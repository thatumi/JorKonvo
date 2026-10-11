#!/usr/bin/env bash
# One-shot setup: fills in secrets, generates Synapse's signing key, renders
# every config template from .env. Safe to re-run (only fills BLANK secrets).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=".env"
[ -f "$ENV_FILE" ] || { echo "!! Copy .env.example to .env and fill it in first."; exit 1; }

# .env holds every secret this stack has (DB password, Synapse macaroon/
# registration/form secrets, LiveKit/TURN/MAS keys) in plaintext - the
# default umask leaves it group/world-readable, which on a shared host (or
# just as basic defense in depth) any other local user could otherwise read.
chmod 600 "$ENV_FILE"

# ---- helpers -------------------------------------------------------------
rand() { openssl rand -hex "${1:-32}"; }
rand_b64() { openssl rand -base64 "${1:-32}" | tr -d '\n'; }

set_if_blank() {
  local key="$1" val="$2"
  local cur
  cur="$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
  if [ -z "$cur" ]; then
    # portable in-place sed
    if sed --version >/dev/null 2>&1; then sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
    else sed -i '' "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"; fi
    echo "  generated ${key}"
  fi
}

# ---- 1. secrets ---------------------------------------------------------
echo "==> secrets"
set_if_blank POSTGRES_PASSWORD "$(rand 24)"
set_if_blank REGISTRATION_SHARED_SECRET "$(rand 32)"
set_if_blank MACAROON_SECRET_KEY "$(rand 32)"
set_if_blank FORM_SECRET "$(rand 32)"
set_if_blank LIVEKIT_API_KEY "API$(rand 6)"
set_if_blank LIVEKIT_API_SECRET "$(rand_b64 32)"
set_if_blank TURN_SHARED_SECRET "$(rand 32)"
set_if_blank MAS_ENCRYPTION_KEY "$(rand 32)"
set_if_blank MAS_SYNAPSE_SHARED_SECRET "$(rand 32)"

# shellcheck disable=SC1091
set -a; source "$ENV_FILE"; set +a

# ---- 2. public IP -----------------------------------------------------
if [ -z "${PUBLIC_IP:-}" ]; then
  PUBLIC_IP="$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me || true)"
  [ -n "$PUBLIC_IP" ] && set_if_blank PUBLIC_IP "$PUBLIC_IP"
  echo "==> detected PUBLIC_IP=${PUBLIC_IP}"
fi
export PUBLIC_IP

# ---- 3. Synapse signing key ----------------------------------------
if [ ! -f synapse/signing.key ]; then
  echo "==> generating Synapse signing key"
  docker run --rm -v "$(pwd)/synapse:/data" -e SYNAPSE_SERVER_NAME="$MATRIX_DOMAIN" \
    -e SYNAPSE_REPORT_STATS=no ghcr.io/element-hq/synapse:latest generate >/dev/null
  # Synapse's "generate" mode chowns everything it touches in /data to its
  # internal UID (991) as part of its own entrypoint, INCLUDING the synapse/
  # directory itself - which then blocks the plain `mv`/`rm` right below for
  # anyone running this script as a normal (non-root) user, since 991 isn't
  # them and the directory is left group/other read-only (found by an
  # actual local run as a non-root deploy user: `mv: Permission denied`,
  # not a hypothetical). Reclaiming it back to whoever is actually running
  # this script - the final ownership for the container's own user gets set
  # again below, after rendering, so this is only ever a transient handoff.
  docker run --rm -v "$(pwd)/synapse:/data" alpine:latest chown -R "$(id -u)":"$(id -g)" /data >/dev/null
  # `generate` names the key after the server_name (e.g.
  # matrix.example.com.signing.key), not the fixed `signing.key` our own
  # template's `signing_key_path: /data/signing.key` expects - without this
  # rename Synapse fails to start on every first-time setup with "Error
  # accessing file '/data/signing.key'" (found by an actual local run of
  # this script, not just reading it).
  mv "synapse/${MATRIX_DOMAIN}.signing.key" synapse/signing.key
  # keep only the signing key + log config we control; our template is authoritative
  rm -f synapse/homeserver.yaml "synapse/${MATRIX_DOMAIN}.log.config"
  # The signing key lets anyone impersonate this homeserver in federation if
  # it leaks - lock it down. Only reachable here, on first creation, while
  # it's still owned by whoever is running this script (the chown above) -
  # on a later re-run the file already has these permissions but is now
  # owned by 991 (see the final ownership pass below), and a plain `chmod`
  # by a non-root, non-991 user on an already-991-owned file fails with
  # "Operation not permitted" (chmod requires owning the file, unlike a
  # read), which would otherwise break re-running this idempotent script.
  chmod 600 synapse/signing.key
fi

# ---- 4. render templates -----------------------------------------------
echo "==> rendering configs"
render() {
  local tpl="$1" out="$2" tmp
  # Renders into a fresh temp file and *renames* it over $out, rather than
  # writing $out directly: on a re-run, $out may already exist owned by a
  # container's internal UID (see the ownership pass below), and a plain
  # shell redirect needs WRITE permission on the file itself to truncate
  # it, which the host user running this script no longer has by then -
  # "Permission denied" on the second run of an otherwise-unchanged script
  # (found by actually re-running it, not just reading it). A rename only
  # needs write permission on the DIRECTORY, which the host user still has.
  tmp="$(mktemp "${out}.XXXXXX")"
  # only substitute the vars we know, so literal $ in configs survive
  envsubst "$(printf '${%s} ' \
    APEX_DOMAIN MATRIX_DOMAIN LIVEKIT_DOMAIN LK_JWT_DOMAIN MAS_DOMAIN ADMIN_DOMAIN \
    ACME_EMAIL PUBLIC_IP POSTGRES_PASSWORD REGISTRATION_SHARED_SECRET MACAROON_SECRET_KEY \
    FORM_SECRET LIVEKIT_API_KEY LIVEKIT_API_SECRET TURN_SHARED_SECRET MAS_ENCRYPTION_KEY \
    MAS_SYNAPSE_SHARED_SECRET ENABLE_OPEN_REGISTRATION)" < "$tpl" > "$tmp"
  # Every rendered file has at least one of the secrets above baked into it
  # in plaintext (e.g. homeserver.yaml carries registration_shared_secret
  # and the Postgres password) - same reasoning as the .env chmod above.
  # mktemp already creates it 600, but that's an implementation detail of
  # mktemp, not a guarantee this script should silently rely on.
  chmod 600 "$tmp"
  mv -f "$tmp" "$out"
  echo "  $out"
}
render synapse/homeserver.yaml.template synapse/homeserver.yaml
render coturn/turnserver.conf.template   coturn/turnserver.conf
render livekit.yaml.template             livekit.yaml
[ -f mas/config.yaml.template ] && render mas/config.yaml.template mas/config.yaml

# ---- 5. ownership for each container's internal (non-root) user ---------
# `chmod 600` alone would lock EVERYONE but the host user out, including the
# container process that actually needs to read the file - most of these
# images drop root and run as a fixed internal UID, which only works if that
# UID also OWNS the file (bind-mounted volumes enforce host-side permission
# bits verbatim; there's no host/container UID translation). Verified against
# a real local run of each container (`docker top`, not just the image docs):
# Synapse's "run" mode runs as 991, coturn as 65534 (nobody), MAS's image as
# 65532 (its distroless "nonroot" user) - LiveKit's own process runs as root
# in its container, so it can read the 600 file regardless of owner and needs
# no chown here.
#
# Deliberately chowning individual FILES, not `-R` on the synapse/ directory
# itself: an earlier version of this did exactly that, which also chowns the
# directory's own inode to 991 - locking the host user (who needs to create
# new temp files here via `render` above on every future re-run) out of
# their own deploy checkout on the very next run (found by actually
# re-running this script twice in a row, not just reading it). Synapse also
# reads log.config at runtime (see homeserver.yaml.template's log_config
# path) - homeserver.yaml.template itself is never read by any container,
# so it deliberately stays host-owned.
echo "==> setting container-user ownership on rendered configs"
docker run --rm -v "$(pwd)/synapse:/data" alpine:latest \
  chown 991:991 /data/signing.key /data/homeserver.yaml /data/log.config >/dev/null
docker run --rm -v "$(pwd)/coturn/turnserver.conf:/f" alpine:latest chown 65534:65534 /f >/dev/null
[ -f mas/config.yaml ] && docker run --rm -v "$(pwd)/mas/config.yaml:/f" alpine:latest chown 65532:65532 /f >/dev/null

echo
echo "Done. Next:"
echo "  docker compose up -d                 # core stack"
echo "  ./scripts/create-admin.sh <name>     # your first account (admin)"
echo
echo "Optional profiles:"
echo "  docker compose --profile admin up -d       # synapse-admin UI"
echo "  docker compose --profile webapp up -d      # serve the JorKonvo web build"
echo "  (QR login / MAS: read README.md, it's a one-way switch)"
