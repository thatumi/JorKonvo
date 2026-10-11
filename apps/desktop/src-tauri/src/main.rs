// Prevents an extra console window from popping up on Windows in release builds.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod discord_rpc;
#[cfg(target_os = "linux")]
mod gpu_settings;

use std::sync::{Arc, Mutex, OnceLock};
use tauri::{Emitter, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri_plugin_opener::OpenerExt;

#[cfg(target_os = "linux")]
const PLATFORM: &str = "linux";
#[cfg(target_os = "macos")]
const PLATFORM: &str = "darwin";
#[cfg(target_os = "windows")]
const PLATFORM: &str = "win32";

/// Only plain web/mail links may be handed to the OS - never a custom
/// protocol handler, file://, etc. Mirrors the Electron build's
/// `isSafeExternalUrl` exactly.
fn is_safe_external_url(raw: &str) -> bool {
    match url::Url::parse(raw) {
        Ok(u) => matches!(u.scheme(), "https" | "http" | "mailto"),
        Err(_) => false,
    }
}

/// Linux only: bridge to the GPU / hardware-video settings commands (gpu_settings.rs).
#[cfg(target_os = "linux")]
const GPU_BRIDGE: &str = r#"
    gpu: {
      get: () => window.__TAURI__.core.invoke("get_gpu_settings"),
      set: (settings) => window.__TAURI__.core.invoke("set_gpu_settings", { settings }),
      relaunch: () => window.__TAURI__.core.invoke("relaunch_app"),
    },"#;
#[cfg(not(target_os = "linux"))]
const GPU_BRIDGE: &str = "";

/// Injected before any app script runs, standing in for the old Electron
/// `preload.cts` contextBridge. Keeps the exact same `window.jorkonvoDesktop`
/// shape (`platform`, `onActivityUpdate`) so apps/web needs zero changes.
/// `onActivityUpdate` must return its unsubscribe function synchronously,
/// but `window.__TAURI__.event.listen` is only ever async - the `cancelled`
/// flag covers an unsubscribe call that lands before the listen() promise
/// has resolved.
fn build_init_script() -> String {
    format!(
        r#"(function () {{
  window.jorkonvoDesktop = {{
    platform: "{platform}",
    onActivityUpdate(callback) {{
      let unlisten = null;
      let cancelled = false;
      window.__TAURI__.event.listen("jorkonvo:activity", (event) => callback(event.payload)).then((fn) => {{
        if (cancelled) {{ fn(); return; }}
        unlisten = fn;
      }});
      return () => {{
        cancelled = true;
        if (unlisten) unlisten();
      }};
    }},{gpu}
  }};
}})();"#,
        platform = PLATFORM,
        gpu = GPU_BRIDGE
    )
}

fn main() {
    let rpc_handle: Arc<Mutex<Option<discord_rpc::DiscordRpcServerHandle>>> = Arc::new(Mutex::new(None));
    let rpc_handle_for_exit = rpc_handle.clone();

    let builder = tauri::Builder::default();
    // Linux screen sharing: getDisplayMedia()'s actual frame capture goes
    // through WebRTC's PipeWire capturer, which this CEF build does not turn
    // on by default (confirmed live: no source picker ever appeared).
    // command_line_args is the only CEF configuration hook this pinned
    // tauri/feat/cef revision exposes (no enable_features()/Cef builder yet).
    // The same switch list also carries the user's GPU / hardware-video choices
    // (Settings; read from gpu-settings.json, so changes need a restart).
    #[cfg(feature = "cef")]
    let builder = builder.command_line_args(gpu_settings::command_line_args(&gpu_settings::load()));
    #[cfg(target_os = "linux")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        gpu_settings::get_gpu_settings,
        gpu_settings::set_gpu_settings,
        gpu_settings::relaunch_app
    ]);

    let app = builder
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            // The window's own origin is only known once its first (real) navigation
            // happens, so the guard just remembers whichever origin shows up first
            // (the app itself, dev server or bundled asset scheme) and denies the rest -
            // matching the Electron build's fixed `appOrigin` check, without hardcoding
            // Tauri's asset-protocol origin, which is version- and OS-sensitive.
            let allowed_origin: Arc<OnceLock<String>> = Arc::new(OnceLock::new());
            let nav_origin = allowed_origin.clone();
            let nav_app_handle = app.handle().clone();

            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("JorKonvo")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .background_color(tauri::window::Color(0x1e, 0x1f, 0x22, 0xff))
                .initialization_script(&build_init_script())
                // Tauri's own drag-drop tracking (used for its native DragDropEvent
                // API, which nothing in this app listens for) injects a script that
                // intercepts HTML5 drag events for its own bridge; disabling it lets
                // the page's own dragover/drop handlers (file upload) see them
                // untouched.
                .disable_drag_drop_handler()
                .on_navigation(move |url| {
                    let origin = format!("{}://{}", url.scheme(), url.host_str().unwrap_or_default());
                    let allowed = nav_origin.get_or_init(|| origin.clone());
                    if &origin == allowed {
                        return true;
                    }
                    // Same intent as the Electron build's will-navigate handler: block the
                    // top frame from ever leaving the app, and hand safe links to the OS
                    // browser instead (this also covers window.open()/target=_blank, e.g.
                    // the QR-login SSO popup, since WebKitGTK routes those through the same
                    // navigation decision).
                    if is_safe_external_url(url.as_str()) {
                        let _ = nav_app_handle.opener().open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                // Explicit answers so camera/mic/notifications/clipboard stay silent
                // (no OS/browser permission bubble) on EITHER CEF runtime style -
                // previously unset, so it only worked by accident because Alloy's
                // own unstyled fallback happens to auto-grant camera+mic. Desktop
                // capture (screen share) is deliberately left at Default: CEF never
                // lets an app-level Allow answer hand out a desktop stream (there is
                // no PermissionKind that names WHICH screen/window), so it always
                // falls through to CEF's own picker - which only exists in Chrome
                // style. See the JORKONVO_CEF_STYLE comment below.
                .on_permission_request(|_webview, kind| match kind {
                    PermissionKind::Camera
                    | PermissionKind::Microphone
                    | PermissionKind::Notifications
                    | PermissionKind::ClipboardRead => PermissionResponse::Allow,
                    _ => PermissionResponse::Default,
                });

            // Alloy = CEF's embedder-controlled style (no Chrome browser UI: no
            // password-save bubble, no permission bubbles). Chrome style is the
            // CEF default. JORKONVO_CEF_STYLE=chrome switches back for debugging -
            // and, as of the screen-share investigation above, is *required* for
            // it: Alloy has no desktop-picker UI at all, so getDisplayMedia() is
            // refused outright (confirmed by reading tauri-runtime-cef's own
            // permission handler - see docs/LINUX_PACKAGING.md). Chrome style shows
            // Chromium's real "Share your screen" picker but also brings back its
            // browser-chrome UI for anything on_permission_request above didn't
            // explicitly answer (notably the password-save bubble) - not yet
            // switched to by default because of that trade-off; needs a live call
            // to confirm what it actually looks like before deciding.
            #[cfg(feature = "cef")]
            let builder = builder.browser_runtime_style(
                if std::env::var("JORKONVO_CEF_STYLE").as_deref() == Ok("chrome") {
                    tauri_runtime_cef::RuntimeStyle::Chrome
                } else {
                    tauri_runtime_cef::RuntimeStyle::Alloy
                },
            );

            let window = builder.build()?;

            // No WebRTC hack needed here anymore - the `cef` runtime (see
            // Cargo.toml) embeds a real Chromium, which has always had working
            // WebRTC. This block only ever existed to work around standard
            // distro WebKitGTK builds shipping without it (see git history on
            // this branch for the full investigation).

            // CEF ships Chrome's own password-manager UI (the "Save password?"
            // bubble) on by default - browser chrome that has no place in an
            // embedded app. Chromium's preference system (not a command-line
            // switch) is what actually gates it; `credentials_enable_service`
            // is the same pref chrome://password-manager/settings's "Offer to
            // save passwords" toggle writes to.
            //
            // UNRESOLVED: this currently does nothing. `can_set_preference`
            // returns true, we're confirmed to be on the CEF UI thread, and
            // `set_preference` still returns failure with an empty error
            // string - no further diagnostic available from the outside.
            // Left in (harmless no-op) in case a future tauri-runtime-cef/CEF
            // update fixes whatever this is; the password prompt itself is
            // still live until then.
            #[cfg(feature = "cef")]
            {
                use tauri_runtime_cef::cef::{self, ImplPreferenceManager, ImplValue};
                if let Some(request_context) = cef::request_context_get_global_context() {
                    for pref in ["credentials_enable_service", "credentials_enable_autosignin"] {
                        let Some(mut value) = cef::value_create() else { continue };
                        value.set_bool(0);
                        let _ = request_context.set_preference(Some(&pref.into()), Some(&mut value), None);
                    }
                }
            }

            let emit_window = window.clone();
            let handle = discord_rpc::start(move |activity| {
                let _ = emit_window.emit("jorkonvo:activity", activity);
            });
            if handle.bound_pipe_id.is_none() {
                eprintln!("Discord RPC-compatible server: all discord-ipc-0..9 slots are taken, not starting.");
            }
            *rpc_handle.lock().unwrap() = Some(handle);

            Ok(())
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|err| {
            // The most common cause on CEF (Linux): another JorKonvo (or a
            // leftover one) already owns the Chromium profile lock, so this
            // process hands off to it and initialisation fails with a
            // misleading `WebviewRuntimeNotInstalled`.
            eprintln!(
                "JorKonvo could not start: {err}\n\
                 If JorKonvo is already running (or a stale process is left over), \
                 close it first: pkill -f jorkonvo-desktop"
            );
            std::process::exit(1);
        });

    app.run(move |_app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(handle) = rpc_handle_for_exit.lock().unwrap().take() {
                handle.cleanup();
            }
        }
    });
}
