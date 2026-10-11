# Builds the JorKonvo web app and serves the static bundle on :8081.
# Build context is the REPO ROOT (see docker-compose.yml's `webapp` service)
# so the whole monorepo is available - the app needs @jorkonvo/matrix-core
# from the workspace.
#
# The build bakes in NOTHING deployment-specific: the homeserver URL is
# entered by the user at the login screen, so one image works for any tenant.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/matrix-core/package.json packages/matrix-core/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci
COPY . .
RUN npm run build:matrix-core && npm run build:web

FROM caddy:2-alpine
COPY --from=build /repo/apps/web/dist /srv
# Real files first (incl. the public static pages privacy.html and
# delete-account.html from apps/web/public), then the same path + ".html" so
# the clean URLs /privacy and /delete-account work too, and only then the SPA
# fallback: every other unknown path serves index.html so client-side routing
# and hard reloads on a deep link both work.
RUN printf ':8081 {\n\troot * /srv\n\ttry_files {path} {path}.html /index.html\n\tfile_server\n\tencode gzip zstd\n}\n' > /etc/caddy/Caddyfile
EXPOSE 8081
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:8081/ >/dev/null || exit 1
