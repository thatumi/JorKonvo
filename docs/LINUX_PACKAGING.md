# Linux packaging

The desktop app is Tauri + CEF (Chromium), built with Tauri's unreleased
`feat/cef` branch. Linux ships in four formats, all produced from one build
(`scripts/build-linux.sh`) and each verified in a clean environment:

| Format   | Source of truth                          | Verified on (2026-09-20)                                   |
|----------|------------------------------------------|------------------------------------------------------------|
| AppImage | `scripts/build-linux.sh`                 | dev box (Debian 12) under xvfb; inside an Arch container   |
| `.deb`   | same build (`bundle.linux.deb` in `tauri.conf.json`) | `apt install` + run on debian:trixie, ubuntu:24.04 |
| Flatpak  | `packaging/linux/flatpak/`               | built with flatpak-builder, installed + run in the real sandbox |
| AUR      | `packaging/linux/aur/jorkonvo-bin/`      | `makepkg` + `pacman -U` + run in archlinux                 |
| apt repo | `packaging/linux/apt/` (sample, unsigned) | `apt install jorkonvo` over HTTP on trixie + ubuntu 24.04  |

"Run" always means: window titled `JorKonvo` appears and the page loads
(checked over the DevTools protocol) under xvfb. The xvfb/container results
above came first; real-hardware results are in the next section.

## Ellenőrzött környezet - real desktop verification (2026-09-20)

Machine (owner's desktop, CachyOS): Arch-based rolling, kernel 7.2.2, KDE
Plasma 6.7.4 on **Wayland** (XWayland available), AMD RX 6700 XT (Mesa 26.2.1,
radeonsi/ACO), PipeWire 1.6.8 + WirePlumber, Ryzen 5 3600, 12 threads. **No
webcam on the machine** (`/dev/video*` does not exist) - camera paths could
only be checked as "no video devices enumerated". Earlier container results
were reproduced from a clean clone of this branch.

### AppImage on the real desktop - works

* Launches on the physical Wayland session (via XWayland); window appears,
  GPU-accelerated: `UNMASKED_RENDERER = ANGLE (AMD, AMD Radeon RX 6700 XT
  (radeonsi navi22 ACO), OpenGL 4.6)`.
* Chromium sandbox verified live: renderers run in a **separate user
  namespace with seccomp=2 (filter)**, main process has **no `--no-sandbox`**,
  shipped `chrome-sandbox` is **not setuid** - exactly as documented above.
  `unshare -Ur` works on this kernel; the `fix-namespaces.hook` path was not
  needed.
* Login form against the live homeserver: submit fires
  `POST /_matrix/client/v3/login`, failures show inline
  (`MatrixError: [403] Invalid username or password`). UX note: the raw SDK
  error + URL is developer-facing text; consider humanizing it.
* Messaging works: a test message sent from the real UI into an E2EE room
  appeared in the timeline (rust-crypto path exercised).
* Session persistence across app restarts works.
* Audio device enumeration returns **correct, human-readable PipeWire names**
  ("ATR2100x-USB Microphone Analog Stereo", "USB Audio Analog Stereo", HDMI,
  "Easy Effects"). Caveat: PipeWire exposes profile ports as separate nodes,
  so the mic appears ~6x and sinks several times - a Discord-style picker
  will look cluttered until the list is deduplicated.
* Window management: programmatic resize (exact size honored), fullscreen
  (2560x1440), maximize, all fine.
* Single instance: a second `jorkonvo` launch prints "Opening in existing
  browser session." and exits.
* **Native Wayland is not available in this CEF build**: with `DISPLAY`
  unset and `--ozone-platform=wayland` the app exits at startup with
  `JorKonvo could not start: runtime error: failed to create window`.
  XWayland is the supported path (matches the Flatpak manifest comment).
* No system tray icon exists in the app (no tray code in `src-tauri`) -
  nothing to test there.
* Calls/notifications were NOT testable: they need a second live account
  (the only peer account seen is offline), and this machine has no camera.
* Dev-tool edge case: creating a `chrome://gpu` CDP target crashed the app
  once (renderer-side); app restarts cleanly. Not user-reachable.

### Follow-up live report (2026-09-22, owner, same CachyOS machine) - 3 real bugs

1. **No audio output at all** - not even notification sounds. Microphone
   input works (confirmed live: the mic ring lights up while speaking).
   `ldd ~/.cache/tauri-cef/151.3.12/cef_linux_x86_64/libcef.so` shows CEF
   links `libasound.so.2` directly and has **no `libpulse` reference
   anywhere** (checked both the dynamic dependency list and strings for a
   runtime `dlopen("libpulse...")`). The only PipeWire-related symbols in
   the binary are `BaseCapturerPipeWire`/`webrtc::videocapturemodule::
   PipeWireNode` - the WebRTC **video** desktop-capture module, unrelated to
   general audio output. This CEF build's audio backend is therefore
   ALSA-only. On a PipeWire-managed desktop (this machine: PipeWire +
   WirePlumber), ALSA's `default` device normally routes through the
   `pipewire-alsa` plugin transparently, so this alone doesn't prove the
   playback path is broken - **not independently verified**, just the one
   concrete lead so far. Needs: `aplay -l` / `pw-cli ls Node` output from
   the failing machine, and ideally stderr from a terminal-launched AppImage
   run while a sound should have played, to actually diagnose further.
2. **Speaker device picker only shows "Default"/"System Default"**, even
   though the earlier verification pass above found audio **input**
   enumeration returning full real PipeWire device names. Not yet
   root-caused; may be a separate, narrower gap in how Chromium enumerates
   `audiooutput` kind devices on this CEF build vs. `audioinput`.
3. **Screen sharing shows no source picker at all** - confirmed root cause
   by reading `tauri-runtime-cef`'s own permission-handling source
   (`crates/tauri-runtime-cef/src/cef_impl/client/permission.rs` at the
   pinned `feat/cef` commit): desktop capture (`getDisplayMedia`) is
   **deliberately never answered by the application's own permission
   handler** - CEF requires the whole request to go through its native
   picker, which only exists in **Chrome** runtime style. **Alloy style
   (this app's default, chosen for "no browser chrome") has no desktop-
   picker UI at all**, so CEF's own default handling for Alloy silently
   *refuses* the request outright. This is a genuine, confirmed, structural
   gap, not a config oversight - fixed in `fix/linux-screenshare-audio`
   (below), but the underlying trade-off (Chrome style's other browser-
   chrome coming back, e.g. the password-save bubble) still needs a live
   verdict from the owner.

### Fix attempt (`fix/linux-screenshare-audio`, 2026-09-22) - needs live re-test

`apps/desktop/src-tauri/src/main.rs` changes:

* `command_line_args([("enable-features", Some("WebRTCPipeWireCapturer"))])`
  - the standard Chromium/CEF flag for PipeWire-based screen capture on
    Wayland. This is the only CEF configuration hook the pinned `feat/cef`
    revision (`468796f8`) actually exposes for feature flags - the fluent
    `Cef::default().enable_features(...)` builder seen in some
    `tauri-runtime-cef` doc comments does **not exist** at this pinned
    commit (checked directly: `grep -rn "fn enable_features"` on the
    checked-out source finds nothing under this revision). Verified this
    compiles (`cargo check --features cef` clean) but the actual capture
    path is **not independently testable here** (no compositor/audio
    hardware on this box).
* `.on_permission_request(...)` now explicitly answers Camera, Microphone,
  Notifications and ClipboardRead as `Allow` - previously **unset**
  entirely, so Alloy style's auto-grant fallback happened to cover
  camera/mic by accident and nothing else. This makes the app's actual
  intent explicit and, combined with the next point, keeps behavior
  identical across both runtime styles for everything except desktop
  capture (an explicit `Allow` bypasses CEF's own prompt/bubble regardless
  of style - see the permission-handler source comments cited above).
  Display capture is deliberately left unanswered (`Default`): CEF never
  lets an app-level answer hand out a desktop stream directly (no
  `PermissionKind` names *which* screen/window/tab), so it always defers to
  CEF's own picker either way.
* **Runtime style default is UNCHANGED (still Alloy)** - switching it is
  the one remaining lever that would actually make the picker appear, but
  it trades away Alloy's "no browser chrome" property (most notably the
  password-save bubble this app explicitly worked around before). Test via
  the existing escape hatch: `JORKONVO_CEF_STYLE=chrome ./JorKonvo*.AppImage`
  and report back what the picker AND the rest of the browser chrome
  actually look like live, before this becomes the shipped default.

### .deb - **breaking change found: glibc portability**

Building on a **rolling host** (this CachyOS box, glibc 2.43) bakes
`GLIBC_2.43` symbol requirements into `jorkonvo-desktop`. The .deb
apt-installs cleanly on debian:trixie (Depends verified complete) but the
smoke run aborts:

```
jorkonvo-desktop: /lib/x86_64-linux-gnu/libm.so.6: version `GLIBC_2.43'
not found (required by jorkonvo-desktop)
```

The AppImage is immune (sharun bundles its own glibc); the deb is not.
Mitigation (verified 2026-09-20): `packaging/linux/deb/build-in-container.sh`
runs the Tauri build inside debian:trixie (web bundle stays on the host;
cargo/rustup/CEF are cached in docker volumes) so the binary links against
the oldest supported glibc. It builds **only the .deb** (`BUNDLES=deb`):
the AppImage stays a host build - sharun makes it glibc-immune anyway, and
quick-sharun wants a fuller library set than a slim trixie container has.
The resulting .deb passes `test-in-container.sh debian:trixie` (install OK,
`ldd` clean, window up in 4 s). Container prereqs baked into the script:
build-essential/pkg-config/libgtk-3-dev for cargo, plus `xauth` for
xvfb-run. **Release gate: run `test-in-container.sh debian:trixie` on the
artifact before every upload.**

### AUR (jorkonvo-bin) on the real Arch host - works

`makepkg` → `pacman -U` → `jorkonvo` runs (window appears; `WM_CLASS =
jorkonvo-desktop` matches the shipped `.desktop` `StartupWMClass`, so the
taskbar groups correctly) → `pacman -Rns` removes everything. namcap
emits `E: ELF files outside of a valid path ('opt/')` plus RELRO/stripped
warnings for the bundled CEF/sharun libraries - inherent to repackaging a
prebuilt AppImage, not fixable in the PKGBUILD. The pinned
`sha256sums`/release URL is still a per-release manual step (release
`linux-v0.0.1` is **not published yet** - the URL currently 404s/303s).

### Flatpak on the real desktop - works

Built with `flatpak build-local.sh` against the **container-built .deb**
(the glibc-safe one; a rolling-host deb would abort inside the GNOME 48
runtime with the same `GLIBC_2.43` error). `flatpak install --user
--bundle` + `flatpak run dev.jorkonvo.desktop` on the physical Plasma
Wayland session:

* Window appears (X11 socket → XWayland); login screen renders.
* Permissions verified as granted: `shared=ipc;network;
  sockets=pulseaudio;x11; devices=all;dri;` +
  `org.freedesktop.Notifications=talk` - matches the manifest.
* Audio inside the sandbox: PipeWire names come through correctly
  ("USB Audio Analog Stereo", "ATR2100x-USB Microphone Analog Stereo",
  HDMI, Easy Effects) - and the deduplication is actually nicer than on
  the host.
* GPU inside the sandbox: same ANGLE/RX 6700 XT/OpenGL 4.6 renderer
  (`--device=dri` works).
* `--no-sandbox` in the wrapper confirmed as the only sandbox mode
  (Flatpak's bwrap is the isolation), as documented.
* Not exercised: the file-chooser portal (needs a signed-in session to
  reach the upload flow) and Discord Rich Presence (documented as
  unsupported in the sandbox).

### Build from clean clone on this machine

Documented prereqs held (installed `patchelf`, `xorg-server-xvfb`; Node
26.8.1 passes the version check; `tauri-cli feat/cef` compiles in ~6 min).
Cold build (web bundle + cargo + CEF download + bundling): ~14 min on this
box; ~5 GB in `apps/desktop/src-tauri/target/` - delete it afterwards if
disk is tight.

## Build

Prerequisites: Node 22.12+ (or 20.19+), Rust, `patchelf`, `xvfb`, `script`
(util-linux), and the patched CLI:

```sh
cargo install --git https://github.com/tauri-apps/tauri --branch feat/cef tauri-cli
scripts/build-linux.sh                       # appimage + deb -> dist/linux/ + SHA256SUMS
BUNDLES=appimage scripts/build-linux.sh      # one format
SKIP_WEB=1 scripts/build-linux.sh            # reuse apps/web/dist
```

The script preflights the tools/Node version/CLI flavour, builds the web bundle,
runs `cargo tauri build --features cef` under `script` + `xvfb-run`
(quick-sharun needs a controlling tty and a display) and copies the results to
`dist/linux/` (git-ignored). Measured on the dev box with a warm cargo/CEF download cache: ~9.5 min for a
clean first build (cargo 5m55s + bundling), ~5 GB in
`apps/desktop/src-tauri/target/` - **delete it afterwards** if disk is tight.
CEF is an opt-in cargo feature, Linux only; a plain `cargo build` on Linux has no
webview runtime and will not run.

Desktop builds are done locally, not on Codemagic (Apple platforms only).

### Known build failure: pinned Debian 12 PipeWire set could not be fetched

```
build-linux: WARNING - could not fetch/extract the pinned Debian 12 PipeWire set
  (pool http://deb.debian.org/debian/pool/main/p/pipewire) - shipping without
  the audio patch; expect no sound on PipeWire desktops.
```

The audio patch below downloads two pinned .debs from Debian's immutable
pool. If that fetch fails (offline build, pool restructure), the bundles are
still produced, just without working audio on PipeWire-only desktops - not
fatal, just degraded. The build host itself needs no PipeWire at all anymore.

### Root cause: why this needed a post-build patch at all (2026-09-22)

Confirmed live (CachyOS, PipeWire + WirePlumber, no exposed raw ALSA hw):
every audio open failed with
`Cannot open shared library libasound_module_pcm_pipewire.so` - both playback
(no sound at all, not even notifications) and microphone capture, identically,
since both go through the same ALSA plugin. `libasound.so.2` gets bundled (a
bare transitive `ldd` dependency of `libcef.so`) but without that plugin.

`DEPLOY_CHROMIUM=1` (which Tauri's own `sharun_cef.rs` bundler already force-
sets - confirmed by reading its source) DOES make quick-sharun's internal
deployment-candidate list include both PipeWire ALSA plugin files - confirmed
by directly instrumenting a local copy of `~/.cache/tauri/quick-sharun.sh`
with debug `_echo` calls at each stage of `_make_deployment_array` /
`_deploy_libs`. They are present right up until `_deploy_libs` actually runs,
then are gone from the final AppDir - lost somewhere in
`TO_DEPLOY_ARRAY=$(_save_array "$@")` / its decode in `_deploy_libs`, not
root-caused further (that script is third-party, freshly re-downloaded on
every build, not worth deep-patching). The same appears to affect at least
some GPU DRI drivers too (the shipped AppImage has `swrast_dri.so` +
`iHD_drv_video.so` but not `radeonsi_dri.so`, despite it also appearing in the
same confirmed-present deployment-candidate dump) - not yet patched, lower
priority since software rendering still works as a fallback.

**The fix** (second revision, 2026-09-22, after live-testing the first one),
in `scripts/build-linux.sh`: after quick-sharun/`cargo tauri build` produces
the bundles, patch a **self-consistent PipeWire ALSA set** into BOTH the
AppImage and the .deb:

- `libasound_module_pcm_pipewire.so` + `libasound_module_ctl_pipewire.so`
  → `<AppDir>/lib/alsa-lib/`
- `libpipewire-0.3.so.0*` → `<AppDir>/lib/`

**Why not the build host's own files** (the first revision of this patch did
exactly that, and it is glibc-fragile): the AppImage runtime bundles Debian
12's glibc **2.36**. On a rolling-release host (Arch/CachyOS, glibc 2.4x)
the copied plugin itself dlopens fine from `lib/alsa-lib/`, but nothing else
in the AppDir provides `libpipewire-0.3.so.0`, so it resolves against the
HOST's libpipewire, which needs `GLIBC_2.38+` symbols the bundled 2.36 libc
does not have - verified live as

```
ALSA lib dlmisc.c: Cannot open shared library libasound_module_pcm_pipewire.so
  (/tmp/.mount_JorKonvo…/lib/libc.so.6: version `GLIBC_2.38' not found
   (required by /usr/lib/libpipewire-0.3.so.0))
```

killing BOTH playback and capture identically (both probe paths,
`default` and `plug:default`, go through the plugin). So instead a
**self-consistent five-piece set** is pinned from **Debian 12 (bookworm)'s
immutable pool** - same glibc era as the bundled runtime
(`PW_VER` in the script; bump it when re-pinning):

| piece | source deb | lands in AppDir |
| --- | --- | --- |
| ALSA PipeWire plugins (pcm + ctl) | `pipewire-alsa` | `lib/alsa-lib/` |
| `libpipewire-0.3.so.0` (only NEEDED: libc, ceiling 2.34) | `libpipewire-0.3-0` | `lib/` |
| SPA plugins incl. `support/` (dlopen'd at runtime, invisible to NEEDED!) | `libspa-0.2-modules` | `lib/spa-0.2/` |
| client modules (`protocol-native` etc.) | `libpipewire-0.3-modules` | `lib/pipewire-0.3/` |
| client configs (`client-rt.conf`…) | `pipewire-bin` | `share/pipewire/` |

The last three pieces are found at runtime through three env vars
(`SPA_PLUGIN_DIR`, `PIPEWIRE_MODULE_DIR`, `PIPEWIRE_CONFIG_DIR`), exported
deliberately unconditionally - mixing the HOST's PipeWire pieces with the
bundled client libs is exactly the failure above. In the AppImage a
`bin/99-jorkonvo-pipewire.hook` (sourced by quick-sharun's AppRun.sh before
exec) sets them; in the .deb the `/usr/bin/jorkonvo-desktop` symlink becomes
a wrapper script setting the same three. Each missing piece has its own
failure signature, all reproduced live during the investigation: plugins
missing → the original `Cannot open shared library`; SPA support missing →
`pw_loop_new(): can't make support.system handle`; client modules missing →
`can't load config client-rt.conf` / bare `audio open error: ENOENT`.

A 0.3.x PipeWire client connecting to a 1.x server is a supported
combination, so the set works on modern desktops (verified against
PipeWire 1.6.8).

**Live verification (2026-09-23, real desktop: CachyOS, KDE Wayland,
PipeWire 1.6.8, ATR2100x USB mic)**:

- `aplay` run against the AppImage's own extracted `lib/` + `share/alsa`
  with the three env vars plays cleanly through the real PipeWire server
  (the exact mechanism the app uses), while the previous (host-plugin)
  build died with the GLIBC_2.38 error above at the same probe.
- In the running AppImage (env confirmed present via `/proc/<pid>/environ`),
  joining a group voice call opens a real PipeWire capture stream
  (`pactl`: source-output, `application.name = "Chromium input"`) plus
  playback sink-inputs, with ZERO ALSA errors in the log - the pre-fix build
  failed the identical action with hard `PcmOpen` errors on both `default`
  and `plug:default`.
- The container-built .deb (this patch runs inside
  `packaging/linux/deb/build-in-container.sh` too) passes
  `test-in-container.sh` and contains the wrapper + all five pieces.
- Screen share under `JORKONVO_CEF_STYLE=chrome` was also re-verified live
  in the same build: Chromium's desktop picker appears, picking a monitor
  returns a live 2560x1440 track rendering at ~30 fps.

Repack mechanics: AppImage via `--appimage-extract` + `appimagetool`
(auto-fetched); two gotchas there - `appimagetool` insists on a directory
literally named `AppDir`, and it validates that the `.desktop` file's `Icon=`
name has a matching top-level icon file, which quick-sharun never provides
(it ships `JorKonvo.png` and its AppRun doesn't care), so the script adds the
expected name as a copy. The .deb is unpacked with plain `ar` + `tar` (no
dpkg-deb needed on the host), the AppDir inside is located by `libcef.so`,
patched, and re-tarred with `--owner=0 --group=0` before `ar rc` rebuilds the
archive (member order matters: `debian-binary` first).

Still open (known, not fixed here): ~~the same quick-sharun drop also eats
GPU DRI drivers (`radeonsi_dri.so`), so the AppImage renders via llvmpipe on
the RX 6700 XT~~ **fixed 2026-09-23, same session** - `gpu_copy_into()` in
`scripts/build-linux.sh`: quick-sharun bundles the host's whole Mesa engine
(`libgallium-*.so`) but drops the `/usr/lib/dri/*.so` entries its loader
probes, so every GPU driver open failed ("MESA-LOADER: failed to open
radeonsi"). On current Arch Mesa those entries are symlinks onto a ~14 KB
loader stub, `libdril_dri.so` (glibc ceiling 2.34) - the patch copies the
stub + recreates the symlinks (radeonsi/swrast/kms_swrast/zink), guarded by
an exact libgallium-version match between the bundle and the host. The
Debian-classic layout (the trixie build container) instead gets the
self-contained `radeonsi_dri.so` + `swrast_dri.so` megadrivers from the same
rootfs the bundled GL stack came from. Live-verified: `glxinfo` against the
AppDir's own libs reports "AMD Radeon RX 6700 XT (radeonsi, navi22, ACO)",
the rebuilt AppImage logs zero MESA-LOADER errors, and in-app WebGL reports
"ANGLE (AMD, AMD Radeon RX 6700 XT (radeonsi navi22 ACO), OpenGL 4.6)".
VA-API video decode stays unaccelerated by choice: the host radeonsi VA
driver drags in `libLLVM.so.22` + GLIBC_2.43 (~150 MB of dependency for
marginal gain).

### Known build failure: quick-sharun 404

```
Download failed! Trying again...   (x5)
ERROR: Failed to download 5 times!
```

`head: error reading '.../bin/locales': Is a directory` above it is harmless
noise. The real cause: the feat/cef bundler downloads `quick-sharun.sh` from the
FabianLars fork and points `HOOKSRC` there, but quick-sharun's other assets
default to `pkgforge-dev/Anylinux-AppImages`, where `anylinux.c` returns 404.
quick-sharun honours `ANYLINUX_LIB_SOURCE` / `GTK_CLASS_FIX_SOURCE` and the
bundler passes the environment through, so `build-linux.sh` exports both
pointing at the fork - no Tauri patch. The fork's `main` is fetched live on every
build, so this can break again; find the URL that 404s with
`grep -n '_SOURCE=\|_LINK=' ~/.cache/tauri/quick-sharun.sh`.

## Sandbox (read this before shipping)

| Format   | Chromium sandbox                                                                 |
|----------|----------------------------------------------------------------------------------|
| AppImage | unprivileged **user namespaces**; `chrome-sandbox` is shipped but not setuid (an AppImage can't be). Measured: renderers run in their own userns with a seccomp filter, no `--no-sandbox` anywhere. |
| `.deb`   | `chrome-sandbox` is installed **setuid root** (`-rwsr-xr-x`, verified in the package). The test run had userns available, so the setuid path itself is **not exercised** by any test here. |
| AUR      | userns (Arch enables them). Not setuid.                                          |
| Flatpak  | Chromium's sandbox **cannot start** inside bwrap (measured: `FATAL ... No usable sandbox!`), so `jorkonvo.sh` passes `--no-sandbox`. Flatpak's own confinement is the isolation. |

Where userns is disabled (Ubuntu 24.04+ AppArmor restriction on some installs,
hardened kernels, default docker seccomp) the AppImage aborts with
`The SUID sandbox helper binary was found, but is not configured correctly`
rather than running unsandboxed - this is intended. The bundled
`fix-namespaces.hook` offers to add an AppArmor profile keyed to the AppImage
**path** (redo it after moving/renaming the file). `--no-sandbox` is a last
resort and removes renderer isolation; never make it the default outside Flatpak.

## Windows question (wry / WebView2 vs CEF) - OWNER DECISION, blocks the merge

**What changes:** on `main`, `default = ["cef"]`, so Windows (and macOS) build
with CEF/Chromium. The owner installed that Windows build and calls work
(`.hub/status.json` history, NIGHT_LOG 2026-09-19). This branch makes CEF
Linux-only: `cargo tree --target x86_64-pc-windows-msvc` now shows `wry 0.56.1` +
`webview2-com` and no `tauri-runtime-cef`. Windows would move to the system
**WebView2** (Chromium-based, so `getUserMedia` / WebRTC / `getDisplayMedia` are
implemented by the engine), shrinking the installers from ~130-180 MB to a few MB.

**Not proven:** no Windows machine was available, so it is untested whether
calls still work: a real Windows build (`[patch.crates-io]` still points `tauri` &
co. at `feat/cef` for every target), WebRTC in WebView2, the mic/camera
permission behaviour, screen-share source selection, and the Discord-RPC
named-pipe server alongside wry. This trades a **verified-working** Windows build
for an unverified one.

**Options:** (a) keep this branch's split and have someone run one real call on a
Windows box before merging; (b) keep CEF on Windows too, i.e. add a
`[target.'cfg(windows)'.dependencies]` tauri entry with `features = ["cef"]` and
build Windows with `--features cef` as `main` does today. The branch was therefore
pushed and opened as a PR instead of being merged into `main`.

## Formats

### AppImage
`dist/linux/JorKonvo_0.0.1_amd64.AppImage`, ~202 MiB, 904 MiB extracted.
`--appimage-extract` works; `bin/` has `libcef.so`, `icudtl.dat`, `*.pak`,
`v8_context_snapshot.bin`, `locales/`, `chrome-sandbox`. No
`Invalid file descriptor to ICU data`.

Known warts: the bundled `share/icons/hicolor` is a copy of the *build host's*
icon theme (unrelated icons such as libreoffice/xarchiver leak in; the AUR
package drops it), and `X-AppImage-Version=UNKNOWN`.

### .deb
The stock bundler output was **not installable as a working app**: `Depends`
was only `libgtk-3-0`, but `libcef.so` needs ~30 more libraries, some
`dlopen`-ed (invisible to `ldd`, e.g. `libxkbcommon-x11`, which panicked on
ubuntu:24.04) plus at least one font (Skia aborts with
`SkFontMgr_FontConfigInterface ... Not implemented` on a font-less system).
`bundle.linux.deb` in `tauri.conf.json` now declares them, with `t64 | non-t64`
alternatives for the 2024 library rename. Package name is `jor-konvo` (Tauri
kebab-cases `productName`, not configurable); it `Provides: jorkonvo`.

```sh
packaging/linux/deb/test-in-container.sh debian:trixie dist/linux/JorKonvo_0.0.1_amd64.deb
```
does `apt install ./x.deb --no-install-recommends`, checks `ldd` for missing
libs, runs the app as a normal user. The run step relaxes docker's seccomp
(otherwise the userns sandbox can't start); that only affects the test container.

### Flatpak (`dev.jorkonvo.desktop`)
The app id is the Tauri `identifier`. Repackages the `.deb` on
`org.gnome.Platform//48` (GTK3/NSS/CUPS come from the runtime; `ldd` inside the
sandbox reports nothing missing). Bundle: ~108 MiB.

Permissions: `network`, `ipc`, `x11`, `pulseaudio`, `dri`, `--device=all`
(camera - Flatpak has no narrower V4L2 option), notifications. Deliberately not
granted: home filesystem. **Discord Rich Presence does not work in the Flatpak**
(the app hosts a Discord-RPC socket in `$XDG_RUNTIME_DIR`, which is private to
the sandbox).

```sh
# root-free tooling:
flatpak install --user flathub org.flatpak.Builder org.gnome.Sdk//48
packaging/linux/flatpak/build-local.sh dist/linux/JorKonvo_0.0.1_amd64.deb   # -> dist/flatpak/
flatpak install --user --bundle dist/flatpak/dev.jorkonvo.desktop.flatpak
```
The output dir must be under `$HOME` (the Builder flatpak cannot see `/tmp`).
Not Flathub-ready: Flathub requires a from-source, offline build, which the git
`feat/cef` dependency tree blocks. Metainfo `project_license` is a placeholder.

### AUR (`jorkonvo-bin`)
Downloads the release AppImage, extracts it to `/opt/jorkonvo-bin`, `/usr/bin/jorkonvo`
wrapper, own `.desktop` + icon. No `fuse2` needed. Depends include `fontconfig` +
`ttf-font` (same font abort as above). `packaging/linux/aur/test-in-container.sh
<AppImage>` swaps the release URL for the local file, then `makepkg`, `pacman -U`,
`namcap`, smoke run. `.SRCINFO` is generated with `makepkg --printsrcinfo`.
Before publishing: pick a `license=` and update `sha256sums` every release.

### apt repo (plan + working sample, NOT a live release)
`packaging/linux/apt/build-repo.sh <deb>` builds an **unsigned** reprepro repo
(codename `stable`, `amd64`); `test-repo.sh <image>` serves it from nginx and
`apt install jorkonvo` from a clean container (`[trusted=yes]` only because it is
unsigned). To go live: (1) owner creates a dedicated signing key and decides
custody, (2) add `SignWith:` in `conf/distributions`, (3) serve `dists/` + `pool/`
behind Caddy on the existing server, (4) publish the public key as
`/jorkonvo.gpg` and document `signed-by=` in the source line. The bundler's
setuid `chrome-sandbox` is a bonus over the AppImage.

## Releasing

Tag convention on Forgejo is `<platform>-v<version>` (`ios-v0.1.9` exists), so
Linux uses `linux-v0.0.1`; the PKGBUILD and the Flatpak manifest already point at
`.../releases/download/linux-v0.0.1/`. Upload `dist/linux/*` (AppImage, deb,
SHA256SUMS) and the `.flatpak`. Update the checksums in the PKGBUILD and the
Flatpak manifest to match.

## Host-drivers mode + VA-API: measured on a second (Intel/glvnd) host, 2026-10-09

`USE_HOST_DRIVERS_EXPERIMENTAL=1` (now the default in `scripts/build-linux.sh`)
ships no GPU/Mesa drivers at all (`DEPLOY_OPENGL=0`, `DEPLOY_VULKAN=0`) and
instead relies on `cross-libc-dlopen.so` + `gl-fwd.so`/`egl-fwd.so`/`gles-fwd.so`
(from `pkgforge-dev/cross-libc-dlopen`, cloned+built at bundle time, see
`scripts/build-linux.sh`) to dlopen whatever GPU stack the *runtime* host has,
bridging the glibc gap. Live-tested on a CachyOS/Arch laptop (Intel UHD 620,
glibc 2.44, glvnd Mesa) - a genuinely different GPU vendor than the AMD build
host, which the old bundled-driver `gpu_copy_into()` path could never have
covered (it requires an exact `libgallium` match between build host and
runtime host).

**Two independent, now precisely diagnosed problems, not one:**

1. **ANGLE's GLX backend (CEF's Linux default) does not work on this host at
   all.** `glXQueryExtensionsString` returns NULL on the very first call,
   `-Exiting GPU process due to errors during initialization-` follows ~4-5x
   until Chromium gives up and falls back to software (SwiftShader, bundled) -
   the app stays fully usable, just unaccelerated. Ruled out, each with its
   own live test: the GPU sandbox (`--disable-gpu-sandbox` - no change), the
   compositor (`xvfb-run` instead of the live KDE/XWayland session - no
   change), which GL stack `gl-fwd.so` forwards to (host-first
   `LD_LIBRARY_PATH` vs the bundled dispatcher - both report "3470 of 3470
   entry points resolved" yet the actual call still returns NULL either way),
   and glvnd vendor selection (`__GLX_VENDOR_LIBRARY_NAME=mesa` forced - no
   change). A plain `glxinfo` against the exact same `DISPLAY`/`XAUTHORITY`
   on the same host succeeds instantly, full extension list, direct
   rendering. This looks like a genuine CEF/ANGLE-GLX-vs-glvnd incompatibility
   in this pinned `feat/cef` build, independent of our packaging.

2. **ANGLE's EGL backend (`--use-angle=gl-egl`) is the one
   `cross-libc-dlopen`'s own upstream test suite validates end to end for
   VA-API on Intel** (their report 9.19: mpv decoding real H.264 through
   `iHD_drv_video.so` and rendering via OpenGL-over-EGL, on an external Alpine
   host). Here it failed differently: `egl-fwd.so` tried to dlopen the host's
   `/usr/lib64/libEGL.so.1` (Intel), and `cross-libc-dlopen.so`'s own rewrite
   attempt failed with `undefined symbol: __isoc23_strtol` - a *symbol that
   plain does not exist* in bookworm's glibc 2.36 (it was added in glibc
   2.38), not a version-tag mismatch the rewrite trick can paper over. The
   officially documented fix, `CROSS_LIBC_DLOPEN_RUNTIME=host` /
   `runtime-select`, measurably does **not** help here: `jorkonvo-desktop` is
   itself sharun's small static-PIE launcher stub, which recomputes its own
   library search path internally on every exec (including every CEF
   subprocess re-exec for `--type=gpu-process` etc.), so neither an exported
   `LD_LIBRARY_PATH` nor `runtime-select`'s explicit `--library-path` (which
   only ever covers the *first* process - Chromium's own internal re-exec of
   itself for each subprocess type never goes back through it) had any
   measurable effect on which `libc.so.6`/`libEGL.so.1` got loaded. **Fixed**
   for this specific gap by building the AppImage inside `debian:trixie`
   (glibc 2.40/2.41, not just the `.deb`) - see
   `packaging/linux/deb/build-in-container.sh`, which now defaults to
   `BUNDLES=appimage,deb` and installs `libnss3`/`libasound2t64`/`file` (a
   bare `debian:trixie` has none of them, and quick-sharun can only bundle
   what the build host actually has installed - the AppImage just silently
   builds short a few libraries otherwise, and `appimagetool` needs `file` to
   finish packaging). Confirmed live afterwards: `egl-fwd.so` now reports
   `44 of 44 entry points resolved from the host library`, `cross-libc-dlopen`
   reports `needs no rewrite, loading it unchanged` - the symbol gap is gone.

**Still open:** even with the symbol gap closed, ANGLE's own
`eglGetPlatformDisplay`-equivalent call (reached only through a raw function
pointer ANGLE gets back from `eglGetProcAddress`, invisible to the shims'
own call tracing from that point on) still returns `EGL_NOT_INITIALIZED` /
"Failed to get system egl display" on this host, with both the real glvnd
dispatcher (`libEGL.so.1`) and the real Intel vendor library
(`libEGL_mesa.so.0`) loading cleanly and zero errors reported by either shim.
Tried and ruled out: `--ozone-platform=x11` forced explicitly,
`EGL_PLATFORM=x11` set. This is very likely a genuine ANGLE/Chromium-level
EGL-over-X11 limitation in this pinned CEF build (EGL-over-X11 is a less
mature ANGLE path than native Wayland or ChromeOS/Android), not something
fixable from the packaging side without Chromium-source-level debugging.

**Net result:** `scripts/build-linux.sh` defaults to
`--use-gl=angle --use-angle=gl-egl` now (`gpu_settings.rs`), since the default
GLX backend is confirmed broken independent of everything above and gl-egl is
at least the validated-elsewhere path; VA-API/hardware video stays
**unaccelerated on this exact Intel/glvnd/CEF combination** for now, same as
before, but the app itself (hand off to SwiftShader, audio, mic, screen share)
is fully live-verified working, unaffected by any of this. The glibc bump is
still a durable, unconditional win: it unblocks this entry point of the
missing-symbol class for *any* future host too, not just this one, and the
AppImage is now built in a container the same way the `.deb` always was,
rather than inheriting whatever glibc happens to be on kimle-server.
Revisit if upstream CEF/ANGLE moves, or on a non-glvnd / Wayland-native host.

## Speaker/mic device list: Chromium's PulseAudio backend, 2026-10-09

Reported by the owner: the speaker picker only ever shows "Default"/"System
Default", never real per-device names. `strings` on the bundled `libcef.so`
confirms Chromium has a full PulseAudio client compiled in
(`pa_context_get_sink_info_list`, `PulseAudioOutputStream`, ...) and prefers it
for device enumeration, with an explicit fallback message: "Falling back to
ALSA for audio output. PulseAudio is not available or could not be
initialized." It isn't a link-time (`NEEDED`) dependency of `libcef.so` -
`pa_context_new` doesn't even appear as a symbol in it - so Chromium dlopens
`libpulse.so.0` lazily by bare SONAME at runtime. We shipped none, so this
always fails and Chromium falls back to ALSA, whose enumeration is far
coarser (one generic device) - this is the bug.

PipeWire's `pipewire-pulse` exposes a PulseAudio-protocol-compatible server on
the usual socket on virtually every modern desktop (the same PipeWire stack
the already-fixed ALSA path talks to through its own plugin), so only the
*client* library needs to exist in the AppDir for this to start working - no
server-side packaging needed.

Fix: `scripts/build-linux.sh` gained a `pulse_prepare`/`pulse_copy_into` pair,
same shape as the existing `pw_prepare`/`pw_copy_into` PipeWire patch - pull a
pinned Debian 12 (bookworm) package set from the immutable pool, extract,
flatten every `.so*` into `lib/`. `libpulse0`'s own dependency chain runs
deeper than PipeWire's did: it needs `libsndfile1` (sample-cache support
Chromium's basic playback/capture/enumerate usage never actually calls into -
but the dynamic loader resolves every `NEEDED` entry at `dlopen()` time
regardless of whether a given library's symbols are ever invoked), which pulls
in the FLAC/vorbis/opus/ogg/mpg123/lame codec libraries, and `libsystemd0` /
`libasyncns0`, which pull in `libgcrypt`/`liblzma`/`libzstd`/`liblz4`/`libbsd`/
`libmd`. 18 packages total, pinned by exact filename from the bookworm
`Packages` index (same glibc-ceiling reasoning as the PipeWire set: all well
under anything already bundled, so the trixie base-image bump doesn't change
this). Verified end-to-end with a standalone extraction (not yet a full app
rebuild at the time of writing): every `.so` this set needs resolves cleanly
against each other plus the libraries `libcef.so` already bundles elsewhere
(`libdbus-1`, `libX11`, `libX11-xcb`, `libxcb`, `libm`, `libc`) - zero
"not found" entries.

One real gotcha hit while writing the copy step: `find ... -type f` silently
**excludes** the bare-SONAME symlinks (`libpulse.so.0 -> libpulse.so.0.24.2`),
which is the exact filename `dlopen()` asks for - only the long versioned
filename would have landed, and the fix would have silently done nothing.
Fixed by dropping the `-type f` filter (keeping `! -type d` instead); plain
`cp` (no `-d`/`-P`) then dereferences each symlink into an ordinarily-named
regular file at the destination, which is just as good as a real symlink here.

## Housekeeping notes

* The docker daemon here runs as root: files created by containers on bind
  mounts are root-owned. The scripts clean up / `chown` inside the container; use
  `docker run --rm -v <dir>:/x debian:trixie rm -rf /x/...` to remove leftovers.
* Only remove containers/images/networks you created; never `docker system prune`.
