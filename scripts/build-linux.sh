#!/usr/bin/env bash
# Reproducible Linux desktop build: web bundle -> Tauri+CEF -> AppImage and/or .deb,
# copied to dist/linux/ together with SHA256SUMS. See docs/LINUX_PACKAGING.md.
#
# Usage:   scripts/build-linux.sh                 # appimage + deb
#          BUNDLES=appimage scripts/build-linux.sh
#          SKIP_WEB=1 scripts/build-linux.sh      # reuse an existing apps/web/dist
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLES="${BUNDLES:-appimage,deb}"

die() { echo "build-linux: $*" >&2; exit 1; }

# --- preflight: fail early with an actionable message, not 40 min into cargo ----
for bin in cargo node npm patchelf xvfb-run script; do
  command -v "$bin" >/dev/null || die "missing '$bin' (Debian/Ubuntu: apt install patchelf xvfb util-linux; Arch: pacman -S patchelf xorg-server-xvfb util-linux; Rust via rustup; Node 20.19+/22.12+)"
done
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)' \
  || die "Node $(node -v) too old: the build needs 20.19+ or 22.12+ (rolldown-vite)"
# The stock crates.io tauri-cli has no CEF-aware bundler; it must come from the feat/cef branch.
cargo install --list | grep -q 'tauri-cli.*feat%2Fcef\|tauri-cli.*feat/cef' \
  || die "tauri-cli must be the feat/cef build: cargo install --git https://github.com/tauri-apps/tauri --branch feat/cef tauri-cli"

# --- quick-sharun 404 workaround --------------------------------------------------
# The feat/cef bundler (sharun_cef.rs) downloads quick-sharun.sh from the FabianLars
# fork and points HOOKSRC there, but NOT the other assets that script fetches.
# quick-sharun's defaults (pkgforge-dev/Anylinux-AppImages) 404 for anylinux.c, so it
# dies with "Failed to download 5 times". quick-sharun honours these env vars and the
# bundler passes its environment through, so we override them here instead of
# patching Tauri. The fork's `main` is fetched live: if this breaks again, run
#   grep -n '_SOURCE=\|_LINK=' ~/.cache/tauri/quick-sharun.sh
FORK=https://raw.githubusercontent.com/FabianLars/Anylinux-AppImages/refs/heads/main/useful-tools
export ANYLINUX_LIB_SOURCE="${ANYLINUX_LIB_SOURCE:-$FORK/lib/anylinux.c}"
export GTK_CLASS_FIX_SOURCE="${GTK_CLASS_FIX_SOURCE:-$FORK/lib/gtk-class-fix.c}"

# --- no audio in/out on a real PipeWire desktop (patched further down) ------------
# libasound.so.2 gets bundled (a bare transitive `ldd` dependency of libcef.so) but
# WITHOUT its PipeWire plugin, so on any PipeWire-only desktop (no exposed raw ALSA
# hw, the default on most modern distros) every audio open fails. Confirmed live
# (CachyOS, PipeWire + WirePlumber, no direct ALSA): `Cannot open shared library
# libasound_module_pcm_pipewire.so` - both playback (no sound at all, not even
# notifications) and capture (mic) broken identically, since both go through the
# same plugin. DEPLOY_CHROMIUM=1 (Tauri's sharun_cef.rs already force-sets this,
# this export is just making that fact visible here) DOES make quick-sharun accept
# both PipeWire ALSA plugin files into its internal deployment list - confirmed by
# instrumenting quick-sharun.sh directly - but they never reach the AppDir it
# actually ships (not yet root-caused inside that script, which is third-party and
# freshly re-downloaded on every build). Patched below instead, after the bundles
# already exist: extract, copy a self-consistent PipeWire ALSA set in, repack.
export DEPLOY_CHROMIUM="${DEPLOY_CHROMIUM:-1}"

# --- GPU / VA-API drivers: use the HOST's, not a bundled copy ------------------------
# The AppImage runtime ships an old glibc (2.36); host Mesa/libva drivers link against
# whatever the distro has (2.4x). quick-sharun's USE_HOST_DRIVERS_EXPERIMENTAL ships no
# GPU drivers and dlopens the host's through cross-libc-dlopen, which is what makes
# hardware GL + VA-API decode work without bundling libLLVM & co (~150 MB). Needs
# ANYLINUX_LIB=1, git and make at build time. Set USE_HOST_DRIVERS_EXPERIMENTAL=0 to get
# the old bundled-Mesa behaviour (+ gpu_copy_into below).
export USE_HOST_DRIVERS_EXPERIMENTAL="${USE_HOST_DRIVERS_EXPERIMENTAL:-1}"
if [ "$USE_HOST_DRIVERS_EXPERIMENTAL" = 1 ]; then
  export ANYLINUX_LIB=1
  command -v git >/dev/null && command -v make >/dev/null || die "USE_HOST_DRIVERS_EXPERIMENTAL=1 needs git and make"
fi

# --- web bundle (Tauri's frontendDist is apps/web/dist; matrix-core must be built first)
if [ -z "${SKIP_WEB:-}" ]; then
  cd "$ROOT"
  [ -d node_modules ] || npm ci
  npm run build
fi
[ -f "$ROOT/apps/web/dist/index.html" ] || die "apps/web/dist missing - run without SKIP_WEB"

# --- Tauri bundle. quick-sharun needs a controlling tty (job control) and a display.
cd "$ROOT/apps/desktop"
script -qec "xvfb-run -a cargo tauri build --features cef --bundles $BUNDLES" /dev/null

# --- patch in a self-consistent PipeWire ALSA set quick-sharun drops (see above) --
# The first cut of this patch copied the plugin from the build HOST - which is
# glibc-fragile: the AppImage runtime bundles Debian 12's glibc 2.36, and on a
# rolling-release host (Arch/CachyOS, glibc 2.4x) the copied plugin dlopens fine
# but then resolves libpipewire from the host, which wants GLIBC_2.38+ symbols
# the bundled 2.36 libc does not have - verified live as
#   Cannot open shared library libasound_module_pcm_pipewire.so
#   (/…mount_JorKonvo…/lib/libc.so.6: version `GLIBC_2.38' not found
#    (required by /usr/lib/libpipewire-0.3.so.0))
# killing BOTH playback and capture. So ship a consistent, 2.36-compatible set
# instead, pinned from Debian 12's immutable pool (pool URLs never change once
# published): the pipewire-alsa plugins AND libpipewire-0.3 itself (Debian's
# build has SPA statically linked in; its only NEEDED is libc.so.6, glibc
# ceiling 2.34). A 0.3.x PipeWire client talking to a 1.x server is a supported
# combination, so this works on modern desktops.
PW_POOL="http://deb.debian.org/debian/pool/main/p/pipewire"
PW_VER="0.3.65-3+deb12u1"
PW_CACHE="$HOME/.cache/jorkonvo-build/pw-debs"
PW_ROOT=""   # set by pw_prepare: extraction root containing all five pieces
pw_prepare() {
  local debs=(
    "pipewire-alsa_${PW_VER}_amd64.deb"
    "libpipewire-0.3-0_${PW_VER}_amd64.deb"
    "libspa-0.2-modules_${PW_VER}_amd64.deb"
    "pipewire-bin_${PW_VER}_amd64.deb"
    "libpipewire-0.3-modules_${PW_VER}_amd64.deb"
  )
  mkdir -p "$PW_CACHE"
  local f d ok=1
  for f in "${debs[@]}"; do
    [ -f "$PW_CACHE/$f" ] || curl -fsSL -o "$PW_CACHE/$f" "$PW_POOL/$f" || ok=0
  done
  if [ "$ok" = 1 ]; then
    rm -rf "$PW_CACHE/x"; mkdir -p "$PW_CACHE/x"
    for f in "${debs[@]}"; do
      d="$PW_CACHE/x/${f%.deb}"; mkdir -p "$d"
      ( cd "$d" && ar x "$PW_CACHE/$f" && tar xf data.tar.* ) || ok=0
    done
  fi
  if [ "$ok" = 1 ]; then
    PW_ROOT="$PW_CACHE/x"
    # All five pieces must be present - a partial set produces the exact
    # dlopen/ENOENT failure chain this patch exists to prevent.
    [ -f "$PW_ROOT/pipewire-alsa_${PW_VER}_amd64/usr/lib/x86_64-linux-gnu/alsa-lib/libasound_module_pcm_pipewire.so" ] \
      && [ -f "$PW_ROOT/libpipewire-0.3-0_${PW_VER}_amd64/usr/lib/x86_64-linux-gnu/libpipewire-0.3.so.0" ] \
      && [ -d "$PW_ROOT/libspa-0.2-modules_${PW_VER}_amd64/usr/lib/x86_64-linux-gnu/spa-0.2/support" ] \
      && [ -f "$PW_ROOT/pipewire-bin_${PW_VER}_amd64/usr/share/pipewire/client-rt.conf" ] \
      && [ -d "$PW_ROOT/libpipewire-0.3-modules_${PW_VER}_amd64/usr/lib/x86_64-linux-gnu/pipewire-0.3" ]
  fi
}
pw_copy_into() {  # $1 = AppDir (a directory containing lib/, e.g. squashfs-root or the deb's usr/share/JorKonvo)
  local alsa="$PW_ROOT/pipewire-alsa_${PW_VER}_amd64/usr/lib/x86_64-linux-gnu/alsa-lib"
  local lib="$PW_ROOT/libpipewire-0.3-0_${PW_VER}_amd64/usr/lib/x86_64-linux-gnu"
  local spa="$PW_ROOT/libspa-0.2-modules_${PW_VER}_amd64/usr/lib/x86_64-linux-gnu/spa-0.2"
  local conf="$PW_ROOT/pipewire-bin_${PW_VER}_amd64/usr/share/pipewire"
  local mods="$PW_ROOT/libpipewire-0.3-modules_${PW_VER}_amd64/usr/lib/x86_64-linux-gnu/pipewire-0.3"
  mkdir -p "$1/lib/alsa-lib" "$1/lib/pipewire-0.3" "$1/share/pipewire"
  cp -v "$alsa"/libasound_module_pcm_pipewire.so* "$alsa"/libasound_module_ctl_pipewire.so* \
    "$1/lib/alsa-lib/"
  cp -v "$lib"/libpipewire-0.3.so.0* "$1/lib/"
  cp -a "$spa" "$1/lib/spa-0.2"
  cp -v "$conf"/*.conf "$1/share/pipewire/"
  cp -v "$mods"/*.so "$1/lib/pipewire-0.3/"
  # AppImage side: AppRun.sh sources bin/*.hook before exec'ing the app, which
  # is where the bundled client's lookup paths get exported. The deb AppDir has
  # no bin/ (its launcher is a bare ELF; the deb wrapper script sets the same
  # env instead), so the hook only lands where it actually runs. Deliberately
  # unconditional env (no :-defaults): mixing the HOST's PipeWire pieces with
  # the bundled client libs is exactly the glibc mismatch this set prevents.
  if [ -d "$1/bin" ]; then
  cat > "$1/bin/99-jorkonvo-pipewire.hook" <<'HOOK'
#!/bin/sh
# JorKonvo audio: point the bundled (glibc-2.36-matched) PipeWire client at its
# bundled SPA plugins, client modules and client config. See
# docs/LINUX_PACKAGING.md "Root cause: why this needed a post-build patch".
export SPA_PLUGIN_DIR="$APPDIR/lib/spa-0.2"
export PIPEWIRE_CONFIG_DIR="$APPDIR/share/pipewire"
export PIPEWIRE_MODULE_DIR="$APPDIR/lib/pipewire-0.3"
HOOK
  fi
}
if ! pw_prepare; then
  echo "build-linux: WARNING - could not fetch/extract the pinned Debian 12 PipeWire set" >&2
  echo "  (pool $PW_POOL) - shipping without the audio patch; expect no sound on PipeWire desktops." >&2
fi

# --- speaker/mic device list: Chromium's built-in PulseAudio backend -------------
# `strings` on libcef.so (2026-10-09) confirms it has a full PulseAudio client
# compiled in (pa_context_get_sink_info_list etc.) and prefers it for per-device
# enumeration ("Speakers", "Headphones", ...), with an explicit "Falling back to
# ALSA for audio output. PulseAudio is not available or could not be initialized."
# message when it can't be reached. It's dlopen'd lazily by bare SONAME
# ("libpulse.so.0", no NEEDED entry on libcef.so itself), and we ship none, so
# Chromium always falls back to ALSA - which only reports one generic device.
# This is the live bug ("speakernél csak defaultot és system defaultot látok").
# PipeWire's pipewire-pulse ships a PulseAudio-protocol-compatible server on the
# usual socket on virtually every modern desktop (the same one the already-fixed
# ALSA path talks to), so only the CLIENT library needs to exist in the AppDir.
# Same pinned-Debian-12-pool approach as the PipeWire set above, but libpulse0's
# own NEEDED chain runs deep: libsndfile (sample-cache support PulseAudio's
# client side never actually calls for Chromium's basic playback/capture/
# enumerate use - but the dynamic loader resolves every NEEDED entry at dlopen()
# time regardless of whether a given library's symbols are ever invoked) pulls in
# FLAC/vorbis/opus/ogg/mpg123/lame codec libs, and libsystemd/libasyncns pull in
# libgcrypt/lzma/zstd/lz4/bsd/md. All from the bookworm (deb12) Packages index,
# so the glibc ceiling stays well under anything already bundled.
PULSE_POOL="http://deb.debian.org/debian/pool/main"
PULSE_CACHE="$HOME/.cache/jorkonvo-build/pulse-debs"
PULSE_ROOT=""   # set by pulse_prepare: extraction root, one subdir per package
pulse_prepare() {
  local debs=(
    "p/pulseaudio/libpulse0_16.1+dfsg1-2+b1_amd64.deb"
    "libs/libsndfile/libsndfile1_1.2.0-1+deb12u1_amd64.deb"
    "s/systemd/libsystemd0_252.39-1~deb12u2_amd64.deb"
    "liba/libasyncns/libasyncns0_0.8-6+b3_amd64.deb"
    "f/flac/libflac12_1.4.2+ds-2_amd64.deb"
    "libv/libvorbis/libvorbis0a_1.3.7-1_amd64.deb"
    "libv/libvorbis/libvorbisenc2_1.3.7-1_amd64.deb"
    "o/opus/libopus0_1.3.1-3_amd64.deb"
    "libo/libogg/libogg0_1.3.5-3_amd64.deb"
    "m/mpg123/libmpg123-0_1.31.2-1+deb12u1_amd64.deb"
    "l/lame/libmp3lame0_3.100-6_amd64.deb"
    "libg/libgcrypt20/libgcrypt20_1.10.1-3+deb12u1_amd64.deb"
    "libg/libgpg-error/libgpg-error0_1.46-1_amd64.deb"
    "x/xz-utils/liblzma5_5.4.1-1+deb12u1_amd64.deb"
    "libz/libzstd/libzstd1_1.5.4+dfsg2-5_amd64.deb"
    "l/lz4/liblz4-1_1.9.4-1_amd64.deb"
    "libb/libbsd/libbsd0_0.11.7-2_amd64.deb"
    "libm/libmd/libmd0_1.0.4-2_amd64.deb"
  )
  mkdir -p "$PULSE_CACHE"
  local f base d ok=1
  for f in "${debs[@]}"; do
    base="$(basename "$f")"
    [ -f "$PULSE_CACHE/$base" ] || curl -fsSL -o "$PULSE_CACHE/$base" "$PULSE_POOL/$f" || ok=0
  done
  if [ "$ok" = 1 ]; then
    rm -rf "$PULSE_CACHE/x"; mkdir -p "$PULSE_CACHE/x"
    for f in "${debs[@]}"; do
      base="$(basename "$f")"
      d="$PULSE_CACHE/x/${base%.deb}"; mkdir -p "$d"
      ( cd "$d" && ar x "$PULSE_CACHE/$base" && tar xf data.tar.* ) || ok=0
    done
  fi
  if [ "$ok" = 1 ]; then
    PULSE_ROOT="$PULSE_CACHE/x"
    # Sanity check the two files this patch actually exists for - a partial set
    # produces the same "Falling back to ALSA" failure this patch prevents.
    [ -f "$PULSE_ROOT/libpulse0_16.1+dfsg1-2+b1_amd64/usr/lib/x86_64-linux-gnu/libpulse.so.0.24.2" ] \
      && [ -f "$PULSE_ROOT/libpulse0_16.1+dfsg1-2+b1_amd64/usr/lib/x86_64-linux-gnu/pulseaudio/libpulsecommon-16.1.so" ]
  fi
}
pulse_copy_into() {  # $1 = AppDir (a directory containing lib/)
  # Flatten every .so* this package set contains (including libpulsecommon-16.1.so,
  # one level down in a pulseaudio/ subdir) into lib/ - the same dir quick-sharun's
  # own launcher already searches, proven by the PipeWire set above landing there.
  # No -type filter: each bare-SONAME symlink (e.g. libpulse.so.0 -> ...so.0.24.2)
  # must land too, under its own short name - that is the exact filename dlopen()
  # looks for. `cp` (no -d/-P) dereferences a symlink into a plain file of the
  # same name at the destination, which is just as good as a real symlink here.
  find "$PULSE_ROOT" -iname '*.so*' ! -type d -exec cp -v {} "$1/lib/" \;
}
if ! pulse_prepare; then
  echo "build-linux: WARNING - could not fetch/extract the pinned Debian 12 PulseAudio client set" >&2
  echo "  (pool $PULSE_POOL) - shipping without it; the speaker/mic list will only show" >&2
  echo "  one generic ALSA device instead of real per-device names." >&2
fi

# --- GPU DRI loader stubs (the same quick-sharun drop as the PipeWire set) ----
# quick-sharun bundles the build host's libgallium (the whole Mesa engine) but
# drops the /usr/lib/dri/*.so entries its loader probes for, so every GPU
# driver open fails and Chromium falls back to llvmpipe software rendering
# (verified live: "MESA-LOADER: failed to open radeonsi: …/lib/dri/
# radeonsi_dri.so" on an RX 6700 XT box). On current Arch Mesa every *_dri.so
# is a symlink onto libdril_dri.so - a ~14 KB loader that dispatches into
# libgallium - so the fix is tiny; it just MUST come from the exact Mesa build
# whose libgallium got bundled (the same host), hence the version guard.
# Verified live: with the stubs in place, glxinfo against the AppDir's own
# libraries reports "AMD Radeon RX 6700 XT (radeonsi, navi22, ACO)".
# VA-API video decode stays unaccelerated by choice: the host radeonsi
# VA driver drags in libLLVM.so + GLIBC_2.43, ~150 MB for marginal gain.
gpu_copy_into() {  # $1 = AppDir
  [ "$USE_HOST_DRIVERS_EXPERIMENTAL" = 1 ] && return 0   # host drivers: nothing to patch in
  local dir="$1" host_gal bun_gal drv
  host_gal="$(ls /usr/lib/libgallium-*.so 2>/dev/null | head -1 || true)"
  bun_gal="$(ls "$dir"/lib/libgallium-*.so 2>/dev/null | head -1 || true)"
  if [ -n "$bun_gal" ] && [ -f /usr/lib/dri/libdril_dri.so ]; then
    # Arch-style host: libgallium got bundled, just add the ~14 KB loader stub
    # + symlinks - but only from the exact same Mesa build.
    if [ -z "$host_gal" ] || [ "$(basename "$host_gal")" != "$(basename "$bun_gal")" ]; then
      echo "build-linux: WARNING - bundled libgallium ('$(basename "$bun_gal")') does not match the" >&2
      echo "  build host's ('$(basename "$host_gal" 2>/dev/null)') - skipping the GPU DRI stub patch;" >&2
      echo "  the bundle will render via llvmpipe (software)." >&2
      return 0
    fi
    mkdir -p "$dir/lib/dri"
    cp -v /usr/lib/dri/libdril_dri.so "$dir/lib/dri/"
    for drv in radeonsi swrast kms_swrast zink; do
      ln -sf libdril_dri.so "$dir/lib/dri/${drv}_dri.so"
    done
  elif [ -f /usr/lib/x86_64-linux-gnu/dri/radeonsi_dri.so ]; then
    # Debian-classic layout (the trixie build container): self-contained
    # per-driver megadrivers instead of Arch's libdril stubs; the bundled GL
    # stack comes from this same rootfs, so they match by construction.
    mkdir -p "$dir/lib/dri"
    cp -v /usr/lib/x86_64-linux-gnu/dri/radeonsi_dri.so "$dir/lib/dri/"
    cp -v /usr/lib/x86_64-linux-gnu/dri/swrast_dri.so "$dir/lib/dri/" 2>/dev/null || true
  else
    echo "build-linux: WARNING - no usable DRI driver source on this host (neither Arch" >&2
    echo "  libdril nor Debian classic layout) - GPU stub patch skipped, llvmpipe fallback." >&2
  fi
}

BUNDLE_DIR_TMP="${CARGO_TARGET_DIR:-$ROOT/apps/desktop/src-tauri/target}/release/bundle"
if [[ ",$BUNDLES," == *,appimage,* ]] && { [ -n "$PW_ROOT" ] || [ -n "$PULSE_ROOT" ]; }; then
  APPIMAGE_PATH="$(find "$BUNDLE_DIR_TMP/appimage" -maxdepth 1 -name '*.AppImage' | head -1)"
  [ -n "$APPIMAGE_PATH" ] || die "no .AppImage found in $BUNDLE_DIR_TMP/appimage to patch"

  APPIMAGETOOL="$HOME/.cache/jorkonvo-build/appimagetool-x86_64.AppImage"
  if [ ! -x "$APPIMAGETOOL" ]; then
    mkdir -p "$(dirname "$APPIMAGETOOL")"
    curl -fL -o "$APPIMAGETOOL" \
      https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
    chmod +x "$APPIMAGETOOL"
  fi
  WORK="$(mktemp -d)"
  ( cd "$WORK" && "$APPIMAGE_PATH" --appimage-extract >/dev/null )
  [ -n "$PW_ROOT" ] && pw_copy_into "$WORK/squashfs-root"
  [ -n "$PULSE_ROOT" ] && pulse_copy_into "$WORK/squashfs-root"
  gpu_copy_into "$WORK/squashfs-root"
  # appimagetool insists on a dir literally named AppDir, and validates that
  # the .desktop file's Icon= name has a matching top-level icon file - quick-
  # sharun's own AppRun doesn't care (it ships JorKonvo.png and never renames
  # it), so add the name appimagetool wants without touching the original.
  mv "$WORK/squashfs-root" "$WORK/AppDir"
  cp "$WORK/AppDir/JorKonvo.png" "$WORK/AppDir/jorkonvo-desktop.png"
  ( cd "$WORK" && ARCH="$(uname -m)" "$APPIMAGETOOL" --appimage-extract-and-run AppDir "$(basename "$APPIMAGE_PATH")" )
  mv -f "$WORK/$(basename "$APPIMAGE_PATH")" "$APPIMAGE_PATH"
  chmod +x "$APPIMAGE_PATH"
  rm -rf "$WORK"
  echo "build-linux: patched the PipeWire ALSA set + PulseAudio client set into $APPIMAGE_PATH"
fi

if [[ ",$BUNDLES," == *,deb,* ]] && { [ -n "$PW_ROOT" ] || [ -n "$PULSE_ROOT" ]; }; then
  DEB_PATH="$(find "$BUNDLE_DIR_TMP/deb" -maxdepth 1 -name '*.deb' | head -1)"
  if [ -n "$DEB_PATH" ]; then
    # Same patch for the .deb: unpack (ar + tar, no dpkg-deb needed on the host),
    # find the bundled AppDir by libcef.so, copy the same set in, repack. The
    # deb's launcher is a bare ELF (no AppRun.sh hook machinery), so the
    # /usr/bin symlink becomes a wrapper that exports the same env. ar keeps
    # member order as given on the command line, debian-binary must stay first.
    WORK="$(mktemp -d)"
    mkdir -p "$WORK/x" "$WORK/root"
    ( cd "$WORK/x" && ar x "$DEB_PATH" )
    ( cd "$WORK/root" && tar xf "$WORK/x/"data.tar.* )
    DEB_APPDIR="$(dirname "$(find "$WORK/root" -name libcef.so -print -quit)")"
    [ -n "$DEB_APPDIR" ] || die "no libcef.so inside $DEB_PATH - unexpected deb layout"
    [ -n "$PW_ROOT" ] && pw_copy_into "$DEB_APPDIR"
    [ -n "$PULSE_ROOT" ] && pulse_copy_into "$DEB_APPDIR"
    gpu_copy_into "$DEB_APPDIR"
    DEB_BIN="$(cd "$WORK/root" && find usr/bin -maxdepth 1 -type l | head -1)"
    if [ -n "$DEB_BIN" ] && [ "$(readlink "$WORK/root/$DEB_BIN")" = "../share/JorKonvo/jorkonvo-desktop" ]; then
      rm "$WORK/root/$DEB_BIN"
      cat > "$WORK/root/$DEB_BIN" <<'WRAPPER'
#!/bin/sh
# JorKonvo deb launcher. Was a symlink to ../share/JorKonvo/jorkonvo-desktop;
# now a wrapper so the bundled (glibc-2.36-matched) PipeWire client finds its
# bundled SPA plugins / client modules / client config - see
# docs/LINUX_PACKAGING.md "Root cause: why this needed a post-build patch".
APPDIR=/usr/share/JorKonvo
export SPA_PLUGIN_DIR="$APPDIR/lib/spa-0.2"
export PIPEWIRE_CONFIG_DIR="$APPDIR/share/pipewire"
export PIPEWIRE_MODULE_DIR="$APPDIR/lib/pipewire-0.3"
exec "$APPDIR/jorkonvo-desktop" "$@"
WRAPPER
      chmod 755 "$WORK/root/$DEB_BIN"
    else
      echo "build-linux: WARNING - deb launcher layout changed ($DEB_BIN), env wrapper not installed" >&2
    fi
    ( cd "$WORK/root" && tar czf "$WORK/x/data.tar.gz" --owner=0 --group=0 --numeric-owner . )
    CTRL_TAR="$(cd "$WORK/x" && ls | grep -m1 '^control\.tar\.')"
    ( cd "$WORK/x" && ar rc "$WORK/$(basename "$DEB_PATH")" debian-binary "$CTRL_TAR" data.tar.gz )
    mv -f "$WORK/$(basename "$DEB_PATH")" "$DEB_PATH"
    rm -rf "$WORK"
    echo "build-linux: patched the PipeWire ALSA set (plugins + libpipewire + spa + modules + config) + PulseAudio client set into $DEB_PATH"
  fi
fi

# --- collect ----------------------------------------------------------------------
OUT="$ROOT/dist/linux"; mkdir -p "$OUT"
BUNDLE_DIR="${CARGO_TARGET_DIR:-$ROOT/apps/desktop/src-tauri/target}/release/bundle"   # jor-release sets CARGO_TARGET_DIR
find "$BUNDLE_DIR" -maxdepth 2 \( -name '*.AppImage' -o -name '*.deb' \) -exec cp -v {} "$OUT"/ \;
(cd "$OUT" && shopt -s nullglob && files=(*.AppImage *.deb) && sha256sum "${files[@]}" | tee SHA256SUMS)   # nullglob: BUNDLES may omit one kind
