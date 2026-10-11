#!/usr/bin/env bash
# Tear down the test Synapse and wipe its state.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose down -v --remove-orphans 2>/dev/null || true
echo "==> test Synapse torn down"
