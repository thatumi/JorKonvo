# JorKonvo

Discord-szerű felületű Matrix kliens. Egyetlen React/TypeScript kódbázis,
ami böngészőben fut (React + Vite + Tailwind v4), és ugyanaz a build csomagolva
desktopon (Tauri + CEF) és Androidon (Capacitor) is.

- **[PLAN.md](PLAN.md)** – a teljes fejlesztési napló, körökre bontva
- **[CLAUDE.md](CLAUDE.md)** – architektúra dióhéjban, konvenciók, gotchák
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** – részletes architektúra
- **[deploy/DEPLOY.md](deploy/DEPLOY.md)** – saját instance üzembe helyezése

## Mappaszerkezet

```
packages/matrix-core/   Framework-agnosztikus Matrix logika (matrix-js-sdk
                        wrapper). NINCS benne React – ez a forrás igazság a
                        protokoll-viselkedéshez.
apps/web/               React + Vite alkalmazás – a forrás igazság a UI-hoz.
apps/desktop/           Tauri shell (CEF runtime), a web buildet tölti be.
apps/web/android/       Capacitor Android projekt (verziókövetve).
deploy/                 "Matrix szerver dobozban" – Docker Compose + Terraform.
e2e/                    Playwright teszt-csomag + eldobható Synapse.
test/                   Vitest egység-tesztek.
```

npm workspaces (pnpm/yarn nem – l. PLAN.md). A `@jorkonvo/matrix-core`
workspace-csomagként fogyasztódik: **előbb buildeld** (`npm run build:matrix-core`),
különben a `dist/*.d.ts` hiányában a web build nem tudja feloldani.

## Fejlesztés

Előfeltétel: **Node.js 20.19+ / 22.12+** (a build `rolldown-vite`-ot használ).

```bash
npm install
npm run build:matrix-core     # kötelező első lépés
npm run dev:web               # Vite dev szerver: http://localhost:5173
```

Teljes build: `npm run build` (`build:matrix-core` + `tsc -b && vite build`).

### Desktop (Tauri)

```bash
cd apps/desktop && npm run dev        # betölti a Vite dev szervert
```

A desktop shell a Tauri `feat/cef` (kiadatlan) ágát használja, ami valódi
Chromiumot ágyaz be CEF-en át – ez kell a képernyőmegosztáshoz Linuxon.

### Mobil (Capacitor)

Az Android natív projekt (`apps/web/android/`) legenerálva és buildelhető.
iOS-hez Mac + Xcode kell (l. PLAN.md).

## Tesztelés

```bash
npm test                    # Vitest egység-tesztek (böngésző/szerver nélkül)
./e2e/scripts/up.sh         # eldobható Synapse felhozása
npm run test:e2e            # Playwright E2E (valós Chromium)
./e2e/scripts/down.sh       # lebontás
```

Első alkalommal: `npx playwright install chromium`.

CI: `.forgejo/workflows/ci.yml` (build + lint + unit minden push-ra; az E2E
job Docker-képes runnert igényel).

## Licenc / állapot

Korai fejlesztési fázisban lévő személyes projekt, MIT licenc alatt (l.
[LICENSE](LICENSE)).

A kódbázis nagy része Claude Code-dal (Anthropic AI-asszisztense) készült,
az én irányításommal és döntéseimmel – architektúra, prioritások, élesben
tesztelt viselkedés mind az enyém, de a tényleges kódsorok nagy hányadát az
AI írta. Ha ez neked számít a hozzájárulásnál vagy a kód megítélésénél,
most tudod.
