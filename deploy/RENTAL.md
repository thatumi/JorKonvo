# "Rent a Matrix server from me" — research + build order

The pitch: a customer picks a plan and a domain, pays, and 5 minutes later has
a private Matrix homeserver with working Discord-style voice/video, spaces and
E2EE — no ops knowledge required. You manage the fleet.

`deploy/` already contains the **provisioning core** (Docker stack + Terraform
that stands up one server per customer). This doc is the rest.

---

## 1. Which host to rent the VMs from

You want **per-hour billing** (so a trial or a cancelled account costs cents,
not a month) and a **good API / Terraform provider** for automation.

| Provider | Billing | 2 vCPU / 4 GB | API / TF | Notes |
|---|---|---|---|---|
| **Hetzner Cloud** | per **hour**, capped at monthly | **~€4.5/mo** (`cx22`) | excellent (`hcloud` TF provider, cloud-init) | 3–5× cheaper than US clouds, 20 TB traffic included, EU + 2 US regions. **Best value by far.** Price change took effect 2026-04-01. |
| **Vultr** | per hour | ~$24/mo | good API | 32 regions incl. emerging markets (São Paulo, Mumbai, Seoul, Joburg…) — pick this for non-EU customers |
| **DigitalOcean** | per hour | ~$24/mo | mature | worth it only if you also want their managed Postgres/Redis |
| **Scaleway** | per hour (some per-minute) | ~€7/mo | decent | EU, per-minute on some instance types |
| **Fly.io** | per **second** | — | Machines API | finest granularity, but Matrix on Fly is awkward (persistent volumes, UDP for LiveKit) — not recommended for this |

**Recommendation:** Hetzner Cloud as the default (EU customers + best margin),
Vultr as the "other regions" fallback. Both are wired into `terraform/main.tf`
already for Hetzner; a Vultr variant is a ~30-line swap.

Rough unit economics at Hetzner `cx22` (~€4.5 cost):
- sell at €6–9/mo → €1.5–4.5 gross margin/server/month
- calls (LiveKit) are the only real variable cost driver; cap concurrent
  video publishers per plan tier

## 2. DNS

Each server needs 4–6 sub-domains. Two models:

- **You own one base domain** (e.g. `jorkonvo.host`) and give each customer
  `theirname.jorkonvo.host` + `matrix.theirname.jorkonvo.host` etc.
  Simplest — one Cloudflare zone, wildcard-ish record creation via API.
- **Customer brings their own domain** — they delegate `_matrix._tcp` SRV +
  point records, or hand you API access to their zone. More support load.

`terraform/main.tf` uses the Cloudflare provider; swap for `dns` /
`desec` / Bunny / Route53 as needed. Cloudflare records must be **DNS-only
(grey cloud)** — Matrix federation and WebRTC need the real IP.

## 3. The SaaS layer (not built yet)

```
customer portal (web)                  <- Next/Remix/plain; or bolt onto the JorKonvo repo
  ├─ sign up / login
  ├─ pick plan + domain
  ├─ Stripe / Paddle checkout  ────────>  webhook
  │                                          │
provisioning worker  <──── job queue ────────┘
  ├─ terraform apply (workspace = tenant)      (or call Hetzner + Cloudflare APIs directly)
  ├─ poll cloud-init `/opt/jorkonvo/.provisioned`
  ├─ create admin account, email credentials
  └─ write tenant row (server id, ip, domains, plan, status)

fleet ops (cron)
  ├─ nightly `backup.sh` on every tenant -> object storage (Hetzner Storage Box / B2)
  ├─ `docker compose pull && up -d` staggered updates
  ├─ disk / CPU / cert alerts (Uptime Kuma or Prometheus node-exporter)
  └─ suspend (stop containers) on non-payment; destroy after grace period
```

### Build order

1. **Manual tier first.** Run `terraform apply -var-file=<tenant>.tfvars` by
   hand for the first few customers. Validates the stack + pricing before any
   portal code. (You could even sell this today.)
2. **Provisioning worker.** A small service that takes `{tenant, plan, domain,
   email}` and runs steps 1–4 above. Terraform Cloud API, or shell out to the
   `terraform` binary, or skip Terraform and call `hcloud` + Cloudflare Go/JS
   SDKs directly (fewer moving parts for a worker).
3. **Billing.** Stripe Billing (subscriptions + metered add-ons for extra call
   minutes) or Paddle (handles EU VAT / merchant-of-record — worth it for a
   solo operator selling into the EU).
4. **Portal.** Thin: auth, plan picker, "your server" status page, invoices,
   "danger zone" (backup download, delete). Can live in this monorepo as
   `apps/portal`.
5. **Fleet dashboard + automation.** Backups, updates, monitoring, lifecycle.

### Legal / operational reality check (solo operator)

- You're now a **data processor** for other people's chats. GDPR: DPA
  template, EU region by default, documented deletion, sub-processor list
  (Hetzner, Cloudflare, Stripe).
- **Abuse.** Open registration on a customer's server = spam/CSAM risk that
  lands on your IPs. Default `open_registration=false`; require the customer
  to own moderation; have a takedown process; consider MSC4284 / mjolnir
  policy lists shipped by default.
- **TURN bandwidth** can be abused as an open relay — `turnserver.conf`
  already denies RFC1918 + metadata ranges; keep it locked.
- Backups contain E2EE-encrypted content (fine) but also access tokens and
  the signing key (encrypt backups at rest).
- **Support burden** is the real cost, not the €4.5 VM. Price for it.

## 4. Cheaper / simpler alternatives to consider

- **Shared multi-tenant Synapse** (one big server, many `server_name`s via
  virtual hosting) — far better margins, but Synapse isn't really built for it
  and one noisy tenant hurts everyone. Not recommended unless you get big.
- **conduwuit / continuwuity** (Rust homeserver) instead of Synapse — a
  fraction of the RAM, single binary, faster. Trade-off: smaller ecosystem,
  some MSCs (extended profiles, sliding sync details) may lag. Worth
  prototyping a `docker-compose.conduwuit.yml` variant — could halve the
  minimum VM size and your costs.
- **dendrite** — in between; less active than conduwuit lately.

---

_Sources: Hetzner/Vultr/DO hourly-billing + pricing comparisons (apicalculators.com,
cloudmart.dev, betterstack.com), Hetzner `hcloud` Terraform provider docs
(registry.terraform.io), Aug 2026._
