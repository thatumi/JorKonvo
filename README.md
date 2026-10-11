# JorKonvo

A Discord-style chat client for [Matrix](https://matrix.org), the open,
decentralized chat protocol. One React/TypeScript codebase that runs in the
browser (React + Vite + Tailwind v4), and the same build packaged for
desktop (Tauri + CEF) and Android (Capacitor).

- **[jorkonvo.com](https://jorkonvo.com)** – landing page & downloads
- **[app.jorkonvo.com](https://app.jorkonvo.com)** – use it in the browser, no install
- **[PLAN.md](PLAN.md)** – the full development log, round by round
- **[CLAUDE.md](CLAUDE.md)** – architecture in a nutshell, conventions, gotchas
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** – detailed architecture
- **[deploy/DEPLOY.md](deploy/DEPLOY.md)** – running your own instance

## Layout

```
packages/matrix-core/   Framework-agnostic Matrix logic (a matrix-js-sdk
                        wrapper). NO React - the source of truth for
                        protocol behaviour.
apps/web/               React + Vite app - the source of truth for the UI.
apps/desktop/           Tauri shell (CEF runtime), loads the web build.
apps/web/android/       Capacitor Android project (tracked in git).
deploy/                 "Matrix server in a box" - Docker Compose + Terraform.
e2e/                    Playwright suite + a disposable Synapse.
test/                   Vitest unit tests.
```

npm workspaces (not pnpm/yarn - see PLAN.md). `@jorkonvo/matrix-core` is
consumed as a workspace package: **build it first**
(`npm run build:matrix-core`), or the web build can't resolve it, since
`dist/*.d.ts` won't exist yet.

## Development

Requires **Node.js 20.19+ / 22.12+** (the build uses `rolldown-vite`).

```bash
npm install
npm run build:matrix-core     # required first step
npm run dev:web                # Vite dev server: http://localhost:5173
```

Full build: `npm run build` (`build:matrix-core` + `tsc -b && vite build`).

### Desktop (Tauri)

```bash
cd apps/desktop && npm run dev        # loads the Vite dev server
```

The desktop shell uses Tauri's unreleased `feat/cef` branch to embed real
Chromium via CEF - needed for screen sharing on Linux.

### Mobile (Capacitor)

The Android native project (`apps/web/android/`) is generated and
buildable. iOS needs a Mac + Xcode (see PLAN.md).

## Testing

```bash
npm test                    # Vitest unit tests (no browser, no server)
./e2e/scripts/up.sh         # bring up a disposable Synapse
npm run test:e2e            # Playwright E2E (real Chromium)
./e2e/scripts/down.sh       # tear it down
```

First time: `npx playwright install chromium`.

CI: `.forgejo/workflows/ci.yml` (build + lint + unit on every push; the E2E
job needs a Docker-capable runner).

## License / status

Early-stage personal project, under the MIT license (see
[LICENSE](LICENSE)).

Most of the codebase was built with Claude Code (Anthropic's AI assistant),
under my direction - the architecture, priorities, and live-tested behaviour
are mine, but the AI wrote the large majority of the actual lines. If that
matters to you when judging the code or deciding to contribute, now you
know.
