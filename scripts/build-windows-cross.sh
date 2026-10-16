#!/usr/bin/env bash
# Cross-compile the Windows NSIS installer on Linux (cargo-xwin, MSVC target).
# This is the wry/WebView2 build: CEF is Linux-only (see apps/desktop/src-tauri/Cargo.toml),
# so the `cef` feature is deliberately NOT enabled here.
# FALLBACK only: the supported Windows build is on Windows itself (also gives the .msi).
# See docs/WINDOWS_WRY_VERIFY.md. Output: dist-windows/ (+ SHA256SUMS).
#
# Usage:   scripts/build-windows-cross.sh
#          SKIP_WEB=1 scripts/build-windows-cross.sh     # reuse an existing apps/web/dist
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
die() { echo "build-windows-cross: $*" >&2; exit 1; }

# NSIS without root: dpkg -x'd into ~/.local-opt with a wrapper that sets NSISDIR
# (tauri-bundler rewrites the NSIS dir to /usr/share/nsis). Recipe: JorStory RELEASE.md section 4:
#   mkdir -p ~/.local-opt && cd /tmp && apt-get download nsis nsis-common && dpkg -x nsis*.deb ~/.local-opt/
#   ~/.local-opt/wrap/makensis = sh script: export NSISDIR="$HOME/.local-opt/usr/share/nsis"; exec ~/.local-opt/usr/bin/makensis "$@"
export PATH="$HOME/.local-opt/wrap:$HOME/.local-opt/usr/bin:/usr/lib/llvm-14/bin:$PATH"
export XWIN_ARCH=x86_64
for bin in cargo cargo-xwin makensis llvm-lib node npm file; do
  command -v "$bin" >/dev/null || die "missing '$bin' (see the header of this script / docs/WINDOWS_WRY_VERIFY.md)"
done
rustup target list --installed | grep -qx x86_64-pc-windows-msvc \
  || die "rustup target add x86_64-pc-windows-msvc"

cd "$ROOT"
if [ -z "${SKIP_WEB:-}" ]; then
  [ -d node_modules ] || npm ci
  npm run build
fi
[ -f apps/web/dist/index.html ] || die "apps/web/dist/index.html missing - run without SKIP_WEB"

# --features tauri/custom-protocol is REQUIRED: without it the exe builds but runs in dev
# mode and tries to load devUrl http://localhost:5173 (docs/WINDOWS_WRY_VERIFY.md, section 2).
# Use the project's own JS CLI (node_modules), not `cargo tauri`, which on the dev box is the CEF CLI.
cd "$ROOT/apps/desktop"
"$ROOT/node_modules/.bin/tauri" build --runner cargo-xwin --target x86_64-pc-windows-msvc \
  --bundles nsis --features tauri/custom-protocol

TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/apps/desktop/src-tauri/target}/x86_64-pc-windows-msvc/release"
EXE="$TARGET_DIR/jorkonvo-desktop.exe"
file "$EXE" | grep -q 'PE32+ executable' || die "$EXE is not a PE32+ executable"

OUT="$ROOT/dist-windows"; rm -rf "$OUT"; mkdir -p "$OUT"
cp -v "$TARGET_DIR"/bundle/nsis/*-setup.exe "$OUT"/
(cd "$OUT" && sha256sum *.exe | tee SHA256SUMS)
