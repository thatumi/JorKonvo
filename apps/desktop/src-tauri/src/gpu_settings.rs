//! Linux-only GPU / hardware-video settings.
//!
//! The CEF command line is fixed at process start, so the settings live in a small
//! JSON file that `main()` reads *before* building the app; the settings UI (apps/web)
//! reads/writes it through the commands below and asks for a restart.
//!
//! Defaults: hardware video decode ON, hardware video encode OFF (unreliable in
//! Chromium's WebRTC path - opt-in only), software rendering OFF (escape hatch).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct GpuSettings {
    pub hw_decode: bool,
    pub hw_encode: bool,
    pub software_render: bool,
}

impl Default for GpuSettings {
    fn default() -> Self {
        Self { hw_decode: true, hw_encode: false, software_render: false }
    }
}

/// What the UI needs to decide which toggles to show.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub settings: GpuSettings,
    /// `/dev/dri` has a render node - there is a GPU to accelerate with at all.
    pub gpu_present: bool,
    /// A VA-API driver (`*_drv_video.so`) exists on the host. The AppImage ships no
    /// GPU drivers (USE_HOST_DRIVERS_EXPERIMENTAL), so without one there is no HW video.
    pub vaapi_driver_found: bool,
}

fn settings_path() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    Some(base.join("jorkonvo-desktop").join("gpu-settings.json"))
}

pub fn load() -> GpuSettings {
    settings_path()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save(s: &GpuSettings) -> Result<(), String> {
    let p = settings_path().ok_or("no config directory")?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(p, json).map_err(|e| e.to_string())
}

fn gpu_present() -> bool {
    std::fs::read_dir("/dev/dri")
        .map(|d| d.flatten().any(|e| e.file_name().to_string_lossy().starts_with("renderD")))
        .unwrap_or(false)
}

fn vaapi_driver_found() -> bool {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(p) = std::env::var_os("LIBVA_DRIVERS_PATH") {
        dirs.extend(std::env::split_paths(&p));
    }
    for d in [
        "/usr/lib/dri",
        "/usr/lib64/dri",
        "/usr/lib/x86_64-linux-gnu/dri",
        "/usr/lib/aarch64-linux-gnu/dri",
        "/usr/lib/va",
    ] {
        dirs.push(PathBuf::from(d));
    }
    dirs.iter().any(|d| {
        std::fs::read_dir(d)
            .map(|rd| rd.flatten().any(|e| e.file_name().to_string_lossy().ends_with("_drv_video.so")))
            .unwrap_or(false)
    })
}

/// CEF/Chromium switches for the given settings, as `(switch, value)` pairs.
/// All feature names are listed under both their older and newer Chromium spellings;
/// Chromium ignores feature names it does not know, so this stays correct across
/// CEF bumps.
pub fn command_line_args(s: &GpuSettings) -> Vec<(String, Option<String>)> {
    // Screen sharing on Linux needs the PipeWire capturer regardless of GPU settings.
    let mut enable: Vec<&str> = vec!["WebRTCPipeWireCapturer"];
    let mut args: Vec<(String, Option<String>)> = Vec::new();

    if s.software_render {
        args.push(("disable-gpu".into(), None));
        args.push(("disable-accelerated-video-decode".into(), None));
        args.push(("disable-accelerated-video-encode".into(), None));
    } else {
        // ANGLE's GLX backend (this pinned CEF's default on Linux) fails outright against a
        // glvnd host: glXQueryExtensionsString returns NULL, independent of sandboxing, the
        // compositor (XWayland vs Xvfb) or where the GL libraries come from - measured live
        // 2026-10-09 on an Intel/glvnd laptop, see docs/LINUX_PACKAGING.md. ANGLE's EGL
        // backend is the one cross-libc-dlopen's own upstream suite validates end to end for
        // VA-API on Intel (mpv, report 9.19), so force it explicitly rather than trust the
        // GLX default.
        args.push(("use-gl".into(), Some("angle".into())));
        args.push(("use-angle".into(), Some("gl-egl".into())));
        if s.hw_decode {
            enable.extend(["VaapiVideoDecoder", "VaapiIgnoreDriverChecks", "AcceleratedVideoDecodeLinuxGL"]);
        } else {
            args.push(("disable-accelerated-video-decode".into(), None));
        }
        if s.hw_encode {
            enable.extend(["VaapiVideoEncoder", "AcceleratedVideoEncoder"]);
        } else {
            args.push(("disable-accelerated-video-encode".into(), None));
        }
    }
    args.push(("enable-features".into(), Some(enable.join(","))));
    args
}

#[tauri::command]
pub fn get_gpu_settings() -> GpuInfo {
    GpuInfo { settings: load(), gpu_present: gpu_present(), vaapi_driver_found: vaapi_driver_found() }
}

#[tauri::command]
pub fn set_gpu_settings(settings: GpuSettings) -> Result<(), String> {
    save(&settings)
}

/// Restart the app so new CEF switches take effect. Inside an AppImage the running
/// binary lives in a temporary mount, so relaunch `$APPIMAGE` itself - after a short
/// delay, so the old instance has released its singleton lock.
#[tauri::command]
pub fn relaunch_app<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    if let Some(img) = std::env::var_os("APPIMAGE").filter(|v| !v.is_empty()) {
        let _ = std::process::Command::new("sh")
            .arg("-c")
            .arg("sleep 1; exec \"$0\"")
            .arg(img)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
        app.exit(0);
    } else {
        app.restart();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enable(args: &[(String, Option<String>)]) -> String {
        args.iter().find(|(k, _)| k == "enable-features").and_then(|(_, v)| v.clone()).unwrap()
    }

    #[test]
    fn defaults_decode_on_encode_off() {
        let a = command_line_args(&GpuSettings::default());
        let e = enable(&a);
        assert!(e.contains("WebRTCPipeWireCapturer") && e.contains("VaapiVideoDecoder"));
        assert!(!e.contains("VaapiVideoEncoder"));
        assert!(a.iter().any(|(k, _)| k == "disable-accelerated-video-encode"));
        assert!(!a.iter().any(|(k, _)| k == "disable-gpu"));
        assert!(a.contains(&("use-gl".to_string(), Some("angle".to_string()))));
        assert!(a.contains(&("use-angle".to_string(), Some("gl-egl".to_string()))), "GLX backend is known broken on glvnd hosts");
    }

    #[test]
    fn encode_opt_in_and_software_escape_hatch() {
        let a = command_line_args(&GpuSettings { hw_encode: true, ..Default::default() });
        assert!(enable(&a).contains("VaapiVideoEncoder"));
        assert!(!a.iter().any(|(k, _)| k == "disable-accelerated-video-encode"));

        let a = command_line_args(&GpuSettings { software_render: true, hw_encode: true, hw_decode: true });
        assert!(a.iter().any(|(k, _)| k == "disable-gpu"));
        assert!(!a.iter().any(|(k, _)| k == "use-angle"), "no point forcing an ANGLE backend with the GPU off");
        let e = enable(&a);
        assert!(e.contains("WebRTCPipeWireCapturer") && !e.contains("Vaapi"), "screen share must survive software mode");
    }

    #[test]
    fn missing_or_partial_json_falls_back_to_defaults() {
        let s: GpuSettings = serde_json::from_str(r#"{"hwEncode":true}"#).unwrap();
        assert_eq!(s, GpuSettings { hw_decode: true, hw_encode: true, software_render: false });
    }
}
