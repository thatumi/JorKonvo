#!/usr/bin/env bash
# Dump the database + media + configs to ./backups/<timestamp>.tar.zst
set -euo pipefail
cd "$(dirname "$0")/.."
TS="$(date +%Y%m%d-%H%M%S)"
OUT="backups/${TS}"
mkdir -p "$OUT"

echo "==> postgres"
docker compose exec -T postgres pg_dump -U synapse synapse | zstd -q -o "${OUT}/synapse.sql.zst"

echo "==> media + configs"
docker run --rm -v "$(pwd)/deploy_synapse_media:/m:ro" -v "$(pwd)/${OUT}:/o" alpine \
  sh -c "cd /m && tar cf - . | zstd -q -o /o/media.tar.zst" 2>/dev/null || \
  echo "  (media volume not found under this name - adjust if your compose project prefix differs)"
cp .env synapse/homeserver.yaml livekit.yaml coturn/turnserver.conf "${OUT}/" 2>/dev/null || true

tar cf - -C backups "${TS}" | zstd -q -o "backups/${TS}.tar.zst"
rm -rf "$OUT"
echo "==> backups/${TS}.tar.zst"
