#!/usr/bin/env bash
# Build the Flatpak from a LOCAL .deb (the release URL does not exist yet) and
# export it to a repo + single-file bundle. Needs flatpak-builder (or, without
# root: `flatpak install --user flathub org.flatpak.Builder org.gnome.Sdk//48`).
#   usage: build-local.sh /path/to/JorKonvo_x.y.z_amd64.deb [outdir]
set -euo pipefail
DEB="$(readlink -f "${1:?path to .deb}")"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${2:-$HERE/../../../dist/flatpak}"; mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"   # must be under $HOME: the sandboxed Builder cannot see /tmp
FB=(flatpak-builder); command -v flatpak-builder >/dev/null || FB=(flatpak run --user org.flatpak.Builder)
SUM="$(sha256sum "$DEB" | cut -d' ' -f1)"
# Point the manifest at the local file + real checksum (path-based sources are
# resolved relative to the manifest, so write it next to the other sources).
sed -E "s#^( +)url: .*_amd64\.deb#\1path: $DEB#; s#^( +)sha256: [0-9a-f]{64}#\1sha256: $SUM#" \
  "$HERE/dev.jorkonvo.desktop.yml" > "$HERE/.local-manifest.yml"
trap 'rm -f "$HERE/.local-manifest.yml"' EXIT
cd "$HERE"
"${FB[@]}" --force-clean --user --disable-rofiles-fuse --repo="$OUT/repo" "$OUT/build" .local-manifest.yml
flatpak build-bundle "$OUT/repo" "$OUT/dev.jorkonvo.desktop.flatpak" dev.jorkonvo.desktop
ls -la "$OUT/dev.jorkonvo.desktop.flatpak"
