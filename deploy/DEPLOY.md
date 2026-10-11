# Deploying a JorKonvo instance

A one-tenant "Matrix server in a box": Synapse + Postgres for chat/E2EE,
LiveKit + coturn for calls, Caddy for TLS and routing, and (optionally) the
JorKonvo web app served at your brand domain.

This is the **exact** sequence for a fresh VPS. It has been smoke-tested end
to end for the Synapse/Postgres core (`./scripts/smoke-test.sh`); Caddy,
LiveKit and coturn additionally need real public DNS and open ports, which a
local test can't stand in for.

---

## 0. What you need

- A Linux server with a **public IPv4** (2 vCPU / 4 GB RAM is comfortable
  for a small community; 1 GB works for a handful of users).
- **Docker** + the Compose plugin (`docker compose version` ≥ v2).
- **DNS A/AAAA records** pointing at the server for every domain you'll use:

  | domain (env var) | needed when | example |
  |---|---|---|
  | `MATRIX_DOMAIN` | always | `matrix.example.com` |
  | `APEX_DOMAIN` | always (brand domain / web app) | `chat.example.com` |
  | `LIVEKIT_DOMAIN` | calls | `livekit.example.com` |
  | `LK_JWT_DOMAIN` | calls | `rtc-jwt.example.com` |
  | `ADMIN_DOMAIN` | `--profile admin` | `admin.example.com` |
  | `MAS_DOMAIN` | `--profile mas` (QR login) | `auth.example.com` |

  `MATRIX_DOMAIN` is **permanent** — user IDs become `@name:MATRIX_DOMAIN`
  and can never be re-homed. Pick it deliberately.

- **Open ports**: `80`, `443` (TCP + UDP) for Caddy; `7880-7890` and a wide
  UDP range for LiveKit/coturn media (host-networked — see
  `livekit.yaml.template` / `coturn/turnserver.conf.template`). On a cloud
  firewall, allow `443/udp` and `3478-3479`, `5349-5350`, `49152-65535/udp`.

---

## 1. Get the files onto the server

```bash
git clone https://git.szabotar.dev/thatumi/JorKonvo.git
cd JorKonvo/deploy
```

Everything below runs from `JorKonvo/deploy`.

---

## 2. Configure

```bash
cp .env.example .env
$EDITOR .env          # fill in the six domains + ACME_EMAIL
```

Leave every `*_SECRET` / `*_KEY` / `POSTGRES_PASSWORD` **blank** — the next
step generates them. Set `ENABLE_OPEN_REGISTRATION=false` unless you really
want anyone to be able to sign up (there is no CAPTCHA).

---

## 3. Provision (generates secrets + renders configs)

```bash
./scripts/provision.sh
```

This is **idempotent** — safe to re-run; it only fills blank secrets. It:

- writes random secrets back into `.env` (and `chmod 600`s it),
- auto-detects `PUBLIC_IP` if blank,
- generates Synapse's federation signing key (`synapse/signing.key`, 600),
- renders `synapse/homeserver.yaml`, `coturn/turnserver.conf`,
  `livekit.yaml` from their `.template` files,
- chowns each rendered file to the UID its container runs as.

> If you run `provision.sh` as a non-root user, it uses short throwaway
> `docker run` calls to do the chowns — that's expected.

---

## 4. Bring up the core stack

```bash
docker compose up -d
```

Wait for health (`docker compose ps` — every service should read
`healthy`/`running`). Caddy will fetch Let's Encrypt certificates on first
start; watch it with `docker compose logs -f caddy` and make sure DNS has
propagated first, or ACME will rate-limit you.

Sanity check:

```bash
curl https://<MATRIX_DOMAIN>/health                       # -> OK
curl https://<MATRIX_DOMAIN>/_matrix/client/versions      # -> JSON
curl https://<APEX_DOMAIN>/.well-known/matrix/client      # -> homeserver + rtc_foci
```

---

## 5. Create your first account (admin)

```bash
./scripts/create-admin.sh <username> --admin
```

(prompts for a password). Sign in from any JorKonvo client with homeserver
`https://<MATRIX_DOMAIN>`.

---

## 6. Optional profiles

```bash
# Serve the JorKonvo web app at https://<APEX_DOMAIN> (builds from the repo)
docker compose --profile webapp up -d --build

# synapse-admin web UI at https://<ADMIN_DOMAIN>
docker compose --profile admin up -d

# QR-code login via Matrix Authentication Service — ONE-WAY change,
# read README.md first
docker compose --profile mas up -d
```

The `webapp` build bakes in nothing tenant-specific (the homeserver URL is
entered on the login screen), so the same image works for any instance.

---

## 7. Backups

```bash
./scripts/backup.sh          # Postgres dump + media, to ./backups/
```

Cron it and copy the output **off the box**. To restore: stop the stack,
`docker compose run --rm postgres pg_restore ...`, restore the media
directory, start again.

---

## 8. Upgrades

```bash
git pull
./scripts/provision.sh       # picks up any template changes
docker compose pull
docker compose up -d
```

Synapse schema migrations run automatically on start; watch
`docker compose logs -f synapse` the first time after a big version jump.

---

## Local sanity check (no DNS needed)

```bash
./scripts/smoke-test.sh
```

Provisions into a scratch `.env`, brings up **Postgres + Synapse only**, and
asserts Synapse boots against Postgres with the real production template and
answers `/health`, `/_matrix/client/versions` and `/login`. Tears itself
down. Does **not** exercise Caddy/ACME, LiveKit or coturn (those need public
DNS / a routable IP).

---

## Troubleshooting

| symptom | cause |
|---|---|
| Caddy crash-loops immediately | `ACME_EMAIL` empty in `.env`, or DNS not pointing here yet |
| Synapse: `Permission denied` on `signing.key` | re-run `./scripts/provision.sh` (fixes ownership) |
| calls connect but no audio/video | media UDP ports not open on the cloud firewall |
| `/_matrix/client/versions` 200 but web app can't connect | the client needs `https://` — check the cert actually issued |
| synapse-admin page is blank | it serves on container port 8080, already handled by the Caddyfile |
