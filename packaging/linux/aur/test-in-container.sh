#!/usr/bin/env bash
# Build + install + smoke-run jorkonvo-bin in a throwaway archlinux container,
# using a LOCAL AppImage instead of the (not yet published) release URL.
#   usage: test-in-container.sh /path/to/JorKonvo_0.0.1_amd64.AppImage
set -euo pipefail
APPIMAGE="$(readlink -f "${1:?path to AppImage}")"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cp "$HERE"/jorkonvo-bin/{PKGBUILD,jorkonvo.desktop,jorkonvo.sh,LICENSE} "$WORK"/
ln "$APPIMAGE" "$WORK/$(basename "$APPIMAGE")" 2>/dev/null || cp "$APPIMAGE" "$WORK/"
# Swap the release URL for the local file and pin the real checksum.
SUM="$(sha256sum "$APPIMAGE" | cut -d' ' -f1)"
sed -i -E "s#^source=\(\"(.*)::[^\"]*\"#source=(\"\1\"#; 0,/sha256sums=\('SKIP'/s//sha256sums=('$SUM'/" "$WORK/PKGBUILD"
docker run --rm ${DOCKER_ARGS:-} -v "$WORK":/pkg:rw --name jorkonvo-aur-test archlinux:latest bash -euxc '
  pacman -Syu --noconfirm --needed base-devel sudo xorg-server-xvfb libx11 mesa alsa-lib hicolor-icon-theme fontconfig ttf-dejavu namcap >/dev/null
  useradd -m builder; chown -R builder /pkg
  sudo -u builder bash -c "cd /pkg && makepkg -f --noconfirm --nodeps 2>&1 | tail -15"
  pacman -U --noconfirm /pkg/jorkonvo-bin-*.pkg.tar.zst
  pacman -Ql jorkonvo-bin | grep -v "/opt/jorkonvo-bin/.*/" | head -20
  namcap /pkg/jorkonvo-bin-*.pkg.tar.zst 2>&1 | grep -v "is not a directory" | head -10 || true
  test -x /usr/bin/jorkonvo
  # Smoke run as a normal user (Chromium refuses root without --no-sandbox).
  sudo -u builder bash -c "xvfb-run -a jorkonvo --remote-debugging-port=9333 >/tmp/run.log 2>&1 &"
  for i in $(seq 1 40); do curl -s localhost:9333/json 2>/dev/null | grep -q "\"title\": \"JorKonvo\"" && { echo "SMOKE OK: window title JorKonvo after ${i}x2s"; break; }; sleep 2; done
  curl -s localhost:9333/json | grep -E "\"(title|url)\"" || true
  tail -12 /tmp/run.log; ps -eo args | grep -c "[j]orkonvo"
'
