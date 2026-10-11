# End-to-end tests

Real Chromium (Playwright) driving the real web build against a **throwaway
Synapse** that is wiped on every run. Separate from the fast unit suite
(`npm test` / Vitest).

## Run locally

```bash
npm run build                 # the e2e run serves the static build
./e2e/scripts/up.sh           # start the disposable homeserver (Docker)
npm run test:e2e              # run the Playwright specs
./e2e/scripts/down.sh         # stop it and wipe its state
```

First run only: `npx playwright install chromium`.

## How it's wired

- `docker-compose.yml` — Synapse + a Caddy TLS front. The app only talks to
  `https://` homeservers (the production CSP forbids plain `http:`), so the
  test hits `https://localhost:18448` with Caddy's internal-CA cert;
  Playwright runs with `ignoreHTTPSErrors`.
- `synapse/homeserver.yaml` — test-only. Committed secrets (they guard
  nothing), open registration, every rate limiter cranked to 1000/s.
- `tests/helpers.ts` — `registerUser()` goes straight through Synapse's
  admin shared-secret endpoint (fast, never rate-limited, never touches the
  flow under test); `loginAs()` drives the password form.

## Coverage

| spec | what it proves |
|---|---|
| `login.spec.ts` | password sign-in reaches the app; wrong password is rejected; in-app registration works; session survives reload |
| `messaging.spec.ts` | two users exchange **end-to-end-encrypted** messages (invite → join → send → decrypt, both directions) |
| `spaces.spec.ts` | create a space, add a channel, channel persists across reload |
| `settings.spec.ts` | a changed preference survives a hard reload |
| `moderation.spec.ts` | a room admin kicks a member via the context menu + confirm dialog (this found DialogHost was never mounted) |
| `roles.spec.ts` | create a role, give it "Kick Members", assign it to a member → the member's `m.room.power_levels` entry actually rises to 50 |
| `csp.spec.ts` / `bundle.spec.ts` | zero CSP violations on load + the pre-paint script runs; the crypto wasm never loads on the login screen |

## Not yet covered (TODO)

Key verification (SAS), 1:1 / group calls, screen share, QR login. These
need two live devices or real media - tracked in `PLAN.md`.
