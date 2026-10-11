# Flathub submission manifest (from-source)

`com.jorkonvo.desktop.yml` here is the **from-source** Flatpak manifest meant
for an actual Flathub submission - distinct from
`packaging/linux/flatpak/com.jorkonvo.desktop.yml`, which repackages a
prebuilt release `.deb` and is only for a self-hosted repo / `.flatpak` bundle
(Flathub does not allow prebuilt-binary sources).

## How CEF is handled

Flathub requires a from-source build, but nobody compiles Chromium from
scratch for a Flatpak - CEF's prebuilt binaries are vendored as a pinned,
checksummed source archive instead (`cef-builds.spotifycdn.com`), the same
pattern Electron-based Flathub apps use for the Electron binary. The
build-commands reorganize that archive into the exact layout
`cef-dll-sys`'s `build.rs` expects at `$CEF_PATH/<version>/cef_linux_x86_64/`
(including a hand-written `archive.json`), so `cargo build --offline`
resolves CEF locally with no network access during the build.

On Linux, CEF's `build.rs` does **not** invoke cmake/ninja (that only
happens on the windows/macos arms) - it links `dylib=cef` directly and copies
the CEF runtime files next to the compiled binary. The result has
`RUNPATH=$ORIGIN` (confirmed on the real release binary), so the
build-commands just copy those files into `/app/lib/jorkonvo/` next to the
binary - no AppImage/`.deb` bundler (quick-sharun, sharun_cef) involved at
all; Flatpak's sandbox already supplies what that bundler exists to vendor.

`node-sources.json` / `cargo-sources.json` are generated from the repo's
`package-lock.json` / `apps/desktop/src-tauri/Cargo.lock` via
[flatpak-builder-tools](https://github.com/flathub/flatpak-builder-tools)
(`node/flatpak-node-generator.py`, `cargo/flatpak-cargo-generator.py`).
Regenerate them if those lockfiles change.

## Verified (2026-10-11)

Built and exported successfully with the Flathub-matched builder
(`flatpak install flathub org.flatpak.Builder`):

```
flatpak run org.flatpak.Builder --force-clean --user \
  --repo=flatpak-repo flatpak-build com.jorkonvo.desktop.yml
```

Installed from the local repo and launched under `xvfb-run`: CEF
initializes and opens a browser process. The only errors seen
(`Failed to connect to the bus`, `No suitable EGL configs found`) are
headless-test-host limitations (no system dbus, no GPU-backed EGL under
Xvfb) - not packaging defects. Needs a real display to confirm full UI
rendering before actually submitting.

## Not yet done

- Fork `flathub/flathub`, open a PR against its `new-pr` branch adding this
  manifest as `com.jorkonvo.desktop.yml` at the repo root. Deliberately not
  done automatically - opening a public PR under the owner's GitHub account
  is a one-way, visible action that should get a final look first.
- Icon: the `.desktop`/`.metainfo.xml` icon reference and a scalable SVG icon
  install should be double-checked against Flathub's linter
  (`flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest
  com.jorkonvo.desktop.yml` and `...appstream app/com.jorkonvo.desktop ...`).
- The vendored source currently pins commit `8764ea49dc68b0a51c1a6aad605e45a599dac25b`
  of `https://github.com/thatumi/JorKonvo.git` - bump it to whatever commit/tag
  should actually ship before submitting.
