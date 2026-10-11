#!/usr/bin/env bash
# Build an UNSIGNED apt repo (reprepro, run in a throwaway debian container).
#   usage: build-repo.sh /path/to/jor-konvo_x.y.z_amd64.deb [outdir]
# Output: <outdir>/{dists,pool} - serve it with any static web server.
set -euo pipefail
DEB="$(readlink -f "${1:?path to .deb}")"; HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${2:-$HERE/../../../dist/apt}"
# The docker daemon runs as root, so files it creates are root-owned: clean up via docker too.
[ -d "$OUT" ] && docker run --rm -v "$(cd "$OUT/.." && pwd)":/p debian:trixie rm -rf "/p/$(basename "$OUT")"
mkdir -p "$OUT/conf"; OUT="$(cd "$OUT" && pwd)"
cp "$HERE/conf/distributions" "$OUT/conf/"
docker run --rm -v "$OUT":/repo -v "$DEB":/pkg/"$(basename "$DEB")":ro debian:trixie bash -euc '
  apt-get update -qq >/dev/null && apt-get install -y -qq reprepro >/dev/null
  reprepro -b /repo includedeb stable /pkg/*.deb
  reprepro -b /repo list stable
  rm -rf /repo/db /repo/conf   # reprepro bookkeeping; not part of the published tree
  chown -R '$(id -u):$(id -g)' /repo'
find "$OUT" -type f | sed "s#$OUT/##"
