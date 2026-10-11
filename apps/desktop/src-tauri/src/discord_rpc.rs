//! Reimplements the CLIENT-FACING side of Discord's own local Rich Presence
//! IPC protocol, so games/apps that already integrate Discord's Game SDK
//! report their "Playing X" activity to JorKonvo the same way they'd report
//! it to the real Discord desktop app.
//!
//! This is NOT an official, documented API - Discord doesn't publish this
//! wire format for third parties. What's implemented here is the protocol
//! shape that's converged, independently, across many long-running
//! open-source reimplementations (the `discord-rpc` npm package,
//! `discordjs/RPC`, Python's `pypresence`, `discord-ipc-rpc`, etc.) - a
//! length-prefixed frame format over a local duplex byte stream at
//! `discord-ipc-0` through `discord-ipc-9`, the same path virtually every
//! native Rich Presence library connects to by default.
//!
//! Ported 1:1 from the Electron build's discordRpcServer.ts. The protocol
//! layer below (framing, handshake, SET_ACTIVITY, ownership tracking) is
//! fully platform-independent - only *how a duplex connection is obtained*
//! differs: a POSIX Unix domain socket on Linux/macOS, a Windows named pipe
//! (`\\.\pipe\discord-ipc-{0..9}`, via the `interprocess` crate - std has no
//! named-pipe support) on Windows. Each connection gets a synthetic
//! `conn_id` (not an OS-level fd/handle) purely to track "who currently owns
//! the shown activity," so the platform split never has to leak into the
//! protocol logic.
//!
//! PROXY MODE (works alongside the real Discord app): JorKonvo binds the
//! first free `discord-ipc-N`. If it starts BEFORE Discord it owns slot 0,
//! Discord falls back to the next free slot, and every game connects to
//! JorKonvo. On each game handshake JorKonvo then opens its own connection
//! to the real Discord (any other slot that answers), relays every frame in
//! both directions unchanged, and additionally records the activity for
//! Matrix presence - so the game shows up in Discord AND in JorKonvo. When
//! no real Discord is reachable it answers the game itself (standalone).
//!
//! REMAINING LIMITATION: if Discord is already running and owns slot 0,
//! games talk to it directly and there is no way to intercept that traffic;
//! start JorKonvo first (or restart the game after restarting Discord).

use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[cfg(unix)]
use std::net::Shutdown;
#[cfg(unix)]
use std::os::unix::net::{UnixListener, UnixStream};

#[cfg(windows)]
use interprocess::os::windows::named_pipe::{pipe_mode, PipeListener, PipeListenerOptions};

const MAX_PIPE_ID: u32 = 9;

type UpstreamRead = Box<dyn Read + Send>;
type UpstreamWrite = Box<dyn Write + Send>;
/// Opens a connection to the real Discord (or any other RPC server that is
/// not us), if one is reachable right now.
type Connector = Arc<dyn Fn() -> Option<(UpstreamRead, UpstreamWrite)> + Send + Sync>;

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;
const OP_PING: u32 = 3;
const OP_PONG: u32 = 4;

#[derive(Clone, Serialize)]
pub struct RpcActivity {
    #[serde(rename = "applicationId")]
    pub application_id: String,
    /// Best-effort, via an unauthenticated Discord API lookup - see `resolve_app_name`.
    #[serde(rename = "appName")]
    pub app_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(rename = "largeImageText", skip_serializing_if = "Option::is_none")]
    pub large_image_text: Option<String>,
    #[serde(rename = "smallImageText", skip_serializing_if = "Option::is_none")]
    pub small_image_text: Option<String>,
    #[serde(rename = "startedAt", skip_serializing_if = "Option::is_none")]
    pub started_at: Option<f64>,
    #[serde(rename = "partyCurrent", skip_serializing_if = "Option::is_none")]
    pub party_current: Option<i64>,
    #[serde(rename = "partyMax", skip_serializing_if = "Option::is_none")]
    pub party_max: Option<i64>,
}

pub struct DiscordRpcServerHandle {
    /// Which of discord-ipc-0..9 we actually bound, or None if all 10 were taken.
    pub bound_pipe_id: Option<u32>,
    /// Only set on Unix - the socket file to remove on exit. Windows named
    /// pipes have no filesystem entry to clean up; the OS reclaims the pipe
    /// name itself once every handle to it is closed.
    socket_path: Option<PathBuf>,
}

impl DiscordRpcServerHandle {
    /// Best-effort removal of the socket file on app exit. The listener
    /// thread itself is not joined - the process is about to exit anyway,
    /// and Rust doesn't run destructors across `process::exit`, so there's
    /// nothing extra a join would buy here. A leftover socket file from an
    /// unclean exit is already handled by `is_socket_stale` on next launch.
    pub fn cleanup(&self) {
        if let Some(path) = &self.socket_path {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(unix)]
fn ipc_path(id: u32) -> PathBuf {
    let base = std::env::var("XDG_RUNTIME_DIR")
        .or_else(|_| std::env::var("TMPDIR"))
        .unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(base).join(format!("discord-ipc-{id}"))
}

/// A path being bound (AddrInUse) does NOT necessarily mean a live server
/// owns it - a crashed previous run can leave an orphaned socket file
/// behind, which also fails to bind until removed. The only safe way to
/// tell the two apart is to actually try connecting to it: a real listener
/// accepts, an orphaned file refuses (ConnectionRefused) or is simply gone
/// by the time we check (NotFound). Unlinking a path that's genuinely
/// still in use would silently cut it off from new connections while its
/// existing ones keep working - exactly what this check exists to prevent.
/// Windows named pipes need no equivalent: there's no stale file to leak,
/// the OS drops the name the moment the last handle closes.
#[cfg(unix)]
fn is_socket_stale(path: &PathBuf) -> bool {
    match UnixStream::connect(path) {
        Ok(stream) => {
            let _ = stream.shutdown(Shutdown::Both);
            false
        }
        Err(err) => matches!(err.kind(), ErrorKind::ConnectionRefused | ErrorKind::NotFound),
    }
}

/// Binds the first free discord-ipc-{0..9}, reclaiming a stale socket file once per id.
#[cfg(unix)]
fn bind_first_free_slot() -> Option<(UnixListener, u32)> {
    for id in 0..=MAX_PIPE_ID {
        let path = ipc_path(id);
        match UnixListener::bind(&path) {
            Ok(listener) => return Some((listener, id)),
            Err(err) if err.kind() == ErrorKind::AddrInUse && is_socket_stale(&path) => {
                if fs::remove_file(&path).is_ok() {
                    if let Ok(listener) = UnixListener::bind(&path) {
                        return Some((listener, id));
                    }
                }
            }
            Err(_) => {}
        }
    }
    None
}

/// Binds the first free `\\.\pipe\discord-ipc-{0..9}`. Unlike Unix, a taken
/// name just fails outright - Windows never leaves a stale pipe name behind
/// for a crashed process, so there's no reclaim step to mirror.
#[cfg(windows)]
fn bind_first_free_slot() -> Option<(PipeListener<pipe_mode::Bytes, pipe_mode::Bytes>, u32)> {
    for id in 0..=MAX_PIPE_ID {
        let name = format!(r"\\.\pipe\discord-ipc-{id}");
        if let Ok(listener) = PipeListenerOptions::new()
            .path(std::path::Path::new(&name))
            .create::<pipe_mode::Bytes, pipe_mode::Bytes>()
        {
            return Some((listener, id));
        }
    }
    None
}

/// Connects to the first other `discord-ipc-N` that accepts - i.e. the real
/// Discord, which took a slot after us. A stale file just refuses and is skipped.
#[cfg(unix)]
fn connect_upstream(own_id: u32) -> Option<(UpstreamRead, UpstreamWrite)> {
    // Only slots ABOVE ours: real Discord takes the next free slot after JorKonvo, and
    // looking only upwards makes a proxy loop between two JorKonvo instances impossible.
    for id in (own_id + 1)..=MAX_PIPE_ID {
        if let Ok(stream) = UnixStream::connect(ipc_path(id)) {
            if let Ok(reader) = stream.try_clone() {
                return Some((Box::new(reader), Box::new(stream)));
            }
        }
    }
    None
}

#[cfg(windows)]
fn connect_upstream(own_id: u32) -> Option<(UpstreamRead, UpstreamWrite)> {
    use interprocess::os::windows::named_pipe::DuplexPipeStream;
    use interprocess::ConnectWaitMode;
    // Only slots ABOVE ours (see the Unix twin), and never wait unbounded on a busy pipe.
    for id in (own_id + 1)..=MAX_PIPE_ID {
        let name = format!(r"\\.\pipe\discord-ipc-{id}");
        if let Ok(stream) = DuplexPipeStream::<pipe_mode::Bytes>::connect_by_path_with_wait_mode(
            std::path::Path::new(&name),
            ConnectWaitMode::Timeout(Duration::from_millis(250)),
        ) {
            let (reader, writer) = stream.split();
            return Some((Box::new(reader), Box::new(writer)));
        }
    }
    None
}

/// Tiny diagnostics log (`<temp>/jorkonvo-rpc.log`): a GUI app has no console, and
/// "the game says connecting..." is otherwise impossible to debug on someone's PC.
fn log_line(msg: &str) {
    use std::io::Write as _;
    let path = std::env::temp_dir().join("jorkonvo-rpc.log");
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(f, "{secs} {msg}");
    }
}

fn write_frame<W: Write>(writer: &Mutex<W>, op: u32, payload: &Value) {
    let body = serde_json::to_vec(payload).unwrap_or_default();
    let mut header = [0u8; 8];
    header[0..4].copy_from_slice(&op.to_le_bytes());
    header[4..8].copy_from_slice(&(body.len() as u32).to_le_bytes());
    if let Ok(mut w) = writer.lock() {
        let _ = w.write_all(&header);
        let _ = w.write_all(&body);
    }
}

/// Discord exposes a public, unauthenticated lookup for an application's
/// display name by client_id (`GET /applications/{id}/rpc`) - this is how
/// the real Discord client resolves "X wants to..." prompts for an app
/// you've never used before. Best-effort only: silently falls back to None
/// on any failure, which is fine since the caller already has
/// state/details to show regardless. Note this sends the game's client_id
/// to Discord's own servers.
fn resolve_app_name(client_id: &str) -> Option<String> {
    let mut url = reqwest::Url::parse("https://discord.com/api/v10/applications/").ok()?;
    url.path_segments_mut().ok()?.push(client_id).push("rpc");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .ok()?;
    let res = client.get(url).send().ok()?;
    if !res.status().is_success() {
        return None;
    }
    let data: Value = res.json().ok()?;
    data.get("name").and_then(|v| v.as_str()).map(String::from)
}

struct Shared {
    /// Classic single-slot Rich Presence model: whichever connection most
    /// recently sent a non-null SET_ACTIVITY is "current" (tracked by a
    /// synthetic per-connection id, not an OS-level fd/handle - see the
    /// module doc comment), and activity only clears when THAT connection
    /// closes/clears it - a different game's connection closing must not
    /// blank out an unrelated, still-live one.
    current_owner: Mutex<Option<u64>>,
}

fn clear_if_owner(conn_id: u64, shared: &Shared, on_activity: &(dyn Fn(Option<RpcActivity>) + Send + Sync)) {
    let mut owner = shared.current_owner.lock().unwrap();
    if *owner == Some(conn_id) {
        *owner = None;
        on_activity(None);
    }
}

fn set_activity(
    conn_id: u64,
    client_id: String,
    activity_arg: Option<Value>,
    shared: &Shared,
    on_activity: &(dyn Fn(Option<RpcActivity>) + Send + Sync),
) {
    let arg = match activity_arg {
        Some(v) if !v.is_null() => v,
        _ => {
            clear_if_owner(conn_id, shared, on_activity);
            return;
        }
    };
    let app_name = resolve_app_name(&client_id);
    let started_at = arg.get("timestamps").and_then(|t| t.get("start")).and_then(Value::as_f64);
    let large_image_text = arg
        .get("assets")
        .and_then(|a| a.get("large_text"))
        .and_then(Value::as_str)
        .map(String::from);
    let small_image_text = arg
        .get("assets")
        .and_then(|a| a.get("small_text"))
        .and_then(Value::as_str)
        .map(String::from);
    let party_size = arg.get("party").and_then(|p| p.get("size")).and_then(Value::as_array);
    let party_current = party_size.and_then(|a| a.first()).and_then(Value::as_i64);
    let party_max = party_size.and_then(|a| a.get(1)).and_then(Value::as_i64);

    *shared.current_owner.lock().unwrap() = Some(conn_id);
    on_activity(Some(RpcActivity {
        application_id: client_id,
        app_name,
        details: arg.get("details").and_then(Value::as_str).map(String::from),
        state: arg.get("state").and_then(Value::as_str).map(String::from),
        large_image_text,
        small_image_text,
        started_at,
        party_current,
        party_max,
    }));
}

fn handle_frame<W: Write>(
    conn_id: u64,
    client_id: &mut Option<String>,
    op: u32,
    payload: Option<Value>,
    writer: &Mutex<W>,
    reply: bool,
    shared: &Shared,
    on_activity: &(dyn Fn(Option<RpcActivity>) + Send + Sync),
) {
    match op {
        OP_HANDSHAKE => {
            *client_id = payload
                .as_ref()
                .and_then(|p| p.get("client_id"))
                .and_then(Value::as_str)
                .map(String::from);
            if reply {
                write_frame(
                    writer,
                    OP_FRAME,
                    &json!({
                    "cmd": "DISPATCH",
                    "evt": "READY",
                    "data": {
                        "v": 1,
                        "config": {
                            "api_endpoint": "//discord.com/api",
                            "cdn_host": "cdn.discordapp.com",
                            "environment": "production"
                        },
                        // A real, plausible-looking local user - some SDKs only check that this exists, not its actual values.
                        "user": { "id": "0", "username": "jorkonvo", "discriminator": "0000", "avatar": null }
                    }
                }),
                );
            }
        }
        OP_FRAME => {
            let Some(msg) = payload else { return };
            let cmd = msg.get("cmd").and_then(Value::as_str);
            let activity_arg = msg.get("args").and_then(|a| a.get("activity")).cloned();
            if cmd == Some("SET_ACTIVITY") {
                if let Some(cid) = client_id.clone() {
                    set_activity(conn_id, cid, activity_arg.clone(), shared, on_activity);
                }
            }
            // Most RPC client libraries wait for an ack matching their nonce before proceeding
            // (in proxy mode the real Discord sends it, so we stay quiet).
            if let (true, Some(cmd_str)) = (reply, cmd) {
                let nonce = msg.get("nonce").cloned().unwrap_or(Value::Null);
                write_frame(
                    writer,
                    OP_FRAME,
                    &json!({ "cmd": cmd_str, "data": activity_arg.unwrap_or(json!({})), "evt": null, "nonce": nonce }),
                );
            }
        }
        OP_PING => {
            if reply {
                write_frame(writer, OP_PONG, &payload.unwrap_or(Value::Null));
            }
        }
        OP_CLOSE => {
            clear_if_owner(conn_id, shared, on_activity);
            // No explicit shutdown() here - it isn't part of the generic
            // Write bound (Unix sockets and Windows named pipes don't share
            // a portable half-close API), and dropping the writer at the
            // end of handle_connection closes the underlying stream either
            // way once the read loop notices the connection is done.
        }
        _ => {}
    }
}

fn handle_connection<R: Read, W: Write + Send + 'static>(
    conn_id: u64,
    mut reader: R,
    writer: W,
    shared: Arc<Shared>,
    on_activity: Arc<dyn Fn(Option<RpcActivity>) + Send + Sync>,
    connector: Connector,
) {
    let writer = Arc::new(Mutex::new(writer));
    let mut upstream: Option<UpstreamWrite> = None;
    let mut client_id: Option<String> = None;
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];

    loop {
        let n = match reader.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        buf.extend_from_slice(&chunk[..n]);

        loop {
            if buf.len() < 8 {
                break;
            }
            let op = u32::from_le_bytes(buf[0..4].try_into().unwrap());
            let len = u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize;
            if buf.len() < 8 + len {
                break;
            }

            // Proxy mode: on the game's handshake, open our own connection to the
            // real Discord and relay its replies straight back to the game.
            if op == OP_HANDSHAKE && upstream.is_none() {
                let up = connector();
                log_line(&format!("conn {conn_id}: handshake, upstream Discord {}", if up.is_some() { "connected (proxy)" } else { "not found (standalone)" }));
                if let Some((mut up_reader, up_writer)) = up {
                    upstream = Some(up_writer);
                    let game_writer = writer.clone();
                    thread::spawn(move || {
                        let mut chunk = [0u8; 8192];
                        loop {
                            match up_reader.read(&mut chunk) {
                                Ok(0) | Err(_) => break,
                                Ok(n) => {
                                    let Ok(mut w) = game_writer.lock() else { break };
                                    if w.write_all(&chunk[..n]).is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                    });
                }
            }

            // Forward first (the name lookup below can block for seconds); if the
            // real Discord went away mid-session we fall back to answering ourselves.
            let forwarded = match upstream.as_mut() {
                Some(up) => {
                    if up.write_all(&buf[..8 + len]).is_ok() {
                        true
                    } else {
                        upstream = None;
                        false
                    }
                }
                None => false,
            };

            let body = &buf[8..8 + len];
            let payload: Option<Value> = if body.is_empty() { None } else { serde_json::from_slice(body).ok() };
            handle_frame(conn_id, &mut client_id, op, payload, &writer, !forwarded, &shared, on_activity.as_ref());
            buf.drain(0..8 + len);
        }
    }

    clear_if_owner(conn_id, &shared, on_activity.as_ref());
}

/// Identifies a connection for `Shared::current_owner` tracking - synthetic
/// rather than an OS-level fd/handle so the exact same protocol/ownership
/// logic above works unmodified across both platforms' very different
/// underlying handle types.
static NEXT_CONN_ID: AtomicU64 = AtomicU64::new(1);

#[cfg(unix)]
pub fn start<F>(on_activity: F) -> DiscordRpcServerHandle
where
    F: Fn(Option<RpcActivity>) + Send + Sync + 'static,
{
    let on_activity: Arc<dyn Fn(Option<RpcActivity>) + Send + Sync> = Arc::new(on_activity);
    let shared = Arc::new(Shared { current_owner: Mutex::new(None) });

    match bind_first_free_slot() {
        Some((listener, id)) => {
            log_line(&format!("server bound discord-ipc-{id}"));
            let path = ipc_path(id);
            let connector: Connector = Arc::new(move || connect_upstream(id));
            thread::spawn(move || {
                for stream in listener.incoming().flatten() {
                    let Ok(reader) = stream.try_clone() else { continue };
                    let shared = shared.clone();
                    let on_activity = on_activity.clone();
                    let conn_id = NEXT_CONN_ID.fetch_add(1, Ordering::Relaxed);
                    let connector = connector.clone();
                    thread::spawn(move || handle_connection(conn_id, reader, stream, shared, on_activity, connector));
                }
            });
            DiscordRpcServerHandle { bound_pipe_id: Some(id), socket_path: Some(path) }
        }
        None => DiscordRpcServerHandle { bound_pipe_id: None, socket_path: None },
    }
}

/// Windows named-pipe equivalent of the Unix implementation above - same
/// protocol/ownership logic (`handle_connection` etc.), the only real
/// difference is how a duplex connection is obtained: `PipeStream::split()`
/// gives independent read/send halves the same way Unix's `try_clone()`
/// gives two independent handles to the same socket.
#[cfg(windows)]
pub fn start<F>(on_activity: F) -> DiscordRpcServerHandle
where
    F: Fn(Option<RpcActivity>) + Send + Sync + 'static,
{
    let on_activity: Arc<dyn Fn(Option<RpcActivity>) + Send + Sync> = Arc::new(on_activity);
    let shared = Arc::new(Shared { current_owner: Mutex::new(None) });

    match bind_first_free_slot() {
        Some((listener, id)) => {
            log_line(&format!("server bound discord-ipc-{id}"));
            let connector: Connector = Arc::new(move || connect_upstream(id));
            thread::spawn(move || {
                for stream in listener.incoming().flatten() {
                    let (reader, writer) = stream.split();
                    let shared = shared.clone();
                    let on_activity = on_activity.clone();
                    let conn_id = NEXT_CONN_ID.fetch_add(1, Ordering::Relaxed);
                    let connector = connector.clone();
                    thread::spawn(move || handle_connection(conn_id, reader, writer, shared, on_activity, connector));
                }
            });
            DiscordRpcServerHandle { bound_pipe_id: Some(id), socket_path: None }
        }
        None => DiscordRpcServerHandle { bound_pipe_id: None, socket_path: None },
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn frame(op: u32, v: &Value) -> Vec<u8> {
        let body = serde_json::to_vec(v).unwrap();
        let mut out = op.to_le_bytes().to_vec();
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(&body);
        out
    }

    fn read_frame(s: &mut UnixStream) -> (u32, Value) {
        let mut h = [0u8; 8];
        s.read_exact(&mut h).unwrap();
        let op = u32::from_le_bytes(h[0..4].try_into().unwrap());
        let len = u32::from_le_bytes(h[4..8].try_into().unwrap()) as usize;
        let mut b = vec![0u8; len];
        s.read_exact(&mut b).unwrap();
        (op, serde_json::from_slice(&b).unwrap())
    }

    /// One test on purpose: it points XDG_RUNTIME_DIR at a temp dir, which is process-global.
    #[test]
    fn proxies_to_real_discord_and_falls_back_to_standalone() {
        let dir = std::env::temp_dir().join(format!("jk-rpc-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        std::env::set_var("XDG_RUNTIME_DIR", &dir);

        // A fake "real Discord" that took a later slot (JorKonvo started first and owns 0).
        let discord = UnixListener::bind(ipc_path(5)).unwrap();
        let (seen_tx, seen_rx) = mpsc::channel::<(u32, Value)>();
        thread::spawn(move || {
            for stream in discord.incoming().flatten() {
                let seen_tx = seen_tx.clone();
                thread::spawn(move || {
                    let mut s = stream;
                    loop {
                        let mut h = [0u8; 8];
                        if s.read_exact(&mut h).is_err() {
                            break;
                        }
                        let op = u32::from_le_bytes(h[0..4].try_into().unwrap());
                        let len = u32::from_le_bytes(h[4..8].try_into().unwrap()) as usize;
                        let mut b = vec![0u8; len];
                        if s.read_exact(&mut b).is_err() {
                            break;
                        }
                        let v: Value = serde_json::from_slice(&b).unwrap_or(Value::Null);
                        seen_tx.send((op, v.clone())).unwrap();
                        let reply = if op == OP_HANDSHAKE {
                            json!({"cmd":"DISPATCH","evt":"READY","data":{"user":{"username":"realdiscord"}}})
                        } else {
                            json!({"cmd": v.get("cmd").cloned().unwrap_or(Value::Null), "evt": null, "nonce": v.get("nonce").cloned().unwrap_or(Value::Null), "data": {"from":"discord"}})
                        };
                        s.write_all(&frame(OP_FRAME, &reply)).unwrap();
                    }
                });
            }
        });

        let (act_tx, act_rx) = mpsc::channel::<Option<RpcActivity>>();
        let handle = start(move |a| {
            let _ = act_tx.send(a);
        });
        assert_eq!(handle.bound_pipe_id, Some(0), "we take the first free slot");
        // A second JorKonvo instance must not create a proxy loop with the first one.
        let handle2 = start(|_| {});
        assert_eq!(handle2.bound_pipe_id, Some(1));

        // A game that talks to us connects, handshakes and sets an activity.
        let mut game = UnixStream::connect(ipc_path(0)).unwrap();
        game.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        game.write_all(&frame(OP_HANDSHAKE, &json!({"v":1,"client_id":"123456789"}))).unwrap();
        let (_, ready) = read_frame(&mut game);
        assert_eq!(ready["data"]["user"]["username"], "realdiscord", "READY must come from the real Discord");
        game.write_all(&frame(
            OP_FRAME,
            &json!({"cmd":"SET_ACTIVITY","nonce":"n1","args":{"pid":1,"activity":{"details":"Ranked","state":"In match"}}}),
        ))
        .unwrap();
        let (_, ack) = read_frame(&mut game);
        assert_eq!(ack["data"]["from"], "discord", "the ack must be the real Discord's");
        assert_eq!(ack["nonce"], "n1");

        let (op, hs) = seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!((op, hs["client_id"].as_str()), (OP_HANDSHAKE, Some("123456789")));
        let (_, set) = seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(set["args"]["activity"]["details"], "Ranked", "the real Discord got the activity");

        let act = act_rx.recv_timeout(Duration::from_secs(5)).unwrap().expect("JorKonvo recorded it too");
        assert_eq!(act.details.as_deref(), Some("Ranked"));
        assert_eq!(act.state.as_deref(), Some("In match"));
        drop(game);
        assert!(act_rx.recv_timeout(Duration::from_secs(5)).unwrap().is_none(), "closing the game clears it");

        // Real Discord gone: the next game is answered by JorKonvo itself.
        fs::remove_file(ipc_path(5)).unwrap();
        handle2.cleanup();
        let mut game2 = UnixStream::connect(ipc_path(0)).unwrap();
        game2.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        game2.write_all(&frame(OP_HANDSHAKE, &json!({"v":1,"client_id":"42"}))).unwrap();
        let (_, ready2) = read_frame(&mut game2);
        assert_eq!(ready2["data"]["user"]["username"], "jorkonvo", "standalone fallback");

        handle.cleanup();
        let _ = fs::remove_dir_all(&dir);
    }
}
