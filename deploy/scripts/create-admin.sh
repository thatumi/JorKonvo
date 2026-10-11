#!/usr/bin/env bash
# Create a user (first one should be your admin). Prompts for a password.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
set -a; source .env; set +a

NAME="${1:-}"
[ -n "$NAME" ] || { echo "usage: $0 <username> [--admin]"; exit 1; }
ADMIN_FLAG=""
[ "${2:-}" = "--admin" ] && ADMIN_FLAG="-a"

docker compose exec synapse register_new_matrix_user \
  -u "$NAME" $ADMIN_FLAG \
  -c /data/homeserver.yaml http://localhost:8008
