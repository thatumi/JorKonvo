## Project HQ (`.hub/`)

This repo is tracked by the cross-project dashboard in `~/jorhub`. When you make
meaningful progress, change direction, or hit a blocker, update
**`.hub/status.json`** (schema in `.hub/README.md`): bump `phase`/`health`,
rewrite `summary`, refresh `needs` and `next`, set `updated` to today and
`updatedBy` to yourself. Drop relevant screenshots in `.hub/screenshots/`.
Commit it with your other changes.

---

# JorKonvo — a Discord-style Matrix client

One React/TypeScript codebase that runs in the browser, in a Tauri desktop
shell, and in a Capacitor Android app. `PLAN.md` is the running dev log
(rounds 0–19+); `docs/ARCHITECTURE.md` goes deeper than this file.

## Layout

```
packages/matrix-core/   framework-agnostic Matrix logic (matrix-js-sdk wrapper).
                        NO React. The source of truth for protocol behaviour.
apps/web/               React + Vite + Tailwind v4. The source of truth for UI.
apps/desktop/           Tauri shell (see "Desktop" below). Loads the web build.
apps/web/android/       Capacitor Android project (tracked — has hand-edited
                        native files; ios/ is not generated yet, needs a Mac).
deploy/                 "Matrix server in a box" — Docker Compose + Terraform.
                        See deploy/DEPLOY.md.
e2e/                    Playwright suite + its throwaway Synapse.
test/                   Vitest unit tests + fakes.
```

npm workspaces (pnpm wouldn't install on the original machine). `@jorkonvo/matrix-core`
is consumed as a workspace package — **build it first** (`npm run build:matrix-core`)
or its `dist/*.d.ts` won't exist and the web build fails to resolve it.

## Toolchain

- **Node 20.19+ / 22.12+** — the build uses `rolldown-vite` (Vite 8). Older Node fails.
- `npm run build` = `build:matrix-core` then `build:web` (`tsc -b && vite build`).
- `npm test` = Vitest unit tests (`test/unit/**`, no browser, no homeserver).
- `npm run test:e2e` = Playwright — needs `./e2e/scripts/up.sh` first (starts a
  disposable Synapse behind a Caddy TLS front on `https://localhost:18448`).
- `npm run lint` = oxlint (config: `apps/web/.oxlintrc.json`). Warnings don't fail.
- **Commit rule:** only push to `main` when `npm run build` + `npm test` are green.
  One logical change per commit. Anything that's a real decision for the owner →
  a Forgejo PR, not `main`.

## State & data flow (the web app)

- **Zustand** everywhere. `state/matrixStore.ts` holds the live `MatrixClient`
  plus `syncTick`, a single global counter.
- `authStore.wireClientEvents()` bumps `syncTick` (coalesced to one bump per
  animation frame) on ~a dozen client/room events, incl. `MatrixEventEvent.Decrypted`
  (E2EE messages decrypt in the background and the SDK does *not* re-emit
  `RoomEvent.Timeline` for them).
- ~30 components subscribe to `syncTick` and **re-derive** what they need from
  the live `client` on each render. There is no normalized store of rooms/events —
  the SDK's own objects are the state. When you add a feature, read from
  `client`/`room` in the component and let `syncTick` drive updates.
- Per-feature stores (`callStore`, `verificationStore`, `qrLoginStore`, …) hold
  transient UI/flow state only.

## matrix-core conventions

- **Discord features that Matrix has no native concept for** (roles, categories,
  slowmode, automod, reaction-roles, space settings, …) live in a custom
  `io.jorkonvo.*` **state event** on the space or room. Read pattern is always
  `room.currentState.getStateEvents(TYPE, "")?.getContent()`.
- **Honest scoping.** slowmode / automod / client-tier role permissions are
  *client-side courtesy limits*, not server-enforced — a modified client can
  ignore them. Every such module says so in its header comment; keep that
  honesty when extending them.
- **Hybrid permissions** (`roles.ts` + `permissions.ts`): Discord-style named,
  colored, multi-assignable roles layered over Matrix power levels. A role's
  power level is opt-in; `computeRequiredPowerLevel()` compiles named
  permissions ("Kick Members", …) down to the PL that actually satisfies them
  across every room in the space.
- **`client.sendStateEvent()` has no local echo** — a plain PUT, visible only
  after it round-trips through `/sync`. Never re-read `room.currentState`
  immediately after writing it to compute the next step; pass the new value
  explicitly (see `roles.ts` `resyncHolders` / `syncMemberPowerLevelFromRoles`).
- Source uses NodeNext-style `./foo.js` specifiers that resolve to `./foo.ts`.
- `qrLogin.ts` is **deliberately not in the barrel** (`index.ts`) — it drags in
  matrix-js-sdk's MSC4108 classes which statically import the ~7.8 MB crypto
  wasm glue. Import it from `"@jorkonvo/matrix-core/qr"`, dynamically.

## Crypto (E2EE)

- rust-crypto (`@matrix-org/matrix-sdk-crypto-wasm`). `initCrypto()` in
  `client.ts` → `client.initRustCrypto()`. matrix-js-sdk lazy-loads the wasm;
  it must stay off the pre-auth path (guarded by `e2e/tests/bundle.spec.ts`).
- **Multi-account:** each added account gets a `cryptoDatabasePrefix` derived
  from its user id so two accounts don't share one IndexedDB crypto store. The
  *first* (pre-multi-account) session keeps the SDK's default unprefixed store —
  its possibly-years-old verified identity must not move. Asymmetric on purpose.
- Device verification uses `requestDeviceVerification` (not `requestVerificationDM` —
  that needs a published cross-signing identity the other user may not have).
- `client.getUser(id).displayName` is **not** account-level — it gets
  contaminated by any per-room nickname. Use `profileStore` / `getProfileInfo()`
  for account identity.

## UI / rendering

- **Design system** is in `apps/web/src/index.css` — Tailwind v4 `@theme` with
  accent / surface / corner / density presets, a motion system, light/dark.
  Read it before touching visuals.
- **XSS:** `MessageBody.tsx` renders other clients' `formatted_body` by walking
  the parsed DOM through an allowlist — never `dangerouslySetInnerHTML` (one
  exception: highlight.js output, which is pre-escaped). `RichEmbed` builds
  iframe `src` from a per-provider allowlist, never the raw URL. Keep it that way.
- **CSP** is defined in `apps/web/vite.config.ts` (`cspPlugin`, injected as a
  `<meta>`) and **mirrored** in `deploy/caddy/Caddyfile` and
  `apps/desktop/src-tauri/tauri.conf.json` — all three are enforced. The one
  inline `<script>` in `index.html` (pre-paint theme init) is allow-listed by
  sha256 in all three; `test/unit/web/csp-inline-script.test.ts` guards the sync.
- **i18n** (`apps/web/src/i18n/`): a tiny dependency-free `t()`. Keys are
  English; `hu` is the reference locale, `en` must keep parity. Some
  `matrix-core` user-facing strings (e.g. slash-command feedback) are still
  hard-coded Hungarian — fine to leave, don't be surprised.
- New interactive elements that a test needs: add a `data-testid` (see existing
  ones — `login-*`, `composer-input`, `room-row`, `create-*`, `settings-nav-*`).

## Desktop

`apps/desktop` is **Tauri**, not Electron (migrated round ~17). It uses Tauri's
unreleased `feat/cef` branch to embed real Chromium via CEF, because plain
WebKitGTK can't do `getDisplayMedia()` / screen share on Linux. `cargo audit`
warnings that trace to the `feat/cef` dependency tree are known and can't be
version-bumped away until that branch moves.

## Gotchas that have bitten before

- `tsc -b` is incremental via `packages/matrix-core/tsconfig.tsbuildinfo`
  (next to the tsconfig, not in `dist/`). If you `rm -rf dist` but leave the
  buildinfo, `tsc -b` skips the rebuild. `.dockerignore` excludes `*.tsbuildinfo`
  for exactly this reason.
- The homeserver login rate limit on a **shared** server is aggressive and every
  password login makes a new device. The e2e suite dodges this with a throwaway
  server; for manual testing against a real one, reuse a persistent browser
  profile (`chromium.launchPersistentContext`).
- `deploy/scripts/provision.sh` chowns rendered configs to each container's
  internal UID (991 Synapse, 65534 coturn, 65532 MAS). Re-running it is safe and
  expected; it only fills blank secrets.
