#!/usr/bin/env bash
# Serve the repo over HTTP (nginx container) and `apt install` from it in a
# clean debian/ubuntu container. Cleans up its own container + network.
#   usage: test-repo.sh <image> [repo-dir]
set -euo pipefail
IMAGE="${1:?image}"; HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${2:-$HERE/../../../dist/apt}" && pwd)"
NET=jorkonvo-apt-test; WEB=jorkonvo-apt-web
cleanup() { docker rm -f $WEB >/dev/null 2>&1 || true; docker network rm $NET >/dev/null 2>&1 || true; }
trap cleanup EXIT; cleanup
docker network create $NET >/dev/null
docker run -d --name $WEB --network $NET -v "$REPO":/usr/share/nginx/html:ro nginx:alpine >/dev/null
docker run --rm --network $NET -e DEBIAN_FRONTEND=noninteractive "$IMAGE" bash -euc '
  apt-get update -qq >/dev/null; apt-get install -y -qq ca-certificates >/dev/null
  # [trusted=yes] only because this sample is unsigned; a real repo ships a key.
  echo "deb [trusted=yes] http://'$WEB'/ stable main" > /etc/apt/sources.list.d/jorkonvo.list
  apt-get update 2>&1 | grep -E "jorkonvo|'$WEB'|Get:|Err" | head -5
  apt-cache policy jorkonvo jor-konvo | head -8
  apt-get install -y -qq --no-install-recommends jorkonvo >/tmp/i.log 2>&1 || { tail -15 /tmp/i.log; exit 1; }
  dpkg -s jor-konvo | grep -E "^(Package|Status|Version|Provides)"; test -x /usr/bin/jorkonvo-desktop && echo "binary present"'
