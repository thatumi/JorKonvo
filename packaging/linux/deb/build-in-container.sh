#!/usr/bin/env bash
# Build the Linux bundles inside debian:trixie so the produced binaries link
# against the oldest glibc we ship to, not the build host's.
#
# Why this exists (measured 2026-09-20 on an Arch/CachyOS host, glibc 2.43):
# building scripts/build-linux.sh directly on a rolling host bakes
# GLIBC_2.43 symbol requirements into jorkonvo-desktop. The resulting .deb
# apt-installs cleanly on debian:trixie but aborts at startup with
#   version `GLIBC_2.43' not found (required by jorkonvo-desktop)
# The AppImage is immune for its OWN requirements (sharun bundles its own
# glibc from the build host), but under USE_HOST_DRIVERS_EXPERIMENTAL=1 it
# still dlopens the RUNTIME host's libEGL/libGL/etc. through cross-libc-dlopen,
# and that shim can only bridge a SYMBOL VERSION gap, not a symbol the
# bundled glibc never had at all. Measured 2026-10-09 on a glibc-2.44 laptop
# (Intel iHD): bookworm's glibc 2.36 (kimle-server, the usual AppImage build
# host) is missing __isoc23_strtol (added in glibc 2.38), which the host's
# own libEGL.so.1 needs - cross-libc-dlopen's rewrite can patch a version
# requirement but can't manufacture a symbol that plain does not exist in the
# bundled libc, so EGL init fails need for the host-drivers GPU path
# (ANGLE's GLX backend fails independently of this, see docs/LINUX_PACKAGING.md).
# Building the AppImage here too, against trixie's glibc 2.40 (>= 2.38),
# removes that specific gap. Host-drivers mode doesn't bundle GPU/Mesa
# libraries (DEPLOY_OPENGL=0), so the "fuller library set" this container
# used to lack for a *bundled-driver* AppImage no longer applies to it.
# Always run packaging/linux/deb/test-in-container.sh on the .deb artifact.
#
# usage: packaging/linux/deb/build-in-container.sh [image]   # default debian:trixie
#   SKIP_WEB=1 ...   reuse apps/web/dist built on the host
#   BUNDLES=appimage,deb ...   which bundles to build (default: both)
# Prereqs on the host: docker, node 20.19+/22.12+ (for the web bundle).
# First run compiles rustup toolchain + tauri-cli inside the container
# (~10 min) and downloads CEF (~1 GB); both are cached in docker volumes /
# the host ~/.cache/tauri, so later runs are much faster.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
IMAGE="${1:-debian:trixie}"
BUNDLES="${BUNDLES:-appimage,deb}"
HOST_UID="$(id -u)"; HOST_GID="$(id -g)"

if [ -z "${SKIP_WEB:-}" ]; then
  cd "$ROOT"
  [ -d node_modules ] || npm ci
  npm run build
fi

# Volumes: cargo/rustup caches survive across runs so tauri-cli is compiled once.
docker volume create jorkonvo-cargo >/dev/null
docker volume create jorkonvo-rustup >/dev/null

docker run --rm --user 0:0 \
  -v "$ROOT":/src:rw \
  -v jorkonvo-cargo:/usr/local/cargo:rw \
  -v jorkonvo-rustup:/usr/local/rustup:rw \
  -v "${HOME}/.cache/tauri":/mnt/tauri-cache:rw \
  -e CARGO_HOME=/usr/local/cargo \
  -e RUSTUP_HOME=/usr/local/rustup \
  -e HOME=/root \
  -e BUNDLES="$BUNDLES" \
  -e USE_HOST_DRIVERS_EXPERIMENTAL="${USE_HOST_DRIVERS_EXPERIMENTAL:-1}" \
  "$IMAGE" bash -euc '
    export PATH="/usr/local/cargo/bin:$PATH"
    apt-get update -qq
    # git + make: USE_HOST_DRIVERS_EXPERIMENTAL=1 clones and builds
    # cross-libc-dlopen (scripts/build-linux.sh). xauth+util-linux(script)+xvfb:
    # quick-sharun needs a controlling tty and a display. libnss3 (+libnspr4,
    # libnssutil3, libsmime3) and libasound2t64: CEF/libcef.so links them
    # directly (NSS for certs/crypto, ALSA as the base audio backend - see the
    # PipeWire-plugin patch further down in build-linux.sh) and quick-sharun
    # can only bundle what the build host actually has installed; a bare
    # debian:trixie has neither (measured 2026-10-09: "is missing libraries!").
    apt-get install -y -qq --no-install-recommends build-essential pkg-config libgtk-3-dev librsvg2-dev libssl-dev libnss3 libasound2t64 curl git patchelf xvfb xauth util-linux nodejs npm ca-certificates file >/dev/null
    command -v cargo >/dev/null || curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable >/dev/null
    cargo install --list | grep -q tauri-cli || cargo install --git https://github.com/tauri-apps/tauri --branch feat/cef tauri-cli
    cd /src
    ls /src/scripts/build-linux.sh >/dev/null   # fail fast with a clear path if the mount is off
    SKIP_WEB=1 scripts/build-linux.sh
    # Hand the WHOLE tree back to the host user (docker runs us as root): Tauri writes
    # outside target/ and dist/ too (apps/desktop/src-tauri/gen/schemas/*.json), and a
    # root-owned leftover there makes jor-release'\''s worktree cleanup fail with
    # "Permission denied" afterwards (measured 2026-10-09).
    chown -R '"$HOST_UID:$HOST_GID"' /src /mnt/tauri-cache
  '
