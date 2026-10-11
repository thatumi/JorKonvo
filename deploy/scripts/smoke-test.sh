#!/usr/bin/env bash
# Local sanity check for the deploy stack WITHOUT real DNS or Let's Encrypt:
# provisions into a scratch .env, brings up Postgres + Synapse (the two
# pieces whose config this repo actually renders), and asserts Synapse boots
# against Postgres with the real production homeserver.yaml.template and
# answers /health + /_matrix/client/versions.
#
# Caddy/ACME, LiveKit and coturn need public DNS / a public IP and are not
# covered here - see DEPLOY.md.
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP=""
if [ -f .env ]; then BACKUP=".env.smoke-backup.$$"; mv .env "$BACKUP"; fi
cleanup() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f .env
  # Synapse runs as uid 991 and leaves the bind-mounted files it touched
  # owned by it; hand synapse/ back to whoever ran this script and drop only
  # the provision-generated files (log.config is checked in - keep it).
  docker run --rm -v "$(pwd)/synapse:/d" alpine:latest \
    sh -c "chown -R $(id -u):$(id -g) /d 2>/dev/null; rm -f /d/homeserver.yaml /d/signing.key /d/homeserver.pid /d/*.rendered; rm -rf /d/media_store" >/dev/null 2>&1 || true
  git checkout -- synapse/log.config 2>/dev/null || true
  [ -n "$BACKUP" ] && mv "$BACKUP" .env
  return 0
}
trap cleanup EXIT

cat > .env <<'EOF'
APEX_DOMAIN=chat.localhost
MATRIX_DOMAIN=matrix.localhost
LIVEKIT_DOMAIN=livekit.localhost
LK_JWT_DOMAIN=rtc-jwt.localhost
MAS_DOMAIN=auth.localhost
ADMIN_DOMAIN=admin.localhost
ACME_EMAIL=smoke@localhost
PUBLIC_IP=203.0.113.10
POSTGRES_PASSWORD=
REGISTRATION_SHARED_SECRET=
MACAROON_SECRET_KEY=
FORM_SECRET=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
TURN_SHARED_SECRET=
MAS_ENCRYPTION_KEY=
MAS_SYNAPSE_SHARED_SECRET=
ENABLE_OPEN_REGISTRATION=true
EOF

echo "==> provisioning (scratch .env)"
PUBLIC_IP=203.0.113.10 ./scripts/provision.sh

echo "==> starting postgres + synapse"
docker compose up -d postgres synapse

echo -n "==> waiting for Synapse to be healthy "
for i in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q synapse)" 2>/dev/null || echo starting)"
  [ "$status" = "healthy" ] && { echo " ok"; break; }
  echo -n "."; sleep 2
  [ "$i" = "60" ] && { echo " FAILED"; docker compose logs --tail 40 synapse; exit 1; }
done

# Synapse is deliberately NOT published to the host (Caddy is the only
# ingress), so every check below runs from inside the container (which has
# curl - the compose healthcheck uses it too).
echo "==> checking Synapse's own endpoints (from inside the container)"
docker compose exec -T synapse curl -fsS http://localhost:8008/health | grep -q OK
docker compose exec -T synapse curl -fsS http://localhost:8008/_matrix/client/versions | grep -q '"v1.'
echo "  /health + /_matrix/client/versions ok"

echo "==> registering a throwaway user (non-interactive)"
docker compose exec -T synapse register_new_matrix_user \
  -u smoke-admin -p smoke-pass-12345 --no-admin \
  -c /data/homeserver.yaml http://localhost:8008

echo "==> logging that user in over the client API"
docker compose exec -T synapse curl -fsS -XPOST http://localhost:8008/_matrix/client/v3/login \
  -H 'Content-Type: application/json' \
  -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"smoke-admin"},"password":"smoke-pass-12345"}' \
  | grep -q access_token
echo "  login ok"

echo
echo "SMOKE TEST PASSED - the deploy stack's rendered Synapse config boots against Postgres and serves the client API."
