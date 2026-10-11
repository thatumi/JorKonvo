#!/usr/bin/env bash
# Install the .deb into a clean Debian/Ubuntu container with apt (so Depends are
# resolved), check for unresolved libs, then smoke-run the app under xvfb.
#   usage: test-in-container.sh <image> /path/to/JorKonvo_x.y.z_amd64.deb
# The run step needs Chromium's user-namespace sandbox, which docker's default
# seccomp profile blocks - so this runs with seccomp/apparmor relaxed. That only
# affects the throwaway test container.
set -euo pipefail
IMAGE="${1:?image, e.g. debian:trixie}"; DEB="$(readlink -f "${2:?path to .deb}")"
docker run --rm --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  -e DEBIAN_FRONTEND=noninteractive -v "$DEB":/pkg.deb:ro "$IMAGE" bash -euc '
  apt-get update -qq >/dev/null
  apt-get install -y -qq --no-install-recommends /pkg.deb xvfb xauth curl ca-certificates >/tmp/apt.log 2>&1 || { tail -20 /tmp/apt.log; exit 1; }
  echo "== dpkg status:"; dpkg -s jor-konvo | grep -E "^(Package|Status|Version|Maintainer|Section|Provides)"
  echo "== setuid sandbox:"; ls -l /usr/share/JorKonvo/chrome-sandbox
  echo "== ldd missing libs:"; (ldd /usr/share/JorKonvo/jorkonvo-desktop; ldd /usr/share/JorKonvo/libcef.so) 2>&1 | grep "not found" | sort -u || echo "(none)"
  useradd -m tester
  su tester -c "xvfb-run -a jorkonvo-desktop --remote-debugging-port=9333 >/tmp/run.log 2>&1 &"
  ok=0; for i in $(seq 1 40); do curl -s localhost:9333/json 2>/dev/null | grep -q "\"title\": \"JorKonvo\"" && { ok=1; echo "== SMOKE OK: window \"JorKonvo\" up after $((i*2))s"; break; }; sleep 2; done
  [ $ok = 1 ] || { echo "== SMOKE FAILED"; tail -15 /tmp/run.log; exit 1; }
'
