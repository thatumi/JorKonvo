# JorKonvo — első kiadás felé

Rövid, tényszerű állapotfelmérés: mi van készen, mi hiányzik egy első
valódi kiadáshoz (desktop + Android), mik a nyitott blockerek. Nem terv -
a `PLAN.md` tartalmazza a funkciók részletes, kör szerinti történetét, a
`.hub/status.json` pedig a legfrissebb, gépileg is olvasható állapotot.

## Állapot dióhéjban

- **Webapp/kliens** (`apps/web` + `packages/matrix-core`): funkcionálisan
  kész, ~20 kör munkája, sok funkció éles Matrix szerver ellen kézzel ÉS
  automatizált Playwright e2e-vel is ellenőrizve.
- **Automatizált tesztek**: `npm test` (Vitest) - 143 teszt, mind zöld.
  `npm run test:e2e` (Playwright, valódi Chromium egy eldobható Synapse
  ellen) - 13 teszt, mind zöld (lokálisan is megerősítve ebben a körben,
  nem csak a CI-ben). Lefedi: bejelentkezés/regisztráció, E2EE üzenetküldés
  (két felhasználó között valódi titkosítással), space/csatorna létrehozás,
  beállítás-perzisztencia, kirúgás/kitiltás/feloldás, szerepkör-
  hozzárendelés → tényleges power level emelkedés, CSP-sértés nulla a
  betöltéskor, kapcsolat-állapot sáv, első-indítás onboarding.
- **CI**: Forgejo Actions, `jorbox-runner`-en regisztrálva, zöld minden
  push-on (build + typecheck + unit tesztek + e2e).
- **Node verzió**: a repo `>=20`-at kér. Ezen a fejlesztői gépen a
  rendszer Node-ja 26.8.1, ami elég új ahhoz, hogy a saját beépített
  `localStorage` globálisa ütközzön a Vitest jsdom-környezetével (3 teszt
  hamis piros lokálisan) - `.nvmrc` (20) hozzáadva ebben a körben, `nvm use
  20`-zal minden zöld. A CI-t ez nem érinti (`node:20-bookworm`-öt használ).
- **Desktop (Tauri)**: `cargo check` tisztán lefut. Bundle targetek
  jelenleg csak `appimage` + `deb` (Linux) - Windows/macOS csomagolás,
  code signing NINCS beállítva.
- **Android (Capacitor)**: a natív projekt (`apps/web/android/`) generálva
  és git-be véve, korábban egy valódi debug APK ténylegesen le lett
  fordítva. **Release-aláírás bekötve** (`app/build.gradle` egy gitignore-olt
  `android/key.properties`-t olvas be, debug-key fallbackkel, ha hiányzik -
  l. `docs/ANDROID.md` "Release signing"): egy eldobható self-signed
  kulcstárral végigpróbálva, `gradlew assembleRelease` valóban aláírt APK-t
  adott (`apksigner`-rel ellenőrizve). **A tényleges upload keystore-t még
  nem generálta le a tulajdonos** - ez emberi lépés, l. lent.
- **iOS (Capacitor)**: a natív projekt (`apps/web/ios/`) scaffoldolva és
  git-be véve (SPM-alapú, Linuxon generálva). `Info.plist` kézzel bővítve
  (usage stringek magyarul + `ITSAppUsesNonExemptEncryption = false`).
  `codemagic.yaml` hozzáadva (unsigned compile check + aláírt IPA →
  TestFlight). **App Store Connect app-rekord, App Store Connect API-kulcs
  a Codemagic-ban, és a natív APNs push bekötése NINCS kész** - a plain
  (push nélküli) build viszont működőképes. Nincs a gépen Mac, így valódi
  Xcode-fordítás még nem történt - azt a Codemagic végzi.
- **Backend/deploy** (`deploy/`, `services/sygnal/`): önálló Docker
  Compose stack (Synapse + Postgres + LiveKit + coturn + Caddy), Terraform-
  mal automatizálható Hetzner-en. Push gateway: Sygnal (APNs + FCM + Web
  Push) a push.szabotar.dev mögött, 2026-09-29 óta élesben (l. services/sygnal).

## Mi kell egy első kiadáshoz

### Desktop (Tauri)
0. **Lokális build, nem Codemagic**: a desktop kiadások lokálisan készülnek (Linux a
   dev boxon, Windows a tulajdonos gépén); a Codemagic csak az Apple platformokra
   (iOS) van használva - a korábbi `desktop-windows` / `desktop-linux` workflow-k
   kikerültek a `codemagic.yaml`-ból.
1. **A `feat/cef` Tauri branch-függőség** (l. Blockerek) - amíg ez nem
   oldódik meg, a desktop build stabilitása a felfelé irányuló repó
   (`tauri-apps/tauri`) akaratától függ.
2. Windows/macOS bundle targetek + code signing (Windows: Authenticode
   cert; macOS: Apple Developer ID + notarization).
3. Verziószám: **inkonzisztens és nem tudatos** - a `package.json`
   (gyökér, `apps/web`, `packages/matrix-core`) és
   `apps/desktop/src-tauri/tauri.conf.json` `0.0.1`-en áll, míg az
   Android (`android/app/build.gradle` `versionName "1.0"`) és iOS
   (`ios/App/App.xcodeproj/project.pbxproj` `MARKETING_VERSION = 1.0`)
   natív projektek a Capacitor/Xcode scaffold alapértelmezett `1.0`
   értékén maradtak - senki nem döntött tudatosan egyik mellett sem.
   Valódi `1.0.0`-ra (vagy tudatos `0.x` pre-release-re) váltás, MINDEN
   targetet egyeztetve, kiadás előtt.

### Android
1. **Upload keystore generálása** (`keytool -genkey ...`) és egy
   `apps/web/android/key.properties` létrehozása a generált fájlra
   mutatva - a `build.gradle` bekötése ehhez már kész (l. fent és
   `docs/ANDROID.md` "Release signing"), csak maga a valódi kulcstár
   hiányzik még.
2. Google Play Console regisztráció ($25 egyszeri díj) + store listing.

### iOS
1. Natív projekt **scaffoldolva** (`apps/web/ios/`, git-be véve),
   `codemagic.yaml` kész. Hátra van: App Store Connect **app-rekord**
   létrehozása (`dev.szabotar.jorkonvo`), App Store Connect **API-kulcs**
   feltöltése a Codemagic-ba (aláírás + TestFlight), és egy tényleges
   fordítás Codemagic Mac-en.
2. Natív **APNs push** bekötése (`@capacitor/push-notifications` +
   Matrix pusher a `services/sygnal` felé) - 2026-09-29: kész a
   `feat/native-push` ágon, Androiddal együtt (háttérmód nem kell hozzá).
3. App **ikon/splash** generálása egy 1024px-es masterből
   (`@capacitor/assets`).

### Backend (self-hosting egy első felhasználónak)
- `deploy/README.md` "Quick start" szekciója már működőképes recept - nem
  release-blocker, korábban kész.
- **MAS (QR-bejelentkezés)**: a kód mindkét irányban készen áll
  (`packages/matrix-core/qrLogin.ts`), de SOHA nem futott valódi
  accountok ellen - egyik itt futó stack sem üzemeltet MAS/OIDC-t.
- **Web push éles bevezetése félig blokkolva**: (1) nincs DNS rekord
  `push.szabotar.dev`-hez, (2) a JorKonvo webapp sehol nincs ténylegesen
  deployolva ezen a gépen, tehát nincs hova a `VITE_VAPID_PUBLIC_KEY`/
  `VITE_PUSH_GATEWAY_URL`-t beépíteni és nincs hol a teljes láncot
  (Beállítások → teszt-értesítés) igazolni.

## Nyitott blockerek

| # | Blocker | Súlyosság | Megjegyzés |
|---|---|---|---|
| 1 | **Android release-aláírás hiányzik** | Blocking Play Store kiadáshoz | Csak debug APK létezik. Upload keystore + Play Console regisztráció emberi/fizetős lépés. |
| 2 | **Desktop code signing hiányzik** | Blocking Windows/macOS disztribúcióhoz | Csak Linux (appimage/deb) van becsomagolva. |
| 3 | **Tauri `feat/cef` git-branch függőség** | Közepes, hosszabb távon kockázatos | Nem hivatalos, verziózott Tauri kiadásra épül. Nincs semver garancia. Érdemes megnézni, kikerült-e már a CEF-támogatás stabil release-be. |
| 4 | **Élő MAS/QR-bejelentkezés teszt hiányzik** | Alacsony (funkció kódban kész) | Kell egy MSC3861/OIDC homeserver a valódi végigteszteléshez - jelenleg egyik stack sem futtat MAS-t. |
| 5 | ~~**Web push éles lánca nem igazolható**~~ | Megoldva 2026-09-29 | Sygnal élesben a push.szabotar.dev mögött (services/sygnal). |
| 6 | **iOS: nincs App Store Connect app-rekord + Codemagic API-kulcs, nincs tényleges Mac-build** | Alacsony (projekt scaffoldolva, `codemagic.yaml` kész) | App-rekord = emberi lépés; API-kulcs = tulajdonos tölti a Codemagic-ba; ezután `ios-v*` tag → aláírt IPA. |
| 7 | ~~**Natív mobil push (iOS APNs + Android FCM) nincs bekötve**~~ | 1. fázis kész 2026-09-29 | `@capacitor/push-notifications` + Sygnal (`feat/native-push`); a titkosított üzenetek natív visszafejtése a 2. fázis. |

## Amit ez a kör NEM csinált (tudatosan)

- Nem nyúlt a `services/` vagy `deploy/` mappához.
- Nem futtatta le a teljes Android/Tauri natív release buildet (a `cargo
  check` gyors, típusszintű ellenőrzés volt, nem teljes release build).
- Nem próbálta meg a MAS/QR-bejelentkezést vagy a web push-t élesbe
  állítani - mindkettő emberi/infrastruktúra döntést igényel (DNS,
  szerver, fiók), l. Blockerek.
