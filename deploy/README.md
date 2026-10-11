# JorKonvo — Matrix server in a box

Everything a JorKonvo (or Element, or any Matrix client) needs, as one Docker
Compose stack:

| Service | What it does |
|---|---|
| **Synapse** + Postgres | the homeserver — accounts, rooms, spaces, E2EE |
| **LiveKit** + `lk-jwt-service` | group voice/video calls + screen share (MSC4143) |
| **coturn** | WebRTC TURN relay for 1:1 calls behind strict NATs |
| **Caddy** | reverse proxy, automatic HTTPS, serves `.well-known` |
| *(opt)* **MAS** | Matrix Authentication Service → unlocks QR-code login |
| *(opt)* **synapse-admin** | web admin UI |
| *(opt)* **webapp** | serves the JorKonvo web build at your apex domain |

## Quick start (any VPS with Docker)

```bash
cd deploy
cp .env.example .env
$EDITOR .env                       # set the 6 domains + your email
./scripts/provision.sh             # generates all secrets + Synapse signing key, renders configs
docker compose up -d
./scripts/create-admin.sh myname --admin
```

DNS: point `A`/`AAAA` records for **all six** domains in `.env` at the server
(`APEX_DOMAIN`, `MATRIX_DOMAIN`, `LIVEKIT_DOMAIN`, `LK_JWT_DOMAIN`, and — if you
enable those profiles — `MAS_DOMAIN`, `ADMIN_DOMAIN`). Caddy gets Let's Encrypt
certs automatically once DNS resolves.

If the host has its own firewall active (e.g. `ufw`, not the case on a fresh
Hetzner VM provisioned via `terraform/` below, but possible if you're
self-hosting on an existing box) make sure it allows traffic from Docker's
bridge networks to the host-networked `livekit`/`coturn` ports (7880-7881
TCP, 3478/3479/5349/5350 UDP+TCP, 50000-60000 UDP) - otherwise Caddy can
reach Synapse fine but not LiveKit, since `livekit`/`coturn` use
`network_mode: host` while Caddy sits on Compose's own bridge network.

Then sign in from JorKonvo with homeserver `https://APEX_DOMAIN`.

### Sizing

| Users | Hetzner type | ~€/mo |
|---|---|---|
| ≤ 15, light calls | `cx22` (2 vCPU / 4 GB) | 4 |
| ≤ 50, regular calls | `cx32` (4 vCPU / 8 GB) | 7 |
| busy space, many concurrent calls | `cx42` (8 vCPU / 16 GB) | 14 |

LiveKit is the CPU hog — each active video publisher costs a chunk. Audio-only
calls are cheap.

## Fully automated (Terraform + Hetzner + Cloudflare)

`terraform/` provisions **one server per customer** — Hetzner VM (hourly
billing, capped monthly) + all the Cloudflare DNS records + cloud-init that
installs Docker and runs `provision.sh` + `docker compose up`.

```bash
cd deploy/terraform
cp tenant.tfvars.example acme.tfvars   # per customer
$EDITOR acme.tfvars
terraform init
terraform apply -var-file=acme.tfvars
# -> outputs server_ip, login_url; the admin account is created by cloud-init
```

Run many tenants with a Terraform **workspace per customer**
(`terraform workspace new acme`) or wrap `main.tf` in a module.

This is the provisioning core of the "rent a Matrix server from me" idea — see
[RENTAL.md](RENTAL.md) for the missing pieces (billing, customer portal,
lifecycle) and a build order.

## QR-code login (MAS)

**One-way switch — do it on a fresh server or a staging copy first.**

1. Fill `MAS_*` in `.env`, create `mas/config.yaml` (template TBD — see
   `github.com/element-hq/matrix-authentication-service` docs).
2. Uncomment the `msc3861` block in `synapse/homeserver.yaml`.
3. `docker compose --profile mas up -d`
4. For an existing server with users: run `mas-cli syn2mas --dry-run` then for
   real, to migrate accounts/sessions.

After this, Synapse delegates auth to MAS, the client's
`isSignInWithQRAvailable()` returns true, and the "QR kóddal" button works.
See the main `PLAN.md` "Amihez emberi beavatkozás kell" section.

## Backups

```bash
./scripts/backup.sh          # -> backups/<timestamp>.tar.zst (db + media + configs)
```

Cron it and copy off-box.

## Monitoring

Two unauthenticated health endpoints, ready to point an external uptime
monitor (UptimeRobot, Healthchecks.io, Uptime Kuma, ...) at:

- `https://<MATRIX_DOMAIN>/health` - Synapse's own health check, proxied
  through Caddy. Returns `OK` when Synapse itself is actually up; a real
  outage (Synapse crashed/OOM'd/still starting) shows as a failed/non-200
  request, not a false "healthy" from Caddy answering on its behalf.
- `https://<LIVEKIT_DOMAIN>/` - LiveKit's own root health response (`OK`).

coturn has no HTTP endpoint to check (it only speaks TURN/STUN over UDP/TCP),
so it isn't covered by either of the above - a real STUN binding request is
the only way to verify it, which is outside what a plain HTTP monitor can do.

## Deploying

See **[DEPLOY.md](DEPLOY.md)** for the exact fresh-VPS sequence. TL;DR:
`cp .env.example .env` → edit domains → `./scripts/provision.sh` →
`docker compose up -d` → `./scripts/create-admin.sh <you> --admin`.

`./scripts/smoke-test.sh` provisions into a scratch `.env` and verifies the
Synapse+Postgres core boots end to end (no DNS needed).

## Files

```
DEPLOY.md                     fresh-VPS walkthrough
docker-compose.yml            the stack (profiles: mas, admin, webapp)
.env.example                  every knob; provision.sh fills the secrets
scripts/provision.sh          idempotent setup
scripts/smoke-test.sh         local core-stack sanity check (no DNS)
scripts/create-admin.sh       register a user
scripts/backup.sh             db + media dump
scripts/hetzner-cloud-init.yaml   fresh-VM bootstrap template
caddy/Caddyfile               proxy + TLS + .well-known (incl. rtc_foci)
synapse/homeserver.yaml.template
livekit.yaml.template         SFU config (host networking)
coturn/turnserver.conf.template
webapp/Dockerfile             builds the JorKonvo web app (--profile webapp)
terraform/                    one-server-per-customer IaC
```
