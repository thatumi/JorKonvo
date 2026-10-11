#!/usr/bin/env bash
# Bring up the disposable test Synapse (+ TLS front) and wait for health.
#
# The Synapse config + signing key are baked into a small image at build
# time (see e2e/synapse/Dockerfile) - no bind mounts, so this runs the same
# on a dev box and inside a docker-outside-of-docker CI job.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> building + starting test Synapse (https://localhost:18448 via Caddy)"
up_log="$(mktemp)"
if ! docker compose up -d --build --wait >"$up_log" 2>&1; then
  cat "$up_log"
  if grep -q "address pools have been fully subnetted" "$up_log"; then
    # This box is shared; the default bridge address pool can fill up with
    # orphaned networks. Pruning only removes networks NOT attached to any
    # running container, so live stacks are untouched.
    echo "==> address pool exhausted - pruning dangling docker networks and retrying"
    docker network prune -f
    docker compose up -d --build --wait
  else
    exit 1
  fi
else
  cat "$up_log"
fi
rm -f "$up_log"

# In a docker-outside-of-docker CI job the published 127.0.0.1:18448 is on
# the HOST's loopback, not this container's - join the compose network and
# talk to Caddy by service name instead (E2E_HOMESERVER is set to
# https://caddy in the workflow).
if [ -n "${CI:-}" ] && [ -n "${HOSTNAME:-}" ]; then
  echo "==> CI: joining jorkonvo-e2e-net as $HOSTNAME"
  docker network connect jorkonvo-e2e-net "$HOSTNAME" 2>/dev/null || true
fi

HS="${E2E_HOMESERVER:-https://localhost:18448}"
echo "==> homeserver is up ($HS):"
for _ in $(seq 1 30); do curl -sk "$HS/health" >/dev/null 2>&1 && break; sleep 1; done
curl -sk "$HS/health" && echo
curl -sk "$HS/_matrix/client/versions" | head -c 120 && echo
