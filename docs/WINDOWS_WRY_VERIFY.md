# Windows (wry + WebView2) desktop build — verified from Linux, under Wine

The decision on `feat/linux-dist` is: CEF (real Chromium) **only on Linux**;
Windows ships Tauri's default wry runtime with the system WebView2. This doc
records a full attempt to verify that Windows path **without a real Windows
machine**: cross-compile on Linux (cargo-xwin, MSVC target), then run the
produced `jorkonvo-desktop.exe` under Wine with the Evergreen WebView2
Runtime installed into a throwaway prefix.

**Bottom line:** the wry/WebView2 Windows build cross-compiles cleanly, runs
under Wine, renders the app, and syncs a real Matrix session over the network.
Not a substitute for testing on real Windows — see the checklist at the end.

## Environment used (2026-09-21)

| Tool | Version | Note |
|------|---------|------|
| wine | 10.0 (CachyOS build, experimental wow64 mode) | system package |
| winetricks | 20260125 | **has no `webview2` verb** |
| umu-run | 1.4.3, GE-Proton10-29 present | not needed in the end |
| rust | 1.98.1 via rustup (user-level), target `x86_64-pc-windows-msvc` | distro Rust has no MSVC std |
| cargo-xwin | installed via `cargo install --locked cargo-xwin` | downloads MSVC CRT + Windows SDK via xwin |
| node | 26.8.1 (repo requires >=20) | fine |
| clang / clang-cl | system (needed by cargo-xwin for `ring` C code) | |
| makensis | **not installed** | no NSIS bundle was produced (running the raw exe is enough for this doc) |
| wine prefix | `~/jk-wine` (win10) | `/tmp` is root-owned tmpfs; wine refuses to create a prefix under it |

## 1. Dependency tree for the Windows target

```
cargo tree --target x86_64-pc-windows-msvc | grep -E 'cef|wry|webview2'
```

- **no `tauri-runtime-cef`** on the Windows target (it is `optional = true`
  and only the `cef` feature pulls it, and that feature is never enabled
  outside Linux builds);
- `tauri-runtime-wry` + `wry 0.56.1` + `webview2-com 0.38.2` are present.

Note the `[patch.crates-io]` still applies on Windows: tauri resolves to the
`feat/cef` git branch — but on non-Linux targets that branch *is* the standard
wry runtime (tauri-runtime-wry), identical code path to crates.io tauri 2.11.x.

## 2. Cross-compilation

```sh
npm ci && npm run build                     # apps/web/dist
cd apps/desktop/src-tauri
cargo xwin build --release --target x86_64-pc-windows-msvc \
    --features tauri/custom-protocol        # ← important, see below
```

- Produces `target/x86_64-pc-windows-msvc/release/jorkonvo-desktop.exe`
  (PE32+ GUI subsystem, ~12 MB). Only benign `LNK4099` PDB warnings.
- **Gotcha:** *without* `--features tauri/custom-protocol` the binary builds
  but runs in dev mode — it tries to load `http://localhost:5173` (the
  `devUrl` from `tauri.conf.json`) and shows an Edge error page
  (screenshot `02`). With the feature, the frontend is embedded from
  `apps/web/dist`.
- `.msi` is impossible on Linux (known). NSIS bundling was skipped (no
  makensis); nothing in this doc depends on an installer.

## 3. `[patch.crates-io]` — could Windows build from stable Tauri 2?

Tested in a scratch copy (`cargo tree --target x86_64-pc-windows-msvc`):

| Variant | Result |
|---|---|
| remove `[patch.crates-io]` only | **fails to resolve**: the git dep `tauri-runtime-cef` requires git-sourced `tauri`; two semver-compatible `tauri 2.x` sources cannot coexist |
| additionally gate `tauri-runtime-cef` to `[target.'cfg(target_os = "linux")'.dependencies]` | **still fails** — cargo resolves every target's table in one graph |
| additionally delete the `cef` feature + the dep entirely | **resolves cleanly**: `tauri 2.11.6` from crates.io, wry/webview2 tree, `tauri-plugin-opener 2.x` from crates.io |

Conclusion: as long as `tauri-runtime-cef` is declared anywhere in the
package, the patch is required — *even for pure Windows builds*. `cargo tree`
verified for the clean variant; `cargo check` was not run for it.

Suggested diff for a hypothetical Windows-only strip (e.g. a CI step or a
`windows` branch — **not applied** on this branch):

```diff
-tauri-runtime-cef = { git = "https://github.com/tauri-apps/tauri", branch = "feat/cef", optional = true }
-
-[features]
-default = []
-cef = ["tauri/cef", "dep:tauri-runtime-cef"]
-
-# Pulls in the whole tauri-apps/tauri monorepo at this branch ...
-[patch.crates-io]
-tauri = { git = "https://github.com/tauri-apps/tauri", branch = "feat/cef" }
-tauri-build = { git = "https://github.com/tauri-apps/tauri", branch = "feat/cef" }
-tauri-macros = { git = "https://github.com/tauri-apps/tauri", branch = "feat/cef" }
-tauri-utils = { git = "https://github.com/tauri-apps/tauri", branch = "feat/cef" }
-tauri-runtime = { git = "https://github.com/tauri-apps/tauri", branch = "feat/cef" }
-tauri-plugin = { git = "https://github.com/tauri-apps/tauri", branch = "feat/cef" }
-tauri-plugin-opener = { git = "https://github.com/tauri-apps/plugins-workspace", branch = "feat/cef" }
```

(nothing else in the manifest is CEF-specific; the `#[cfg(feature = "cef")]`
blocks in `main.rs` compile out automatically)

## 4. Wine run (the interesting part)

### WebView2 Runtime installation — the failure mode worth documenting

- `winetricks webview2` does not exist (winetricks 20260125).
- Used the Microsoft standalone installers under Wine
  (`wine installer.exe /silent /install`):
  - `fwlink 2099617` → **X86** installer. It silently installs a 32-bit-only
    runtime (`EBWebView/x86/EmbeddedBrowserWebView.dll`, no `x64`). On a
    64-bit process the loader then fails discovery with `0x80070002` and the
    app shows a **silent blank window** (screenshot `01`) — no panic, no
    error anywhere. This is exactly the failure a mis-provisioned prefix
    produces.
  - `fwlink 2124701` → **X64** Evergreen Standalone Installer → lays down
    `EBWebView/x64/EmbeddedBrowserWebView.dll` →
    `GetAvailableCoreWebView2BrowserVersionString` returns `153.0.4234.48`.
- Diagnosis was done with a 30-line probe exe calling
  `GetAvailableCoreWebView2BrowserVersionString` (webview2-com) plus
  `WINEDEBUG=+file`, which showed the loader probing
  `<folder>\EBWebView\x64\EmbeddedBrowserWebView.dll`. Registry discovery
  additionally needed the `{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` key
  (`pv`, `location`) mirrored under `HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients`
  (the 64-bit view; the X86 installer only writes `WOW6432Node`).

### The app itself

With the x64 runtime in the prefix, `jorkonvo-desktop.exe`:

- spawns the full `msedgewebview2.exe` browser process tree (6 processes);
- creates the `%LOCALAPPDATA%\dev.jorkonvo.desktop` WebView2 user-data folder;
- renders the app UI (screenshot `03`): window titled `JorKonvo`, 1280×800,
  correct background color, sidebar/channels/composer all drawn;
- syncs a **real, logged-in Matrix session** over Wine's network stack
  (messages, members, avatars; E2EE rust-crypto WASM runs — the
  "couldn't be decrypted" notices are the expected fresh-device state, not a
  failure);
- `WINEDEBUG=err+all` shows only benign noise (`uiautomation` stubs, one
  `RoGetActivationFactory` miss, a single `wglSetPixelFormat` warning,
  `edgeupdate` service skipped). **No panics, no crashes** across
  ~10 minutes of runtime.
- **second instance:** a second launch starts a second process + second
  window; nothing panics, nothing hands off. There is **no single-instance
  enforcement on Windows** (the Linux CEF build gets that de facto from the
  Chromium profile lock). → recommend `tauri-plugin-single-instance` for the
  Windows build (not added in this branch).
- **Discord Rich Presence (`discord_rpc.rs`):** with no Discord present, the
  named-pipe listener (`interprocess` crate, Windows code path) starts
  silently (no "all slots taken" message), and the app keeps running — the
  no-Discord crash-safety requirement holds. Actual RPC traffic with a real
  game was not tested under Wine.
- **taskbar badge (`setBadgeCount`):** capability is granted; behavior under
  Wine is not meaningful and was not asserted. Needs real Windows.

### Screenshots (`docs/windows-wry-verify/`)

1. `01-blank-window-runtime-missing.png` — X86-only runtime: blank window, no error
2. `02-devurl-error-page.png` — binary built without `tauri/custom-protocol`
3. `03-app-rendering-wine-webview2.png` — the app running under Wine + WebView2

## 5. NOT verified (explicitly)

- **Real Windows** (real WebView2 Evergreen servicing, real COM/WER
  integration, window chrome/DPI, hardware acceleration).
- **WebRTC / calls: microphone, camera, screen share.** Not tested under Wine
  and *not reported working*. WebView2 permission prompting for
  getUserMedia/getDisplayMedia is the main open risk for a calls app — must
  be verified on real Windows first.
- **NSIS installer** end-to-end (no makensis here) and installer-based
  WebView2 bootstrapping on a clean machine (`webviewInstallMode`).
- **Discord RPC with an actual game**; only the no-Discord no-crash case.
- `cargo check` (vs `tree`) for the patch-free manifest variant.
- CEF Windows build — deliberately out of scope (CEF stays Linux-only).

## 6. Manual test checklist for a real Windows machine

1. `winget install --id Microsoft.EdgeWebView2Runtime` (or verify preinstalled
   via the registry `pv` key); then install/run the NSIS build produced by CI.
2. First launch: window appears at 1280×800, no console window, app UI renders
   (not blank — blank = runtime/loader problem, see screenshot 01).
3. Login (QR SSO + password), messages sync, E2EE verification flow works.
4. External links open in the default browser; top-frame navigation never
   leaves the app.
5. Second launch while running: expected to be blocked/handed off once
   `tauri-plugin-single-instance` is added (today: a second window opens).
6. Voice/video call: mic + camera permission prompts appear and are honored;
   device switching works (watch for the `setSinkId`/webAudioMix fallback —
   see `groupCallStore.ts`); screen share works.
7. Discord RPC: run a game with Rich Presence while JorKonvo is running;
   activity shows on the profile; closing the game clears it.
8. Unread badge toggle (Settings → Appearance): taskbar badge count changes.
9. Long-run stability: sleep/resume, network flaps, window resize/minimize.

## Reproducing this verification

```sh
rustup toolchain install stable --profile minimal \
    --target x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
npm ci && npm run build
cd apps/desktop/src-tauri
cargo xwin build --release --target x86_64-pc-windows-msvc \
    --features tauri/custom-protocol

WINEPREFIX=~/jk-wine wineboot -i && winetricks win10
# WebView2: fwlink 2124701 (X64 standalone!) — NOT 2099617 (X86)
curl -L -o wv2-x64.exe "https://go.microsoft.com/fwlink/?linkid=2124701"
WINEPREFIX=~/jk-wine wine wv2-x64.exe /silent /install

WINEPREFIX=~/jk-wine WINEDEBUG=err+all \
    wine target/x86_64-pc-windows-msvc/release/jorkonvo-desktop.exe
```
