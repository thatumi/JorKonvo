# JorKonvo architecture

A Discord-shaped client for Matrix. This document explains how the pieces fit
together; `CLAUDE.md` has the day-to-day conventions and gotchas, `PLAN.md` is
the chronological dev log.

## 1. The three layers

```
┌─────────────────────────────────────────────────────────────┐
│ apps/web        React 19 + Vite 8 (rolldown) + Tailwind v4   │  UI, source of truth
│   components/   presentational + container React components  │
│   layout/       the three-column shell                       │
│   state/        Zustand stores                               │
│   lib/          device-local helpers (prefs, media, format)  │
│   i18n/         hu (reference) + en                           │
├─────────────────────────────────────────────────────────────┤
│ packages/matrix-core    framework-agnostic Matrix logic      │  protocol, source of truth
│   client.ts     login / restore / crypto init / sync start   │
│   rooms/messages/threads/…   thin, typed SDK wrappers         │
│   roles.ts + permissions.ts  the hybrid permission model     │
│   *.ts          one file per Discord-style feature           │
├─────────────────────────────────────────────────────────────┤
│ matrix-js-sdk (rust-crypto)   the actual Matrix client       │
└─────────────────────────────────────────────────────────────┘
```

`matrix-core` has **no React import** and never will — it's the seam that lets
the same protocol logic back a browser app, a desktop shell, and (later)
anything else. `apps/web` is the only consumer today.

The **shells** wrap the exact same web build:

- `apps/desktop` — Tauri 2 on its unreleased `feat/cef` branch, which embeds
  real Chromium (CEF) instead of WebKitGTK. This is the whole reason the
  migration off Electron happened: `getDisplayMedia()` / screen share works on
  every OS with CEF, which plain WebView does not. `src-tauri/src/main.rs`
  locks the webview to its own origin (`on_navigation` + `is_safe_external_url`)
  and exposes a minimal `window.jorkonvoDesktop` bridge (unread-badge count,
  Rich Presence events). `capabilities/default.json` grants nothing else.
- `apps/web/android` — Capacitor. Bundles `dist/` directly.

## 2. Sync and rendering

There is **no normalized store**. matrix-js-sdk already maintains `Room`,
`MatrixEvent`, `RoomMember` objects from `/sync`; those *are* the state.

```
/sync ──▶ matrix-js-sdk objects ──▶ client events ──▶ authStore.wireClientEvents
                                                              │
                                          requestAnimationFrame-coalesced
                                                              ▼
                                        matrixStore.syncTick += 1  ── Zustand ──▶
                                                                     ~30 components
                                                                     re-derive from
                                                                     the live client
```

`syncTick` is deliberately coarse: one counter, one bump per frame, a full
re-render cascade. Chat activity (typing, receipts, a fast backlog scroll) would
otherwise be a torrent of synchronous re-renders. Consumers lose nothing because
they always re-read current state from the client — the tick just says "look
again". `MatrixEventEvent.Decrypted` is wired in too, because an E2EE message
that decrypts in the background does **not** re-emit `RoomEvent.Timeline`.

Per-feature stores (`callStore`, `groupCallStore`, `verificationStore`,
`qrLoginStore`, `dialogStore`, `modalStore`, …) hold only transient flow/UI
state — never a copy of Matrix data.

## 3. Discord features on top of Matrix

Matrix has spaces, rooms, power levels, and state events. It does **not** have
roles, categories, slowmode, automod, per-space notification config, etc. Each
of those is a custom **state event** (`io.jorkonvo.*`) on the space or room:

| feature | event type | enforced by |
|---|---|---|
| roles + assignments | `io.jorkonvo.space_roles` (on the space) | power levels it pushes out; client for the rest |
| channel categories | `io.jorkonvo.space_categories` | `state_default` PL (org-level, exactly right) |
| slowmode | `io.jorkonvo.slowmode` | **client only** — courtesy limit |
| automod | `io.jorkonvo.automod` | **whichever moderator's client is open** |
| reaction roles | `io.jorkonvo.reaction_roles` | client |
| space settings | `io.jorkonvo.space_settings` | `state_default` PL |

The honesty is explicit in every module header: a modified client can bypass
the client-only ones. They still degrade gracefully — the config is readable by
any client, so a well-behaved one honours it.

### The hybrid permission model

`permissions.ts` + `roles.ts`. Matrix's model is a **scalar** (power level)
compared against per-action thresholds — a total order. Discord's is an
**unordered set of bits**. They only reconcile for a subset:

- **power-level tier** (kick, ban, redact, invite, send, react, specific state
  events): checking the box is genuinely server-enforced, but because Matrix
  has one scalar, granting the highest-threshold permission also grants every
  lower one. `computeRequiredPowerLevel()` takes the max across every room in
  the space so the number is sufficient everywhere; the role editor UI surfaces
  the implied extras rather than hiding them.
- **client tier** (attach files, external emoji, create threads): no Matrix
  equivalent — a file and a text message are both `m.room.message`. Best-effort
  UI gates (`hasClientPermission`), backward-compatible: a role that never
  configured its `permissions` list can only ever *gain* nothing and *lose*
  nothing.

## 4. End-to-end encryption

- rust-crypto (`@matrix-org/matrix-sdk-crypto-wasm`, ~7.8 MB). matrix-js-sdk
  dynamically imports it at `initRustCrypto()` time, which is **after** login —
  so it never touches the pre-auth login screen. `qrLogin.ts` used to drag the
  wasm glue onto the main bundle via MSC4108; it's now a lazy
  `"@jorkonvo/matrix-core/qr"` subpath. `e2e/tests/bundle.spec.ts` guards this.
- **Per-account IndexedDB isolation:** `StoredSession.cryptoDatabasePrefix`,
  derived from the user id, keeps two logged-in accounts from sharing one
  crypto store. Asymmetric on purpose: the *first* account (from before
  multi-account existed) keeps the SDK's default unprefixed store, so a
  years-old verified identity doesn't move a byte.
- **Verification:** device-level SAS (`requestDeviceVerification`), not
  `requestVerificationDM` — the latter needs the other user to already have a
  published cross-signing identity, which two fresh accounts don't.
- **Key backup / 4S:** `crypto.ts` — `restoreKeyBackupWithRecoveryKey`,
  `restoreCrossSigningWithRecoveryKey` (reads existing keys), and
  `createFreshCrossSigningIdentity` (destructive — only for an account with
  nothing set up yet).

## 5. Calls

Group voice/video/screen-share is **LiveKit** (an SFU), discovered via the
`org.matrix.msc4143.rtc_foci` entry the deploy stack's Caddy serves in
`.well-known/matrix/client`. `lk-jwt-service` mints LiveKit access tokens,
verifying the caller against the homeserver's OpenID federation.
`groupCallStore` drives the `livekit-client` connection; `callStore` handles
legacy 1:1 WebRTC. RNNoise noise suppression runs as a browser `AudioWorklet`
+ wasm before the track is published.

## 6. Deploy topology

`deploy/` is a single-tenant "server in a box" (`deploy/DEPLOY.md` is the
walkthrough):

```
                    Caddy (:443, automatic HTTPS, .well-known)
                   /      |         |            \
        <APEX>    /  <MATRIX>   <LIVEKIT_DOMAIN>  <LK_JWT_DOMAIN>
       webapp   /   synapse ── postgres          lk-jwt
      (profile)     │
                    └── coturn (host-net, TURN/STUN for calls)
                    livekit (host-net, SFU media)
```

`scripts/provision.sh` generates secrets and renders every `*.template` from
`.env`, chowning each rendered file to the UID its container runs as. Optional
compose profiles: `webapp` (builds the client from the repo),
`admin` (synapse-admin), `mas` (Matrix Authentication Service → unlocks QR
login; one-way).

## 7. Testing

| suite | what | how |
|---|---|---|
| `test/unit/**` (Vitest) | framework-agnostic matrix-core logic + web helpers; hand-rolled `FakeRoom`/`FakeClient` | `npm test` — no browser, no homeserver |
| `e2e/tests/**` (Playwright) | the real web build vs a throwaway Synapse (+ Caddy TLS front, so it hits the real prod CSP) | `./e2e/scripts/up.sh` then `npm run test:e2e` |
| `deploy/scripts/smoke-test.sh` | the deploy stack's Synapse+Postgres core boots with the production template | run it directly |

CI (`.forgejo/workflows/ci.yml`) runs build + lint + unit on every push; the
e2e job is gated on a Docker-capable runner. No runner is registered yet.
