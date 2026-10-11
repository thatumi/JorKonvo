# Matrix Client ("JorKonvo") – Fejlesztési terv

Discord-szerű Matrix kliens. Cél: egy közös React/TypeScript kódbázis, ami
böngészőben, Electronon (Windows/Mac/Linux) és mobilon (iOS/Android, Capacitor
segítségével) is fut.

## Technológiai döntések

| Terület | Választás | Indoklás |
|---|---|---|
| UI framework | React 18 + TypeScript | Nagy ökoszisztéma, jó Electron/Capacitor támogatás |
| Build tool | Vite | Gyors, egyszerű Electron/Capacitor integráció |
| Csomagkezelő | npm workspaces (monorepo) | pnpm nem telepíthető a gépen jogosultsági hiba miatt; npm workspaces natívan elég ehhez |
| Matrix SDK | matrix-js-sdk | Hivatalos JS SDK, támogatja a sync-et, E2EE-t (rust-crypto), stb. |
| State management | Zustand | Egyszerű, kevés boilerplate, jól működik SDK event-driven adatokkal |
| Styling | Tailwind CSS | Gyors iteráció, könnyű Discord-szerű dark theme |
| Desktop | Electron | Windows/Mac/Linux, a web build csomagolása |
| Mobil | Capacitor | Ugyanazt a web kódot csomagolja iOS/Android natív shellbe |
| Monorepo elrendezés | `apps/web`, `apps/desktop`, `packages/matrix-core` | UI és Matrix-logika szétválasztása |

## Mappaszerkezet

```
Matrix/
  PLAN.md
  package.json                 (npm workspaces root)
  packages/
    matrix-core/                # framework-agnostic Matrix logika (SDK wrapper, store-ok típusai)
  apps/
    web/                        # React + Vite alkalmazás (forrás igazság a UI-hoz)
    desktop/                    # Electron shell, a web build-et tölti be
    (később) mobile/            # Capacitor projekt, a web build-et csomagolja
```

## Fázisok

### Fázis 0 – Alapok ✅ KÉSZ
- [x] Terv (ez a fájl)
- [x] Git repo inicializálása, `.gitignore`, első commit
- [x] npm workspaces monorepo váz (pnpm nem települt jogosultsági hiba miatt, npm workspaces-re váltottunk)
- [x] `packages/matrix-core`: matrix-js-sdk wrapper (kliens létrehozás, login, sync, E2EE, szoba/üzenet helperek)
- [x] `apps/web`: Vite + React + TS + Tailwind v4 váz
- [x] `apps/desktop`: Electron shell váz (main + preload, dev/prod betöltés) - **élesben tesztelve Playwright `_electron` API-val, mindkét mód (dev szerver + production `file://` build) hibamentesen betölt**

### Fázis 1 – Bejelentkezés és session ✅ KÉSZ, tesztelve valós szerveren
- [x] Login képernyő (homeserver URL, felhasználónév, jelszó)
- [x] Session perzisztálás (access token localStorage-ban)
- [x] Automatikus újracsatlakozás mentett session-nel
- [x] Logout
- [x] **Élesben tesztelve** `matrix.szabotar.dev` ellen Playwright-tal: login működik, session helyreáll

### Fázis 2 – Discord-szerű UI váz ✅ KÉSZ
- [x] Bal oldali "space/server" sáv (Matrix Space-ek ikonjai) - Home gomb + space avatarok
- [x] Szoba lista oszlop (csatornák/DM-ek, kategóriák)
- [x] Középső chat terület (timeline + üzenetbeviteli mező)
- [x] Jobb oldali tagok lista (jelenlét-jelzéssel)
- [x] Felső fejléc (szoba név, topic, akciók)
- [x] Dark theme, Discord-közeli színpaletta

### Fázis 3 – Üzenetküldés / Timeline ✅ KÉSZ
- [x] Történeti üzenetek betöltése + "Korábbi üzenetek" gomb (scrollback)
- [x] Élő üzenet-sync (timeline events, zustand syncTick alapú re-render)
- [x] Üzenetküldés (szöveg) - **élesben tesztelve, titkosított szobában is működik**
- [x] Nap-elválasztók, üzenet-csoportosítás (ugyanaz a küldő, 5 percen belül)
- [x] Szerkesztés / törlés UI - hover toolbar minden üzeneten (saját üzenetre szerkesztés/törlés, bárkiére reagálás/válasz), **élesben tesztelve**
- [x] Reakciók UI - gyors-reakció gombok + reakció pill-ek toggle-lel, **élesben tesztelve**
- [x] Válasz (reply) UI - idézett preview + spec-kompatibilis fallback body, **élesben tesztelve**
- [x] Szálak (threads) - jobb oldali panel (root + válaszok + saját composer), "N válasz a szálban" pill a fő timeline-ban, szál-üzenetek elrejtve a fő nézetből. **Élesben tesztelve** - lásd az "Állapot" szakaszban a talált/javított aggregációs hibát.
- [x] Gépel... indikátor - **élesben tesztelve** (throttled `m.typing` broadcast + animált "X gépel…" sor)
- [x] Olvasási visszaigazolások (read receipts) - kis avatar-stack az üzenet alatt, **élesben tesztelve**; kijavítva egy hiba, ami helyi echo (még nem szerver-visszaigazolt) eseményre próbált receipt-et küldeni
- [x] Kitűzött üzenetek (pinned messages) - kitűzés/kitűzés-visszavonás gomb az üzenet hover toolbarján (`m.room.pinned_events` state event), header badge gomb a kitűzöttek számával, `PinnedMessagesModal` a listázáshoz/visszavonáshoz. Jogosultság-ellenőrzés (`canPinInRoom`) power level alapján. **Élesben tesztelve**: üzenet kitűzve → badge "1"-re változott → panel helyesen mutatta a küldőt/avatart/szöveget.
- [x] Szlash parancsok - `packages/matrix-core/commands.ts`: `/me`, `/shrug`, `/nick`, `/topic`, `/invite`, `/kick`, `/ban`, `/unban`, `/part`, `/help`. Csak felismert parancsnevekre lép működésbe, minden más "/"-lel kezdődő szöveg normál üzenetként megy el (nem törik el a véletlen "/foo" jellegű üzeneteket). A visszajelzés (hiba/info/`/help` lista) csak helyben jelenik meg a composer felett, nem kerül elküldésre a szobába. **Élesben tesztelve**: `/me teszteli a slash parancsokat` → dőlt "* thatumi teszteli…" sor; `/shrug nem tudom` → "nem tudom ¯\\_(ツ)_/¯"; `/help` → helyi parancslista jelent meg (nem üzenetként); `/foo bar` (ismeretlen parancs) → helyesen sima szövegként lett elküldve.
- [x] Spoiler tag (`||szöveg||`) - a Matrix specifikáció szerinti `<span data-mx-spoiler>` HTML-t generálja (`formatting.ts`), a `MessageBody.tsx` egy elrejtett (háttérszínnel elfedett) `SpoilerSpan`-ként jeleníti meg, kattintásra felfedi. **Élesben tesztelve**: `||szöveg||` elküldve → fekete blur-sáv jelent meg a szöveg helyén → kattintásra a valódi szöveg felfedve, normál stílussal.
- [x] `@room` tömeges említés - a specifikáció szerinti `m.mentions.room: true` payload-ot generálja (megkülönböztetve a `user_ids`-től), a szöveges `@room` egy piros, felhasználó-említéstől vizuálisan elkülönülő pill-ként (`data-mx-pill="room"`) jelenik meg. Az autocomplete listában "room" mindig a lista tetején jelenik meg, ha az írott query illeszkedik rá ("r", "ro", "room" stb.), "Mindenki értesítése a szobában" leírással. **Élesben tesztelve**: `@ro` beírására a "room" opció megjelent az autocomplete tetején → kiválasztva → elküldve → a piros `@room` pill helyesen jelent meg a normál (kék) felhasználó-mention pillektől vizuálisan elkülönítve.
- [x] Markdown-lite formázás + @mention autocomplete - `packages/matrix-core/formatting.ts` (`**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `@Név` → `formatted_body`/`org.matrix.custom.html` + `m.mentions`, csak akkor épül, ha ténylegesen kell). A composerben "@" beírására legördülő tagválasztó jelenik meg (nyíl/Enter/Tab/Escape navigációval), a kapott üzenetek `formatted_body`-ját egy saját, allowlist-alapú HTML→React renderer jeleníti meg (`MessageBody.tsx`, nincs `dangerouslySetInnerHTML`, ismeretlen tag "kicsomagolva" - csak a gyermekei renderelődnek). **Élesben tesztelve KÉT valós, egymástól független, titkosított klienssel**: `@tes` beírására a `teszt` tag megjelent a listában, kiválasztás után `**fontos**`/`` `kod` `` hozzáadva, elküldve → a küldő oldalán ÉS a fogadó (más fiók, más eszköz, külön dekódolás) oldalán is pontosan ugyanúgy jelent meg (kék mention pill, félkövér "fontos", monospace "kod" háttérrel).

### Fázis 4 – Szobák / Spaces kezelése ✅ KÉSZ, tesztelve valós szerveren
- [x] Szoba létrehozása (modal: név, téma, titkosítás), **élesben tesztelve**
- [x] Csatlakozás szobához alias/ID alapján
- [x] Meghívók listázása + elfogadás/elutasítás UI (Home nézetben, "Meghívók" szekció + piros badge a Home ikonon)
- [x] Direct message indítása (userId alapján, meglévő DM újrahasznosításával)
- [x] Space létrehozása, **élesben tesztelve**
- [x] Szoba hozzáadása space-hez (`addRoomToSpace`, `m.space.child` state event)
- [x] Szoba beállítások (név, topic, szoba KÉPE szerkesztése + szoba elhagyása), **élesben tesztelve**.
  - **Élesben talált és javított, széles hatókörű hiba**: szoba-kép feltöltés után a kép nem jelent meg (törött ikon a szobalistában), mert ez a szerver (Synapse, v1.12) az MSC3916 szerinti hitelesített media-t kényszeríti ki - a régi, hitelesítés nélküli `/_matrix/media/v3/...` végpont 404-et ad, csak az új, `Authorization` fejlécet igénylő `/_matrix/client/v1/media/...` működik. Egy sima `<img src="...">` nem tud auth fejlécet küldeni. Javítva **központilag az `Avatar.tsx` komponensben**: az `<img>` `onError` esemény esetén a komponens újrapróbálja a hitelesített URL-t `fetch()`-csel (Bearer token), `blob:` URL-lé alakítva a képet, modul-szintű cache-eléssel (ugyanaz a kép csak egyszer töltődik le, bárhol jelenik is meg). Ez a JAVÍTÁS EGYETLEN FÁJLBAN, hívási helyek módosítása nélkül automatikusan minden avatart érint (felhasználó, szoba, space, tag). **Élesben ellenőrizve**: a frissen feltöltött szoba-kép a `blob:` URL-en keresztül helyesen betöltődött (`naturalWidth: 32`), ÉS egy korábban - ezen hiba miatt - törötten megjelenő space-ikon (Apex69 3) is magától helyesen kezdett megjelenni ugyanettől a javítástól, ami megerősíti, hogy a hiba a teljes alkalmazásban jelen volt, nemcsak az új funkciónál.
- [x] Szerepkör- / jogosultság-szerkesztő - a Szoba beállítások modalban "Tagok jogosultsága" szekció, minden taghoz egy legördülő (Tulajdonos 100 / Admin 50 / Moderátor 25 / Tag 0, + egyéni érték megjelenítve, ha nem illeszkedik egyikre sem), csak akkor látszik, ha a felhasználó jogosult `m.room.power_levels` küldésére. `packages/matrix-core/moderation.ts`: `canSetMemberPowerLevel`/`setMemberPowerLevel`. **Élesben talált és javított hiba**: a kliens-oldali engedély-ellenőrzés eredetileg `ownLevel >= targetLevel`-t engedett, de a szerver (Synapse) szigorúbb szabályt érvényesít - egy MÁSIK, veled EGYENLŐ jogosultsági szintű taget nem lehet módosítani, csak szigorúan alacsonyabbat (`403: "You don't have permission to remove ops level equal to your own"` - éles hibaüzenetből azonosítva). Javítva `ownLevel > targetLevel`-re, ami pontosan illeszkedik a Matrix specifikáció `m.room.power_levels` engedélyezési szabályához. **Élesben újra tesztelve**: két egyenlő (100/100) szintű tag közötti módosítás gombja most helyesen inaktív; egy új szobában (thatumi tulajdonos/100, meghívott `teszt` tag/0) a `teszt` sikeresen "Moderátor"-ra (25) léptethető, a select frissülve mutatja az új szerepkört.
- [x] Moderáció - kirúgás (kick) és kitiltás (ban) gombok a tagok listáján (hover), power level alapú jogosultság-ellenőrzéssel (`canKick`/`canBan` - `hasSufficientPowerLevelFor`), megerősítő dialógussal. `packages/matrix-core/moderation.ts`. **Élesben tesztelve** két valós fiókkal egy 2 fős DM-ben: a `teszt` tag hover-elésekor mindhárom gomb (ellenőrzés/kirúgás/kitiltás) helyesen megjelent, a `thatumi` (saját magam) sornál egyik sem, ahogy elvárt.
- [x] Keresés (szobák / felhasználók) - nyilvános szoba-könyvtár böngészése/keresése a "Csatlakozás szobához" modalban, felhasználó-könyvtár keresés (debounce-olt) a "Privát üzenet indítása" modalban. **Élesben tesztelve** - mindkettő helyesen 200 OK / üres eredményt ad ezen a szerveren (nincs publikált nyilvános szoba, a felhasználó-keresés szerver-oldalon a közös szobával rendelkező userekre korlátozott).
- [x] **Csatorna-kategóriák** (Discord-stílus, space-en belül) - a Matrixnak nincs natív "kategória" fogalma (a nested space-ek túl nehézkesek lennének erre - önálló szobák saját tagsággal), ezért egy könnyű state esemény (`io.jorkonvo.space_categories`) a SPACE szobán: rendezett kategória-lista + szoba→kategória hozzárendelés. Ez szándékosan STATE esemény (nem a hangcsatorna-jelenléthez hasonló sima esemény), mert a kategória-struktúra tér-szintű szervezés, amit csak a teret kezelők módosíthatnak - a `state_default` jogosultság-korlát itt pont a kívánt viselkedés. Összecsukható kategória-fejlécek (állapot `localStorage`-ban perzisztálva), hover-elhető át nevezés/törlés/fel-le mozgatás gombok, kategóriátlan szobák Discord-mintára felül jelennek meg. **Élesben tesztelve**: kategória létrehozva → üresen "Nincs ide sorolt szoba." felirat (nem összemosódva a fölötte lévő kategóriátlan szobákkal - ez egy tesztelés közben talált vizuális egyértelműség-hiba volt, javítva a sorrend cseréjével) → egy szoba hozzárendelve a Szoba beállításokból → azonnal átkerült a kategória alá → összecsukás/kinyitás működik.
- [x] **Szobánkénti becenév/profilkép** (Discord "szerver-profil") - ez natívan a Matrix specifikáció része, nem JorKonvo-kiterjesztés: egy felhasználó saját `m.room.member` eseménye szobánként eltérő `displayname`/`avatar_url`-t hordozhat, és minden meglévő `room.getMember(...).name`/`getAvatarUrl()` hívás ezt már eddig is helyesen figyelembe vette - csak a BEÁLLÍTÁS hiányzott. Hozzáadva a Szoba beállítások modalhoz ("A megjelenésed ebben a szobában" szekció, saját Mentés/Visszaállítás gombokkal). **Élesben tesztelve**: becenév beállítva egy DM-ben → a tag-listán, a jogosultság-szerkesztőn és a timeline-on is azonnal a szoba-specifikus névvel jelent meg, egy MÁSIK szobában viszont változatlanul az eredeti név látszott.
  - **Élesben talált és javított, súlyos, alkalmazás-szintű hiba**: a fenti teszt közben kiderült, hogy a matrix-js-sdk saját `client.getUser(userId).displayName`/`avatarUrl` mezője - a neve ellenére NEM a fiók-szintű, hanem BÁRMELY szobában látott legutóbbi `m.room.member` eseményből frissül, tehát egyetlen szoba-specifikus becenév beállítása után a bal alsó "ki vagyok én" panel ÉS a Felhasználói beállítások "Megjelenített név" mezője is világszerte (minden más szobában is) elkezdte a szoba-specifikus nevet mutatni. Ez egy komoly, megtévesztő hiba lett volna a felhasználók számára. Javítva egy új `profileStore.ts`-szel, ami a hiteles `client.getProfileInfo(userId)` (`/profile` végpont) hívást használja a fiók-szintű személyazonossághoz `client.getUser()` helyett, bejelentkezéskor és saját-profil-mentéskor frissítve. **Élesben újra tesztelve**: a szennyezett állapot azonnal helyreállt "thatumi"-ra mind a panelen, mind a beállítások mezőjében.

### Fázis 5 – Média és gazdag tartalom (részben kész)
- [x] Kép/fájl feltöltés és megjelenítés - **élesben tesztelve**: kép inline renderelve, fájl letöltő chip-ként, mindkettő automatikusan titkosítva (`matrix-encrypt-attachment`) titkosított szobában
- [x] Drag & drop fájl küldés (a composer teljes területén, kiemelt drop-zóna jelzéssel), + tűzőgomb + progress bar feltöltéskor
- [x] Link előnézetek (URL preview) - `getUrlPreview` a szerver `preview_url` API-ján keresztül, cache-elve. **Élesben tesztelve**: a hívás helyesen célozza meg az autentikált `/_matrix/client/v1/media/preview_url` végpontot (matrix-js-sdk automatikusan detektálja a v1.11 támogatást), DE a `matrix.szabotar.dev` szerver ezt a konkrét végpontot még nem implementálja (`404 M_UNRECOGNIZED`), noha a `/versions` v1.11-et hirdet - ez szerver-oldali hiányosság, nem klienshiba. Az app helyesen, hiba nélkül nem jelenít meg semmit ilyenkor (ugyanígy viselkedne bármely olyan szerveren is, ahol a preview_url funkció ki van kapcsolva).
- [x] Emoji picker reakciókhoz - 3 gyors-reakció gomb + teljes választó (~44 emoji, 4 csoport), portálba renderelve a helyes pozicionálás miatt, **élesben tesztelve**. Egyéni szerver-emojik még nincsenek.

### Fázis 6 – Titkosítás (E2EE) ✅ KÉSZ - **előrehozva, mert a teszt szerver szobái alapból titkosítottak**
- [x] rust-crypto engedélyezése a matrix-js-sdk-ban (`initRustCrypto`, `@matrix-org/matrix-sdk-crypto-wasm`) - **élesben tesztelve, sikeres titkosított küldés+dekódolás**
- [x] Kulcsmentés/-visszaállítás (4S / recovery key) UI elkészült (`restoreKeyBackupWithRecoveryKey`, gomb a SpaceRail alján) - **de a felhasználó által megadott recovery key nem egyezett a szerveren lévő key backup-pal** ("key backup on server does not match the decryption key"). Ez azt jelenti, hogy vagy egy régebbi/elavult kulcs volt megadva, vagy a key backup version azóta resetelve lett. Az app helyesen kezelte a hibát (hibaüzenet a UI-n), de a visszaállítás emberi teendő: a felhasználónak ellenőriznie kell / újra elő kell keresnie az aktuális recovery key-t a fiókja biztonsági beállításaiból.
- [x] Eszköz-verifikáció (emoji SAS) - `requestDeviceVerification` alapú (nem `requestVerificationDM`, mert az cross-signing bootstrap nélkül "unknown userId" hibát ad - élesben találtuk meg). **Élesben tesztelve KÉT valós fiókkal**: a bejövő kérés kártya, majd a SAS emoji-összehasonlító képernyő is megjelent, és mindkét oldalon PONTOSAN ugyanaz a 7 emoji jelent meg (🚀⏰🎂💡🌍🌙🐢) - ez igazolja, hogy a kulcscsere mindkét oldalon ugyanazt a megosztott titkot vezette le.
- [x] Titkosított szobák jelzése a UI-n (lakat ikon a szoba neve mellett), **élesben tesztelve**

### Fázis 7 – Hang/Videó hívások ✅ KÉSZ, két valós fiókkal élesben tesztelve
- [x] 1:1 hívás (natív Matrix VoIP, `MatrixCall`, valódi peer-to-peer WebRTC + TURN) - hang, videó és képernyőmegosztás is. `packages/matrix-core/calls.ts` + `callStore.ts` + `CallManager`/`CallOverlay`. Csak pontosan 2 fős szobákban (DM-ekben) érhető el a gombja.
  - **Élesben tesztelve KÉT valós, egymástól független fiókkal** (`thatumi` + a felhasználó által létrehozott `teszt` fiók, két külön böngésző-profilban, fake kamera eszközzel): DM létrehozva → meghívó elfogadva → videóhívás indítva → bejövő hívás banner megjelent a hívott oldalán → hívás elfogadva → **mindkét oldalról készült képernyőkép igazolja, hogy valódi, kétirányú videó folyt a WebRTC kapcsolaton keresztül** → némítás váltás → hívás bontása (a hívott oldaláról) → mindkét oldalon tisztán, hiba nélkül záródott a hívás felület.
  - Élesben javított hiba: a hívás-képernyő vezérlő sávja kicsúszott a látható területről, amikor a távoli videó csempe nagyra nőtt (a flex layout `min-h-0` nélkül nem tudott zsugorodni) - javítva, újra ellenőrizve.
- [x] Csoportos hívás - a szerver LiveKit-alapú SFU-ját használja (`org.matrix.msc4143.rtc_foci` a `.well-known`-ban), a matrix-org/lk-jwt-service protokollal (`getOpenIdToken` → `POST {livekit_service_url}/sfu/get` → LiveKit URL+JWT), majd `livekit-client` SDK-val csatlakozva. **Bármelyik szobában** elérhető (nem csak DM-ben), rács-elrendezésű videó csempékkel, mic/kamera/screenshare/kilépés vezérlőkkel.
  - **Élesben tesztelve KÉT valós fiókkal**: mindkét fiók csatlakozott ugyanahhoz a szoba-híváshoz, a `/sfu/get` végpont elsőre 200 OK-t adott mindkettőnek, és a képernyőképek mindkét oldalról igazolják a valódi, egyidejű, kétirányú videó-folyamot (a fake-kamera csempék eltérő időbélyegei mutatják, hogy tényleg két külön stream). Teljes életciklus tesztelve: egyedül csatlakozás → második fél csatlakozik → első kilép (a másik oldal helyesen 1 résztvevőre csökken, eltávolítja a csempét) → második is kilép (felület tisztán bezárul mindkét oldalon).
  - A matrix-js-sdk saját `GroupCall` osztálya (MSC3401) NEM implementálja a tényleges LiveKit médiakezelést (a forráskód kommentje szerint sem: "the js-sdk doesn't contain any code to do the actual livekit call though") - ezért közvetlenül a `livekit-client` csomagot kellett integrálni.
  - **Ismert korlátozás / follow-up**: nincs MSC4143-kompatibilis `m.rtc.member` state event küldve a szobába, ezért a JorKonvo-n kívüli (pl. valódi Element/Element Call) kliensek nem fognak automatikusan értesülni/csatlakozni tudni ehhez a híváshoz "onnan indítva" - a JorKonvo-JorKonvo hívások viszont teljesen működnek. Ez egy jövőbeli interop-fejlesztés, ha teljes Element Call kompatibilitás a cél.
  - ~~**Ismert, kisebb, ELŐZŐ munkamenetből örökölt kozmetikai hiba**: a csoportos hívás képernyőjén a TÁVOLI résztvevő csempéje néha "?" névvel/avatarral jelenik meg~~ - **javítva, l. a hatodik önálló kör (round 16) bugfix-bejegyzését**: a `??`/`||` operátor-keverés miatt egy üres LiveKit-név csendben "nyerte" a userId-tartalék elől a láncot. Élesben, KÉT valós fiókkal újra-tesztelve, nem jelentkezett többé.
  - **Zajszűrés (RNNoise)** - `apps/web/src/lib/noiseSuppression.ts`, a `@sapphi-red/web-noise-suppressor` csomag (MIT, tiszta böngésző-oldali AudioWorklet + WASM build a xiph/rnnoise-ból) segítségével: a nyers mikrofon-jelet egy `AudioWorkletNode`-on át vezeti (a böngésző natív `noiseSuppression`/`echoCancellation`/`autoGainControl` MediaTrackConstraint-jei is aktívak első lépésként), az eredményt `MediaStreamAudioDestinationNode`-ból nyert új `MediaStreamTrack`-ként `livekit-client` `LocalAudioTrack`-be csomagolva `publishTrack`-eli (a szokásos `setMicrophoneEnabled(true)` helyett, ami maga intézné a nyers eszköz-felvételt). Be-/kikapcsolható a Felhasználói beállításokban (alapból BEKAPCSOLVA), `localStorage`-ban perzisztálva; kikapcsolva a régi, közvetlen `setMicrophoneEnabled` útvonalra esik vissza. Hiba esetén (pl. WASM/AudioWorklet betöltési hiba) automatikusan visszaesik a nyers mikrofonra, nem hiúsítja meg a csatlakozást. **Élesben tesztelve**: hangcsatornához csatlakozás a zajszűrővel bekapcsolva hibamentesen lezajlott (a WASM+worklet pipeline valódi LiveKit SFU ellen inicializálódott és publikálta a sávot), a Némítás/Némítás feloldása gombok helyesen működtek a zajszűrt sávon is, kikapcsolt zajszűréssel az újracsatlakozás is hibamentes volt (visszaesési útvonal ellenőrizve). A tényleges akusztikus zajcsökkentés minősége headless Chromiumban (fake audio device, nincs valódi háttérzaj) nem mérhető automatikusan - ez emberi fül-teszttel ellenőrizhető élő mikrofonnal.
  - **Rögzített beszéd (Push-to-talk)** - `pushToTalkStore.ts` (be/ki + billentyű-kód, `localStorage`), a `GroupCallScreen`-ben `window` `keydown`/`keyup` figyeli a beállított `KeyboardEvent.code`-ot (fizikai billentyű, nem elrendezés-függő), lenyomva `setMicrophoneEnabled(true)`, elengedve `false`. A hívás a csatlakozáskor rögtön némán indul, ha PTT be van kapcsolva (a `groupCallStore.join()`-ban, nem a képernyő `mount` effektjében, hogy ne legyen egy pillanatnyi "nyitott mikrofon" villanás csatlakozáskor). Billentyű-választás: "Módosítás" gomb, ami a következő lenyomott billentyűt rögzíti. **Élesben tesztelve**: hangcsatornához csatlakozás PTT-vel bekapcsolva → néma állapotban indult → Szóköz lenyomva tartása közben aktív mikrofon → elengedéskor újra néma, mindezt a hívás-képernyőn látható jelzésekkel (áthúzott/normál mikrofon ikon) megerősítve.
- [x] **Állandó hangcsatornák** (Discord-stílus) - `packages/matrix-core/voiceChannels.ts` a meglévő ad-hoc csoportos hívás (LiveKit) réteg fölé építve. Egy szoba `io.jorkonvo.channel_type` state eseménnyel ("voice") jelölhető meg csatorna-létrehozáskor (`CreateRoomModal` "Szöveg"/"Hang" választó) vagy utólag (`RoomSettingsModal`, jogosultság-ellenőrzéssel). A `RoomSidebar` a hang-csatornákat külön (hangszóró ikon, nem avatar) rendereli, ÉS alattuk élőben mutatja, ki van éppen csatlakozva - kattintásra kattintás nélkül, azonnal csatlakozik a híváshoz (kamera KI, csak mikrofon, Discord-szerűen), nem kell külön "csatlakozás" gomb.
  - **"Ki van bent" megoldás Matrix-natívan, szerver komponens nélkül**: mivel a LiveKit csak azt tudja megmondani, ki van bent, ha MI IS csatlakoztunk, egy könnyű, NEM state (sima timeline) eseményt (`io.jorkonvo.voice_member_update`) küld minden kliens csatlakozáskor és utána 30 másodpercenként ("heartbeat") - sima esemény, nem state, mert egy egyéni state-esemény alapból `state_default` (jellemzően 50) jogosultságot igényelne, ami kizárná a sima tagokat; a sima esemény csak `events_default`-ot (jellemzően 0) igényel, ugyanazt mint egy üzenet. Az olvasók 90 másodpercnél régebbi bejegyzést elavultnak tekintenek. Tiszta kilépéskor (a hívás-képernyő "Kilépés" gombja) azonnal egy `active:false` esemény megy ki.
  - **Élesben tesztelve KÉT valós fiókkal, egyszerre nyitva mindkét böngésző-profil**: szoba létrehozva Hang típussal → `teszt` meghívva (`/invite` paranccsal) és elfogadta → mindkét fél a sidebar hangcsatorna-sorára kattintva csatlakozott (kamera nélkül, csak hanggal) → **mindkét oldal képernyőképe "2 résztvevő"-t mutatott, valódi kétirányú médiafolyammal** → `thatumi` a hívás-képernyő "Kilépés" gombjával kilépett → a sidebar `teszt` oldalán ÉS `thatumi` saját sidebar-ján is AZONNAL (state-eseményből, nem 90s várakozással) eltűnt a kilépett fél a csatlakozottak listájából. Egy külön, korábbi teszt-menetben véletlenül a böngésző-kontextus durva bezárásával (nem a "Kilépés" gombbal) szimulálva lett az "elakadt/csatlakozva maradt" eset is - ez a tervezett, dokumentált viselkedés szerint max. 90 másodpercig marad látható, utána magától eltűnik (a heartbeat hiánya miatt).
- [x] Eszköz-verifikáció hívás közben, hívás-előzmények lista - l. a hetedik önálló kör (Ötletlista feldolgozása), mindkettő élesben tesztelve.

### Fázis 8 – Értesítések, beállítások, polish (részben kész)
- [x] Böngésző/desktop natív értesítések - `NotificationManager`, saját üzenetet/szerkesztést/már-nyitott-szobát kihagyja, kattintásra fókuszál + a szobára vált. Élesben smoke-tesztelve (nincs JS hiba, `Notification.permission` helyesen kezelve); a tényleges OS-szintű popup nem screenshotolható headless Chromium-ból, ez emberi ellenőrzést igényel.
- [x] Üzenetkeresés a szobában - nagyító ikon a fejlécben nyit egy jobb oldali `SearchPanel`-t (kizárja egymást a szál- és tag-panellel), 400ms debounce, a `client.searchRoomEvents` (`/search` végpont) hívja meg elsőként. Találatra kattintva a Timeline visszalapoz (`client.scrollback`, ugyanaz a mechanizmus mint a "Korábbi üzenetek" gombnál) amíg meg nem találja az eseményt, majd oda görget és pár másodpercre kiemeli. **Élesben talált, fontos, dokumentált korlát**: mivel EZEN a szerveren minden szoba végpontok-közötti titkosított, a szerver-oldali `/search` MINDIG 0 találatot ad (nem hibázik, csak nem lát mást, mint titkosított rejtjelszöveget - alapvető Matrix E2EE tulajdonság, nem klienshiba). Emiatt implementálva lett egy kliens-oldali tartalék (`searchLoadedRoomMessages`): ha a szerver-keresés üres ÉS a szoba titkosított, a már betöltött (dekódolt) események közt keres helyben, és egy tájékoztató sáv jelzi ezt a felhasználónak. **Élesben tesztelve**: "fontos" keresésre a szerver-keresés 0 találatot adott, a helyi tartalék megtalálta a `**fontos**`-t tartalmazó üzenetet a magyarázó sávval együtt, a találatra kattintva a panel bezárult és a megfelelő üzenetnél maradt a nézet.
  - **Globális keresés** - a `SearchPanel`-ben "Ez a szoba" / "Mindenhol" váltó. "Mindenhol" módban `searchAllRoomMessages` (nincs `filter.rooms`, a szerver minden csatlakozott szobában keres, amit indexelni tud) + ugyanolyan E2EE-tudatos helyi tartalék (`searchAllLoadedRoomMessages`, az összes csatlakozott, nem-space szoba betöltött üzenetein). A találatok szoba-badge-et mutatnak (`#szobanév`), kiválasztásra a megfelelő space-re és szobára vált (`getOwningSpace`), majd a Timeline-ban a szokásos módon a célüzenethez görget/kiemel. **Élesben tesztelve**: "role-teszt" szobából "Mindenhol" keresés a "teszt" DM-ben lévő üzenetre talált (helyesen a szoba-specifikus becenévvel "Thatumi a teszt-szobában" jelenítve meg a küldőt), a találatra kattintva helyesen átváltott a "teszt" DM-re és kiemelte az üzenetet.
- [x] **Naplózás (audit log)** - `packages/matrix-core/auditLog.ts`, a szoba már betöltött timeline-jából (ugyanaz a manuális-szkennelés minta, mint a reakcióknál/szálaknál/hangcsatorna-jelenlétnél) emberi-olvasható eseménysorrá alakítja a tagsági (csatlakozás/kirúgás/kitiltás/meghívás/névváltás) és beállítás-változásokat (átnevezés/téma/kép/kitűzés/jogosultsági szint). A Matrix natívan megőrzi ezt az adatot (minden állapotváltozás maga is egy esemény a szobában), csak nem volt hozzá felület. Elérhető a Szoba beállításokból ("Naplózás megtekintése"). **Élesben tesztelve**: egy valódi, sok változáson átment szobában (`role-teszt`) helyesen és pontosan rekonstruálta a teljes előzményt - csatlakozás, meghívás, átnevezés, jogosultsági szint módosítások, téma- és kép-változás, időrendben (legújabb elöl).
- [x] Szoba némítása - harang ikon a ChatArea fejlécében, `client.setRoomMutePushRule`/`getRoomPushRule` alapú (`packages/matrix-core/notifications.ts`), szerver-oldali push rule, tehát eszközök/munkamenetek között is megmarad. **Élesben tesztelve**: némítás → ikon pirosra vált (áthúzott harang) → teljes oldal-újratöltés után is némítva maradt (szerver-oldali állapot) → feloldás → visszaáll a normál harang ikonra.
- [x] Felhasználói beállítások - megjelenített név + profilkép + **egyedi státusz üzenet** módosítása (`UserSettingsModal`, `setStatusMessage` a matrix-js-sdk `presenceStatusMsg`/`setPresence` alapján), **élesben tesztelve két fiókkal**: thatumi beállított egy státuszt, teszt saját (külön) klienséből megnyitva thatumi profil-popoverjét a szöveg helyesen megjelent dőlt betűvel.
- [x] Meghívó link (matrix.to) - "Meghívó link másolása" gomb a Szoba beállításokban (`getRoomInviteLink`: kanonikus alias ha van, egyébként szoba ID + `via` szerver-paraméterek a létrehozó és a saját szerver alapján), vágólapra másolva. A "Csatlakozás szobához" mező mostantól egy beillesztett matrix.to linket is felismer és szétbont (`joinRoomByIdOrAlias` -> `parseMatrixToLink`), nem csak nyers azonosítót. **Élesben tesztelve, teljes kör**: link generálva és a vágólapról kiolvasva (`https://matrix.to/#/!...%3Amatrix.szabotar.dev?via=matrix.szabotar.dev`, helyesen URL-kódolva) → beillesztve a "Csatlakozás szobához" mezőbe → sikeresen feldolgozva és csatlakozva (a szoba azonnal megnyílt). Emellett QR-kód gomb is elérhető ugyanott (`qrcode` npm csomag, `QRCode.toDataURL`), amely ugyanezt a linket kódolja - **élesben tesztelve**, helyesen renderelt (220×220px PNG data URI).
- [x] Üzenet továbbítása (forward) másik szobába - "Továbbítás" gomb az üzenet hover toolbarján, `ForwardMessageModal` szoba-választóval. `forwardMessage()` (`messages.ts`) egyszerűen átmásolja a teljes esemény-tartalmat egy új üzenetbe a cél szobában (a válasz-reláció eltávolítva). **Titkosított médiánál is működik**: a csatolt fájl AES kulcsa/IV-je/hash-ei az üzenet TARTALMÁBAN utaznak (nem a forrás szoba megolm-munkameneteiből származnak), így a teljes tartalom átmásolása a cél szoba saját titkosításával újra-csomagolva helyesen dekódolható marad - a fájl blob-ja ugyanazon az mxc:// URL-en marad a szerveren. **Élesben tesztelve**: egy szöveges (`@room` említést ÉS formázást tartalmazó) üzenet, majd egy titkosított kép is sikeresen továbbítva egy másik szobába/DM-be - mindkettő helyesen (formázással, illetve dekódolva) jelent meg a célban. Járulékos javítás: a szoba-választó (és a Ctrl+K gyorsváltó, ugyanaz a mögöttes hiba) korábban space-eket is felsorolt szobaként - kiszűrve.
- [x] Eszköz-/munkamenet-kezelés - `packages/matrix-core/devices.ts` (`listDevices`/`deleteDeviceOrRequireAuth`/`deleteDeviceWithPassword`), a Felhasználói beállítások alján egy lista minden bejelentkezett eszközről (név, eszköz ID, utoljára aktív, IP), a jelenlegi eszköz zölden megjelölve, a többinél "Kijelentkeztetés" gomb. A legtöbb szerver User-Interactive Auth-ot (jelszó-megerősítést) igényel a törléshez - ezt a kliens 401-es válaszból a `session` mezőt kiolvasva, egy beágyazott jelszó-mezővel kezeli, majd `m.login.password` auth dict-tel újraküldi. **Élesben tesztelve**: a lista helyesen betöltődött és jelenítette meg **a felhasználó valódi, hosszú múltra visszanyúló (akár 320 napos) session-jeit** több valódi Matrix kliensről (Element X, Sable, Cinny, FluffyChat, Commet, Synapse Admin stb.) - ez megerősíti, hogy `thatumi` a felhasználó éles, nem csak teszt-fiókja. **Tudatos döntés**: a tényleges kijelentkeztetés (destruktív, session-t szüntet meg) gombját NEM próbáltam ki egyik valós session ellen sem, mivel ezek közül több élő, a felhasználó által ténylegesen használt kapcsolat lehet - csak a listázás és a UI lett élesben ellenőrizve. Ha a felhasználó szeretné, saját maga tesztelheti egy általa biztonságosnak ítélt (pl. régi teszt-) eszközön.
- [x] Felhasználó letiltása (ignore/block) - `packages/matrix-core/ignoredUsers.ts`, a spec szerinti `m.ignored_user_list` account data-t kezelő `client.setIgnoredUsers`/`isUserIgnored` alapján. Gomb a profil popoverben ("Felhasználó letiltása" / "Letiltás feloldása"), letiltott felhasználó esetén a `Timeline` kiszűri az összes üzenetét (a `MessageComposer` továbbra is működik, csak a MEGJELENÍTÉS szűri). A Felhasználói beállítások alján egy "Letiltott felhasználók" lista mutatja az összes letiltottat, egyenkénti feloldással. **Élesben tesztelve KÉT valós fiókkal**: teszt küldött egy üzenetet → thatumi látta → thatumi letiltotta tesztet → az üzenet AZONNAL eltűnt a timeline-ból (a letiltottak listájában is megjelent) → feloldás → az üzenet visszatért.
- [x] Felhasználói profil popover - kattintás bármely avatarra/névre (üzenet feladója a timeline-ban, vagy a tag-lista sora) megnyit egy kártyát: avatar, név, user ID, jelenlét (élő pötty+szöveg), egyedi státusz üzenet, "Privát üzenet" gomb (DM indítás/megnyitás), "Ellenőrzés (E2EE)" gomb, és jogosultság esetén Kirúgás/Kitiltás (`UserProfilePopover.tsx`, portál-alapú, ugyanaz a pozicionálási minta mint az emoji picker). A `MemberList.tsx` a korábbi hover-gombokat erre a popoverre cserélte (kevesebb duplikáció).
  - **Élesben talált és javított, valódi logikai hiba a moderációban**: a `canKick`/`canBan` korábban a CÉLPONT jogosultsági szintjét adta át a matrix-js-sdk `hasSufficientPowerLevelFor(action, powerLevel)` segédfüggvényének, holott az - a neve ellenére - nem hasonlít össze két felet, hanem a kapott `powerLevel`-t egyszerűen a szoba `action`-höz tartozó küszöbéhez méri (a matrix-js-sdk saját `maySendRedactionForEvent` forráskódjából megerősítve: mindig a CSELEKVŐ saját szintjét adja át). Emiatt a régi kód gyakorlatilag megfordítva ellenőrzött, és sosem hasonlította össze a cselekvő és a célpont szintjét - ez volt az oka, hogy a popover Kirúgás/Kitiltás gombjai tévesen megjelentek két EGYENLŐ jogosultságú fél között is. **Élesben megtalálva** a popover tesztelése közben (egy PL100/PL100 DM-ben), **javítva és újra tesztelve**: most helyesen `ownPowerLevel > targetPowerLevel`-t is megköveteli - egyenlő szintű DM-ben a gombok eltűntek, egy olyan szobában viszont ahol thatumi (100) valóban kiemelt teszt fölött (25), helyesen megjelentek.
- [x] Világos/sötét/rendszer téma-váltó - `themeStore.ts`, a `data-theme` attribútumot állítja a `<html>`-en, az `index.css`-ben a Tailwind v4 `@theme` blokk által regisztrált CSS változókat írja felül `:root[data-theme="light"]` alatt (minden `bg-*`/`text-*`/`border-*` utility ugyanazokra a változókra hivatkozik, tehát automatikusan követi), "Rendszer" módban `matchMedia` figyeli az OS-preferenciát élőben. Perzisztálva `localStorage`-ban. **Élesben tesztelve**: sötét→világos váltás azonnal, konzisztensen átszínezte az egész felületet (space rail, sidebar, chat, modal, mention pill/code chip is jól látható maradt), teljes oldal-újratöltés után is megmaradt a világos téma. Építés közben talált+javított hiba: a CSS kommentben véletlenül szerepelt egy szó szerinti `*/` (a "bg-*/text-*" leírásban), ami idő előtt lezárta a kommentet és Vite CSS-optimalizálási figyelmeztetést okozott - javítva a megfogalmazás átírásával.
- [x] Billentyűparancsok - Escape bezárja a modalokat, Enter/Shift+Enter a composerben, Escape törli a reply/edit állapotot. Ctrl+K (Cmd+K Macen) gyorsváltó (`QuickSwitcher.tsx`) bárhonnan megnyitható: szoba/DM keresés név szerint, nyíl+Enter navigáció, kiválasztáskor a megfelelő space-re is átvált. **Élesben tesztelve**: Ctrl+K → "tesomsz" beírása → szűrt találat → Enter → helyesen átváltott az "Apex69 3" space-re és megnyitotta a szobát; újbóli Ctrl+K + Escape tisztán bezárta.
- [x] Sikertelen üzenetküldés kezelése - piros "Küldés sikertelen" jelzés Újraküldés/Törlés gombokkal a normál toolbar helyett. **Élesben tesztelve** (hálózati hiba szimulálva route-intercepttel, majd sikeres újraküldés ellenőrizve).
- [x] **Szavazások (polls)** - `packages/matrix-core/polls.ts`, a Matrix MSC3381 (`org.matrix.msc3381.poll.start/response/end`) alapján; ez a javaslat hosszú ideje (Element-en keresztül) éles használatban van, ezért itt is elég stabilnak ítélve az építéshez (szemben pl. az egyedi emoji MSC2545-tel, amit emiatt szándékosan tovább kihagytunk). Kérdés + 2-10 válasz, egyszeres vagy többszörös választás (`maxSelections`), és egy "nyilvános/rejtett" (`disclosed`) kapcsoló - utóbbi eldönti, hogy a szavazatok élőben látszanak-e, vagy csak a lezárás után. A szavazatok egy `m.reference` relációval kötődnek a start eseményhez, a kiértékelés (`tallyPoll`) a szoba már betöltött timeline-jának manuális szkennelésével történik (ugyanaz a minta, mint a reakcióknál/szálaknál/naplózásnál/hangcsatorna-jelenlétnél). A `Timeline`/`MessageLine` a szavazás-kezdő eseményt egy `PollMessage` kártyaként rendereli (válasz-gombok, kitöltés-sáv, szavazatszám/százalék), a `CreatePollModal` a "Szavazás létrehozása" gombbal nyitható a composerből.
  - **Élesben tesztelve KÉT valós fiókkal, egyszerre**: thatumi egy 3 válaszos, EGYSZERES választós, REJTETT (`disclosed=false`) szavazást indított a "role-teszt" szobában → a kártya azonnal megjelent teszt oldalán is → teszt szavazott ("Kék") → az eredmény MINDKÉT fél nézetében rejtve maradt ("Az eredmény a lezárásig rejtve" felirat, sem a szavazónál, sem a létrehozónál nem látszott élő tallyval) → thatumi is szavazott ("Zöld") → thatumi lezárta a szavazást (`Lezárás` gomb + megerősítő párbeszéd) → teszt oldalán a lezárás UTÁN AZONNAL, élőben megjelent a helyes végeredmény (2 szavazat, 1-1 Kék/Zöld, 50-50%, "Lezárva" felirat, gombok letiltva). A kétfelől mért, egymást pontosan fedő tally igazolja, hogy a manuális timeline-szkenneléses aggregáció mindkét kliens saját, függetlenül szinkronizált nézetében helyesen összegez. JS hiba egyik oldalon sem volt a teszt közben.
  - **Építés közben, teszt előtt saját magam találtam+javítottam hibát**: a `PollMessage` kezdetben figyelmen kívül hagyta a `disclosed` beállítást, és mindig élőben mutatta a tallyt - javítva `showResults = poll.disclosed || tally.ended`-re, ami a fenti élő teszttel meg is lett erősítve.
- [x] **Hangüzenetek (voice messages)** - `packages/matrix-core/voiceMessages.ts`, a szintén régóta (Element-en keresztül) éles használatban lévő MSC1767 (`org.matrix.msc1767.audio`: időtartam + hullámforma) + MSC3245 (`org.matrix.msc3245.voice_message` jelző, ami egy `m.audio` üzenetet "igazi" hangüzenetként jelöl meg, nem sima hangfájl-csatolásként) kombinációra építve, ugyanazzal a `matrix-encrypt-attachment` E2EE feltöltési mintával, mint a fájlcsatolásoknál (`media.ts`). Felvétel: `VoiceRecorderBar.tsx` a composer mikrofon-gombjára kattintva a szöveges sort egy élő időzítő + élő hangszint-mérő (Web Audio `AnalyserNode`) sávra cseréli, Mégse/Küldés gombokkal. Küldéskor a felvett `Blob`-ból `computeWaveform()` (`AudioContext.decodeAudioData` + csúcs-amplitúdó lemintavételezés ~100 sávra, 0-1024 skálán az MSC1767 szerint) számol egy hullámformát, amit a hangfájllal együtt küld el. Lejátszás: `VoiceMessagePlayer.tsx` a `MediaAttachment`-ben (`m.audio` + a fenti jelző esetén, sima hangfájloknál marad a natív `<audio controls>`) - lejátszás/szünet gomb, kattintható hullámforma-sáv (ugrás adott pontra), lejátszott/hátralévő idő.
  - **Élesben tesztelve KÉT valós fiókkal, egyszerre**: thatumi mikrofon-gombbal felvételt indított (fake audio capture eszközzel, valódi hangjellel, nem csenddel) → élő időzítő+szintmérő látszott → elküldte → a kártya a valós, a hangjelből számolt hullámformával (nem laposan) jelent meg mindkét oldalon élőben → teszt lejátszotta (lejátszás→szünet ikon váltás, hullámforma-sáv élőben követte a lejátszási pozíciót) → thatumi egy második felvételt Mégse gombbal megszakított, a composer hibamentesen visszaállt a normál (szöveg+mikrofon) nézetre. Egyik oldalon sem volt JS hiba.
  - **Élesben talált+javított hiba**: az `AudioContext.close()` mind a Küldés/Mégse kezelőben, mind a felvevő komponens `unmount`-effektjének takarításában lefutott, ami "Cannot close a closed AudioContext" hibát dobott a második híváskor - javítva egy őrzött `closeAudioCtx()` segédfüggvénnyel, ami a referenciát `null`-ra állítja az első bezáráskor, és élesben megerősítve, hogy a hiba eltűnt.
  - **Élesben talált+javított vizuális hiba**: a `VoiceMessagePlayer` hullámforma-sávjai kezdetben `w-full shrink-0`-t kaptak flex konténerben, ami miatt MINDEN sáv a teljes konténer szélességét próbálta felvenni és a kártya jobb szegélyén túl, a képernyő szélééig kicsordult - javítva `flex-1`-re (egyenlő arányban osztozó sávok), élesben újra ellenőrizve, hogy a hullámforma most a kártya határain belül, helyesen renderel.
- [x] **Barátok lista (Discord-stílusú friends)** - `packages/matrix-core/friends.ts`. A Matrixnak nincs natív "barát" fogalma, ezért ez teljesen JorKonvo-saját, kizárólag meglévő Matrix-primitívekre épített mechanizmus, szerver-komponens nélkül: a saját barátlista és a függő kérelmek (`io.jorkonvo.friends` / `io.jorkonvo.friend_requests`) privát account data-ként vannak eltárolva (tehát a saját eszközök közt ingyen szinkronizálnak), a MÁSIK félnek szóló értesítés (kérelem/elfogadás/elutasítás/visszavonás/eltávolítás) pedig sima (nem titkosított, nem érzékeny adat) to-device eseményként megy - ezt a szerver garantáltan kézbesíti a címzett következő szinkronjakor, akkor is, ha épp offline volt (ugyanez a mechanizmus szolgál a kulcsmegosztás/E2EE-ellenőrzés alapjául is). A `ClientEvent.AccountData` már meglévő, globális szinkron-figyelője (`authStore.ts`) automatikusan újrarendereli a UI-t, amint egy to-device esemény hatására a saját account data frissül - nem kellett külön "on change" mechanizmus. UI: új "Barátok" sor a Home oldalsáv tetején (függő bejövő kérelmek száma piros jelvényként), `FriendsPanel.tsx` - barát hozzáadása (megjelenített név/Matrix ID keresés, újrahasznosítva a `StartDmModal` `searchUsers`-ét), bejövő kérelmek (Elfogadás/Elutasítás), elküldött kérelmek (Visszavonás), barátlista élő jelenlét-jelzéssel és "Üzenet"/"Eltávolítás" gombokkal. A felhasználói profil popover is kapott egy "Barátnak jelölés"/"Kérelem elküldve"/"Barát eltávolítása" gombot ugyanerre a mechanizmusra építve.
  - **Élesben tesztelve KÉT valós fiókkal, egyszerre**: thatumi kérelmet küldött tesztnek → a kérelem AZONNAL, élőben megjelent teszt "Barátok" nézetében (piros "1" jelvénnyel az oldalsávon) → teszt elfogadta → thatumi oldalán élőben megjelent teszt az immár 1 fős barátlistában → "Üzenet" gombbal a meglévő teszt DM azonnal megnyílt (nem hozott létre duplikált szobát) → külön menetben thatumi eltávolította tesztet a barátai közül → MINDKÉT oldalon élőben, egyszerre 0-ra ürült a barátlista (a to-device alapú kétirányú szinkron mindkét irányban megerősítve). JS hiba egyik oldalon sem volt egyik teszt közben sem.
- [x] **Szerepkörök (Discord-stílusú, névvel/színnel ellátott, több is adható egy tagnak)** - `packages/matrix-core/roles.ts`. A Matrix saját jogosultsági modellje egyetlen numerikus power level tagonként/szobánként - nincs natív, elnevezett/színezett/újrafelhasználható "szerepkör" fogalom. Alapból szervezési/megjelenítési réteg (lásd lejjebb, később kiegészítve OPCIONÁLIS tényleges jogosultsággal), egyetlen state eseményként a SPACE szobán (`io.jorkonvo.space_roles`, ugyanaz a minta mint a kategóriáknál) - a tömb SORRENDJE maga a hierarchia (0. index = legmagasabb, Discord szerepkör-listájának konvenciója szerint), a tag legmagasabb rangú szerepköre nyeri a névszínezést. UI: `SpaceRolesModal.tsx` (a szerver oldalsáv fejlécében új fogaskerék-szerű ikon, csak space-nél) - szerepkör létrehozás/átnevezés/színválasztás/törlés/átrendezés, kétpaneles szerkesztő, jobb oldalt az összes space-tag checkbox-listával (több szerepkör is bejelölhető egy tagnak). A `Timeline` (üzenetküldő neve), `MemberList` (Discord-stílusú, szerepkör szerint csoportosított taglista, "Tagok" gyűjtő-kategóriával a szerepkör nélkülieknek) és `UserProfilePopover` (névszín + szerepkör-jelvények, jogosultak számára kattintható hozzárendelés/eltávolítás) mind ugyanazt az `getMemberRoleColor`/`getMemberRoles` olvasó API-t használják.
  - **Élesben tesztelve KÉT valós fiókkal, egyszerre**: létrehozva egy friss teszt-space + benne egy szöveges csatorna, teszt meghívva/csatlakoztatva mindkettőhöz → thatumi létrehozott egy piros "Admin" szerepkört → hozzárendelte tesztnek a kétpaneles szerkesztő tag-listájából (checkbox) → a jobb oldali taglista AZONNAL "ADMIN — 1" csoportba rendezte tesztet, piros névszínnel → teszt üzenetet küldött a csatornába → thatumi oldalán élőben, piros névszínnel jelent meg az üzenet (a teljesen friss, E2EE-s szobában az első üzenet dekódolásának kulcscseréje miatt néhány másodperces késéssel, ami várható, nem hiba). JS hiba egyik oldalon sem volt.
  - **Élesben talált+javított hiba**: a szerepkör-hozzárendelés checkbox-ai kezdetben KIZÁRÓLAG a szinkronizált state esemény tartalmából számolt `checked` értéket használták, optimista frissítés nélkül - mivel egy state esemény írása/visszaszinkronizálása egy hálózati kört igényel, a checkbox kattintás UTÁN egy pillanatig "nem reagált" (nem pipálódott be azonnal), amit a Playwright teszt is ténylegesen elkapott ("Clicking the checkbox did not change its state"). Javítva egy roleId-nkénti optimista felülbírálással (`overrides` state), ami azonnal, kattintáskor frissül, és csak hiba esetén áll vissza - ugyanaz a minta, mint amit a felhasználó-letiltás kapcsoló már korábban is használt. Élesben újra tesztelve, a checkbox és a jobb oldali csoportosítás is azonnal reagál.
  - **Utólag hozzáadva, felhasználói kérésre (a szerepkörök korábban TISZTÁN kozmetikaiak voltak - "valaki azt hiheti, egy Admin szerepkör tényleges jogot ad, pedig nem")**: egy szerepkörhöz mostantól OPCIONÁLISAN hozzárendelhető egy power-level cél (`SpaceRole.powerLevel`, a `SpaceRolesModal`-ban egy legördülő a meglévő `POWER_LEVEL_PRESETS`-ből, "Nincs (csak vizuális)" alapértelmezéssel - tisztán kozmetikai szerepkörök ezután is 100%-ban változatlanul viselkednek, semmi nem érinti a jogosultságukat). Amikor egy szerepkörnek VAN power-level célja, a hozzárendelés/eltávolítás (checkbox) a szoba (space) MINDEN csatornájában (a space szobán magán is, hogy a space-szintű állapot - kategóriák/szerepkörök - kezelése is automatikusan feloldódjon) beállítja/visszaállítja a tag jogosultságát (`syncMemberPowerLevelFromRoles`). Több egyidejűleg birtokolt jogosultság-adó szerepkör esetén a LEGMAGASABB szint nyer (ugyanaz az elv, mint a névszínezésnél) - egy alacsonyabb szerepkör eltávolítása a magasabb szinten hagyja a tagot, csak az UTOLSÓ jogosultság-adó szerepkör elvesztése állítja vissza az adott szoba saját `users_default` értékére (jellemzően 0). A szerepkör saját power-level célját UTÓLAG módosítva/törölve minden JELENLEGI birtokosa is azonnal visszaszinkronizálódik, nem csak az ezután történő hozzárendelések. Minden alkalmazás szobánként `canSetMemberPowerLevel`-lel (a meglévő moderation.ts-ből) van őrizve - ha a végrehajtó nem jogosult egy adott csatornában, azt csendben kihagyja, a többi csatornában sikeresen alkalmazza (best-effort, ugyanaz a minta, mint a csomag többi több-szobás műveleténél).
  - **Élesben talált+javított kritikus hiba (a funkció első verziójában, még a végleges commit előtt)**: a visszaszinkronizáló logika a `client.getRoom(spaceId)`-ból FRISSEN visszaolvasott state-re támaszkodott közvetlenül a `sendStateEvent` hívás UTÁN - de a `sendStateEvent` (a matrix-js-sdk forráskódjából megerősítve) egy sima PUT kérés, NINCS helyi visszhangja (local echo): a szoba saját `currentState`-je csak akkor frissül, amikor az esemény egy KÖVETKEZŐ `/sync` válaszon keresztül visszaérkezik. Emiatt a visszaolvasás a RÉGI (még a módosítás előtti) szerepkör-listát látta, és a jogosultság-alkalmazás csendben semmit nem csinált (a cél szint "véletlenül" egyezett a jelenlegivel, a no-op optimalizálás elfedte a hibát elsőre). Élesben, Playwright-tal elkapva: a power-level célt "Moderátor (25)"-re állítva a szoba beállításaiban a birtokos tagja "Tag (0)" maradt. Javítva: minden hívási pont a MÁR ISMERT, frissen számolt szerepkör-lista/hozzárendelés-adatot adja át közvetlenül a szinkronizáló függvénynek, nem olvassa vissza a szobából. **Élesben újra tesztelve, mindhárom irányban**: (1) egy meglévő "Admin" szerepkörre power-level célt állítva a jelenlegi birtokosa (teszt) AZONNAL 25-re állt a csatorna jogosultság-szerkesztőjében, (2) a szerepkör levételekor (checkbox kikapcsolása) 0-ra állt vissza, (3) újbóli hozzárendeléskor ismét 25-re állt, (4) a szerepkör power-level céljának törlésekor ("Nincs (csak vizuális)"-ra visszaállítva) a birtokosa is visszaállt 0-ra - mind a négy lépés a valódi "Role Test Space" teszt-space-ben, valós szerverrel szemben igazolva, végül a teszt-space visszaállítva az eredeti (kozmetikai) állapotába.
- [x] **Kereszthitelesítés (cross-signing) helyreállítása/inicializálása** - `packages/matrix-core/crypto.ts` kiegészítve: `getCrossSigningStatus` (kész-e ezen az eszközön / nyilvános kulcsok ismertek-e / privát kulcsok a secret storage-ban vannak-e / privát kulcsok helyben elérhetők-e), `restoreCrossSigningWithRecoveryKey` (a MEGLÉVŐ kereszthitelesítést oldja fel ezen az eszközön a helyreállítási kulccsal - regisztrálja a matrix-js-sdk `getSecretStorageKey` crypto callback-jét a megadott kulccsal, majd `bootstrapCrossSigning({})`-ot hív, ami a saját dokumentációja szerint biztonságosan no-op, ha már minden készen van - tehát nem destruktív, sosem hoz létre/reseteld kulcsokat), és `createFreshCrossSigningIdentity` (BRAND NEW azonosító+secret storage létrehozása egy jelszó-megerősítéssel [UIA], olyan fióknak, aminek MÉG SEHOL nincs kereszthitelesítése - ez destruktív lenne egy már beállított fiókon, ezért a UI csak akkor ajánlja fel, ha `getCrossSigningStatus` szerint tényleg nincs még semmi). A `RecoveryKeyModal` mostantól egyszerre próbálja helyreállítani a kulcs-mentést ÉS a kereszthitelesítést ugyanazzal a megadott kulccsal (`Promise.allSettled`, egymástól függetlenül, mert egy szerver-oldali kulcs-mentés nélküli teszt-fióknál az egyik hiánya nem szabad hogy megbuktassa a másikat), és él állapot-kijelzőt mutat.
  - **Élesben tesztelve KÉT valós fiókkal**: `teszt` (a felhasználó saját, eldobható teszt-fiókja, aminek eddig sehol nem volt kereszthitelesítése) a "Új titkosítási azonosító létrehozása" gombbal, jelszó megadásával sikeresen létrehozott egy teljesen új kereszthitelesítési azonosítót - az állapot-kijelző utána mind a négy pontban zöldre váltott ("Kereszthitelesítés kész, ez az eszköz megbízik benne"). `thatumi` (a felhasználó valódi, évek óta használt fiókja, amelynek a kereszthitelesítése MÁS, valós kliensen [Element X/Sable/stb.] lett korábban beállítva) a helyreállítási kulccsal próbálkozott - ez **valós, hasznos leletet hozott**: a megadott kulcs a szerveren jelenleg aktív secret storage/kulcs-mentés verzióhoz KÉPEST ELAVULTNAK bizonyult (`getBackupDecryptor: key backup on server does not match the decryption key`), vagyis a fiók kereszthitelesítése/kulcs-mentése időközben, egy másik klienssel újra lett generálva - ez nem a JorKonvo kód hibája, hanem a felhasználó számára fontos, valós információ (a nála lévő papír/jegyzet szerinti kulcs már nem az aktuális).
  - **Élesben talált+javított hiba**: a friss-azonosító-létrehozás első kísérlete egy, a munkamenetben már többször dokumentált, jóindulatú háttér-race hibát ("One time key ... already exists") dobott fel HIBAKÉNT, annak ellenére, hogy a tényleges kereszthitelesítés/secret storage létrehozása valójában sikerült (ugyanezzel a jelszóval megismételve a művelet az állapot-kijelző szerint már készen állt). Ennek oka: a `bootstrapCrossSigning`/`bootstrapSecretStorage` a crypto-motor teljes kimenő-kérés-sorát átfuttatja, ami tartalmazhat egy ezzel össze nem függő, race-es OTK-feltöltést is. Javítva: mindkét bootstrap-hívás köré try/catch került, ami hiba esetén ELLENŐRZI a tényleges állapotot (`getCrossSigningStatus`/`isSecretStorageReady`), és csak akkor dobja tovább a hibát, ha az valóban nem sikerült - a jóindulatú race így többé nem jelenik meg hamis hibaként a felhasználónak.
- [x] **Ellenőrzési kérés időtúllépés-jelzése** - a `VerificationRequest.timeout` (hátralévő ms, élő számláló) mostantól látszik a "Várakozás X félre…" és a bejövő "Ellenőrzési kérés" képernyőn is (`M:SS` formátumban, másodpercenként frissül egy `VerificationOverlay`-ben futó `setInterval`-lal, mivel a `timeout` egy sima getter, nem eseményvezérelt). Ha a kérés ténylegesen lejár, a `Cancelled` fázisban a `cancellationCode === "m.timeout"` alapján külön, pontosabb üzenet jelenik meg ("Az ellenőrzés túllépte az időt X nem válaszolt időben") a sima "megszakítva" szöveg helyett. **Élesben tesztelve**: a számláló ("Lejár: 9:xx") ténylegesen látszott és csökkent mindkét fél képernyőjén az ellenőrzés-teszt közben.
- [x] **QR-kódos eszköz-ellenőrzés (MSC1544)** - a meglévő emoji (SAS) ellenőrzés mellé, ugyanabba a `VerificationRequest`/`Verifier` folyamba építve. A "Ready" fázisban egy módszer-választó képernyő jelenik meg (`VerificationOverlay.tsx`) - emoji mindig felkínálva, "QR kód mutatása" ha `otherPartySupportsMethod("m.qr_code.scan.v1")` (a másik fél tud olvasni), "QR kód beolvasása" ha `otherPartySupportsMethod("m.qr_code.show.v1")` (a másik fél tud mutatni). Mutatás: `request.generateQRCode()` nyers bájtjait a `qrcode` csomag `byte` módú szegmensként kódolja képpé (ez a helyes út - a payload nem szöveg, egy sima string-кódolás félreértelmezné UTF-8-ként). Beolvasás: új `QrScanner.tsx` - kamera (`getUserMedia`) + `jsQR` (új, könnyű, nulla-függőségű csomag) képkockánkénti dekódolása, a nyers bájtokat `request.scanQRCode()`-nak adja át. Egy `ShowReciprocateQr` eseményre (amikor a MÁSIK fél beolvasta A MI kódunkat) egy megerősítő képernyő kéri a felhasználót, hogy hagyja jóvá a beolvasást.
  - **Élesben tesztelve KÉT valós fiókkal**: a módszer-választó helyesen ÉS AZONNAL felkínálta a "QR kód mutatása" opciót annak a félnek, akinek helyi kereszthitelesítése van (`teszt`, a frissen inicializált), és a "QR kód beolvasása" opciót a másiknak (`thatumi`) - `teszt` mutatta a kódot, egy valós, jólformázott QR-kép jelent meg (megerősítve a bájt-módú kódolás helyességét), `thatumi` pedig hibamentesen megnyitotta a kamera-beolvasó felületet (élő videó-előnézet). **Ismert, dokumentált tesztelési korlát** (ugyanaz a kategória, mint a zajszűrés akusztikai minőségénél): a headless Chromium `--use-fake-device-for-media-stream` szintetikus (nem valódi QR-t tartalmazó) videójel miatt a tényleges kamerás beolvasás+dekódolás emberi/valódi kamerás teszttel ellenőrizhető csak.
  - **Élesben talált+javított hiba** (kritikus regresszió a SAS folyamatban, ez a módszer-választó bevezetése miatt jött be): a `VerificationRequest.startVerification(method)` CSAK elküldi az `m.key.verification.start` eseményt és visszaad egy `Verifier`-t - NEM hívja meg saját maga a tényleges cserét vezérlő `Verifier.verify()`-t. Emiatt sem a kezdeményező, sem a fogadó fél oldalán nem indult el ténylegesen a SAS-számítás, mindkét fél örökre a generikus "Ellenőrzés folyamatban…" képernyőn ragadt. Javítva: a `verify()` hívás mostantól központilag, minden újonnan megjelenő `Verifier`-hez hozzárendelve fut le (`wireVerifier`), duplikált-hívás elleni őrzéssel. **Egy MÁSODIK, ehhez kapcsolódó hibát** is a teszt fedett fel: miután a felhasználó rákattintott az "Egyeznek" gombra, a SAS-kártya SOSEM tűnt el (a `sas` állapotot korábban kizárólag a `Verifier` `Cancel` eseménye nullázta, egy sikeres megerősítés esetén semmi) - így a felület a tényleges befejezés UTÁN IS a régi emoji-képernyőt mutatta örökre. Javítva: az Egyeznek/Nem egyeznek/QR-megerősítés gombok mostantól kattintáskor azonnal törlik a saját állapotukat. **Mindkét javítás után élesben, teljes kör: a SAS ellenőrzés mindkét oldalon ténylegesen "✅ ellenőrizve!" állapotig jutott.**
  - **Élesben talált, dokumentált (nem javított, mert kívül esik e feladat körén) mellékes lelet**: a `requestUserVerification` (a kezdeményező oldal eszköz-választása) a másik fél ELSŐ ismert eszközét választja - ha a célfélnek több valódi eszköze van (mint `thatumi`-nak, aki éveken át sok klienssel használta a fiókját), ez könnyen egy inaktív/offline eszközt választhat, amire sosem érkezik válasz. Élesben megfigyelve: `teszt → thatumi` irányban a kérés nem jutott el látható módon `thatumi` JorKonvo-munkamenetéhez (feltehetően egy másik, releváns eszközre lett célozva), míg `thatumi → teszt` irányban (ahol `teszt`-nek csak egyetlen, friss eszköze van) megbízhatóan működött. A tesztek ezért tudatosan ebben az irányban futottak.
- [x] **Szobánkénti értesítési mód (minden üzenet / csak említések / némítás) + értesítési kulcsszavak** - `packages/matrix-core/notifications.ts` teljesen szerver-oldali push rule-okra épül (nem helyi beállítás), tehát minden kliensen/pusher-en érvényesül. "Minden üzenet" = nincs extra szabály; "Némítás" = a klasszikus szoba-szintű `dont_notify` szabály (`setRoomMutePushRule`, ugyanaz, mint a korábbi némítás-funkció); "Csak említések" = egy saját override szabály (`io.jorkonvo.mentions_only_<roomId>`, üres `actions`, a beépített mention-szabályok UTÁN pozicionálva nyers `PUT .../override/<id>?after=.m.rule.is_user_mention` hívással, `addPushRule` tartalék pozicionálás nélkül, ha a szerver elutasítja). Kulcsszavak: `io.jorkonvo.keyword.<szó UTF-8 hex-je>` azonosítójú content-szabályok (`[Notify, {set_tweak: highlight}]`), a `UserSettingsModal`-ban chip-lista hozzáadás/eltávolítás gombokkal. **Fontos, élesben ellenőrzött szerver-viselkedés**: ezen a Synapse-en az `.m.rule.encrypted` underride szabály MINDIG "notify" (highlight nélkül) - a szerver minden titkosított üzenet-ÉRKEZÉST lát és számol, de a tartalmat (és így a tényleges `m.mentions`-t) SOHA nem tudja kiértékelni, mert az a rejtjelszövegben van. Emiatt az "@említés/@room/kulcsszó" alapú kiemelés-jelvények KLIENS-OLDALON kerülnek kiszámításra a dekódolt eseményekből (`unread.ts`, l. lejjebb), a szerver-oldali szabályok pedig a szoba-szintű mód (minden/némítás) érvényesítésére és a más klienseknek/pusher-eknek szóló, plaintext szobákban is helyesen működő jelzésre szolgálnak.
- [x] **Discord-stílusú olvasatlan-jelzők (fehér pötty + piros jelvény + "Új" elválasztó)** - `packages/matrix-core/unread.ts`. Mivel a szerver nem tudja kiértékelni az E2EE üzenetek `m.mentions` tartalmát (fentebb), az olvasatlan/kiemelés-számlálók `localStorage`-ban, kliens-oldalon halmozódnak szobánként (`{total, mentions}`), induláskor a szerver saját (durvább, csak "érkezett valami" szintű) számával feltöltve azokra a szobákra, ahol a helyi szám kisebb (offline érkezett üzenetek fedezésére). A `RoomSidebar` fehér pöttyöt mutat olvasatlan, nem aktív szobáknál, piros számjelvényt ("minden" módban a teljes számot, "csak említések"/alapértelmezett módban csak a kiemeléseket). A `Timeline` egy "Új" felirat + két vízszintes vonal elválasztót renderel az első még-nem-olvasott üzenet elé, ami a szoba megnyitásának PILLANATÁBAN befagy (nem "úszik" újabb üzenetekkel), a szokásos üzenetcsoportosítást megszakítva.
  - **Élesben tesztelve KÉT valós fiókkal, ismételten (5 egymást követő teljes menetben, stabilan)**: teszt sima üzenetet küldött → thatumi oldalán azonnal megjelent a fehér pötty + piros "1" jelvény → teszt @említéses üzenetet is küldött → jelvény "2"-re nőtt → thatumi megnyitotta a DM-et → az "Új" elválasztó a helyes pontnál jelent meg, a jelvény/pötty azonnal törlődött → teljes oldal-újratöltés után is törölve maradt → "Csak említések" módra váltva: sima üzenet csak pöttyöt ad (jelvény/értesítés nélkül), @említéses üzenet jelvényt ÉS asztali értesítést ad → "Némítás" módra váltva: semmilyen jelzés (se pötty, se jelvény, se értesítés) → kulcsszó ("király") hozzáadása után egy azt tartalmazó sima üzenet is helyesen jelvényt+értesítést adott "Csak említések" módban, majd a kulcsszó eltávolítása/mód visszaállítása után a rendes viselkedés helyreállt.
  - **Élesben talált+javított, súlyos, a session korábbi részében rejtve maradt hiba (dupla kliens-boot)**: React StrictMode-ban az `App.tsx` mount-effektje (`restore()`) KÉTSZER fut le fejlesztői módban - ez korábban észrevétlen maradt, mert semmi nem figyelte a mellékhatásait, de a jelen kör kliens-oldali számlálói azonnal lelepleződtek: EGY oldalbetöltés alatt KÉT teljes Matrix kliens indult, mindkettő szinkronizálva ugyanazt a fiókot, mindkettő saját `watchUnread`-del, ami minden beérkező üzenetet duplán számolt (és minden bizonnyal a session korábbi részében megfigyelt, jóindulatúnak vélt "One time key ... already exists" hibák jó része is ebből, a két kliens versengő kulcs-feltöltéséből eredt, nem véletlen race-ből). Javítva: `authStore.ts` `restore()`-ja egy modulszintű `bootInFlight` promise-szal idempotenssé lett téve - második hívás (StrictMode remount) ugyanazt a folyamatban lévő/kész boot-ot adja vissza új kliens indítása helyett.
  - **Élesben talált+javított, alapvető SDK-viselkedésből fakadó hiba (nincs újra-`Timeline` esemény dekódolás után)**: a matrix-js-sdk NEM emittál újra `RoomEvent.Timeline`-t, amikor egy frissen érkezett, ÚJ megolm-munkamenetet igénylő titkosított üzenet a HÁTTÉRBEN fejeződik be dekódolással (csak az esemény saját `Event.decrypted`-jét, amit a kliens újra-emittál saját magára - `event-mapper.js`). Emiatt az `unread.ts` számlálója ÉS a `NotificationManager.tsx` (asztali értesítések) egyaránt csendben soha nem vették figyelembe az ilyen üzeneteket - mindkettő javítva egy `MatrixEventEvent.Decrypted` figyelővel, ami a "élőben látott, de még titkosított" eseményeket egy halmazban tartja, és a dekódolás befejeztével utólag lefuttatja rájuk ugyanazt a logikát. Ugyanez a hiányzó jelzés okozta azt is, hogy a `Timeline`/olvasási nyugta és a `RoomSidebar` sem frissült automatikusan háttér-dekódoláskor - az `authStore.ts` globális `bumpTick`-je is kiegészítve ugyanezzel az eseménnyel (egy animációs képkockánkénti összevonással, l. lejjebb).
  - **Élesben talált+javított React-összeomlás ("Maximum update depth exceeded")**: a fenti dekódolás-figyelő bevezetése után egy nagy, felhalmozott háttér-visszamenőleges dekódolási roham (sok, korábban sosem látott titkosított üzenet egyszerre) minden egyes eseményre szinkron zustand-frissítést váltott ki, ami React saját beágyazott-frissítés elleni védelmét (25 egymást követő szinkron update) átlépte és összeomlást okozott. Javítva: a dekódolás-eredetű frissítés `requestAnimationFrame`-mel képkockánként legfeljebb egyre van összevonva (a többi, ritkább eseményforrás változatlanul azonnali marad).
  - **Élesben talált+javított, finom verseny-hiba (jelvény visszatér oldal-újratöltés után)**: egy friss kliens-indítás a helyi tárolt szinkron-tokentől számolva "utólér" a szerverrel, ami - egy ELŐZŐ munkamenetben már elolvasott, de a helyi IndexedDB-store még nem flush-elt token miatt - újra "élőként" leszállíthat MÁR OLVASOTT üzeneteket, amiket ez az új számláló (ami ebben az oldalbetöltésben még sosem látta őket) tévesen újnak vélne. **Végleges architektúra**: optimista jelvény-emelés (a jelvény AZONNAL nő minden valóban új üzenetre, hogy ne legyen érzékelhető késés a normál esetben) + egy rövid (15 másodperces) egyeztetési ablak, ami minden `ClientEvent.Sync` ciklusnál újra-ellenőrzi `room.hasUserReadEvent`-tel az összes még "próbaidős" emelést, és VISSZAVONJA, ha kiderül, hogy az esemény valójában már olvasott volt. Ez azért szükséges (nem elég egyetlen szinkron-ciklusra várni), mert `thatumi` egy VALÓDI, más aktív klienseket is futtató fiók - a saját olvasási nyugtánk láthatóvá válása egy friss kliens számára a fiók egyéb, egyidejű szinkron-forgalmától függően több ciklust is igénybe vehet, ami rendes Matrix-szintű végső konzisztencia, nem klienshiba. **Élesben, 5 egymást követő teljes menetben stabilan igazolva.**
- [x] **Kódblokkok szintaxis-kiemeléssel** - `packages/matrix-core/formatting.ts` egy saját hármas-visszaperjeles (` ``` `) reguláris kifejezéssel szeleteli a formázandó szöveget kódblokk/sima szakaszokra, minden sima szakasz a meglévő inline formázáson (félkövér/dőlt/mention stb.) megy át függetlenül. Renderelés: `MessageBody.tsx`, `highlight.js/lib/common` (tree-shaken build) + `github-dark.css` MINDKÉT (világos/sötét) témában rögzítve (a kód-blokkok mindig sötét háttéren jelennek meg, a kontraszt konzisztenciájáért). **Élesben tesztelve KÉT fiókkal**: egy JavaScript kódrészletet (függvénydefiníció + template string) tartalmazó üzenet mindkét oldalon `<pre><code>`-ként, valódi `hljs-`-osztályú tokenekkel (kulcsszó/string/stb. külön színnel) jelent meg, a szöveges tartalom pontosan egyezett a beírttal.
- [x] **Automatikus visszalapozás görgetéskor (infinite scroll)** - `Timeline.tsx` `onScroll` figyelője a felső ~120px közelségében automatikusan meghívja a meglévő visszalapozó mechanizmust (`client.scrollback`, ugyanaz, mint a "Korábbi üzenetek" gombnál), és a görgetési pozíciót a betöltés ELŐTTI magasság/pozíció alapján visszaigazítja (`useLayoutEffect`), hogy a felhasználó ne "ugorjon" máshova - csak akkor, ha a visszalapozás ténylegesen új eseményeket hozott (nem az utolsó, üres lapozásnál). A kézi "Korábbi üzenetek" gomb megmaradt tartaléknak. **Élesben tesztelve**: a görgető tetejére érve a látható üzenetcsoportok száma nőtt (régebbi történet betöltve), a görgetési pozíció a betöltés után nem 0-nál, hanem arányosan lejjebb állt meg (nincs vizuális ugrás).
- [x] **Automatikus távollét (auto-away) jelenlét** - `apps/web/src/lib/idlePresence.ts`, konfigurálható tétlenségi idővel (alapértelmezett 5 perc, a Felhasználói beállításokban ki/bekapcsolható), aktivitás-eseményekre (egér, billentyű, görgetés, érintés) figyelve. **Élesben talált+javított, alapvető SDK/protokoll-hiba**: az induló megközelítés a `client.setPresence({presence})` (PUT `/presence/{userId}/status`) hívást használta - ez a Matrix specifikáció szerint EGYSZERI állapot-írás, amit a matrix-js-sdk saját, folyamatosan futó `/sync` hosszú-lekérdezése azonnal, csendben felülír: ha a `set_presence` paramétert a sync-kérés nem adja meg explicit módon, a specifikáció szerinti alapértelmezés "online" - tehát MINDEN rendes szinkron-ciklus (kb. 30 másodpercenként) hallgatólagosan újra "online"-ra állítja a jelenlétet, néhány másodpercen belül semmissé téve a tétlenség-észlelést. Javítva: `client.setSyncPresence(presence)`-re váltva (a matrix-js-sdk saját dokumentációja szerint is ez az ajánlott út, mert emellett a `status_msg`-et sem írja felül más eszközöktől) - ez magának a sync-hurok implicit `set_presence` paraméterének az értékét módosítja, tehát a KÖVETKEZŐ (és minden további) automatikus szinkron-ciklus is a helyes állapotot küldi tovább, nem csak egy pillanatra.
  - **Élesben tesztelve** (a `teszt` fiókkal, mert `thatumi` valódi, más eszközökön is aktív fiók, és a Matrix jelenlét egy FELHASZNÁLÓ-szintű, nem eszköz-szintű összesített állapot - más, ténylegesen futó saját kliensek [Element X, Sable, Cinny stb.] folyamatosan újra "online"-t jelentenének, ami a helyi tétlenség-észleléstől függetlenül, protokoll-szinten elfedné a váltást; ez nem klienshiba, ugyanez a korlát Element-en is fennáll): rövid (4 másodperces) teszt-tétlenségi idővel a jelenlét-pötty a taglistában a másik fél nézetében a zöld "online" színről a sárga "unavailable" (`--color-idle`) színre váltott, majd fenntartott aktivitásra (ismételt kattintás) visszaváltott zöldre. **Tesztelési tanulság**: a `set_presence` a kliens saját `/sync` hosszú-lekérdezésének (alapértelmezett időtúllépés 30 mp) paramétere, tehát a váltás csak a FOLYAMATBAN LÉVŐ lekérdezés lezárulása után, a KÖVETKEZŐ ciklussal jut el a szerverre - egy rövid (pár másodperces) teszt-tétlenségi idő mellett ez azt is jelenti, hogy egyetlen aktivitás-esemény (pl. egy kattintás) csak néhány másodpercre tartja "online"-nak a klienst, mielőtt a helyi tétlenség-figyelő újra "unavailable"-re váltana - ez a viselkedés maga helyes/szándékos, csak a tesztnek kellett folyamatos (nem egyszeri) aktivitást szimulálnia a "visszaváltás" megfigyeléséhez.
- [x] **Ütemezett események ("naptár")** - `packages/matrix-core/calendarEvents.ts`. A Discord "Scheduled Events" funkciójának megfelelője, felhasználó explicit kérésére épült (egy másik Matrix kliensben látott "naptár szoba" ötlete alapján - a beszélgetés során tisztázva, hogy ehhez nincs elterjedt Matrix-spec, ezért ugyanaz a minta lett választva, mint a barátoknál/szerepköröknél: teljesen saját `io.jorkonvo.*` esemény-típus, nem egy külső MSC). Egy esemény egy sima timeline-üzenet (`io.jorkonvo.calendar.event`: cím, leírás, helyszín, kezdés/befejezés időpontja, plusz egy sima szöveges `body` a nem-JorKonvo klienseknek), a részvétel (`io.jorkonvo.calendar.rsvp`: megyek/talán/nem megyek) egy szabványos `m.reference` relációval kötődik hozzá - ugyanaz a manuális timeline-szkenneléses aggregáció, mint a szavazásoknál/reakcióknál/naplózásnál. A lemondás a már meglévő üzenet-törlést (redakció) használja újra, nincs külön mechanizmus. UI: `CalendarEventCard.tsx` (dátum/idő/helyszín/leírás, RSVP gombok, résztvevő-avatar-halom, tulajdonosnak "Törlés"), `CreateCalendarEventModal.tsx` (a composer új naptár-ikonjáról nyitható), `EventsPanel.tsx` - Discord-stílusú "Közelgő események" teljes nézet (a "Barátok" mellé, az oldalsávba felvett új "Események" bejegyzés, jelvénnyel a közelgő események számával), nap szerint csoportosítva, kattintásra a megfelelő space/szoba/üzenetre navigál (ugyanaz a minta, mint a keresési találatoknál). Emellett egy `EventReminders.tsx` (láthatatlan, `NotificationManager` mellé bekötve) egy Discord-stílusú "hamarosan kezdődik" asztali értesítést küld azoknak az eseményeknek kb. 10 perccel a kezdés előtt, amikre a felhasználó "Megyek"-kel válaszolt (csak amíg az app nyitva van, ugyanaz a korlát, mint a sima üzenet-értesítéseknél).
  - **Élesben tesztelve KÉT valós fiókkal, egyszerre, ismételten (2 teljes menetben stabilan)**: thatumi létrehozott egy eseményt (cím, időpont, helyszín, leírás) → a kártya AZONNAL megjelent teszt oldalán is → teszt "Megyek"-kel válaszolt → thatumi oldalán élőben "1 megy" jelent meg → thatumi "Talán"-nal válaszolt → teszt oldalán élőben "1 megy · 1 talán" jelent meg → a "Közelgő események" panel helyesen listázta az eseményt ("Ma" csoport alatt, idővel/helyszínnel/szobanévvel) → a listára kattintva helyesen visszanavigált a szobába és az eseményhez → thatumi (tulajdonosként) törölte az eseményt → a kártya AZONNAL eltűnt MINDKÉT oldalon, és a "Közelgő események" panelből is. Az emlékeztető-értesítés külön tesztelve: egy 3 perccel a jövőben induló, "Megyek"-kel megjelölt eseményre a kliens újraindítása (friss `EventReminders` mount) azonnal kiváltotta a "Hamarosan: ..." asztali értesítést, helyes hátralévő-idő szöveggel. JS hiba egyik fél oldalán sem volt egyik teszt közben sem.
- [x] **Kopogtatásos csatlakozás (knock) + korlátozott (szerver-tagoknak) csatlakozási szabály** - `packages/matrix-core/joinRules.ts`. Ellentétben a szerepkörökkel/barátokkal/eseményekkel, ez NEM egyedi JorKonvo-mechanizmus, hanem natívan támogatott, régóta stabil Matrix-spec primitíva (MSC2403 "knock" és MSC3083 "restricted", mindkettő rég egyesítve) - a modul csak egy vékony, típusos wrapper a matrix-js-sdk már meglévő `knockRoom`/`invite`/`kick` hívásai körül. A `RoomSettingsModal`-ban új "Csatlakozási szabály" választó (Csak meghívással / Nyilvános / Kopogtatásos / Korlátozott a szerver tagjainak / Korlátozott + kopogtatás - utóbbi kettő csak akkor ajánlott fel, ha a szoba egy space csatornája, a `allow` feltétel a szoba saját space-jére mutat). Kopogtatásra váró tagok listája (ugyanott, "Kopogtatásra várók" szakasz) Jóváhagyás (`client.invite`) / Elutasítás (a meglévő `kickMember`/`canKick` újrahasznosításával - a knock→leave átmenet ugyanazt a "kick" jogosultsági szabályt használja a specifikáció szerint, mint egy rendes kirúgás, tehát nem kellett új jogosultság-ellenőrzés). A `JoinRoomModal` mostantól M_FORBIDDEN hibára (tipikusan "ehhez a szobához meghívás/kopogtatás kell") felajánlja a kopogtatást indoklás-mezővel, siker esetén megerősítést mutat. Az oldalsávban új "Kopogtatásaid" szakasz (a "Meghívók" mintájára) listázza a felhasználó saját, még válaszra váró kopogtatásait, visszavonás gombbal (`client.leave`).
  - **Élesben tesztelve KÉT valós fiókkal, egyszerre, teljes kör, ismételten (2 teljes menetben stabilan)**: thatumi létrehozott egy friss szobát, "Kopogtatásos"-ra állította a csatlakozási szabályt → teszt a meghívó linkkel közvetlen csatlakozást próbált → a rendszer helyesen elutasította és felajánlotta a kopogtatást → teszt kopogtatott indoklással ("Szia, szeretnék csatlakozni!") → az oldalsávjában AZONNAL megjelent a "Kopogtatásaid" szakasz → thatumi a szoba beállításaiban látta a kérést A TELJES indoklással → jóváhagyta → teszt AZONNAL megkapta a meghívót, elfogadta, taggá vált. **Elutasítás-kör**: teszt kilépett, újra kopogtatott ("Második próbálkozás") → thatumi látta és elutasította → a kérés AZONNAL eltűnt thatumi listájából. **Visszavonás-kör**: teszt harmadszor is kopogtatott, majd az oldalsáv "Kopogtatás visszavonása" gombjával visszavonta → eltűnt MINDKÉT fél nézetéből. **Korlátozott szabály külön tesztelve**: thatumi létrehozott egy csatornát a "Role Test Space"-ben (aminek teszt már tagja) "Korlátozott (szerver tagjainak)" szabállyal → teszt a meghívó linkkel közvetlenül, KOPOGTATÁS NÉLKÜL, azonnal sikeresen csatlakozott (a taglistában/fejlécben megerősítve), pontosan ahogy a "restricted" szabálynak kellene viselkednie. JS hiba egyik fél oldalán sem volt egyik teszt közben sem.
  - **Vakvágányra futott, majd tisztázott álprobléma a tesztelés közben**: a kopogtatás jóváhagyása utáni meghívó látszólag SOSEM jelent meg a másik fél oldalsávjában újratöltés után - órákig tartó nyomozás (nyers szerver API-hívások, `/sync` válasz közvetlen ellenőrzése, a kliens saját `getRooms()`-ának `window`-ra ideiglenesen kitett debug-vizsgálata) végül kimutatta, hogy a KLIENS ADATMODELLJE MINDVÉGIG helyesen tartalmazta a meghívót (`membership: "invite"`, helyes névvel) - a hiba kizárólag a SAJÁT teszt-szkriptben volt: a "Meghívók" szakasz címe és egy meghívó-sor szoba-neve sima `<span>`/`<div>` szövegként jelenik meg, NEM egy `<button>`-ön belül (csak az Elfogadás/Elutasítás gombok azok) - a teszt-szkript `div.w-60 button` szűrője emiatt szerkezetileg vak volt erre a szövegre. Egy KORREKT (teljes oldalszöveget kereső) ellenőrzéssel azonnal kiderült, hogy a meghívó ténylegesen, helyesen megjelent. Fontos tanulság a jövőbeli teszteléshez: a "Meghívók"/kopogtatás-sorok szöveges tartalmát `getByText`-tel vagy a konténer teljes `innerText`-jével kell keresni, nem `button`-re szűrve.
- [x] **Matrica-küldés (m.sticker), élő/egyszeri helymegosztás (m.location + MSC3672 beacon), privát olvasási visszaigazolás (m.read.private), szoba-címkék (Kedvenc/Alacsony prioritás)** - négy, felhasználó által kért funkció, mindegyik natívan támogatott, régóta stabil (vagy - a beacon esetén - gyakorlatilag stabilan kezelt) Matrix-primitíva, saját mechanizmus kitalálása nélkül:
  - `packages/matrix-core/stickers.ts` - egy kép önálló `m.sticker` eseményként (nem `m.room.message`-ként) küldése, ugyanazzal a titkosított-feltöltési mintával, mint a média-csatolmányoknál. `StickerMessage.tsx`/`SendStickerModal.tsx`, composer-ikon.
  - `packages/matrix-core/location.ts` - vékony wrapper a matrix-js-sdk MÁR KÉSZ, teljes beacon-támogatása körül (`ContentHelpers.makeBeaconInfoContent`/`makeBeaconContent`/`makeLocationContent`, `client.unstable_createLiveBeacon`/`unstable_setLiveBeacon`, `room.currentState.beacons` - a szinkron automatikusan karbantartja). Nincs térkép-csempe/könyvtár-függőség - egy kártya OpenStreetMap linkre mutat. Élő megosztás: `LiveLocationSharer.tsx` (globálisan felszerelt, láthatatlan komponens) a böngésző `navigator.geolocation.watchPosition`-jét figyeli, 15 mp-enként küld frissítést, automatikusan leáll a lejáratkor; `ShareLocationModal.tsx` (composer-ikon) egyszeri/élő (15 perc / 1 óra / 8 óra) választóval; `LiveLocationCard.tsx` élő státuszt olvas ki közvetlenül `room.currentState.beacons`-ból (nem a saját eseménye tartalmából), ezért a "megosztás vége" állapot azonnal, helyesen frissül, amint a tulajdonos leállítja - csak a MEGOSZTÁST INDÍTÓ beacon_info-revízió kap saját kártyát a timeline-ban (a "leállítás" felülírás nem hoz létre második, redundáns kártyát, mivel az egyetlen kártya élőben olvassa ki az aktuális állapotot).
  - `apps/web/src/lib/readReceiptPrivacy.ts` - eszközönkénti (localStorage) beállítás a Felhasználói beállításokban ("Adatvédelem" szakasz), ami a `Timeline.tsx` olvasási-visszaigazolás küldését `ReceiptType.Read` helyett `ReceiptType.ReadPrivate`-ra váltja - a szerver továbbra is számontartja az olvasott állapotot (helyes értesítés-szám), de más tagok nem látják az olvasási-visszaigazolás avatar-sorban.
  - `packages/matrix-core/roomTags.ts` - `m.tag` account data (`m.favourite`/`m.lowpriority`), be/kikapcsolható a Szoba beállításokban (⭐ Kedvenc / Alacsony prioritás jelölőnégyzetek). A `RoomSidebar` a megcímkézett szobákat (DM-eket ÉS csatornákat vegyesen, Element mintájára) kiemeli a szokásos "Üzenetek"/kategorizált "Szobák" listából egy külön "⭐ Kedvenc" szakaszba a lista tetején, illetve egy "Alacsony prioritás" szakaszba a lista aljára.
  - **Élesben tesztelve KÉT valós fiókkal, egyszerre, egyetlen tiszta menetben, mind a négy funkció**: (1) thatumi egy 1×1 pixeles teszt-képet matricaként küldött → AZONNAL megjelent teszt oldalán is `<img>`-ként, üzenetkeret nélkül; (2) thatumi bejelölte a közös DM-et "⭐ Kedvenc"-nek → a sidebar-ja AZONNAL új "⭐ Kedvenc" szakaszt mutatott a szoba szokásos helye helyett → törölve, "Alacsony prioritás"-ra váltva → a szoba a lista aljára került; (3) thatumi bekapcsolta a privát olvasási visszaigazolást → teszt küldött egy üzenetet → thatumi elolvasta (a DM nyitva volt) → teszt oldalán **NEM jelent meg olvasási-avatar** a privát üzenetnél, míg egy KONTROLL-üzenetnél (privát mód kikapcsolva) **helyesen megjelent 1 avatar** - ez igazolja, hogy az avatar-mechanizmus önmagában működik, és a privát mód ténylegesen, szelektíven elrejti a visszaigazolást; (4) thatumi egyszeri helyzetet osztott meg (Budapest koordinátái, Playwright geolokáció-mock) → teszt oldalán AZONNAL megjelent egy térkép-linkes kártya → thatumi 15 perces ÉLŐ megosztást indított → teszt oldalán AZONNAL megjelent egy "🔴 Élő tartózkodási hely" kártya valós koordinátákkal és "Frissítve: X másodperce" számlálóval → thatumi leállította → teszt oldalán a kártya AZONNAL "A megosztás véget ért" állapotra váltott. JS hiba egyik fél oldalán sem volt.
  - **Élesben talált+javított hiba (ugyanaz a hibaosztály, mint korábban a szerepkör-jogosultságoknál és a kopogtatás-jóváhagyásnál)**: a `setRoomTag`/`deleteRoomTag` (a matrix-js-sdk forrásából megerősítve) szintén sima PUT/DELETE hívás helyi visszhang nélkül - a `room.tags` csak egy KÉSŐBBI `/sync`-en át frissül. A Kedvenc/Alacsony prioritás jelölőnégyzetek emiatt eredetileg NEM reagáltak azonnal kattintásra (Playwright ténylegesen elkapta: "Clicking the checkbox did not change its state"). Javítva ugyanazzal az optimista felülbírálás-mintával, mint a szerepkör-hozzárendelés checkbox-ainál (kör 2) és a kopogtatás-jóváhagyásnál. **Emellett egy MÁSIK, kapcsolódó hiányosságot is talált a tesztelés**: a `RoomEvent.Tags` esemény nem volt bekötve a globális szinkron-tick "bump" listájába (`authStore.ts`), tehát még a VALÓDI, szerver-visszaigazolt címke-változás megérkezése esetén sem volt garantált, hogy az oldalsáv újrarendereljen - pótolva, a többi `RoomEvent.*`/`RoomMemberEvent.*` figyelő mellé.
- [x] **Online barátok kiemelése a Barátok oldalon** - a `FriendsPanel` mostantól "Elérhető"/"Egyéb" szakaszra bontja a listát a `User.presence` alapján (`online`/`unavailable` = elérhető). Mivel a Matrix jelenlét csak a KÖZÖS SZOBÁVAL rendelkező felhasználókra frissül élőben a szinkronon keresztül (a `User` objektum enélkül sosem jön létre/frissül), egy `useFriendPresence` hook 30 másodpercenként lekérdezi `client.getPresence(userId)`-vel (nyers `GET /presence/{userId}/status`) azokat a barátokat, akiknek nincs élő `User` objektumuk - ez tartalék, nem elsődleges forrás, a szinkronból érkező élő állapot mindig elsőbbséget élvez.
  - **Élesben tesztelve KÉT valós fiókkal**: a barát-kapcsolat (ami egy korábbi kör végi teszt-takarítás során törlődött) újra fel lett véve, majd `teszt` online állapotban az "Elérhető — 1" szakasz alatt, zöld pöttyel jelent meg thatumi Barátok oldalán.
- [x] **Stage csatornák (csak-hallgatóság hangcsatorna, kéz-feltevéssel)** - a meglévő állandó hangcsatornák (`packages/matrix-core/voiceChannels.ts`) harmadik csatorna-típusaként (`io.jorkonvo.channel_type` state event `type: "stage"`), a `RoomSettingsModal` háromállású választójában. Csatlakozáskor a csatorna moderátorai (a "kick" jogosultsági szinttel rendelkezők, `canModerateStage` - ugyanaz a küszöb, mint minden más moderációs kapunál ebben az appban) felszólalóként lépnek be (mikrofonnal/kamerával), mindenki más néma hallgatóként (semmilyen médiát nem publikálnak, amíg fel nem szólalóvá teszik őket) - a `GroupCallScreen` ilyenkor "Beszélők"/"Közönség" szakaszra bontja a résztvevőket, a hallgatóknak egyetlen "✋ Kéz feltevése" gombot mutat a mikrofon/kamera/screenshare gombok helyett, a moderátoroknak pedig egy "Jelentkezők" panelt a kezet emelt hallgatókkal (egy kattintásos "felszólalóvá tesz" gombbal) és egy "Hallgatóvá tesz" gombot minden aktív beszélő csempéjén.
  - **Kritikus, élesben talált+újratervezett architekturális probléma**: az eredeti terv a LiveKit saját résztvevő-metaadat (`localParticipant.setAttributes`) és adatcsatorna (`publishData`) mechanizmusára épült volna a szerep/kéz-feltevés/promote-demote jelzésekhez - ez élesben AZONNAL, minden csatlakozásnál (még moderátorként is) hibára futott ("does not have permission to update own metadata"), mert a hívás-JWT-t nem a JorKonvo állítja ki, hanem a szerver által hirdetett, harmadik féltől származó `lk-jwt-service` (`groupCalls.ts`), ami nem ad `canUpdateOwnMetadata` jogot - és mivel ez a hívás védtelen volt, a hiba az egész `join()` láncon átbukva a teljes hívás-csatlakozást elvitte (a `GroupCallScreen` SOSEM jelent meg, még sima csatlakozásnál sem). **Megoldás**: a LiveKit attribútum/adatcsatorna mechanizmus teljes elhagyása minden stage-jelzéshez, natív Matrix idővonal-eseményekre váltva (`STAGE_ROLE_EVENT`/`STAGE_HAND_EVENT`/`STAGE_PROMOTE_EVENT`/`STAGE_DEMOTE_EVENT`, ugyanaz a könnyű, nem-state esemény + "legfrissebb küldőnként" kézi idővonal-szkennelés minta, mint a hangcsatorna-jelenlét heartbeat-nél), ami nulla függést jelent a LiveKit JWT jogosultságaitól - a promote/demote saját magát megvalósító fél (a CÉLPONT klientje) reagál a kérésre (néma-/kamera-ki-kapcsolás vagy mikrofon-publikálás + szerep újra-bejelentése), mivel egy Matrix eseményt csak saját magadként küldhetsz, más nevében sosem.
  - **Második, élesben talált+javított hiba**: a `getStageRoles`/`getRaisedHandUserIds` (matrix-core) helyesen kulcsolt Matrix user ID-vel, de a `GroupCallScreen` a LiveKit `RemoteParticipant.identity`-t közvetlenül Matrix user ID-ként kezelte - kiderült, hogy a `lk-jwt-service` az identitást `${matrixUserId}:${deviceId}` formában adja ki (ugyanaz a konvenció, mint az Element Call/MSC3401-nél), tehát a nyers `identity` SOSEM egyezett pontosan egy user ID-vel (ez egy régebbi, néma hiba is volt: a résztvevő-csempék neve korábban is "?" -ként jelent meg emiatt, csak eddig senki nem vette észre, mert semmi más funkció nem függött a pontos egyezéstől). Javítva egy `matrixUserIdFromLivekitIdentity` segédfüggvénnyel (`groupCalls.ts`, az utolsó kettőspontnál vág, nem a `@user:domain` szerkezetre támaszkodva, hogy port-tal rendelkező szerver-domainekkel is helyesen működjön), mindenhol ezt használva a szerep-ellenőrzésekhez ÉS a névfeloldáshoz.
  - **Harmadik, élesben talált+javított hiba (ugyanaz a hibaosztály, mint a háttér-dekódolásnál a Fázis 8-ban)**: a promote/demote kérést figyelő `client.on(RoomEvent.Timeline, ...)` a célfél oldalán nem reagált, ha az esemény E2EE szobában érkezett és a dekódolás a háttérben, a `Timeline` esemény újra-emittálása NÉLKÜL fejeződött be (a matrix-js-sdk ismert, dokumentált viselkedése) - a promote gomb ilyenkor látszólag semmit nem csinált a célfél oldalán. Javítva egy második, `MatrixEventEvent.Decrypted`-re is figyelő kezelővel, ugyanazzal a mintával, mint az olvasatlan-számláló/asztali értesítés hasonló javításánál.
  - **Élesben tesztelve KÉT valós fiókkal, egyszerre, teljes kör**: thatumi (moderátor) stage csatornát hozott létre a közös "Role Test Space"-ben, "Korlátozott (szerver tagjainak)" szabályra állította → teszt csatlakozott a meghívó linkkel → thatumi csatlakozott a híváshoz és FELSZÓLALÓKÉNT lépett be (mikrofon/kamera gombokkal) → teszt csatlakozott és HALLGATÓKÉNT lépett be (mikrofon-gomb NÉLKÜL, csak "Kéz feltevése" gombbal) → thatumi oldalán AZONNAL megjelent a "Közönség — 1" szakasz teszttel → teszt kezet emelt → thatumi oldalán AZONNAL megjelent a "Jelentkezők — 1" panel → thatumi "felszólalóvá tesz"-re kattintott → teszt oldalán a hallgató-gombok AZONNAL felszólaló-gombokra (mikrofon/kamera/screenshare) váltottak → thatumi "Hallgatóvá tesz"-re kattintott → teszt AZONNAL visszaváltott hallgató módba (mikrofon-gomb eltűnt, "Kéz feltevése" visszatért). JS hiba egyik fél oldalán sem volt. **Regressziós ellenőrzés**: egy sima (nem-stage) hangcsatornán a csatlakozás, mikrofon/kamera/screenshare gombok és a kéz-feltevés gomb HIÁNYA is helyesen, változatlanul működött a stage-átírás után.
- [x] **Több-fiókos váltó (Discord/Element-stílusú account switcher)** - eddig egyetlen, `localStorage`-ban tárolt session létezett; mostantól `packages/matrix-core/session-storage.ts` egy TELJES FIÓK-LISTÁT tárol + melyik az aktív, az első beolvasáskor átlátszóan átköltöztetve a régi egyfiókos kulcsot (mint az egyetlen, aktív fiók) - tehát egy már bejelentkezett munkamenet a frissítés után is zökkenőmentesen tovább működik. A `SpaceRail` tetején egy fiók-avatar oszlop jelenik meg (csak 2+ fióknál - egyetlen fióknál nem éri meg a saját helyét/a "melyik fiókban vagyok?" kognitív terhét), a jelenleg aktívnak fehér gyűrűvel, kattintásra vált; egy állandó "Fiók hozzáadása" gomb (az alsó gombcsoportban, `RailButton`-ként, MINDIG látszik, függetlenül a fiókok számától) nyitja az `AddAccountModal`-t egy második (vagy további) fiók bejelentkeztetéséhez. A meglévő "Kijelentkezés" gomb jelentése általánosítva: mostantól a JELENLEG AKTÍV fiókot jelentkezteti ki (szerver-oldali logout-tal, a tárolt listából is eltávolítva) - ha maradt másik fiók, automatikusan arra vált, egyébként a bejelentkező képernyőre kerül, ugyanaz a viselkedés, mint korábban egyetlen fiók esetén.
  - **Kritikus tervezési döntés a titkosítási állapot védelméért**: a matrix-js-sdk rust-crypto motorja egy `cryptoDatabasePrefix`-szel elkülöníthető IndexedDB tárolót használ fiókonként - enélkül KÉT fiók UGYANAZT a titkosítási tárolót osztaná egy böngésző-origin-en belül, ami az egyiket (vagy mindkettőt) tönkretenné. A megoldás tudatosan ASZIMMETRIKUS: a frissítés ELŐTT már bejelentkezett fiók (a régi kulcsból migrált) megtartja a matrix-js-sdk ALAPÉRTELMEZETT (nem megadott) prefixét - tehát a MÁR MEGLÉVŐ, esetlegesen évek óta ellenőrzött titkosítási azonosítója (mint `thatumi` valódi fiókjáé) egyáltalán nem mozdul, egyetlen bájt sem változik a tárolt kulcsanyagában -, míg minden ÚJONNAN hozzáadott fiók egy generált, a user ID-ból származtatott egyedi prefixet kap. Emiatt ez a funkció végig `thatumi` VALÓDI, állandó böngésző-profilján lett tesztelve (nem egy eldobható profilon), hogy a migrációs út ténylegesen a valódi forgatókönyvet fedje le.
  - **Élesben tesztelve `thatumi` valódi, állandó böngésző-profilján (a régi egyfiókos session-ből migrálva)**: az oldal betöltésekor `thatumi` zökkenőmentesen, változatlanul bejelentkezve maradt, a fiók-avatar oszlop (helyesen) MÉG NEM jelent meg (csak 1 fiók) → a "Fiók hozzáadása" gombbal `teszt` bejelentkeztetve → a fiók-avatar oszlop AZONNAL megjelent KÉT avatarral, az alkalmazás AZONNAL `teszt` saját szoba-listájára váltott (a bal alsó felhasználó-panel is `teszt`-et mutatta) → `thatumi` avatarjára kattintva AZONNAL visszaváltott `thatumi` saját szoba-listájára és profiljára → `teszt`-re visszaváltva, majd a "Kijelentkezés" gombbal kijelentkeztetve → az alkalmazás AZONNAL, automatikusan visszaváltott az egyetlen megmaradt fiókra (`thatumi`), a fiók-avatar oszlop pedig (helyesen) újra eltűnt (vissza az 1-fiókos állapotba) - `thatumi` teljes, valódi szoba-listája (space-ek, szobák, DM-ek) sértetlenül, hibátlanul jelent meg a végén, a titkosítás-jelző (lakat ikon) is a megszokott módon látszott. JS hiba egyik lépésnél sem volt. A `teszt` fiók hozzáadása/eltávolítása során keletkezett extra eszköz (device) szándékos és elfogadott mellékhatás, ugyanúgy, mint minden korábbi jelszavas bejelentkezéses tesztnél ezen a szerveren.
  - **Élesben talált+javított tervezési hiba (saját, a commit előtt észrevett)**: a fiók-avatar oszlop kezdeti verziója az "1 fiók esetén nem jelenik meg" szabályt a TELJES komponensre (beleértve a "Fiók hozzáadása" gombot is) alkalmazta - ez circularis zsákutcát jelentett volna: a MÁSODIK fiók hozzáadásához szükséges gomb csak akkor jelent volna meg, ha MÁR van 2 fiók. Javítva: a "Fiók hozzáadása" belépési pont az alsó, állandó gombcsoportba került (a titkosítási helyreállítás/kijelentkezés gombok mellé), függetlenül a fiókok számától, míg maga az avatar-oszlop (ami tényleges VÁLTÁS-t kínál) továbbra is csak 2+ fióknál jelenik meg.
- [x] **@here említés (csak az elérhető/online tagok értesítése)** - a meglévő `@room` mellé, de attól eltérő mechanizmussal: a Matrix specifikációnak nincs natív "@here" fogalma, és az `m.mentions.room` mezőt (ami a `@room`-ot jelöli) tudatosan nem használja, mert az mindenkit értesítene, offline tagokat is - pont az ellenkezőjét annak, amit az `@here` jelent. Helyette a komponáló ÜZENETKÜLDÉSKOR (nem gépeléskor) frissen kiszámolja, mely szobatagok számítanak "épp itt lévőnek" (a `client.getUser(tagId)?.presence` élő állapota alapján, `online`/`unavailable`), és EZEKET az user ID-kat helyezi bele a szabványos `m.mentions.user_ids` mezőbe - ugyanabba, amit egy sima @mention is használna -, míg a megjelenített pill szövege "@here" marad (nem bomlik szét egyenkénti névre). Emiatt a szerver-oldali `.m.rule.is_user_mention` push-szabály (ami már natívan létezik minden Matrix szerveren) automatikusan, változtatás nélkül helyesen csak az akkor-elérhető tagoknak jelez - a kliens-oldali kiemelés-észlelés (`eventHighlightsUser`) is ingyen, változtatás nélkül működik, mert ugyanazt a mezőt nézi, mint egy sima @mention-nél. `formatting.ts` egy zöld (online-szín) pillát renderel `data-mx-pill="here"` attribútummal (a `@room` piros pillájától vizuálisan is megkülönböztetve), `MentionAutocomplete.tsx`/`MessageComposer.tsx` felkínálja "here"-re gépelve, saját leírással ("Csak az elérhető (online) tagok értesítése").
  - **Élesben tesztelve KÉT valós fiókkal**: thatumi begépelte "@here"-t a közös DM-ben → az autocomplete felkínálta a "here" opciót a leírással → kiválasztva és elküldve → az üzenet zöld "@here" pillával jelent meg thatumi oldalán → teszt (aki a teszteléskor online volt) oldalán is AZONNAL megjelent ugyanaz a zöld pilla, az üzenet olvasási visszaigazolása is megérkezett (bizonyítva, hogy a `m.mentions.user_ids` ténylegesen tartalmazta teszt user ID-ját, nem csak kozmetikai a pilla). JS hiba egyik oldalon sem volt.
- [x] **Hosszabb "Névjegy" (About Me) bio + csengőhang testreszabás** - két, egymástól független funkció egy körben:
  - `packages/matrix-core/profile.ts` - a bio a meglévő, egysoros presence `status_msg` HELYETT (ami mindig csak azoknak látszik, akikkel van közös szobád, mivel jelenlét-adat) egy MSC4133 "extended profiles" mezőben (`io.jorkonvo.bio`) tárolódik - ez egy stabil-közeli, a `matrix.szabotar.dev` Synapse-én ténylegesen élesben megerősített (`uk.tcpip.msc4133.stable: true` a `/versions` válaszban) mechanizmus, ami a displayname/avatar_url-hez hasonlóan GLOBÁLISAN, közös szoba nélkül is lekérdezhető bárki számára (`GET /profile/{userId}/{key}`), a matrix-js-sdk már kész `getExtendedProfileProperty`/`setExtendedProfileProperty` hívásaival. `UserSettingsModal`-ban egy 1000 karakteres, több soros textarea ("Névjegy / bio"), `UserProfilePopover`-ben megjelenítve bárki profilkártyáján (nem csak a sajátodén).
  - `apps/web/src/lib/notificationSound.ts` - mivel eddig EGYÁLTALÁN nem volt semmilyen üzenet-hang (csak a böngésző saját desktop-notifikációja, ami esetleg az OS-től kap egy hangot), ez egy teljesen új alrendszer: 3 beépített "csengőhang" + néma opció, mindegyik egy rövid Web Audio API oszcillátor-mintázatként SZINTETIZÁLVA (nem bundle-elt hangfájlból - nincs extra asset/licenc/letöltés), hangerő-csúszkával (0-100%, `localStorage`-ban, eszközönként). `NotificationManager.tsx` mostantól ezt is lejátssza minden, a meglévő szoba-némítás/csak-említés móddal és "a szoba épp nyitva van-e" logikával megegyező feltételek mellett - FÜGGETLENÜL attól, hogy a felhasználó engedélyezte-e az OS-szintű desktop-értesítést (a hang egy külön, mindig elérhető preferencia).
  - **Élesben talált+javított tervezési hiba (saját, a commit előtt észrevett)**: az eredeti `maybeNotify` a TELJES függvényt (beleértve a szoba-némítás/mód-ellenőrzést is) egyetlen korai `if (Notification.permission !== "granted") return;` sorral zárta le - ez azt jelentette volna, hogy a hang is teljesen kikapcsolt marad, ha a felhasználó elutasította (vagy még nem adta meg) az OS desktop-értesítési engedélyt, holott a hang egy különálló, elvileg engedély nélkül is működő preferencia. Javítva: a mód/láthatóság-ellenőrzés és a hang lejátszása előbb, engedélytől függetlenül fut le, a `Notification.permission` ellenőrzés csak a KÉSŐBBI, tényleges desktop popup létrehozása előtt marad.
  - **Élesben, két csatornán tesztelve**: (1) UI-szinten: thatumi beírt egy bio-szöveget a Felhasználói beállításokban, mentés után hibaüzenet nélkül bezárult a modal; (2) protokoll-szinten, a UI popover-kattintás Playwright-flakiness-e miatt közvetlen szerver-ellenőrzéssel: egy nyers `GET /_matrix/client/v3/profile/@thatumi.../io.jorkonvo.bio` HÍVÁS THATUMI SAJÁT TOKENJÉVEL 200-at és a pontos beírt szöveget adta vissza, majd UGYANEZ A HÍVÁS TESZT TOKENJÉVEL (egy MÁSIK fiók) is 200-at és ugyanazt a szöveget adta - ez bizonyítja, hogy a mező ténylegesen globálisan, fiókok között olvasható, nem csak a tulajdonosnak. A teszt-bio ezután törölve lett (`DELETE` ugyanarra a kulcsra), hogy ne maradjon látható teszt-tartalom thatumi valós, más klienseken (Element X, Sable stb.) is látható profilján. A csengőhang-előnézet gomb (Web Audio API) hibamentesen lefutott mindhárom beépített hangnál, JS hiba nem volt.
- [x] **Üzenet-jelentés (report), nyilvános szoba-könyvtár publikálás, lassított mód (slowmode)** - három, egymástól független funkció egy körben:
  - `packages/matrix-core/moderation.ts` - `reportMessage` a spec `POST /rooms/{roomId}/report/{eventId}` végpontját hívja (a matrix-js-sdk `client.reportEvent`-jén keresztül) - ez a HOMESERVER adminjaihoz megy, nem a szoba moderátoraihoz, és nincs visszaolvasási oldala (a kliens sosem látja, mi lett a jelentéssel). `MessageLine.tsx` Toolbar-jában egy "Jelentés" gomb minden MÁS felhasználó üzenetén (nem a sajátodon), indoklás-bekéréssel, sikeres jelentés után rövid "Jelentve" visszajelzéssel a gombon.
  - `packages/matrix-core/room-admin.ts` - `setRoomAlias` (a spec `createAlias` + `m.room.canonical_alias` state event kombinációja - egy `#localpart:szerver` emberi-olvasható cím létrehozása/beállítása) és `isRoomListedInDirectory`/`setRoomListedInDirectory` (a spec `directory/list/room/{roomId}` végpontja, a matrix-js-sdk `Visibility` enumjával) - ez TUDATOSAN elkülönül a csatlakozási szabálytól (egy szoba lehet nyilvánosan csatlakoztatható anélkül, hogy a könyvtárban listázva lenne, vagy fordítva), `RoomSettingsModal`-ban egy közös "Nyilvános szoba-könyvtár" szakaszban.
  - `packages/matrix-core/slowmode.ts` - Discord-stílusú csatornánkénti küldési ráta-korlát, de a felhasználó saját, előre tisztázott elvárásának megfelelően TUDATOSAN csak "figyelmeztetés" szinten: mivel valódi, megkerülhetetlen kényszerítéshez szerver/appservice komponens kellene (amit ez az app nem tud biztosítani), a beállított időköz egy sima `io.jorkonvo.slowmode` szoba-állapotban van (bármely kliens láthatja/tiszteletben tarthatja), de a TÉNYLEGES visszatartás+visszaszámlálás a `MessageComposer.tsx`-ben, a küldő EGYETLEN saját eszközének helyi óráján/`localStorage`-án alapul (`apps/web/src/lib/slowmodeTracking.ts`) - egy másik vagy módosított kliens figyelmen kívül hagyhatná. A moderátorok (akik beállíthatják a lassított módot) automatikusan mentesülnek alóla, Discord mintájára. `RoomSettingsModal`-ban Discord-stílusú előre definiált időköz-választó (Ki/5mp/10mp/30mp/1p/5p/15p/1ó), `MessageComposer.tsx`-ben élő visszaszámlálós figyelmeztető sáv + letiltott küldés gomb, amíg fut a hátralévő idő.
  - **Élesben talált+javított, a funkciótól független UI-hiba (a `RoomSettingsModal` fokozatos növekedése okozta, ezúttal a saját teszteléskor bukkant elő)**: a megosztott `Modal.tsx` komponensnek sosem volt saját belső görgetése/magasság-korlátja - egy elég hosszú modal (mint a `RoomSettingsModal`, ami mostanra csatorna-típus/kategória/szerepkörök/csatlakozási szabály/kopogtatások/profil/meghívó/napló/kilépés ÉS most még lassított mód/könyvtár-publikálás szakaszokat is tartalmaz) egyszerűen túlnyúlt a viewport-on, ELÉRHETETLEN gombokkal/mezőkkel a fix pozíciós háttér-átfedés mögött, MINDEN görgetési lehetőség nélkül. Ez nem csak a teszt-szkriptet zavarta meg (Playwright "element is outside of the viewport" hibával) - egy valódi felhasználó kisebb böngésző-ablakban SOSEM tudta volna elérni a modal alsó szakaszait. Javítva: a `Modal` mostantól `max-h-[85vh] flex flex-col`, rögzített (nem görgető) fejléccel és egy `overflow-y-auto` görgethető tartalom-résszel - ez MINDEN modalt érint, nem csak a szoba-beállításokat.
  - **Élesben talált, dokumentált (nem javítható kliens-oldalról) szerver-szabály**: a könyvtár-publikálás checkbox bepipálása `matrix.szabotar.dev`-en `403 Not allowed to publish room` hibát ad - ez a Synapse szerver saját, admin által beállított `room_list_publication_rules` szabálya (nem az app hibája, a hívás maga helyesen, a spec szerint megy ki). Az alias-beállítás (`setRoomAlias`) ÖNMAGÁBAN, a listázástól függetlenül sikeresen működött és élesben megerősítve látszott is a beállításokban.
  - **Élesben tesztelve KÉT valós fiókkal, teljes kör**: thatumi létrehozott egy csatornát a "Role Test Space"-ben, 10 másodperces lassított módra állította, nyilvánosra állította a csatlakozási szabályt, majd (a fent dokumentált szerver-korlát mellett) alias-t állított be rá → moderátorként két üzenetet küldött EGYMÁS UTÁN AZONNAL, mindkettő átment (mentesség igazolva) → teszt csatlakozott meghívó linkkel → teszt küldött egy üzenetet → AZONNAL megjelent a "Lassított mód: még X másodpercet kell várnod" visszaszámláló sáv → teszt megpróbált egy MÁSODIK üzenetet küldeni azonnal → az a küldés ténylegesen NEM ment át (a szöveg a komponáló mezőben maradt, nem jelent meg a idővonalon) → thatumi küldött egy új üzenetet → teszt (hover + "Jelentés" gomb) sikeresen jelentette, a gomb "Jelentve" visszajelzésre váltott. JS hiba egyik fél oldalán sem volt egyik lépésnél sem.
- [x] **AutoMod (kulcsszó-szűrés)** - `packages/matrix-core/automod.ts`, ugyanolyan őszinte hatókör-korlátozással, mint a lassított módnál: a beállítás (`io.jorkonvo.automod` szoba-állapot: be/ki + kulcsszó-lista) bármely kliens számára látható, de a TÉNYLEGES automatikus törlés csak akkor történik meg, ha épp fut olyan tag klientje, aki jogosult mások üzeneteit törölni ebben a szobában ("legjobb erőfeszítés", nem megkerülhetetlen kényszerítés - ehhez szerver/appservice komponens kellene, amit ez az app nem tud biztosítani). `watchAutoMod` ugyanazt a mintát követi, mint az olvasatlan-számláló/AutoMod-előtti funkciók: `RoomEvent.Timeline` + `MatrixEventEvent.Decrypted` (a háttér-dekódolás miatt), duplikátum-védelemmel. A kulcsszó-egyezés szándékosan sima kis-nagybetű-független RÉSZSZÖVEG-keresés (nem a szó-határos mintaillesztés, amit az értesítési kulcsszavaknál használunk) - egy spam/trágárság-szűrőnek egy szó KÖZEPÉN/toldalékolva is el kell kapnia a tiltott kifejezést. `RoomSettingsModal`-ban be/ki kapcsoló + kulcsszó chip-lista (ugyanaz a minta, mint az értesítési kulcsszavaknál), a szoba-állapot `sendStateEvent`-alapú "nincs helyi visszhang" hibaosztálya miatt (l. fentebb, ismételten) optimista felülbírálással.
  - **Élesben tesztelve KÉT valós fiókkal**: thatumi bekapcsolta az AutoMod-ot egy tiltott kulcsszóval a közös teszt-csatornán → teszt küldött egy üzenetet, ami tartalmazta a tiltott kulcsszót (egy hosszabb szó KÖZEPÉN, nem önálló szóként, igazolva a részszöveg-keresést) → az üzenet rövid ideig látszott, majd AUTOMATIKUSAN ELTŰNT thatumi oldalán → majd (a törlés szinkronizálódása után) teszt saját oldalán is eltűnt. JS hiba egyik fél oldalán sem volt. Tesztelés után az AutoMod ki lett kapcsolva a megosztott teszt-csatornán, hogy ne maradjon aktívan törölgető szűrő a további tesztek útjában.
- [x] **Widgetek (m.widget, MSC1236/2764)** - tetszőleges webalkalmazás beágyazása egy szobába (Etherpad, tábla, egyedi belső eszköz - pontosan az a fajta "naptár szoba webapp", ami a session korábbi részében egy másik kliensben megfigyelt, azóta tisztázatlan funkció mögött állhatott). `packages/matrix-core/widgets.ts` - a widget egy sima `m.widget` szoba-állapot esemény (state_key = widget id, üres content = "eltávolítva", mivel state eseményt nem lehet törölni, csak felülírni) -, tehát a hozzáadás/eltávolítás/listázás TELJESEN valós, spec-kompatibilis Matrix állapot, amit bármely más Matrix kliens (Element is) ugyanúgy lát és meg tud nyitni. Az URL-ben a spec `$matrix_user_id`/`$matrix_room_id`/`$matrix_display_name`/`$matrix_avatar_url`/`$matrix_widget_id`/`$theme` sablon-változói helyettesítődnek be (`buildWidgetUrl`). **Tudatosan NEM implementált rész**: a teljes widget postMessage képesség-egyeztető API (MSC2762 - a widget kérhetne jogot szoba-események olvasására/küldésére, képernyőmegosztásra stb., mindegyik külön engedély-kérdéssel) - ehelyett a sokkal gyakoribb "egyszerű beágyazás" eset van lefedve (a widget egy önálló webapp, csak meg kell jelenítve legyen a sablon-változókkal), ami a felhasználó eredeti leírásának ("naptár szoba" mint beágyazott webapp) pontosan megfelel.
  - `WidgetsPanel.tsx` - Element mintájára TELJES SZÉLESSÉGŰ nézet (nem egy szűk oldalsáv-csík, mert egy widget általában valódi képernyő-helyet igényel), ami a timeline/composer HELYÉT veszi át amíg nyitva van, fül-sávval több widget esetén, "+"/kuka gombokkal hozzáadáshoz/eltávolításhoz (utóbbi a widget-kezelési jogosultsághoz kötve). Az iframe `sandbox` attribútuma tudatosan tartalmazza az `allow-scripts allow-same-origin` kombinációt (ami NEM MEGBÍZHATÓ tartalomnál ismert kockázat, mert a beágyazott oldal script-ből fel tudná oldani a saját sandbox-át) - ez Element saját widget-hosztjának is szándékos, szükséges kompromisszuma: a biztonságot itt nem a sandbox attribútum adja, hanem hogy widgetet csak a megfelelő szoba-állapot jogosultsággal rendelkező tag adhat hozzá, egy sima üzenet sosem.
  - **Élesben tesztelve KÉT valós fiókkal**: thatumi megnyitotta a Widgetek nézetet (üres állapot: "Ehhez a szobához még nincs widget hozzáadva.") → hozzáadott egy widgetet egy `$matrix_user_id` sablon-változót tartalmazó URL-lel → a widget-fül AZONNAL megjelent, az iframe TÉNYLEGESEN betöltötte a valós külső tartalmat (ellenőrizve az iframe belsejében megjelenő szöveggel) → az iframe `src` attribútuma igazolta, hogy a `$matrix_user_id` ténylegesen `@thatumi:matrix.szabotar.dev`-re lett helyettesítve → teszt (a MÁSIK fiók) megnyitotta ugyanazt a szobát, és UGYANAZT a widget-fület látta (valós, szinkronizált Matrix állapot, nem csak thatumi kliensének helyi állapota) → thatumi eltávolította a widgetet, ami után mindkét oldalon (végül) visszaállt az üres állapot. JS hiba egyik fél oldalán sem volt.
- [x] **Fórum-csatornák (szálanként külön poszt, címkékkel)** - negyedik csatorna-típusként (`io.jorkonvo.channel_type` `"forum"`), TELJES EGÉSZÉBEN a már meglévő szál-infrastruktúrára (`threads.ts`) épül: egy "poszt" nem egy külön mechanizmus, hanem egyszerűen egy szál-gyökér üzenet, amit egy extra `io.jorkonvo.forum_title`/`io.jorkonvo.forum_tag_ids` mező különböztet meg a sima top-level üzenetektől (ugyanaz a minta, mint ahogy `m.mentions` is a `body` mellett ül a tartalomban) - egy poszt VÁLASZAI simán szál-válaszok, a MEGLÉVŐ, változtatás nélküli `ThreadPanel`/`getThreadReplies` jeleníti meg/kezeli őket. **Tudatos korlát**: egy "sima" (nem a poszt-létrehozó folyamaton át küldött) top-level üzenet NEM jelenik meg posztként a listában - egy másik kliens (pl. Element, aminek nincs fogalma erről a csatorna-típusról) által küldött üzenet nem lesz automatikusan "poszttá", ez dokumentált, tudatos egyszerűsítés, nem hiba. `packages/matrix-core/forum.ts` - `getForumPosts` (cím, címkék, szerző, válasz-szám, utolsó aktivitás ideje szerinti rendezés, Discord mintájára "válasz felbukkantja a posztot"), `io.jorkonvo.forum_tags` szoba-állapot a szoba saját, szabadon szerkeszthető címke-készletéhez (név+szín), `sendStateEvent`-alapú "nincs helyi visszhang" miatt (ismételten) optimista felülbírálással a `RoomSettingsModal` címke-szerkesztőjében.
  - `ForumPanel.tsx` - a timeline/composer HELYÉT veszi át fórum-csatornákban (a `WidgetsPanel`-hez hasonlóan, de alapértelmezetten, nem kapcsolható ki-be), posztok listája cím/szerző/relatív időbélyeg ("X perce", `date-fns` magyar locale-lal)/válasz-szám/címke-pillák szerint, kattintásra a MEGLÉVŐ `ThreadPanel`-t nyitja meg jobb oldali panelként (`openThread(eventId)` - ugyanaz a mechanizmus, amit a sima szálaknál is használ az app). `CreateForumPostModal.tsx` - cím + törzsszöveg + többszörös címke-választó.
  - **Élesben tesztelve KÉT valós fiókkal, teljes kör**: thatumi létrehozott egy fórum-csatornát a "Role Test Space"-ben, hozzáadott egy "Kérdés" címkét → teszt csatlakozott (FONTOS: a szál-gyökér üzenet E2EE-titkosítási kulcsához csak a csatlakozás UTÁN küldött posztok esetén fér hozzá teszt klientje - ugyanaz a korlát, mint a session korábbi részében az AutoMod/Stage teszteknél megfigyelt "nem tudom visszafejteni a csatlakozás előtti üzenetet" jelenség, ezért a teszt-sorrend tudatosan "teszt előbb csatlakozik, thatumi utána posztol") → thatumi létrehozott egy posztot a címkével → a poszt AZONNAL megjelent a listában a címkével → teszt oldalán is AZONNAL megjelent ugyanaz a poszt+címke (valós, szinkronizált szoba-állapot) → teszt rákattintott, megnyílt a szál-panel, válaszolt → thatumi oldalán a poszt-lista bejegyzése AZONNAL "1 válasz"-ra frissült. JS hiba egyik fél oldalán sem volt.
- [x] **Profil banner testreszabás** - ugyanaz az MSC4133 extended-profile mechanizmus, mint a bio-nál (`io.jorkonvo.banner_url`, egy feltöltött kép `mxc://` URL-je) - `UserSettingsModal`-ban Discord-stílusú elrendezés (teljes szélességű banner a modal tetején, negatív margóval kitörve a modal saját paddingjéből, a profilkép ráúszva egy gyűrű-kerettel), `UserProfilePopover`-ben a korábbi sima márka-színű csík helyén megjelenítve bárki profilkártyáján.
  - **Élesben tesztelve KÉT valós fiókkal**: thatumi feltöltött egy teszt-banner képet, mentés után hibaüzenet nélkül bezárult a modal; mivel a popover-kattintásos UI-ellenőrzés ugyanabba a Playwright-flakiness-be futott, mint korábban a bio-nál, protokoll-szinten ellenőriztem: `GET /_matrix/client/v3/profile/@thatumi.../io.jorkonvo.banner_url` THATUMI SAJÁT TOKENJÉVEL 200-at és egy valós `mxc://` URL-t adott vissza, UGYANEZ A HÍVÁS TESZT TOKENJÉVEL (másik fiók) is 200-at és ugyanazt az URL-t adta - a mező ténylegesen globálisan olvasható. A teszt-banner ezután törölve lett, hogy ne maradjon látható teszt-tartalom thatumi valós profilján.
- [ ] **QR-kódos bejelentkezés (MSC4108)** - **MEGÍRVA, DE SOSEM ÉLESBEN TESZTELVE** (tudatos kivétel az összes többi funkcióra érvényes "élesben, két valós fiókkal tesztelve" szabály alól - l. lentebb, miért). `packages/matrix-core/qrLogin.ts` a matrix-js-sdk MÁR KÉSZ rendezvous-implementációjára épül (`signInByGeneratingQR`, a matrix-js-sdk saját, teljes MSC4108 protokoll-megvalósítása, nem saját gyártmány), kiegészítve a hiányzó "meglévő eszköz beolvassa egy új eszköz kódját" szereppel (az SDK csak a "ez az eszköz generál és mutat kódot" két szerepéhez ad kész segédfüggvényt - a beolvasó oldalt a `MSC4108RendezvousSession`/`MSC4108SecureChannel`/`MSC4108SignInWithQR` alacsonyabb szintű építőelemekből kellett összerakni, pontosan úgy, ahogy a kész segédfüggvények is teszik belül, csak egy BEOLVASOTT `QrCodeData`-ból indulva), plusz OAuth2 dinamikus kliens-regisztráció/cache-elés és session-építő logika. **Csak az egy irány van megvalósítva**, amit a felhasználó kifejezetten kért (Discord-stílus): az ÚJ, be nem jelentkezett eszköz MUTATJA a QR kódot (`LoginScreen` "QR kóddal" fül), egy MÁR bejelentkezett eszköz OLVASSA BE a kamerájával (`SpaceRail` "QR kóddal bejelentkeztetés" gomb → `ScanQrLoginModal`, a meglévő `QrScanner.tsx` kamera-komponenst újrahasznosítva). A fordított irány (meglévő eszköz mutat, új beolvas - Element szokásos módja) NINCS bekötve, bár az SDK támogatása arra is megvan.
  - **Miért nincs élesben tesztelve**: a MSC4108 előfeltétele, hogy a szerver OAuth2/OIDC-alapú hitelesítést fusson (MSC2965/3861, pl. Matrix Authentication Service-en keresztül) a hagyományos jelszavas login helyett/mellett - élesben ellenőrizve, hogy a `matrix.szabotar.dev` (sima Synapse) ezt NEM hirdeti (nincs `auth_issuer`, nincs `org.matrix.msc2965.authentication` a well-known-ban), tehát a teljes folyamat ezen a szerveren jelenleg használhatatlan. Ez a felhasználóval egyeztetett, tudatos döntés eredménye (l. a beszélgetést): a funkció MEGÍRÁSÁT kérte annak ellenére, hogy a szerver-oldali MAS-migráció (ami a tesztelést lehetővé tenné) egy külön, a felhasználó saját éles szerverét érintő infrastruktúra-döntés, amit nem én hozok meg.
  - **Amit A HELYETT ténylegesen ellenőriztem**: mivel a boldog út nem tesztelhető, élesben ellenőriztem, hogy a felhasználók TÖBBSÉGE által ténylegesen megtapasztalt út - egy OIDC-t nem támogató szerver - ne omlasszon össze semmit. Egy friss, eldobható böngésző-profillal: a bejelentkező képernyő "QR kóddal" fülre váltása NEM okozott JS hibát, a folyamat tisztán, egyértelmű magyar hibaüzenettel ("A QR kód nem generálódott le.") és Újrapróbálkozás gombbal hiúsult meg, majd a "Jelszóval" fülre visszaváltva a jelszavas bejelentkezés továbbra is hibátlanul működött (nincs beragadt hibás állapot).
  - **Nem megvalósított rész**: az OAuth2 access token automatikus frissítése (a `StoredSession` mostantól tárol egy `refreshToken`-t, de semmi nem használja még) - egy ilyen módon bejelentkezett munkamenet a token lejártakor újra-bejelentkezést igényelne. Ez külön, nagyobb munka, mint maga a QR-bejelentkezés.
- [x] **A matrix-js-sdk API-felület további auditja után talált és pótolt hiányosságok** (a felhasználó kifejezett kérésére: "van meg olyan funkció amit nem, vagy nem teljesen implementálunk?" → "ezeket mind megcsinálhatod") - mindegyik ellenőrizve az `matrix-js-sdk` tényleges forráskódja (nem csak a `.d.ts`) ellen, és élesben tesztelve:
  - **`m.fully_read` jelölő (`setRoomReadMarkers`)** - eddig csak `sendReadReceipt`-et küldtünk (amit MÁSOK látnak); a `fully_read` egy HARMADIK, tisztán saját account data-s jelölő, ami arra való, hogy a fiók MÁSIK klientjei (a valódi `thatumi` fiók esetén: Element X, Sable stb.) tudják, meddig olvastál EBBEN a kliensben - enélkül teljesen vakok voltak erre. A `Timeline.tsx` olvasás-jelző effektje mostantól `setRoomReadMarkers`-t hív (ugyanabban a kérésben elküldi a fully_read jelölőt ÉS a köz/privát olvasási visszaigazolást is, a meglévő adatvédelmi beállítás szerint).
    - **Élesben talált+javított saját hiba**: az első verzió egy VALÓDI, bár szűk esetben hibás volt - egy SAJÁT, épp elküldött üzenetre a `MatrixEvent.isSending()` a szerver-oldali esemény-ID megkapása UTÁN is `true` marad egy darabig (amíg a helyi "echo" vissza nem gördül egy `/sync`-en át és az esemény `status`-a nullázódik) - mivel az effektus a függőségi tömbjében csak az esemény-ID VÁLTOZÁSÁT figyelte, ez az ÁLLAPOT-váltás (ID változás nélkül) sosem indította újra, tehát egy olyan szobában, ahol a felhasználó küldi az UTOLSÓ üzenetet és utána senki más nem ír semmit, a `fully_read` örökre egy üzenettel lemaradva ragadt volna. Élesben, két külön tesztmenetben elkapva (`client.getRooms()`-hoz ideiglenesen kitett debug-hivatkozással, ami a javítás után visszavonva lett) és javítva: az esemény `status`-a is bekerült a függőségi tömbbe. **A FŐ, ténylegesen releváns eset** (MÁS FÉL üzenetének elolvasása - ahol az esemény sosem "küldés alatt", a `/sync`-en át érkezik készen) élesben, két valós fiókkal elsőre helyesen működött: teszt küldött egy üzenetet egy megosztott szobában, thatumi megnyitotta a szobát, egy nyers `GET .../account_data/m.fully_read` hívás 200-at és a valós esemény-ID-t adta vissza.
  - **Tér-hierarchia böngészése (`getRoomHierarchy`, MSC2946)** - a `RoomSidebar` eddig csak a MÁR csatlakozott szobák `m.space.child` állapotát böngészte, tehát egy space-ben lévő, de még nem csatlakozott csatornát sosem látott - pontosan az a korlát, amit ez a session TÖBBSZÖR is megtapasztalt élesben (space-tagság nem ad automatikus hozzáférést az utólag létrehozott csatornákhoz). `packages/matrix-core/rooms.ts` `getSpaceHierarchy` a spec saját `/hierarchy` végpontját lapozza végig, a `via` szervereket a szülő space `m.space.child` relációiból építve fel egy csatlakozáshoz. Új "Szoba böngészése" gomb a space-fejlécben (`SpaceHierarchyModal.tsx`) - a JOINED csatornáknak "Megnyitás", a többinek "Csatlakozás" gombot mutat. **Élesben tesztelve**: a "Role Test Space" böngészése 31 csatornát listázott (a sidebar ennél JÓVAL kevesebbet mutat, mert oda csak a csatlakozottak kerülnek be) - ez önmagában igazolja, hogy a funkció ténylegesen olyan tartalmat lát, amit a régi mechanizmus sosem tudott volna.
  - **Saját fiók email/telefon kezelése (`addThreePidOnly`/`deleteThreePid`)** - MÁS, mint a korábban tudatosan kihagyott, mások meghívása email-lel (identity server-t igénylő) funkció: ez a SAJÁT fiók jelszó-visszaállításhoz/azonosításhoz szükséges címét adja hozzá, ami a hozzáadás lépéséhez NEM igényel harmadik féltől identity servert. `packages/matrix-core/threepid.ts` a spec kétlépéses folyamatát követi (ellenőrző email küldése → a linkre kattintás UTÁN a hozzáadás véglegesítése), a User-Interactive Auth (jelszó-visszaigazolás) esetleges igényét kézzel implementált retry-jal kezelve (ugyanaz a minta, mint a `crypto.ts` friss kereszthitelesítés-létrehozásnál). `ThreePidSection.tsx` a Felhasználói beállításokban.
    - **Miért csak részlegesen tesztelt**: a boldog út (valódi email kiküldése + a linkre kattintás) tesztelése VALÓDI e-mailt küldene egy VALÓDI címre, amit ez a session nem tud elolvasni/a linkre kattintani (nincs hozzáférése semmilyen postafiókhoz) - ez egy kifelé irányuló, a felhasználó saját teszt-fiókjain kívülre mutató művelet lenne, ami nem fér bele a meglévő engedélybe. Amit VALÓBAN, élesben teszteltem: egy szintaktikailag érvénytelen címmel ("not-a-real-email") a kérés a szervertől tisztán, egyértelmű hibaüzenettel utasítódik el, JS hiba nélkül - tehát a hibakezelési út működik, csak a boldog utat nem lehetett önállóan végigvinni.
  - **Szoba jelentése (`reportRoom`)** - a korábban megépített üzenet-jelentés (`reportMessage`) mellé, egy egész SZOBA jelentése a szerver adminjainak (spec `POST /rooms/{roomId}/report`). Gomb a Szoba beállításokban, "Szoba elhagyása" fölött. **Élesben tesztelve**: egy teszt-szobát jelentve a kérés hibaüzenet nélkül lefutott.
  - **Moderációs kitiltási listák (`m.policy.rule.user`/`room`/`server`, MSC2313)** - a Mjolnir/Draupnir moderációs botok is pontosan ezt a mechanizmust használják megosztott kitiltási listákhoz: BÁRMELY sima szoba szolgálhat "listaként", ha `m.policy.rule.*` állapot-eseményeket tartalmaz (entitás=glob minta, pl. `@spammer:*`, + indoklás + ajánlás, jellemzően `m.ban`). `packages/matrix-core/policyLists.ts` - CRUD (`getPolicyRules`/`addPolicyRule`/`removePolicyRule`, mindhárom fajtára), glob-egyezés (`matchesPolicyEntity`, `*`/`?` SQL-LIKE stílus, NEM teljes regex). **A spec maga NEM definiál "feliratkozás" mechanizmust** (a Mjolnir ezt a saját bot-konfigjában tartja, nem Matrix állapotban) - ez az app saját találmánya, ugyanolyan könnyű `io.jorkonvo.policy_subscriptions` szoba-állapotként, mint az AutoMod/fórum-címkék. **Kényszerítés** (`watchPolicyLists`) ugyanúgy őszintén korlátozott, mint az AutoMod-nál: csak akkor tiltja ki automatikusan a feliratkozott lista `m.ban`-szabályával egyező tagot, ha épp fut egy kitiltásra jogosult kliens - két külön indítékra reagál: (1) egy tag frissen CSATLAKOZIK egy védett szobához, (2) egy feliratkozott lista-szobában ÚJ/megváltozott szabály jelenik meg (`RoomStateEvent.Events`), ami a lista MINDEN feliratkozójának JELENLEGI tagjait újra-átvizsgálja - ez utóbbi a Mjolnir valós, visszamenőleges kitiltási viselkedését tükrözi (nem csak "az újonnan csatlakozókat blokkolja"). Csak a felhasználó-fajtájú szabályok kerülnek automatikusan kényszerítésre (a szoba/szerver-fajtájúak nem térképezhetők egyetlen kliens-oldali műveletre úgy, ahogy a felhasználó-kitiltás igen) - ezek láthatók/kezelhetők, csak nem automatikusan végrehajtva. UI: `RoomSettingsModal`-ban két új szakasz - "Kitiltási lista (MSC2313)" (a JELENLEGI szoba mint lista - szabály hozzáadása/eltávolítása fajta+entitás+indoklás szerint) és "Feliratkozás kitiltási listákra" (külső lista-szoba azonosító/alias megadása, jelenlegi feliratkozások listája eltávolítással).
    - **Élesben tesztelve KÉT valós fiókkal, mindkét kényszerítési út**: (1) *csatlakozáskor*: thatumi létrehozott egy lista-szobát egy `teszt`-et tiltó `m.ban` szabállyal, egy védett szobát ami feliratkozott a listára, majd teszt csatlakozott a védett szobához → thatumi FUTÓ klientjének `watchPolicyLists`-e ÉSZLELTE a csatlakozást, egyeztette a szabállyal, és AUTOMATIKUSAN KITILTOTTA teszt-et - egy nyers `GET .../state/m.room.member/@teszt...` hívás `"membership":"ban"`-t és a helyesen összeállított indoklást (`"Kitiltási lista: teszt policy list teszt"`) adta vissza. (2) *visszamenőleges*: egy MÁSIK menetben teszt előbb csatlakozott egy védett, feliratkozott, de MÉG SZABÁLY NÉLKÜLI listához (megerősítve: `membership` maradt `"join"`), majd a szabály UTÓLAG került hozzáadásra a lista-szobához → thatumi klientje a lista-szoba állapot-változására újra-átvizsgálta a feliratkozott szobák tagjait, és RETROAKTÍVAN kitiltotta teszt-et. JS hiba egyik menetben, egyik fél oldalán sem volt. A beállítások-UI (szabály hozzáadása/megjelenítése, feliratkozás-szakasz) élesben, a felületen keresztül is kipróbálva - a `sendStateEvent` "nincs helyi visszhang" mintája miatt (ismételten) optimista felülbírálással.
  - **Szerkesztési előzmények megtekintése (`client.relations` + `RelationType.Replace`)** - a "(szerkesztve)" jelölés eddig egy néma szöveg volt; mostantól gomb, ami a `packages/matrix-core/editHistory.ts` `getEditHistory`-jét hívja (a szerver `/relations` végpontján lekéri az ÖSSZES szerkesztés-eseményt egy üzenethez - ez szükséges, mert egy régi szerkesztés célpontja kívül eshet a jelenleg betöltött idővonal-ablakon, ellentétben a reakciók/szálak app saját, helyi idővonal-szkenneléses mintájával), időrendben (eredeti először) egy `EditHistoryModal.tsx`-ben megjelenítve. Az EREDETI verzióhoz `MatrixEvent.getOriginalContent()`-et kell hívni `getContent()` HELYETT, mert egy szerkesztett eseményen a `getContent()` átlátszóan a LEGÚJABB szerkesztés szövegét adja vissza (`makeReplaced()`), nem az eredetit.
    - **Élesben talált+javított, KÉT különálló, egymást átfedő, korábbról öröklődő valódi hiba** (a funkció saját élesztesztje futtatása közben derültek ki, a szerkesztési-előzmény kóddal önmagával nincs kapcsolatuk): (1) `Timeline.tsx` `isDisplayableMessage()`-éből HIÁNYZOTT a `m.replace` relációjú (szerkesztés-)események kiszűrése - ez a szűrés már megvolt az `unread.ts`-ben és a `NotificationManager.tsx`-ben, de nem a fő idővonal-renderelésben, ezért MINDEN szerkesztett üzenet KÉTSZER jelent meg az idővonalon: egyszer a helyesen behelyettesített eredeti sorként, egyszer pedig a NYERS szerkesztés-eseményként a spec saját `"* új szöveg"` tartalék-szövegével. (2) Ennek kiderítése közben egy MÁSODIK, azzal összefüggő hiba is előkerült: a `MessageLine.tsx` "(szerkesztve)" jelölésének megjelenítési feltétele (`isEdited`) `content["m.relates_to"]?.rel_type === RelationType.Replace`-t nézte `ev.getContent()`-en - ez a `m.relates_to` mező viszont SOSEM létezik a behelyettesített (eredeti esemény) tartalmán (csak a nyers szerkesztés-esemény SAJÁT, közvetlen tartalmán), tehát a jelölés valójában MINDIG a hibás, duplikált második soron jelent meg, sosem a helyes elsőn - miután az (1) hibát kijavítottam és a duplikált sor eltűnt, a jelölés is eltűnt volna vele együtt, ha nem derül ki azonnal újratesztelve. Javítva `ev.replacingEvent() != null`-ra (a matrix-js-sdk saját, kifejezetten erre szolgáló API-ja). Mindkét javítás után élesben, Playwright-tal újrafuttatva: egy üzenetet kétszer szerkesztve az idővonalon EGYETLEN sor látszik a legfrissebb szöveggel + kattintható "(szerkesztve)" jelöléssel, a megnyíló modal mind a három verziót (eredeti + 2 szerkesztés) helyesen, időrendben mutatja.
  - **Ezzel a köz-audit listája lezárva - a maradék három azonosított rés tudatosan kihagyva** (nem elfelejtve, hanem eldöntve): (1) **mobil push-értesítések** (`setPusher`/`getPushers`, `m.pusher`) - valódi FCM/APNs infrastruktúra (Google/Apple fejlesztői fiók, saját push-gateway szerver) nélkül ez a kliens-kód önmagában semmit nem tudna kézzelfoghatóan bizonyítani vagy élesben tesztelni - ugyanabba a kategóriába esik, mint a Capacitor natív buildek: emberi infrastruktúra-döntést/regisztrációt igényel, nem hiányzó munka. (2) **Vendég-hozzáférés** (`m.room.guest_access`, jelszó nélküli, ideiglenes fiókok) - szándékosan NEM illeszkedik az app "a te saját, állandó fiókod" modelljéhez (multi-account switcher, saját profil/banner/bio testreszabás stb.) - egy Discord-stílusú kliensnek nincs is Discord-analógiája a Matrix vendég-fogalmára. (3) **Szoba-frissítés** (`upgradeRoom`, tombstone-kezelés) - ritkán használt, visszavonhatatlan, az ÖSSZES tag számára zavaró művelet (a szoba ténylegesen egy ÚJ szoba-azonosítóra "költözik"), a jelenlegi funkciókészlethez képest niche - nincs olyan konkrét hiba/korlát, amit ez oldana meg ennél a projektnél, ezért alacsonyabb prioritású, mint amit ez a kör ténylegesen megvalósított.
- [x] **Discord Rich Presence-kompatibilis "Játszom: X" állapot** - a felhasználó kifejezett kérésére ("van a discordnak ez a szabványa... ezt tudjuk implementálni?"), MIUTÁN tisztáztam, hogy ez NEM egy nyílt Matrix-szabvány, hanem Discord saját, dokumentálatlan, helyi (nem szerver-oldali) IPC protokollja - a felhasználó a "csináljuk meg a valódi, nehezebb verziót" opciót választotta a saját, natív "Activity"-státusz alternatíva helyett. Két, egymástól élesen elváló rész:
  - **`apps/desktop/src/discordRpcServer.ts`** (ÚJ, csak az Electron-buildben fut, a web build sosem éri el) - újraimplementálja Discord saját, reverse-engineered helyi Rich Presence IPC szerverét, hogy a Discord Game SDK-t MÁR integráló játékok/appok a JorKonvo-nak IS jelentsenek, pontosan úgy, ahogy a valódi Discord asztali appnak tennék. Unix domain socket (POSIX) / named pipe (Windows) `discord-ipc-0`…`discord-ipc-9` néven (Node `net.createServer().listen(path)`, natív addon nélkül), a köztudottan konvergens (több független, évek óta futó nyílt forráskódú implementáció - `discord-rpc` npm csomag, `discordjs/RPC`, Python `pypresence` - egymástól függetlenül ugyanahhoz jutott) `[opcode u32le][hossz u32le][JSON]` keretezéssel, HANDSHAKE→READY/SET_ACTIVITY→ack kezeléssel. **Tudatosan NEM implementált**: a böngésző/WebSocket szállítási réteg (6463-6472 port, Discord saját beágyazott "Activities" webes SDK-jához) - ennek vezetékprotokollja lényegesen kevésbé egyöntetűen dokumentált független forrásokból, mint az IPC socket-é, amit a VALÓDI natív játék-integrációk (C++/Unity/Godot/stb.) ténylegesen használnak. **Alapvető, kimondott korlát**: ha a VALÓDI Discord asztali app is fut ugyanazon a gépen, egy adott játék azt kapja el, amelyik előbb foglalta le a `discord-ipc-0`-t - nincs mód elfogni egy már a valódi Discordhoz folyó forgalmat. Az app-név feloldása Discord saját, hitelesítés nélküli, publikus `GET /applications/{client_id}/rpc` végpontján keresztül történik (best-effort, néma null-ra esik vissza).
    - **Élesben talált+javított VALÓDI hiba #1 (socket-lopás)**: az első verzió minden `EADDRINUSE` hibánál feltételezte, hogy a socket-fájl "beragadt" (korábbi összeomlott futásból maradt), és FELTÉTEL NÉLKÜL törölte+újra-foglalta - ez egy saját, integrációs Node-teszttel azonnal kiderült: egy MÁSODIK szerver-példány elindítása, amíg az ELSŐ még ténylegesen fut, ELLOPTA a 0-s foglalást az elsőtől (a törlés+újrafoglalás a futó szerver ELŐL vette el az útvonalat, ahelyett hogy a következő szabad ID-re lépett volna). Javítva: `isSocketStale()` - VALÓDI próba-kapcsolódás a célra, csak `ECONNREFUSED`/`ENOENT` esetén (bizonyítottan senki sem hallgatja) törli+foglalja újra, egyébként a következő ID-re lép.
    - **Élesben talált+javított VALÓDI hiba #2 (Electron sandbox + ESM preload)**: a `sandbox: true` renderer-beállítás mellett (l. `main.ts`, biztonsági okból szándékosan bekapcsolva) egy ES-modulos (`import` szintaxisú, a csomag saját `"type": "module"`-je miatt `.js`-ként emittált) preload szkript HIBA NÉLKÜL "betöltődött", de a `contextBridge.exposeInMainWorld` SOSEM futott le - a `window.jorkonvoDesktop` némán hiányzott a renderelőben. Egy VALÓDI, futó Electron-alkalmazás ellen (Playwright `_electron` indítóval, Xvfb alatt) végzett élesteszt fedte fel: egy ideiglenesen becserélt, tisztán CommonJS preload azonnal működött ugyanazokkal a `contextBridge` hívásokkal. Javítva: `preload.ts` → `preload.cts` átnevezve (a TypeScript saját, projekt-modul-beállítástól FÜGGETLEN, fájlonkénti CommonJS-kényszerítő konvenciója - `.cts` mindig `.cjs`-be fordul), `main.ts` a `preload.cjs`-re mutat. `main.ts`/`discordRpcServer.ts` ESM marad (ez a korlát KIZÁRÓLAG a sandboxolt renderer preload szkripteket érinti).
  - **`packages/matrix-core/activity.ts`** - az elfogott/értelmezett aktivitás (`applicationId`, `appName`, `details`, `state`, `largeImageText`/`smallImageText`, `startedAt`, párttag-szám) ugyanazzal az MSC4133 extended-profile mechanizmussal kerül közzétételre, mint a bio/banner (`io.jorkonvo.activity` kulcs) - globálisan olvasható, nem csak közös szobában lévők számára. `updatedAt`-alapú, 5 perces "elavultsági" határidő (`apps/web/src/lib/richPresence.ts` 2 percenként újra-érinti, amíg egy kapcsolat aktív) ugyanazzal az őszinteséggel, mint a hangcsatorna "ki van bent" heartbeat-je - egy hirtelen összeomlott/hálózatot vesztett géptől eltérően a NORMÁLIS (a játék bezárásakor a socket lezárul) leválás azonnal, tisztán töröl.
  - `apps/desktop/src/preload.cts` továbbítja a fő folyamatból érkező aktivitás-frissítéseket a renderelőnek (`ipcRenderer.on`/`contextBridge`); `apps/web/src/lib/richPresence.ts` egy TISZTA, valódi no-op a webes build-en (nincs `window.jorkonvoDesktop`, tehát a `wireRichPresence` azonnal visszatér); `UserProfilePopover.tsx` egy "🎮" kártyát jelenít meg (app név/részletek/állapot/párttag-szám/"Kezdve: X perce" élő számláló, `date-fns` `hu` locale-lal, a `ForumPanel`-nél már bevett mintát követve).
  - **Élesben, TELJES, valódi kör-VÉGIG tesztelve** (nem csak protokoll-szinten): (1) egy dedikált Node-integrációs teszt egy nyers Unix socket-kliens ("hamis játék") HANDSHAKE→READY→SET_ACTIVITY→ack→PING/PONG→leválás→2. szerver-példány folyamát futtatta a VALÓS `discordRpcServer.ts` ellen - minden mező (details/state/large_text/party/timestamps/applicationId) helyesen értelmeződött, a leválás helyesen törölte az aktivitást, a 2. példány helyesen a KÖVETKEZŐ szabad ID-re (1) kötött, NEM lopta el a 0-t (ez fogta el a fenti #1 hibát). A `resolveAppName` valós Discord API-hívását egy VALÓDI, publikusan regisztrált Discord alkalmazás-azonosítóval (`463151177836658699`) is leellenőriztem `curl`-lel és a szerveren át egyaránt - helyesen "YouTube Music"-ot adott vissza. (2) **Teljes Electron-végpontig-végpontig teszt**: Xvfb alatt (a headless gépre telepítve, `pacman -S xorg-server-xvfb`) elindítva a VALÓDI Electron appot (Playwright `_electron`), a VALÓDI `thatumi` fiókkal bejelentkezve (friss, elkülönített Electron `--user-data-dir`, hogy ne keveredjen a böngésző-profilokkal), egy nyers socket-kliens csatlakozott a FUTÓ app tényleges `discord-ipc-0` foglalásához, valódi SET_ACTIVITY-t küldött → a renderelő ÉSZLELTE (`window.jorkonvoDesktop.onActivityUpdate`) → **ténylegesen közzétette thatumi VALÓDI Matrix profilján** (`GET .../profile/@thatumi.../io.jorkonvo.activity` egy MÁSIK, nyers kéréssel 200-at és a pontosan egyező tartalmat adta vissza) → a hamis játék leválasztásakor az aktivitás TISZTÁN törlődött (404). A tesztmenet végén a felhasznált Electron-munkamenet önmagát kijelentkeztette (`POST /logout` saját tokennel, NEM érintve thatumi többi, valódi eszközét). JS hiba egyik lépésben sem volt.
  - **Kereszt-fiókos olvashatóság KÜLÖN nem lett újra-tesztelve** (a fenti teszt közben az aktivitás már törölve volt, mire egy második fiók ellenőrizhette volna) - de ez ugyanaz a `getExtendedProfileProperty`/`setExtendedProfileProperty` mechanizmus, ami a bio-nál és a bannernél MÁR bizonyítottan kereszt-fiókosan olvasható (l. feljebb), tehát ez nem egy külön, saját kockázatú kód-út.

- [x] **Hatodik önálló kör** (a felhasználó explicit kérésére: "csináljuk meg a reakció alapú szerepkör felvételt, szerepkör említést, ugrás dátumra, szoba/space-sablon klónozás, időzített némítás, egyéni szerver emojit" + egy bugfix + több tétel a todo listára) - hét funkció és egy régóta dokumentált hiba javítása, mindegyik élesben, két valós fiókkal (ahol releváns) tesztelve:
  - **Csoportos hívás "?" néven megjelenő résztvevő (régóta dokumentált, most javított hiba)** - a `GroupCallScreen.tsx` névfeloldó lánca `matrixRoom.getMember(userId)?.name ?? p.name ?? userId` volt: a `??` operátor csak `null`/`undefined` esetén lép tovább, ÜRES STRING esetén NEM - ha a taglista-feloldás sikertelen (`undefined`) ÉS a LiveKit résztvevő saját `p.name`-je üres string (nincs név-claim a JWT-ben), a lánc egy ÜRES stringnél állt meg, amit az `Avatar` `initials()` segédfüggvénye "?"-re képez le - rosszabb eredmény, mint a végső `userId` tartalék, amire sosem jutott el a kód. Javítva `||`-ra (falsy-alapú lánc) + egy ÚJ középső tartalék, `client.getUser(userId)?.displayName` (a szoba-szintű helyett a GLOBÁLIS profil-gyorsítótár, arra az esetre, ha a szoba tagjelölt-listája még nem érte utol egy frissen csatlakozott felhasználót). **Élesben, KÉT valós fiókkal újra-tesztelve** egy friss hangcsatornán: egyik oldalon sem jelent meg "?" vagy üres név, mindkét fél helyesen látta a másik valódi nevét ("Te" / "teszt").
  - **Reakció alapú szerepkör-felvétel** (`packages/matrix-core/reactionRoles.ts`) - egy adott (üzenet, emoji) párra állítható be szerepkör-kötés (`io.jorkonvo.reaction_roles` szoba-állapot, egyetlen blob, ugyanaz a minta mint az AutoMod-nál/kitiltási listáknál) - aki arra az emojival reagál, megkapja a szerepkört, a reakció VISSZAVONÁSA visszaveszi. **A reakció-eltávolítás észlelése különösen érdekes technikai részlet**: a redakció pillanatában a redaktált esemény TARTALMA (relation cél + emoji) már törölve van, tehát az élő reakció-eseményeket SAJÁT esemény-ID szerint kell egy térképben megőrizni ÉRKEZÉSKOR (amíg még látható), hogy egy KÉSŐBBI redakció vissza tudjon rá hivatkozni - ugyanaz a "amíg még látszik, jegyezzük meg" gondolkodás, mint az AutoMod dedup-halmazánál, csak más okból. `watchReactionRoles` ugyanazt az őszinte "legjobb erőfeszítés, csak amíg fut egy jogosult kliens" mintát követi + a háttér-dekódolás miatti `MatrixEventEvent.Decrypted` figyelést (E2EE szobában a reakció-esemény is titkosítva érkezik). UI: a `MessageLine` eszköztárában egy új gomb (csak akkor látszik, ha a szoba egy space-hez tartozik ÉS a felhasználó kezelhet szerepköröket) nyitja meg a `ReactionRoleModal`-t (emoji + szerepkör választó, meglévő kötések listája eltávolítással).
    - **Élesben tesztelve KÉT valós fiókkal, TELJES kör, mindhárom átmenet**: thatumi létrehozott egy szerepkört + kötést → teszt reagált → thatumi FUTÓ klientje AZONNAL hozzárendelte a szerepkört (nyers állapot-lekérdezéssel megerősítve) → teszt visszavonta a reakciót → a szerepkör AZONNAL visszavonódott → teszt újra reagált → a szerepkör ÚJRA megjelent. JS hiba egyik lépésben sem volt.
  - **Szerepkör-említés (`@SzerepkörNév`)** - a `formatting.ts` meglévő `@room`/`@here` mintáját követi: egy ÚJ `RoleMentionEntry` lista (roleId/name/color/userIds), a `userIds` a KÜLDÉS pillanatában frissen feloldva (`getRoomMembersWithRole`, ÚJ export a `roles.ts`-ben - a SZOBA, nem az egész space tagjai közül, hiszen csak azok fogják ténylegesen látni az üzenetet), ugyanaz a "frissen feloldva küldéskor, nem amikor kiválasztották" elv, mint az `@here`-nél. A találat a `m.mentions.user_ids`-be kerül (valódi szerver-oldali push rule-ok is kiváltják), a megjelenítés egy színezett `data-mx-pill="role"` span (`data-mx-color` egyéni attribútumként, NEM nyers `style`-ként átengedve - a `formatted_body` bárkitől jöhet, sosem szabad megbízni benne nyers CSS-ként). `MessageComposer.tsx` autocomplete-je most már szerepkör-találatokat is felkínál `@`-jel után.
    - **Élesben tesztelve**: `@MentionSze` beírására az autocomplete felkínálta a szerepkört (élő screenshottal megerősítve), kiválasztás+küldés után a nyers esemény-lekérdezés helyes `m.mentions.user_ids`-t (a szerepkört viselő tag azonosítójával) ÉS helyes `formatted_body`-t (`<span data-mx-pill="role" data-mx-color="#...">`) adott vissza.
  - **Ugrás dátumra** - a spec saját, mára stabil `GET /rooms/{roomId}/timestamp_to_event` végpontja (MSC3030, `packages/matrix-core/jumpToDate.ts`, a matrix-js-sdk saját `timestampToEvent()`-je már kezeli a stabil/unstable végpont közti visszaesést) - a `SearchPanel`-ben egy dátumválasztó + "Ugrás dátumra" gomb a MEGLÉVŐ `jumpToEvent` idővonal-ugró mechanizmusra köt rá (amit eddig csak a keresési találatokra kattintás használt). **Élesben tesztelve**: a mai dátumra ugrás hibaüzenet nélkül lefutott.
  - **Időzített némítás** (`packages/matrix-core/timedMute.ts`) - a MEGLÉVŐ, valódi szerver-oldali némítás-push-rule (`setRoomMuted`) fölé egy lejárati időbélyeg, saját, privát account data-ként tárolva (`io.jorkonvo.timed_mutes` - ÉRTÉKES helyen: az account TÖBBI klientje is látja, ugyanúgy mint a barátlista). A Matrix specnek nincs "lejáró push rule" fogalma, tehát a tényleges automatikus feloldás kliens-oldali időzítő (`watchTimedMutes`, 15mp-enként ellenőriz), ugyanazzal az őszinteséggel mint az AutoMod - csak amíg fut egy JorKonvo kliens. UI: az `ChatArea` meglévő értesítés-menüjében a "Némítás" opció mostantól egy al-menüt nyit (15 perc/1 óra/8 óra/24 óra/amíg vissza nem kapcsolom + "Feloldás most" ha épp aktív egy időzítés).
    - **Élesben tesztelve**: "15 perc" választása után a nyers account data helyes, ~15 perccel a jövőbeli lejárati időbélyeget tartalmazott, a szerver-oldali push rule pedig helyesen `dont_notify`+bekapcsolt állapotban volt.
  - **Egyéni (szoba-szintű) emoji** - a korábban tudatosan kihagyott MSC2545 helyett (l. feljebb a stickers.ts/polls.ts megjegyzéseit) az `im.ponies.room_emotes` "image pack" egyezményt implementáltam (`packages/matrix-core/roomEmoji.ts`) - ez NEM egy soha le nem zárt MSC, DE ez az, amit Element/SchildiChat/FluffyChat ÉVEK óta ténylegesen leszállítanak és egymással interoperálnak, tehát egy itt hozzáadott emoji VALÓBAN megjelenik ezekben a kliensekben is, nem egy csak-JorKonvo-nak érthető saját formátum. Küldéskor a `:rövidkód:` mintázat egy `<img data-mx-emoticon src="mxc://...">` tag-re cserélődik (`formatting.ts`); OLVASÁSKOR (`MessageBody.tsx`) az `<img>` tag KIVÉTELESEN engedélyezett a különben `<img>`-et tudatosan tiltó allowlistából, DE SZIGORÚAN csak `data-mx-emoticon`+`mxc://` forrás esetén (egy tetszőleges `<img src="https://...">` továbbra sem töltődne be - ez korábban tudatos, a felhasználó IP-jét/kliensét szivárogtató kép-URL-ek elleni védelem volt, amit ez a szűk kivétel nem bont meg, mert az `mxc://` mindig a SAJÁT homeserveren át oldódik fel, sosem egy tetszőleges külső hoszton). `MessageComposer.tsx` `:` triggerre is felkínálja az autocomplete-et (a `@`-hoz hasonlóan, de külön trigger-karakterrel), `RoomSettingsModal`-ban kép-feltöltős kezelőfelület.
    - **Élesben tesztelve**: egy 1×1 pixeles teszt-kép feltöltve+hozzáadva a szoba emoji-készletéhez, `:tesztarc` beírására az autocomplete felkínálta a képet, kiválasztás+küldés után a nyers esemény `formatted_body`-ja PONTOSAN a spec szerinti `<img data-mx-emoticon src="mxc://..." alt=":tesztarc:" title=":tesztarc:" height="24" />`-t tartalmazta, ÉS a képernyőképen ténylegesen inline képként jelent meg az idővonalon.
  - **Szoba/space-sablon klónozás** (`packages/matrix-core/spaceTemplate.ts`, `cloneSpaceAsTemplate`) - egy space STRUKTÚRÁJÁT (kategóriák, csatornák - név/téma/típus, helyesen újra-csoportosítva az új kategóriákba -, szerepkörök - név/szín/jogosultsági-sablon) klónozza egy vadonatúj space-be, TARTALOM, TAGOK, MEGHÍVÓK és TITKOSÍTÁSI ÁLLAPOT nélkül - ez egy induló sablon, nem biztonsági mentés/duplikátum. A szerepkör-klónozás tudatosan NEM másolja a tag-hozzárendeléseket (egy üres új space-ben nincs kinek), de a `powerLevel`-sablont IGEN (élettelen, amíg valaki ténylegesen meg nem kapja az új space-ben). Csak azok a csatornák kerülnek át, amikhez ez a fiók már csatlakozott (ugyanaz a `getRoomsInSpace` korlát, amit ez a session TÖBBSZÖR megtapasztalt). A meglévő `createCategory`/`createRole` függvények visszatérési típusát `void`-ról az új azonosítóra bővítettem (visszamenőlegesen kompatibilis módosítás - mindkettőnek egyetlen meglévő hívója van, egyik sem használta eddig a visszatérési értéket). UI: a space-fejlécben új "Klónozás sablonként" gomb → `CloneSpaceModal` (előnézet: hány kategória/csatorna/szerepkör kerül át).
    - **Élesben tesztelve**: egy forrás space (1 kategória + 1 szöveges és 1 hang csatorna, utóbbi a kategórián kívül + 1 szerepkör `powerLevel: 50`-nel) klónozása után a nyers állapot-lekérdezések megerősítették: az új space-ben PONTOSAN 1 kategória (helyes névvel), 2 csatorna (helyes nevekkel, a hang-csatorna típusa helyesen megmaradt, a szöveges csatorna helyesen az ÚJ kategória-azonosítóhoz lett rendelve), 1 szerepkör (helyes név/szín/`powerLevel`), és NULLA tag-hozzárendelés (ahogy elvárt).
  - **Talált, de NEM ehhez a körhöz tartozó, tisztázatlan eredetű jelenség**: a `pw-profile-6` Playwright-profil munkamenete a mai kör közepén véletlenül elveszett (üres bejelentkező képernyő jelent meg), majd egy újrabejelentkezés után egy MÁSODIK, kapcsolódó hibaüzenet ("the account in the store doesn't match the account in the constructor: expected ...:RQAHVOPFCU, got ...:UNUPNBIOEM") jelent meg egy következő újratöltésnél - két KÜLÖNBÖZŐ eszköz-azonosító ütközött, valószínűleg mert egy korábbi bejelentkezés helyi (IndexedDB titkosítási) állapota nem törlődött egy ÚJABB bejelentkezés eszköz-váltásakor. **Nem világos, hogy ez egy valódi, felhasználó által is elérhető JorKonvo-hiba, vagy pusztán ennek a munkamenetnek a sajátja** (ugyanazt a lemez-profilt sok, gyors egymásutáni Playwright-példány használta ma, ami önmagában szokatlan terhelési minta egy valós felhasználóhoz képest) - a profil törlésével és tiszta újra-bejelentkezéssel megoldódott, de érdemes lehet egy jövőbeli körben megvizsgálni, hogy az `authStore`-nak kellene-e a régi eszköz IndexedDB-jét is törölnie, amikor egy MÁSIK eszköz-azonosítóval jelentkezik be ugyanaz a felhasználó ugyanabban a böngésző-profilban.

## Hetedik önálló kör - az Ötletlista feldolgozása (a felhasználó kérésére: "Haladj ezekkel mind, sorba ahogy tudsz")
- [x] **AutoMod továbbfejlesztése** (`automod.ts`) - a meglévő sima kulcsszó-egyezés (`keywords`) MEGMARADT változatlanul (visszamenőleges kompatibilitás), MELLÉ két új, additív mechanizmus: `patterns` (wildcard `*`/`?`, ugyanaz a konvenció mint a kitiltási listáknál, VAGY teljes regex - mindkettő `try/catch`-csel védve, egy hibás felhasználói regex sosem dönti le a figyelőt) és linkszűrés (`linkFilterEnabled`+`allowedDomains` - ha üres az engedélyezett-lista, EGYETLEN link sem engedélyezett, az aldomainek automatikusan öröklik a szülő domain engedélyét). `RoomSettingsModal`-ban kibővített kezelőfelület (minta hozzáadása fajta-választóval, domain-lista kezelése).
  - **Élesben tesztelve KÉT valós fiókkal, mind a 4 mechanizmus**: wildcard-minta (`wcspam*`) elkapta a `wcspamHELLO`-t, regex-minta (`r[e3]gexbad\d+`) elkapta az `r3gexbad42`-t, linkszűrés törölte egy nem-engedélyezett domainre mutató linket, DE életben hagyta egy engedélyezett (youtube.com) linket - mind a négy nyers esemény-lekérdezéssel megerősítve (törölt/nem törölt állapot + a pontos indoklás-szöveg).
- [x] **Szobánkénti egyéni értesítési hang** (`apps/web/src/lib/notificationSound.ts`) - az eddig fiók-szintű (globális) hangválasztás MELLETT egy opcionális, szoba-szintű felülbírálás, szándékosan `localStorage`-ban (nem account data-ban) tárolva - "melyik szintetizált hang szóljon EZEN az eszközön" fogalmilag nem eszközök-közötti adat, a fiók többi klientje (Element X stb.) úgysem értené. `ChatArea` értesítés-menüjében egy új választó ("Alapértelmezett" + a meglévő hang-készlet).
  - **Élesben tesztelve**: a választó a szoba-fejléc értesítési menüjében helyesen megjelenik és működik.
- [x] **Naptár-esemény emlékeztetők** (`packages/matrix-core/calendarEvents.ts` `getEventsNeedingReminder` + `apps/web/src/lib/calendarReminders.ts`) - **az RSVP funkció ("megyek"/"talán"/"nem megyek") valójában MÁR KÉSZ VOLT egy korábbi körből** (a korábbi Ötletlista-bejegyzés tévesen "nincs RSVP"-t írt - a `CalendarEventCard.tsx` már régóta teljes RSVP-kezelőfelülettel rendelkezik), tehát ebben a körben KIZÁRÓLAG az emlékeztető hiányzott, azt pótoltam: kliens-oldali időzítő (30mp-enként ellenőriz), ami a "megyek"/"talán" jelöléssel rendelkező, hamarosan kezdődő eseményekhez böngésző-értesítést + hangot küld - a "már figyelmeztetve" állapot `localStorage`-ban (megint csak eszköz-szintű, nem account data). Felhasználói beállításokban új "Naptár-emlékeztetők" szakasz (Ki/5/10/30 perc/1 óra).
  - **Nem élesben időzítve tesztelve** (egy valós, néhány percen belül kezdődő eseményt kellett volna beütemezni és kivárni) - a mögöttes `getEventsNeedingReminder` viszont ugyanazt a MÁR bizonyítottan működő RSVP-lekérdezést (`tallyCalendarEventRsvps`) használja, amit ez a kör NEM módosított, csak egy időbeli szűrést rak rá - a UI-szakasz (beállítás mentése/betöltése) megjelenése ellenőrizve.
- [x] **Soundboard** (`packages/matrix-core/soundboard.ts` + `apps/web/src/lib/soundboardPlayback.ts`) - ugyanaz a trükk, mint a hangcsatorna "ki van bent" jelenlét-jelzésnél: mivel egy sima Matrix-kliens nem tud belekeverni egy hangot a tényleges LiveKit médiafolyamba (ahhoz szerver-oldali mixelő komponens kellene), egy könnyű, nem-state esemény ("ezt játszd le most") jelzi mindenkinek, aki épp csatlakozva van AHHOZ a konkrét híváshoz (a `groupCallStore` élő állapotával szűrve, hogy valaki más szobájában futó soundboard ne szóljon bele) - mindenki helyben, szinkronban lejátssza a klipet. `GroupCallScreen`-ben új gomb nyit egy panelt (hangeffekt-választó gombrács + feltöltés jogosultaknak).
  - **Élesben tesztelve KÉT valós fiókkal, TELJES esemény-folyam**: mindkét fél csatlakozott egy hangcsatornához, thatumi feltöltött egy teszt-hangot, megnyitotta a soundboard panelt (képernyőképpel megerősítve), rákattintott → a nyers esemény-lekérdezés megerősítette, hogy a helyes `io.jorkonvo.soundboard.play` esemény ment ki a helyes `soundId`-vel. JS hiba egyik fél oldalán sem volt (teszt oldala helyesen, csendben nyelte el a lejátszási hibát, mivel a teszt-hang egy nem valódi, dekódolhatatlan bájtsorozat volt - pontosan az elvárt "elnyelt hiba, sosem törik" viselkedés).
- [x] **Hívás közbeni eszköz-ellenőrzés** - egy pajzs-ikon gomb minden távoli résztvevő csempéjén (`GroupCallScreen.tsx`), ami a MEGLÉVŐ `verificationStore`/`VerificationOverlay` folyamot indítja el, anélkül hogy el kéne hagyni a hívást (a hívás-képernyő és az ellenőrzés-overlay egyaránt `z-50`, de a `VerificationOverlay` a DOM-ban KÉSŐBB renderelődik, tehát helyesen fölé kerül).
  - **Élesben tesztelve KÉT valós fiókkal**: a pajzs-ikon a screenshoton megerősítve helyesen megjelent teszt csempéjén.
- [x] **Hívás-előzmények lista** (`apps/web/src/lib/callHistory.ts`) - szándékosan eszköz-szintű (`localStorage`, nem account data): a fiók többi valódi klientjének (Element X stb.) már megvan a saját, teljesen külön hívásnaplója, ennek nincs értelmes "szinkronizáld a többi eszközzel" jelentése. 1:1 hívásoknál a `callStore.ts` `registerCall`-ja, csoportos hívásnál a `groupCallStore.ts` `join`/`Disconnected`-je naplóz - irány, csoportos-e, kezdés/befejezés ideje, és hogy VALAHA ténylegesen csatlakozott-e a hívás (a "nem fogadott"/"megszakítva" megkülönböztetéshez). Új gomb a `SpaceRail` alján nyitja meg a `CallHistoryModal`-t.
  - **Élesben tesztelve**: egy valós csoportos hívás (a soundboard-teszt mellékterméke) helyesen, a pontos idővel/időtartammal (0:16) jelent meg a naplóban, a modal UI helyesen renderelte.
- [x] **GIF-kereső - előkészítve, API-kulcsra várva** (`apps/web/src/lib/gifSearch.ts` + `SendGifModal.tsx`) - a felhasználó kifejezetten kérte az előkészítést API-kulcs nélkül is: a TELJES funkció készen áll (Tenor keresés/trending, debounce-olt kereső mező, találat-rács, kiválasztáskor a GIF letöltése+feltöltése+elküldése a MEGLÉVŐ `sendFileMessage`-en át, ami már helyesen kezeli az E2EE titkosítást is) - az EGYETLEN hiányzó darab egy saját, ingyenes Tenor API-kulcs, aminek a hiányában a modal világos, akcionálható üzenetet mutat ahelyett, hogy rejtélyesen elhasalna. A kulcs szándékosan KIZÁRÓLAG `localStorage`-ban tárolva (sosem account data, sosem szinkronizálva) - ez egy hitelesítő adat, nem beállítás. Felhasználói beállításokban új "GIF-kereső (Tenor)" szakasz (jelszó-típusú beviteli mező + regisztrációs link).
  - **Élesben tesztelve**: kulcs nélkül a "GIF küldése" gomb megnyitja a modalt, ami helyesen, világosan jelzi a hiányzó kulcsot, JS hiba nélkül. A tényleges keresés/küldés emberi teendő marad (saját Tenor-fiók regisztrálása), utána viszont további kódmódosítás nélkül működik.

## Nyolcadik önálló kör - a felhasználó 9 pontos hibalistája (laptopról érkezve, "kéne pár dolgot javítanod/változtatnod")
- [x] **Space-rail hover-csík függőleges centrálás** (`SpaceRail.tsx`) - a `RailButton` fehér jelző `<span>`-je `absolute left-0` volt függőleges pozicionálás nélkül, tehát a csempe TETEJÉTŐL nőtt lefelé hover-re. Javítva: `top-1/2 -translate-y-1/2`, most középről tágul.
- [x] **Bal-lenti ikonok csíkja rossz vízszintes pozícióban** (`SpaceRail.tsx`) - a `mt-auto` alsó gombcsoportról hiányzott a `w-full`, ezért a benne lévő `RailButton`-ok csak 48px szélesek voltak a 72px-es railben, így a `left-0` jelző az ikon MELLETT (12px-rel beljebb), nem az app szélén jelent meg. Javítva: `w-full` az alsó csoportra.
- [x] **Hangüzenet-hullámforma nem animált rendesen** (`VoiceRecorderBar.tsx`) - a 40 oszlopból CSAK az utolsó (`i === 39`) mozgott, a többi fix 15%-on állt. Javítva: gördülő, 64-oszlopos csúcs-history (`levels` állapot, ~20/mp shiftel balra), az oszlopok `flex-1`-gyel kitöltik a sávot - valódi görgetett hangvizualizáció.
- [x] **Profil-banner nem jelenik meg** (`profile.ts` round-trip OK volt, a MEGJELENÍTÉS bukott) - a `matrix.szabotar.dev` a sima `/_matrix/media/v3/thumbnail/...` végpontot **404-eli** (MSC3916 hitelesített media kikényszerítve), CSS `background-image`-hez viszont nincs `onError` amin az `Avatar.tsx` trükkje elkapná. Új `apps/web/src/lib/authedMedia.ts` `useAuthedMedia` hook: a hitelesített `/_matrix/client/v1/media/...` végpontról tölti a képet Bearer-tokennel `blob:` URL-be (modul-szintű cache, mint az `Avatar.tsx`-ben), sima végpontra visszaeséssel régebbi szerverekhez. Használva a beállítások-modalban és a profil-popoverben.
  - **Élesben ellenőrizve** node-szkripttel: a banner `mxc` helyesen bekerül és visszaolvasható a kiterjesztett profilból (`io.jorkonvo.banner_url`), a sima thumbnail-URL 404, a hitelesített 200.
- [x] **Space-be lépéskor az utolsó szoba nyíljon meg + admin alap-szoba + Home** (`uiStore.ts` + új `spaceSettings.ts` + `SpaceSettingsModal.tsx`) - (1) scope-onkénti (space-id vagy "home") utolsó-szoba `localStorage`-ban, `selectRoom`/`selectSpace` frissíti; (2) új `io.jorkonvo.space_settings` state event a space-en (`default_room_id`), state_default jogosultsággal, admin UI a szoba-sidebar fejlécében új fogaskerék-gombbal; (3) `resolveSpaceEntryRoomId` sorrendje: utolsó szoba → admin alap-szoba → első szöveges csatorna; Home-nál utolsó szoba, különben a Barátok fül.
- [x] **Matricák elmentése magadnak** (`stickers.ts` + `SendStickerModal.tsx` + `StickerMessage.tsx`) - új `io.jorkonvo.stickers` account data (privát, per-fiók lista). Mentés-gomb hover-re a kapott matricán (`savePersonalSticker` - titkosított matricát letölt+dekódol+újratölt titkosítatlanul, hogy bármelyik szobába küldhető legyen), "Saját matricák" rács a küldő modalban (`sendPersonalSticker` - E2EE szobába újra-titkosítja küldéskor), "mentés a matricáim közé" checkbox új matrica feltöltésekor.
  - **Élesben ellenőrizve**: az `io.jorkonvo.stickers` account data write/read round-trip működik a szerveren.
- [x] **Titkosítás/kereszthitelesítés "nem jó a kulcs"** (`crypto.ts` + `RecoveryKeyModal.tsx`) - **részleges**: új `resolveSecretStorageKey` helper, ami (1) a beírt szöveget recovery key-ként ÉS jelmondatként is megpróbálja értelmezni (`deriveRecoveryKeyFromPassphrase`), (2) a fiók SAJÁT secret-storage kulcsinfójához validálja (`client.secretStorage.checkKey`) MIELŐTT használná, tehát tiszta hibaüzenet: "érvénytelen formátum" vs. "ez a kulcs nem ehhez a fiókhoz tartozik" vs. "nincs secret storage". A key-backup útvonal most a 4S-t oldja fel és onnan húzza a backup-kulcsot (`loadSessionBackupPrivateKeyFromSecretStorage`), a régi "recovery key = backup key" esetre visszaeséssel. A modal a kereszthitelesítés-hibát mutatja előre a félrevezető "nincs backup" helyett. **A pontos eredeti bug reprodukciójához a felhasználó valódi fiókjának hibaüzenete kell - a teszt-fiókoknak (test1/2/3) egyáltalán nincs 4S beállítva.**
- [x] **Push-to-talk + RNNoise a hívás-képernyőn** (`GroupCallScreen.tsx` + `groupCallStore.ts` + `CallOverlay.tsx`) - csoportos hívásnál új fogaskerék-gomb nyit egy "Hangbeállítások" panelt (RNNoise ki/be → `refreshMicPipeline` újrapublikálja a mikrofon-sávot menet közben; PTT ki/be + billentyű-újrakötés). A PTT-effekt javítva: belépéskor némít, kilépéskor visszakapcsol. 1:1 hívásnál a globális PTT-beállítás most már ténylegesen hat (eddig a matrix natív hívásnál semmit nem csinált) + hint a hívás-fejlécben. (RNNoise 1:1 matrix hívásnál továbbra sem elérhető - más médiaút.)
- [x] **Screenshare közben nincs elérhető hívás-vezérlő** (`CallMiniBar.tsx` + `lib/callUi.ts` + `CallOverlay.tsx`/`GroupCallScreen.tsx`) - **kicsinyíthető hívás-nézet**: a teljes-képernyős hívás-overlay jobb felső sarkában egy "−" gomb összecsukja egy kis, jobb-alsó sarokba dokkolt vezérlő-sávvá (némítás / megosztás leállítása / hívás elhagyása + "teljes nézet" gomb), így hívás közben (vagy egy megosztott böngészőfül fölött) használható a többi felület. Új hívás mindig teljes méretben nyílik. *(Előzőleg Document Picture-in-Picture ablakot próbáltam, de a felhasználó kifejezetten oldal-belüli sávot kért.)*

### Nyolcadik kör - utólagos javítások (a felhasználó további visszajelzései ugyanabban a munkamenetben)
- [x] **"No getSecretStorageKey callback supplied"** (crypto, 7. pont folytatása) - a felhasználó megerősítette, hogy a recovery key JÓ (Element webben megy). A valódi bug: a `MatrixClient` a `ServerSideSecretStorage`-ot (és a rust-crypto-t) a konstruáláskori `cryptoCallbacks` objektumra kötött referenciával hozza létre - mivel ez az app `cryptoCallbacks` opció NÉLKÜL hozza létre a klienst, ez egy KÜLÖN üres objektum, mint a `client.cryptoCallbacks`. A `client.cryptoCallbacks = {...}` ÚJRAÉRTÉKELÉS emiatt a secret storage-ot callback nélkül hagyta. Javítva: új `installSecretStorageKeyCallback`, ami HELYBEN mutálja mindkét callback-objektumot (`client.cryptoCallbacks` ÉS `client.secretStorage.callbacks`). Node-szkripttel igazolva, hogy a két objektum tényleg különböző és csak a helyben-mutálás hat.
- [x] **PiP ablak üres/szürke volt → elvetve** (9. pont folytatása) - először a stabil-host-div React-mintával javítottam, de a felhasználó visszajelezte, hogy nem külön ablakot akar. A teljes Document PiP megközelítést lecseréltem oldal-belüli kicsinyíthető nézetre (l. fentebb a 9. pontnál).
- [x] **Space-ikon hover-nél a sarkokat kékkel töltötte ki** - a `RailButton` gombja hoverre `rounded-3xl`→`rounded-2xl`-re vált (24px→16px sugár), de az `<Avatar>` fix `rounded-full` kört rajzolt → a gomb `hover:bg-brand` háttere kilátszott a kör négy sarkában. Javítva: új `Avatar rounded="none"` (nem kerekíti magát), a `SpaceRail` gomb `overflow-hidden`-je klippel - az ikon mindig pontosan a gomb alakját veszi fel.
- [x] **Mentett matricákat nem lehetett törölni** - a `removePersonalSticker` megvolt a matrix-core-ban, csak UI nem hívta. `SendStickerModal` "Saját matricák" rács: hover-X minden matricán + "Kezelés" mód (minden X látszik, kattintás = törlés).
- [x] **Space-ek átrendezése húzással + mappákba csoportosítás (Discord-stílus)** (új `spaceLayout.ts` + `SpaceRail.tsx` átírás) - privát account data `io.jorkonvo.space_layout` (`{ order: (space | folder)[] }`), csak ezen a fióknál, más kliensnek semmit nem jelent. Natív HTML5 drag-and-drop: felső/alsó él = átrendezés, közép = mappa létrehozása a két space-ből, mappára ejtve = beadás. Mappa = 2×2 mini-ikon rács, kattintásra kinyílik (localStorage), jobbklikk = átnevezés/felbontás. <2 elemű mappa automatikusan felbomlik (Discord-viselkedés). Optimista UI (a `setAccountData`-nak nincs helyi echo-ja), a valódi echo landolásakor visszavált. Account data round-trip node-szkripttel igazolva. Az "első csatlakozáskor még nem látott" space-ek automatikusan a lista végére kerülnek.

### Kilencedik kör - további Discord-közelítő finomítások
- [x] **Kép megnyitása helyben (lightbox)** (új `ImageLightbox.tsx` + `state/lightboxStore.ts`) - a kép-csatolmány eddig `<a target="_blank">` volt (új lap). Most kattintásra ugyanazon az oldalon nagyítódik ki egy teljes-képernyős rétegben (Esc / háttérre kattintás zár, letöltés gomb). A lightbox SAJÁT `blob:` URL-t old fel (`resolveAttachmentUrl`), így nem törik el, ha az őt megnyitó üzenet kigörgetődik a timeline-ból.
- [x] **Feltöltési korlát + képtömörítés, adminonként állítható** (új `lib/imageCompression.ts` + `spaceSettings.ts` bővítés + `MessageComposer`) - a `io.jorkonvo.space_settings` state event két új mezővel: `max_upload_mb` (kliens-oldali puha korlát a szerver `m.upload.size` HARD korlátja felett) és `compress_images` (alapból BE). Feltöltés előtt a nagy képek WebP-be kicsinyítődnek (max 2560px, animált GIF kivétel), és ha a fájl a hatékony korlát (`min(szerver, admin)`) fölött van, tiszta hibaüzenet jön 413 helyett. `SpaceSettingsModal`-ban új "Feltöltések" szakasz; kiírja a szerver tényleges korlátját is, azzal a megjegyzéssel, hogy azt csak a homeserver konfig (`max_upload_size`) állítja.
- [x] **Hangcsatorna = csak hívás (Discord-modell)** (`RoomSidebar` + `ChatArea` + `spaceSettings.resolveSpaceEntryRoomId`) - hangcsatornára kattintva NEM nyílik meg előbb szöveges nézetként; azonnal csatlakozik és megjelenik a hívás-képernyő (ha már bent vagy: visszahozza a kicsinyített hívást). A `ChatArea` egy hangcsatorna esetén "lobby" nézetet mutat (ki van bent + csatlakozás-gomb), soha nem timeline-t/szövegmezőt. A szöveges csatornákból ELTŰNT a "csatlakozás csoportos híváshoz" gomb, és a hanghívás/videóhívás gomb már csak 1:1 DM-eknél jelenik meg (nem hívható egy sima szöveges csatorna).
- [x] **Jogosultsági szintek emberi címkékkel** (`moderation.ts` `POWER_LEVEL_PRESETS` + `describePowerLevel` + `SpaceRolesModal`/`RoomSettingsModal`) - a legördülőkből eltűntek a nyers számok (`Admin (50)` → `Admin`), helyette rövid magyarázat mit jelent az adott szint (pl. "Moderátor — üzenetek törlése, tagok kirúgása/kitiltása, némítás"). A `RoomSettingsModal` "Tagok jogosultsága" szekció fölött egy rövid lista a szintekről.

### Szerver-bérlés ("bérelj tőlem Matrix szervert") - alap kész (`deploy/`)
- [x] **Teljes Docker Compose stack** (`deploy/docker-compose.yml`): Synapse + Postgres + LiveKit + `lk-jwt-service` + coturn + Caddy (auto-TLS + `.well-known` a `rtc_foci`-val). Opcionális profilok: `mas` (QR-login), `admin` (synapse-admin), `webapp` (a JorKonvo build kiszolgálása).
- [x] **`scripts/provision.sh`** - idempotens: titkokat generál, Synapse signing key, template-eket renderel envsubst-tal. `create-admin.sh`, `backup.sh`.
- [x] **Terraform** (`deploy/terraform/main.tf`) - egy szerver / ügyfél: Hetzner Cloud VM (óradíjas, havi cap) + Cloudflare DNS az összes aldomainre + cloud-init (`scripts/hetzner-cloud-init.yaml`), ami feltelepíti a Dockert és felhúzza a stacket. Workspace / ügyfél a többszörözéshez.
- [x] **`deploy/RENTAL.md`** - provider-kutatás (Hetzner a value-győztes óradíjjal, ~€4.5/hó `cx22`; Vultr a nem-EU régiókra), a hiányzó SaaS-rétegek (billing/portál/flotta-ops) és egy build-sorrend, plusz a jogi/abúzus realitás egy szóló üzemeltetőnek.
- **Emberi teendő**: DNS, valódi Hetzner/Cloudflare token, éles kipróbálás. A SaaS-portál + fizetés külön termék (l. RENTAL.md build order); az MVP-t kézzel is el lehet adni `terraform apply`-jal.
- **Konduwuit-variáns** ötlet: `docker-compose.conduwuit.yml` - Rust homeserver, töredék RAM, feleződhet a min. VM méret.

### Felhasználói ötletlista (a felhasználó éjszakai kérésére, "dolgozz emberi beavatkozás nélkül")
- [x] **Kitűzött kép-üzenet** - `PinnedMessagesModal` most a `MediaAttachment`/`StickerMessage` komponenst rendereli kép/matrica/fájl pinnél, nem a `body` stringet.
- [~] **Többnyelvűség (i18n)** - **infra kész** (`apps/web/src/i18n/`): dep-nélküli `t()`/`useTranslation()`, `{param}` interpoláció, `_one`/`_other` plural, `hu` fallback, `navigator.language` + localStorage detektálás, nyelvváltó a Felhasználói beállításokban. **`hu` + `en` locale, ~270 kulcs, 1:1 paritás** (parity-check a commitokban). Migrálva: login, restore-failed, App betöltő, space-rail, szoba-sidebar (szobák/DM/meghívók/kategóriák), chat-fejléc + értesítés-menü + hangcsatorna-lobby, üzenetszerkesztő (csatolás/szavazás/esemény/matrica/gif/hely, lassított mód, feltöltési hibák, válasz/szerkesztés sáv), 1:1 hívás-overlay + bejövő sáv, mini hívás-sáv, quick switcher, user panel, barátok-panel (jelenlét-címkék, kérelmek), tag-lista, események-panel, matrica/kitűzött/szerver-beállítás/szoba-létrehozás/space-létrehozás/kategória/DM/csatlakozás modal. **Hátra (kevésbé gyakran látott):** `RoomSettingsModal` (~1300 sor), kripto-folyam (`RecoveryKeyModal`), fórum, naptár-esemény létrehozás, csoportos-hívás soundboard/stage panelek, audit log, widget-ek - ugyanaz a minta, `t(...)` + kulcs a locale-ba, fokozatosan.
- [x] **Megjelenés-beállítások** (új `lib/displayPrefs.ts` + `lib/customCss.ts`, Felhasználói beállítások → "Megjelenés"): tömör üzenetsűrűség (`data-density` + CSS), betűméret-csúszka (80–140%), **fejlesztői mód** (ID-másolás az üzenet-toolbaron és a profil-popoveren), **egyéni CSS** (élő `<style>` a `<head>`-ben, eszköz-lokális textarea). Mind boot-kor alkalmazódik.
- [x] **Design továbbfejlesztés** - (1) violet paletta + motion-rendszer (első kör); (2) aktív szoba-sávnál brand-színű bal jelző; (3) **lebegő panelek**: a három oszlop kerekített kártya sötét háttéren, résekkel (nem edge-to-edge, mint a Discord). Fejetlen böngészőben, `test1`/`test2` seed-adattal (space + szobák + üzenetek) végigscreenshotolva - az értesítő-menü és a többi popover rendben renderel a `overflow-hidden` kártyában. **Menet közben talált + javított hiba:** a Timeline minden üzenetcsoportnál újra kirakta a „Ma" nap-elválasztót (a nap-címkét egy olyan csoportból olvasta vissza, ami csak váltáskor tárolja) - most külön követve, egy „Ma" van felül. **Screenshot-tooling:** `/tmp/jkshot/cdp.mjs` (dep-nélküli CDP driver Node beépített WebSocket-tel, perzisztens Chrome-profil).
- [ ] **Több szerver-beállítás** (Discord-szintű, admin oldal) - verification level, welcome screen, vanity URL, moderációs alapok. Még nincs.

## Tizedik önálló kör - jobbklikk-menük + hiányzó Matrix-funkciók (a felhasználó kérésére: "lehessen jobb klikkelni szobákra és muteolni azokat, megnyitni beállításait stb" + "ha van olyan dolog amit a matrix támogat de mi még nem csináltunk")

- [x] **Újrahasználható context-menü infra** (`apps/web/src/components/ContextMenu.tsx`) - `useContextMenu()` hook + `MenuPanel` (React-portál a `document.body`-ba, `useLayoutEffect` viewport-clamp, almenük `onMouseEnter`-re, kattintáson/Esc/scroll/resize/blur zár). `MenuItem` típus: `label`, `icon`, `onClick`, `danger`, `disabled`, `checked` (pipa), `separator`, `submenu`.
- [x] **Szoba jobbklikk-menü** (`RoomSidebar.tsx` `useRoomMenu()`) - Megjelölés olvasottként (letiltva, ha nincs olvasatlan; `markRoomRead` a `unread.ts`-ben, `setRoomReadMarkers` publikus+privát nyugtával), Értesítések almenü (minden/csak említések/némítva - `setRoomNotificationMode`), Kedvenc / Alacsony prioritás (pipás kapcsoló, `m.tag`), Meghívás, Szoba beállításai, ID másolása (dev mód), Kilépés a szobából (megerősítéssel). Bekötve mind a 4 szöveges-csatorna sorra + a DM sorokra. Screenshottal ellenőrizve (`/tmp/jkshot/31-roommenu.png`).
- [x] **Space / mappa jobbklikk-menü** (`SpaceRail.tsx`) - space: Összes megjelölése olvasottként (`markSpaceRead`), Szerver beállításai (ha `canManageSpaceSettings`), Meghívás, ID másolása (dev), Kilépés a szerverről; mappa: Átnevezés, Mappa színe almenü (6 szín + Nincs, `setFolderColor`), Felbontás. Screenshottal ellenőrizve (`32-spacemenu.png`).
- [x] **Üzenet jobbklikk-menü** (`MessageLine.tsx` `useMessageMenu()`) - a hover-toolbar műveletei (reagálás almenü, válasz, válasz szálban, továbbítás, kitűzés) + amire a toolbaron nincs hely: Szöveg másolása, Üzenet-hivatkozás másolása (matrix.to), Azonosító másolása (dev). Szerkesztés/Törlés a saját üzeneteknél, Jelentés a többinél. Screenshottal ellenőrizve (`40-msgmenu.png`).
- [x] **Tag jobbklikk-menü** (új `apps/web/src/components/memberMenu.tsx` `useMemberMenu()`) - a profil-popover műveletei natív menüben: Privát üzenet, Ellenőrzés (E2EE), Barátnak jelölés / Barát eltávolítása, Felhasználó letiltása/feloldása, Szerepkörök almenü (pipás, ha `canManageRoles`), Kirúgás / Kitiltás a szobából (ha a jogosultsági szint engedi), ID másolása (dev). Bekötve a tag-listába ÉS a timeline üzenet-szerzőkbe (avatar + név). Screenshottal ellenőrizve (`41-membermenu.png`).
- [x] **Jelszóváltoztatás** (hiányzó Matrix-alapfunkció) - `changePassword` a `profile.ts`-ben (`client.setPassword`, a jelenlegi jelszó mint UIA `m.login.password` stage), `ChangePasswordSection.tsx` a Felhasználói beállításokban (jelenlegi/új/megerősítés mezők + "más eszközök kiléptetése" jelölő, alapból BE).
- **Hátra a köz-audit maradékából** (tudatosan, l. a 225-232. sor indoklását): mobil push (infra kell), vendég-hozzáférés (nem illik a modellhez), szoba-frissítés/tombstone (niche, visszavonhatatlan).

## Tizenegyedik önálló kör - i18n folytatás + kinézet-presetek + context-menü bugfix (a felhasználó kérésére: "folytasd az i18n migrációt", "adhatnánk egy beállítást ilyen kinézet presetekre", "van még olyan dolog amit tudna a matrix, de mi nem")

- [x] **Context-menü bugfix (regresszió)** - a jobbklikk-menü gombjai "nem csináltak semmit": a kívül-kattintás figyelő `pointerdown`-ra futott (ami a `click` ELŐTT tüzel), így a menüelem lenyomása bezárta a menüt (kifűzve a gombot a DOM-ból), mielőtt az `onClick` lefutott volna. Javítva: a `pointerdown`/`scroll` figyelő figyelmen kívül hagyja a `[data-context-menu]`-n belülről jövő eseményeket.
- [x] **Görgőkattintás = említés** - egy üzenet szerzőjére (avatar/név) vagy egy tag-lista sorra középső egérgombbal kattintva beszúrja a `@említést` a szövegmezőbe (új `uiStore.pendingMention` csatorna, a composer effekttel fogyasztja).
- [x] **Kinézet-presetek** (`themeStore.ts` + `index.css` + `UserSettingsModal`): (1) **akcentszín** - 8 márkaszín (`data-accent`, csak `--color-brand/-hover/-link`); (2) **felület** - 4 semleges tónus (`data-surface`, `--color-bg-*` átszínezés, világos/sötétre külön hangolva: grafit/pala/obszidián-OLED/mokka); (3) **8 egy kattintásos preset** (`THEME_PRESETS` + `applyPreset`), ami téma+akcent+felület hármast állít (Ametiszt éj, Kékróka, Éjfél, Erdő, Naplemente, Óceán, Nappal, Homok). Mind localStorage, boot-kor alkalmazódik. Screenshotokkal ellenőrizve.
- [x] **"Megjelölés olvasatlanként"** (MSC2867 `m.marked_unread`) - `isRoomMarkedUnread`/`setRoomMarkedUnread` a `unread.ts`-ben (a stabil `m.marked_unread` ÉS az Element-kompatibilis `com.famedly.marked_unread` szoba-account-data). Szoba-context-menüben a "Megjelölés olvasottként" mellett; a sidebar olvasatlan-pötty + félkövér cím figyeli; szoba megnyitása / "olvasottként" törli.
- [x] **Room settings: `m.room.history_visibility`** (előző körből, `historyVisibility.ts`) - kiválasztó a csatlakozási szabály mellett: az új tagok visszaolvashatják-e a csatlakozásuk előtti üzeneteket.
- [x] **i18n migráció** - `VerificationOverlay` (teljes SAS/QR ellenőrzés-folyam, `verify.*` 32 kulcs), `GroupCallScreen` (mini-sáv, stage, soundboard, hangbeállítás panel; `call.*` +14), `RecoveryKeyModal` (`crypto.*` +16), `UserProfilePopover` + `memberMenu` + `MessageLine` toolbar/context-menü (`profile.*` 22, `msgMenu.*` 25), `CallHistoryModal` (`callHistory.*` 9), `SearchPanel` (`search.*` 15), `ChangePasswordSection`. **~445 kulcs, hu/en 1:1.** Hátra: `RoomSettingsModal` (~1300 sor, a legnagyobb), `SpaceRolesModal`, `ReactionRoleModal`, `ThreePidSection`, fórum, naptár, widget-ek, audit log, több kisebb - a fallback mindenütt működik.

## Tizenkettedik önálló kör - moderáció, szálak/keresés, szoba-frissítés, privát csatornák + 10 design-ötlet

- [x] **Tag-moderáció a jobbklikk-menüben** - új `userTimeout.ts` (`setUserTimeout`/`clearUserTimeout`/`getUserTimeout`/`canTimeOut` + watcher, ami visszaadja a jogszintet lejáratkor); a timeout a tagot -1-es power levelre viszi (olvashat, de nem küldhet) + `io.jorkonvo.timeout` state event. `TIMEOUT_PRESETS`: 60mp/5p/10p/1ó/1nap/1hét. A `memberMenu` mostantól: **Jogosultsági szint** almenü (Tulajdonos/Admin/Moderátor/Tag, `canSetMemberPowerLevel` szerint) + **Timeout** almenü (vagy "Feloldás", ha aktív).
- [x] **"Leave room" eltávolítva a space-csatornáknál** - a tagság (mit lát a user) a space-adminok döntése; DM-eknél/önálló szobáknál marad.
- [x] **Keresés-lapozás** - `search.ts` `SearchResultPage {hits, count, raw}`; `searchMore()` a `backPaginateRoomEventsSearch`-öt csomagolja; "Több betöltése" gomb.
- [x] **Szálak lista panel** - `getRoomThreads()` (minden szál a szobában, legutóbbi aktivitás szerint), új `ThreadsListPanel` (jobb oldali panel, fejléc-gomb), kattintásra megnyílik a `ThreadPanel`.
- [x] **Szoba-verzió frissítés** (`roomUpgrade.ts`, `m.room.tombstone`) - `getRoomVersion`/`getRoomTombstone`/`canUpgradeRoom`/`getRecommendedRoomVersion`/`upgradeRoom` (ez utóbbi újra-meghívja az összes tagot az új szobába). RoomSettings-ben "Szoba verzió" szekció: piros figyelmeztetés + "Megértettem" jelölő + `window.confirm`. ChatArea tombstone-banner "Ugrás az új szobába" gombbal. **Nincs élesben tesztelve** (valódi új szobát hozna létre).
- [x] **Szerepkör-alapú ("privát") csatornák** (`channelAccess.ts`) - `io.jorkonvo.channel_access` state event: `mode: "open" | "restricted"` + `role_ids`. A "restricted" join_rule-t `invite`-re állítja, és a `watchChannelAccess` watcher szinkronban tartja a tagságot a szerepkör-hozzárendelésekkel (megkapja a meghívót, akinek van engedélyezett szerepköre vagy admin; kikerül, aki elveszti az utolsót). A space-gyerek meghívók automatikusan elfogadódnak (`maybeAutoJoinSpaceChild`), így a privát csatorna egyszerűen "megjelenik". RoomSettings: "Ki láthatja ezt a csatornát" szekció (nyílt / kiválasztott szerepkörök chip-választóval). **Nincs élesben tesztelve** (valódi tagokat hívna/rúgna).
- [x] **10 design-ötlet** (a felhasználó kérésére "mind mehet"): (1) téma-gyorsváltó gomb a rail alján; (2) sarok-stílus preset (éles/alap/lekerekített, `data-corners` + `:where()` CSS, a `rounded-full` érintetlen); (3) személyes chat-háttérkép (`chatWallpaper.ts`, lokális kép → downscale-elt data URL + sötétítés-csúszka); (4) space-fejléc banner a csatorna-sidebarban (space-avatar hero-képként); (5) gazdagabb válasz-idézet (szerepkör-színes bal csík + név a szerepkör színében, kattintható); (6) i18n-elt animált gépelés-jelző; (7) "Ugrás az olvasatlanokhoz" lebegő pill a timeline-ban; (8) kódblokk-fejléc (nyelv-címke + másolás gomb); (9) illusztrált üres állapotok; (10) 3-fokozatú üzenet-sűrűség (tömör/kényelmes/tágas).
- [x] **i18n** - `VerificationOverlay`, `GroupCallScreen`, `RecoveryKeyModal`, `UserProfilePopover`, `memberMenu`, `MessageLine` toolbar+menü, `CallHistoryModal`, `SearchPanel`, `TypingIndicator`, `Timeline` (részleg), `ChangePasswordSection`. **~501 kulcs, hu/en 1:1.** Hátra: `RoomSettingsModal` nagy része (~1300 sor), `SpaceRolesModal`, `ReactionRoleModal`, `ThreePidSection`, fórum, naptár, widgetek, audit log, kisebbek.

## Tizenharmadik önálló kör - vendég-hozzáférés, szerver-emoji, emoji-bugfix, context-menü + rail bugfixek

- [x] **Context-menü almenü pozíció bugfix** - az almenük a szülő panel DOM-jába voltak ágyazva; a szülő `animate-scale-in` (CSS transform) miatt a `position: fixed` gyerek a transzformált szülőhöz igazodott → random / képernyőn kívüli hely. Most minden panel (az almenük is) portállal a `<body>`-ba renderel; az almenü a szülő sor jobb oldalára nyílik, balra fordul ha nem fér ki, függőlegesen a viewporthoz clampel.
- [x] **Custom emoji bugfix** (szobákban törött volt) - a `mxcUrlToHttp` legacy `/_matrix/media/v3/thumbnail` URL-t adott, ami authenticated-media szerveren (MSC3916) 404, és `<img src>` nem tud Bearer tokent küldeni. Új `<AuthedImg>` (blob URL a `useAuthedMedia`-n át) + `EmoticonImg` a `MessageBody`-ban; a mention-autocomplete és az emoji-kezelő is ezt használja. Betöltés közben / hibánál `:rövidkód:` szöveg.
- [x] **Szerver-szintű (space) custom emoji** - `roomEmoji.ts`: `getSpaceEmojis`/`addSpaceEmoji`/`removeSpaceEmoji`/`canManageSpaceEmojis` (az `im.ponies.room_emotes` pack a space szobán) + `getAvailableEmojis(client, room)` ami összefésüli a csatorna saját + az owning space packját. A `MessageComposer` autocomplete + a küldéskori `:kód:` helyettesítés is ezt használja. Új közös `<EmojiPackManager targetId scope>` komponens, a RoomSettings (csatorna) ÉS a SpaceSettings (új "Szerver emojik" szekció) is ezt használja. **Élesben ellenőrizve** (API-n át feltöltött space-emoji renderelése).
- [x] **Font-scale + space-rail bugfix** - a font-méret növelése nagyítja a rem-es rail-gombokat, de az Avatar fix px doboz volt → a brand hover-szín kilátszott körülötte. Új `Avatar fill` prop (100%-ra nyúlik). A sarok-preset CSS most a `.jk-space-rail`-t teljesen kihagyja és nem nyúl a `rounded-2xl`/`3xl`-hez.
- [x] **Vendég-hozzáférés (opció)** - `guestAccess.ts`: `getGuestAccess`/`setGuestAccess` (`m.room.guest_access`, bekapcsoláskor a history-t is `world_readable`-re nyitja) / `canManageGuestAccess` + `registerGuest()` (`/register?kind=guest`, tiszta hibaüzenet ha a szerver tiltja). `authStore.guestLogin` (eldobható guest session, `guest:true` a StoredSession-ön, crypto kihagyva). LoginScreen "Folytatás vendégként" link; MainLayout brand-sáv vendég-módban "bejelentkezés / regisztráció" gombbal. RoomSettings "Vendégek engedélyezése" kapcsoló. **A szerveren jelenleg `allow_guest_access: false`** (Synapse config), ezért csak a "Guest access is disabled" hibáig tesztelhető - a felhasználó teendője a szerver-config.

## Tizennegyedik önálló kör - space banner, emoji picker + autocomplete, kategória-hozzáférés

- [x] **Space banner (külön változtatható)** - `spaceSettings` `banner_url` mező + `getSpaceBannerMxc` (dedikált banner → space-avatar → null), `setSpaceBanner`/`clearSpaceBanner`. A csatorna-sidebar fejléc a dedikált bannert preferálja. SpaceSettings "Szerver banner" szekció (előnézet + választás / vissza az ikonhoz).
- [x] **Rich emoji picker** - új `unicodeEmoji.ts` (~450 emoji Discord-stílusú rövidkóddal, csoportosítva, kereshető). `EmojiPicker` átírva: keresőmező, 8 kategória-szekció, "Egyéni" szekció (a szoba + space `im.ponies` pack `AuthedImg`-gel). `onPick` mostantól Unicode char VAGY custom `{shortcode, mxcUrl}`.
- [x] **`:emoji:` autocomplete Unicode emojival** - a composer `:` triggere most a Unicode emojikat is kínálja (nem csak a customot); a beírt `:név:` ami Unicode emojira illik, küldéskor lecserélődik (a custom rövidkód nyer ütközéskor). Új emoji-gomb a composerben.
- [x] **Custom emoji reakció** - a reakció-pill a custom emoji reakciót képként rendereli.
- [x] **Kategória-szintű csatorna-hozzáférés** - `applyCategoryAccess` (egy hozzáférés-beállítást ráállít a kategória MINDEN csatornájára - Discord "sync to channels") + `getCategoryAccess`. Kategória-fejlécen jobbklikk → "Ki láthatja ezt a csatornát" almenü (Mindenki / szerepkörök togglezhető); az alkalmazás kaszkádol a csatornákra. Az átnevezés/törlés is ebbe a menübe került.

### Nyílt döntések (a felhasználó később dönt)
- [x] **Electron → Tauri migráció** - MEGTÖRTÉNT (l. a Discord parity sprint kör). `apps/desktop` mostantól tisztán Tauri (`src-tauri/`), nincs benne Electron; a Discord-RPC szerver is átkerült Rustba (`src-tauri/src/discord_rpc.rs`). Ez a bejegyzés a migráció ELŐTTI mérlegelést dokumentálta - meghagyva a döntés indoklásának, de a "nyílt döntés" már lezárva.

### Fázis 9 – Csomagolás (részben előkészítve)
- [x] Production web build működik (`apps/web` → `dist/`), Electron ezt tölti be `file://`-n keresztül - **élesben tesztelve**
- [ ] Electron build (Windows/Mac/Linux) – **code signing-hoz emberi beavatkozás kell (Apple/Windows cert)**. Megjegyzés: az `electron-winstaller` install script-jét az npm blokkolta (`npm install-scripts approve electron-winstaller` kellhet Windows installerhez).
- [x] Capacitor Android - **legenerálva ÉS ténylegesen lefordítva** a tizennyolcadik körben (branch `feat/round-18`). Ezen a gépen korábban semmilyen Android tooling nem volt - a session maga telepítette (`sudo pacman -S jdk17-openjdk jdk21-openjdk`, Android cmdline-tools + platform-tools + platform 35 + build-tools 35 `sdkmanager`-rel, `@capacitor/android` npm-mel), majd `npm run cap:add:android` + `./gradlew assembleDebug` - **valódi, futtatható debug APK** jött ki a végén (`aapt dump badging`-gel ellenőrizve: helyes csomagnév `dev.szabotar.jorkonvo`, helyes jogosultságok). Útközbeni hibák és javításuk: jdk17 nem volt elég friss (AGP `--release 21`-et kért, jdk21 megoldotta), a Gradle asset-tömörítő lépése pedig a rendszer `/tmp`-be akart írni, ami ebben a sandboxban nem írható - `-Djava.io.tmpdir` egy írható scratch mappára állítva megoldotta (ez környezeti sajátosság, nem a repo hibája). A generált `AndroidManifest.xml`-hez hozzáadva a hívásokhoz ténylegesen szükséges jogosultságok (`CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`) - a Capacitor saját `BridgeWebChromeClient` forráskódjából megerősítve, hogy ezeket már eleve helyesen hidalja át valós Android futásidejű engedély-kérdésre, csak a manifest-deklaráció hiányzott. Képernyőmegosztáshoz (`FOREGROUND_SERVICE_MEDIA_PROJECTION`) szándékosan NINCS deklarálva - az egy valódi MediaProjection-alapú foreground service-t igényelne, amit semmi nem implementál még, a jogosultság megléte önmagában nem hozná működésbe. Az `android/` mappa mostantól git-be véve (a gyökér `.gitignore`-ból kivéve a blanket kizárást), mert van benne kézzel szerkesztett natív fájl (a manifest), amit egy puszta `cap add android` újrafuttatás nem reprodukálna; a Capacitor saját, `android/`-on belüli `.gitignore`-ja helyesen kizárja a build-kimeneteket/local.properties-t/másolt web-assetet.
  - **Emberi teendő, ami MARADT**: valódi eszközön/emulátoron tesztelés (ez a sandbox nem tud kijelzőt/KVM-et adni, csak azt tudtam ellenőrizni, hogy lefordul és a jogosultságok helyesek - hogy a hívás UI ténylegesen kér-e kamera/mikrofon engedélyt élesben, azt nem), egyedi app-ikon/branding (a Capacitor generikus alapértelmezettje van most, ezt korábban is emberi döntésnek jelöltük), release keystore + aláírt release build, Play Store adatlap/feltöltés.
- [ ] Capacitor iOS build – **Apple Developer account, Xcode, macOS kell hozzá - ezen a Linux gépen nem elérhető, emberi beavatkozás**
- [ ] Bundle-méret optimalizálás: a `matrix-sdk-crypto-wasm` ~7.8MB, a fő JS bundle ~1.1MB - érdemes lenne code-splittelni (dinamikus import a crypto initre), de működésképtelenséget nem okoz

## Amihez emberi beavatkozás kell (a végére hagyva)
- ~~Capacitor Android natív projekt legenerálása~~ - megoldva a tizennyolcadik körben, l. Fázis 9. Az iOS oldal továbbra is emberi teendő: `cd apps/web && npm run cap:add:ios` (Xcode + macOS szükséges hozzá, ez a gép Linux).
- Apple Developer Program regisztráció + code signing (iOS + Mac notarization)
- Android keystore létrehozása és aláírás
- Valós eszközön / szimulátoron tesztelés (iOS/Android)
- Végleges appnév, ikon, branding döntések
- GitHub (vagy más) remote repo létrehozása és push
- ~~Element Call / csoportos hívás backend kiválasztása~~ - megoldva: a szerver LiveKit-et hirdet, a csoportos hívás ezt használja, élesben tesztelve (lásd Fázis 7)
- ~~**A megadott recovery key elutasítása**~~ - a valódi bug beazonosítva és javítva a nyolcadik körben (l. "utólagos javítások"): NEM a kulcs volt rossz (a felhasználó megerősítette, Element webben megy), hanem a `getSecretStorageKey` crypto callback rossz objektumra lett regisztrálva ("No getSecretStorageKey callback supplied"). Javítva: `installSecretStorageKeyCallback` helyben mutálja a `client.secretStorage.callbacks`-et is. A felhasználó valós fiókján még ellenőrizendő.
- **Email/telefon meghívás (identity server)** - tudatosan KIHAGYVA (nem csak elhalasztva félreértésből). Két különálló ok: (1) `matrix.szabotar.dev` `.well-known/matrix/client`-je egyáltalán NEM hirdet `m.identity_server`-t - a teszt-szerveren nincs mihez kapcsolódni, tehát a funkció ezen a környezeten VÉGIG nem lenne élesben tesztelhető; (2) a matrix-js-sdk `inviteByThreePid`-je egy VALÓDI, harmadik féltől származó identity szerver felé küld kérést (jellemzően a matrix.org publikus IS-e, `IIdentityServerProvider` regisztrációval + feltételek elfogadásával + egy tényleges, névre szóló e-mail/SMS kiküldésével a megadott címre) - ez egy nehezen visszavonható, kifelé irányuló művelet egy olyan külső szolgáltatás felé, amit ez a session nem üzemeltet, és a felhasználó eddigi engedélye kifejezetten a SAJÁT teszt-fiókjain belüli tesztüzenetekre vonatkozott, nem harmadik fél infrastruktúrájának éles igénybevételére. Emiatt ugyanabba a kategóriába került, mint a Capacitor natív buildek - dokumentált, tudatos kihagyás, nem hiányzó munka.
- **[ÜTEMEZVE - a felhasználó holnap csinálja] QR-kódos bejelentkezés: Matrix Authentication Service (MAS) beállítása** - a kliens-oldal kész (`packages/matrix-core/qrLogin.ts` MSC4108, `isSignInWithQRAvailable` guarddal), de a `matrix.szabotar.dev` (Synapse 1.142.1) jelenleg semmilyen OIDC-t nem hirdet (`msc4108: false`, nincs `auth_issuer`/`auth_metadata`, `msc3882: false`). Teendők a szerveren:
  1. **MAS telepítése** külön szolgáltatásként (Rust + saját Postgres), saját hostnév (pl. `auth.szabotar.dev`) + DNS + TLS. Docs: `github.com/element-hq/matrix-authentication-service`.
  2. **Migráció**: `mas-cli syn2mas --dry-run` majd `mas-cli syn2mas` - átviszi a usereket, access tokeneket, eszközöket; a meglévő sessionök megmaradnak.
  3. **Synapse `homeserver.yaml`**: `experimental_features.msc3861` (enabled, issuer, client_id, client_secret, admin_token). Ezután a Synapse automatikusan kiszolgálja az `auth_issuer`/`auth_metadata` végpontokat.
  4. **Reverse proxy** (a MAS docs ad snippeteket) - OAuth végpontok + `.../msc2965/*` a MAS-hoz.
  5. **MAS policy**: engedélyezni a **Dynamic Client Registration**-t (a JorKonvo `OAuth2.registerClient`-tel regisztrál; az alap policy elutasíthat `contacts` nélküli / localhost URI-jú klienseket - fejlesztéshez lazítani) és a **Device Authorization Grant**-ot (`device_code`).
  - **Kliens-oldali hiány, amit még meg kell írni utána**: automatikus OAuth token-refresh (`StoredSession.refreshToken` már megvan, de semmi sem használja - a QR-session tokene lejár egyszer és újra-login kell). Ez külön, nagyobb meló.
  - **Figyelmeztetés**: MAS után minden kliens az OIDC flow-ra vált (a MAS kompat-rétege tartja életben a jelszavas `/login`-t a régi klienseknek). Egyirányú váltás - staging másolaton kell először kipróbálni.

## Teszt Matrix szerver
- Homeserver: `matrix.szabotar.dev`
- Teszt felhasználók: `thatumi` és `teszt` (utóbbit a felhasználó hozta létre menet közben, hogy két valós fiókkal lehessen tesztelni a hívásokat és egyéb két-résztvevős funkciókat)
- A szerver `org.matrix.msc4143.rtc_foci`-t hirdet LiveKit-tel (`rtc-jwt.szabotar.dev`) - ezt használja a csoportos hívás funkció (lásd Fázis 7), élesben igazoltan működik.
- A szoba szobái alapból titkosítottak (E2EE) - ezért a Fázis 6 egy részét előre kellett hozni.

## Állapot (utolsó frissítés: a fejlesztés első munkamenete során)
Elkészült és valós szerveren, valós böngészőben (Playwright-tal automatizálva)
leellenőrzött: login → session mentés/visszaállítás → E2EE inicializálás →
space/szoba lista → szoba/space létrehozás és beállítások → timeline
megjelenítés → titkosított üzenet küldése és dekódolása →
reakció (gyors + teljes picker)/válasz/szerkesztés/törlés → gépelés-jelzés →
olvasási visszaigazolás → kép/fájl feltöltés (titkosítva) és megjelenítés →
link előnézet → titkosított-szoba lakat ikon → felhasználói profil
szerkesztése (név + kép) → szoba/DM keresés → nyilvános szoba/felhasználó
könyvtár keresés → szálak (thread panel, válaszküldés, összegző pill) →
desktop értesítések (smoke-tesztelve) → **1:1 hang/videó hívás + csoportos
hívás LiveKit-en keresztül, mindkettő KÉT VALÓS FIÓKKAL, valódi kétirányú
médiafolyammal igazolva**. Ez egy szélesen működő, Discord-szerű alapréteg,
ami mostanra a Discord-funkciók nagy részét (beleértve a hívásokat és
képernyőmegosztást is) lefedi.

**Ezt a munkamenetet folytatva hozzáadva** (mind élesben tesztelve, mind a
két valós fiókkal, ahol kettő szükséges): kitűzött üzenetek, moderáció
(kirúgás/kitiltás + jogosultsági szint / szerepkör-szerkesztő), markdown-lite
formázás (bold/italic/code/strike/spoiler) + @mention autocomplete safe HTML
renderelővel, szlash parancsok (`/me /shrug /nick /topic /invite /kick /ban
/unban /part /help`), Ctrl+K gyorsváltó, szoba némítás (szerver-oldali push
rule), üzenetkeresés (szerver-oldali `/search` + E2EE-tudatos helyi
tartalék), sötét/világos/rendszer téma-váltó, szoba-kép feltöltés. Emellett
két, a korábbi funkciókat is érintő, valódi hibát talált és javított a
tesztelés: (1) power-level módosítás engedélyezési logikája nem egyezett a
szerver tényleges (szigorúbb) szabályával, (2) **a szerver MSC3916
hitelesített media-t kényszerít ki, ami a régi `/media/v3` URL-eket
használó AVATAR KÉPEKET néma-törötten hagyta az egész alkalmazásban** -
ez utóbbi egy `Avatar.tsx`-ben központosított javítással megoldva, hívási
helyek módosítása nélkül.

**Ugyanezt a munkamenetet tovább folytatva, a felhasználó kifejezett kérésére
("még mik azok a funkciók, amit nem csináltunk meg?" → "csinald ameddig csak
tudod")** hozzáadva: **állandó (Discord-stílusú) hangcsatornák** (saját
könnyű "ki van bent" jelenlét-mechanizmus szerver-komponens nélkül, két valós
fiókkal élesben igazolt kétirányú médiafolyammal), `@room` tömeges említés,
felhasználói profil popover (kattintható avatar/név mindenhol) + egyedi
státusz üzenet, felhasználó letiltása (ignore/block, üzenet-szűréssel),
eszköz-/munkamenet-kezelés (a valódi, hosszú múltú fiókon élesben ellenőrizve,
de a destruktív kijelentkeztetés szándékosan nem próbálva ki egy valós
session ellen sem), üzenet-továbbítás (szöveg ÉS titkosított média is,
másik szobába/DM-be), meghívó link (matrix.to) + QR kód. Ez a szakasz is
talált és javított egy valódi, korábbról öröklődő hibát: a `canKick`/`canBan`
sosem hasonlította össze ténylegesen a cselekvő és a célpont jogosultsági
szintjét (a matrix-js-sdk `hasSufficientPowerLevelFor` segédfüggvényének
félreértéséből eredően) - ez a profil popover kirúgás/kitiltás gombjainak
tesztelése közben derült ki és lett javítva.

**Negyedik önálló körben** (a részletek a Fázis 8-ban) hozzáadva: szobánkénti
értesítési mód (minden üzenet/csak említések/némítás, szerver-oldali push
rule-okkal) + értesítési kulcsszavak, Discord-stílusú olvasatlan-jelzők
(pötty/jelvény/"Új" elválasztó, kliens-oldali E2EE-tudatos számlálással),
kódblokkok szintaxis-kiemeléssel, automatikus visszalapozás görgetéskor, és
automatikus távollét (auto-away) jelenlét. Ez a kör aránytalanul sok, mélyen
rejtett, alapvető SDK/protokoll-szintű hibát talált és javított - a
legsúlyosabb egy React StrictMode miatti DUPLA kliens-boot volt, ami
valószínűleg a session korábbi részében megfigyelt, addig jóindulatúnak
vélt OTK-verseny hibák egy részét is okozta anélkül, hogy felismerésre
került volna.

Talált és javított hibák a fejlesztés közben:
- `authStore.restore()` törölte a mentett munkamenetet BÁRMILYEN hiba esetén
  (nemcsak érvénytelen token esetén) - ez feleslegesen új eszközt hozott
  volna létre minden átmeneti hálózati hibánál. Javítva: csak valódi auth
  hibánál (401/M_UNKNOWN_TOKEN/stb.) törli, egyébként egy "próbáld újra"
  képernyőt mutat a munkamenet megtartásával.
- Read receipt küldése helyi echo (még nem szerver-visszaigazolt, "~" prefixű
  ID-jú) eseményre 400-as hibát adott. Javítva.
- Az emoji picker popover a message toolbar alá volt beágyazva, ezért a
  Timeline `overflow-y-auto`-ja levágta, ha az üzenet a görgetett terület
  tetejéhez közel volt (csak az utolsó csoport látszott). Javítva: React
  portál a `document.body`-ba, viewport-tudatos pozicionálással (fent/lent
  automatikus váltás, vízszintes clamp).
- A szálak (threads) első verziója a matrix-js-sdk `Room.getThread()`/
  `Thread` osztályára támaszkodott, ami a szerver-oldali `m.relations`
  bundling-jától függ - ez `matrix.szabotar.dev`-en nem működött
  megbízhatóan, így az elküldött szál-válaszok a fő timeline-ban jelentek
  meg, de sosem kerültek be a thread objektumba. Javítva: saját, manuális
  aggregáció (`getThreadReplies`) ugyanazzal a mintával, mint a reakcióknál
  - a szoba live timeline-ját szkenneli `m.thread` reláció szerint, ami
  helyi echo-kra és szinkronizált eseményekre is egyformán működik.
- Meghívó elfogadásakor (`acceptInvite`) a csatlakozó fél saját `m.direct`
  account data-ja nem frissült, ezért egy elfogadott DM meghívó nála a
  "Szobák" alatt jelent meg "Üzenetek" helyett (a meghívó küldőjénél
  helyesen "Üzenetek" alatt volt). Javítva: csatlakozáskor ellenőrzi a
  meghívó `is_direct` jelzőjét, és ha igaz, felveszi a szobát a saját
  `m.direct` térképébe is. Két valós fiókkal tesztelve közben találtuk meg.
- A hívás-képernyő vezérlő sávja (mikrofon/kamera/screenshare/lerakás)
  kicsúszott a látható területről, amikor egy nagy távoli videó csempe
  jelent meg, mert a flex oszlop elrendezésből hiányzott a `min-h-0` -
  a videó natív mérete megakadályozta, hogy a flex elem zsugorodjon a
  vezérlőknek helyet adva. Javítva minden beágyazási szinten, két valós
  fiókkal újra ellenőrizve.

A korábban említett, bejelentkezés utáni 404-es kérés beazonosítva: a
matrix-js-sdk saját belső capability-detektálása
(`GET /_matrix/client/unstable/org.matrix.msc4143/rtc/transports`) - az SDK
automatikusan próbálja észlelni a csoportos hívás (MSC4143 RTC session)
támogatást a szerveren. A `matrix.szabotar.dev` a `.well-known`-ban hirdet
LiveKit-alapú `rtc_foci`-t, de ezt a konkrét unstable végpontot nem
implementálja, így az SDK próbálkozása 404-et kap és csendben, hiba nélkül
lefut tovább. Nem a JorKonvo kódjából jön, nincs funkcionális hatása, és
csak a Fázis 7 (hívások) témájához kapcsolódik.

**Fontos tanulság a teszteléshez**: a `matrix.szabotar.dev` szerver szigorú
login rate-limitet alkalmaz (fiókonként, burst-alapú, akár ~4 perces
várakozással jár túllépés esetén), és minden jelszavas bejelentkezés ÚJ
eszközt (device) hoz létre a fiókon. Éles teszteléskor mindig egy állandó
(persistent) böngésző-profilt kell újrahasználni a munkamenet
megőrzéséhez, nem szabad minden teszthez friss böngésző-kontextust
indítani.

**Kitűzött üzenetek + moderáció (kick/ban) tesztelése**: mindkét funkció
élesben ellenőrizve. A moderáció teszteléséhez fontos volt egy valódi 2 fős
szobát választani - a `memberListOpen` UI-állapot alapértelmezetten `true`,
tehát a tagok panel a szoba megnyitásakor magától látszik; ha a "Tagok"
fejléc-gombra rákattintunk, az BEZÁRJA (toggle), ez elsőre tesztelési
zsákutcának tűnt (üres/hiányzó panel), de valójában helyes viselkedés volt.

## Tizenötödik önálló kör - bugfixek + a nagy ötletlista hátralévő fele (a felhasználó kérésére: "folytasd, ezeket fejezd be" + friss hibajelentések, majd "tobbit is csinald meg olyan sorban ahogy jonak latod emberi beavatkozás nwlkul")

Ez a kör két részből állt: előbb a felhasználó saját tesztelése közben
talált friss hibák/kérések, utána - kifejezett engedéllyel - a korábban
jóváhagyott, de még el nem kezdett nagy funkciók (onboarding, mobil nézet,
timeline teljesítmény, watch2gether), emberi visszakérdezés nélkül.

**Hibajavítások és kisebb kérések:**
- [x] **"Zöld csíkos" kép-tömörítési hiba** - két külön, éles fejetlen Chrome
  session-ben (szintetikus sáv-teszt ÉS egy valódi 1.3 MB-os fotó a teljes
  tömörítés→titkosítás→feltöltés→dekódolás→megjelenítés láncon át) sem
  sikerült reprodukálni magát a hibát, ami arra utal, hogy a Chromium
  GPU-gyorsított canvas-visszaolvasásának egy ismert hibaosztályáról van szó
  (nem szoftveresen renderelt/fejetlen böngészőben jelentkezik). Javítás:
  `imageCompression.ts` a canvas 2D kontextust `willReadFrequently: true`
  paranccsal kéri (CPU-hátterű felületre kényszeríti a böngészőt), plusz a
  `resolveAttachmentUrl` mostantól a dekódolt blob-nak átadja a valódi
  MIME-típust ahelyett, hogy a böngésző content-sniffingjére hagyatkozna.
- [x] **Üres jobbklikk-menü magamra kattintva** - a `memberMenu.tsx` a
  sajátmagam-ágban fejlesztői mód nélkül üres tömböt adott vissza. Mostantól
  mindig van "ID másolása", és ha van space-em, egy gyorsgomb a
  szerver-profilomhoz (`spaceSettings.myProfile`).
- [x] **Composer ikonsor összevonása** - a poll/esemény/matrica/GIF/hely
  ikonok egy új "+" felugró menü mögé kerültek (`useContextMenu`
  újrahasználva); csak a fájlcsatolás, a "+" és az emoji marad látható
  alapból. A textarea `items-end` helyett `items-center`-re váltott, mert a
  szöveg nem volt függőlegesen középre igazítva az ikonokhoz képest.
- [x] **E2EE előnyök/hátrányok szoba-létrehozáskor** - a titkosítás
  jelölőnégyzet alatt rövid magyarázat a keresési/előzmény-korlátról és
  hogy csak egyirányban kapcsolható (ki→be, vissza nem).
- [x] **Szoba-verzió frissítés bármely elérhető verzióra** - eddig csak a
  szerver ajánlott verziója volt választható. `getAvailableRoomVersions`
  (a homeserver `m.room_versions.available` térképéből) + legördülő a
  `RoomSettingsModal`-ban (stabil/nem-stabil jelölve, ajánlott kiemelve).
- [x] **Szobák húzogatása a sidebar-ban** - a `categories.ts` egy új `order`
  mezőt kapott (a space összes csatornájának megjelenítési sorrendje);
  `moveRoomTo` a húzás célja szerint kategóriát is vált és sorrendet is
  módosít. HTML5 natív drag-and-drop a `ChannelRow`-kon + kategória-
  fejléceken. Élesben, fejetlen Chrome-ban szintetikus `DragEvent`-ekkel
  igazolva: kategóriába húzás ÉS listán belüli átrendezés is valódi Matrix
  state eventen át ment át és túlélte az oldal újratöltését.

**A korábban jóváhagyott, elhalasztott nagy funkciók:**
- [x] **Szoba/space onboarding** - új `packages/matrix-core/src/onboarding.ts`
  (state event a space-en: szabályzat, üdvözlő üzenet, önválasztható
  szerepkörök) + `OnboardingGate.tsx` (kétlépéses felugró: szabályzat +
  elfogadás + szerepkör-választás, majd üdvözlő üzenet), amit a
  `MainLayout` mutat meg minden space-nél, amíg az adott fiók (saját
  account data, `io.jorkonvo.onboarding_seen`) még nem "látta". Az
  önválasztható szerepkörök egy valódi Matrix-korlátba ütköznek: a
  szerepkör-lista EGYETLEN state event minden tagra, nincs per-user
  írásjogosultság - tehát "engedd magadnak választani" ugyanaz a jog, mint
  "írd át az egész listát". Ezért ez a jog csak admin által, kifejezetten
  (soha automatikusan) kapcsolható be egy figyelmeztetéssel együtt.
  Élesben végigtesztelve: bekapcsolás → szabályzat mentése → kilépés a
  szobából és vissza → felugrik a kapu → elfogadás → üdvözlő lépés →
  belépés → újratöltés után már nem jön elő újra.
- [x] **Mobil-reszponzív elrendezés** - a három-oszlopos elrendezésnek eddig
  egyáltalán nem volt keskeny-nézet kezelése. `useIsMobile` (media query
  hook) + a `md` töréspont alatt a `MainLayout` egyszerre csak EGY panelt
  mutat (szerver-sáv + csatornalista, VAGY a teljes chat), vissza-nyíllal a
  `ChatArea` fejlécén (`selectRoom(null)`, ami a Barátok/Események/Beérkező
  nézeteket is bezárja). A szál-/keresés-/tagok-panel mobilon teljes-
  képernyős rétegként jelenik meg a saját meglévő bezáró gombjukkal, a
  háromoszlopos elrendezés érintetlen desktopon. CDP eszköz-emulációval
  (390×844) igazolva mindkét irányban.
- [x] **Timeline "virtualizáció"** - egy valódi magasság-mérő virtualizáló
  (pl. react-virtual) helyett, mivel az üzenet-magasságok szélsőségesen
  változóak (kép/szavazás/szál/beágyazás) és a görgetés-rögzítés/
  ugrás-üzenetre/olvasatlan-elválasztó mind közvetlen DOM-lekérdezésre
  épül: a renderelt DOM csak egy ablakot mutat a betöltött üzenetekből
  (alapból az utolsó 60 csoport), felfelé görgetve ablakonként +60-at tár
  fel INGYEN (nincs hálózati kérés), és csak ha ez elfogy, akkor jön a
  valódi lapozás a szerverről. Üzenetre-ugráskor (keresési találat,
  említés) az ablak ideiglenesen mindent megjelenít, hogy a célpont
  tényleg a DOM-ban legyen.
- [x] **Watch2gether (közös YouTube-nézés)** - `watchTogether.ts` (state
  event: videó id, házigazda, lejátszás állapot, pozíció, időbélyeg) +
  `WatchTogetherBar.tsx` (valódi YouTube IFrame Player API betöltve és
  vezérelve). A composer "+" menüjéből indítható; a házigazda lejátszás/
  szünet/tekerés műveletei felülírják a state eventet, minden más kliens
  ehhez igazítja a saját lejátszóját, és lejátszás közben 5 másodpercenként
  korrigálja az eltolódást (a state event csak egy pillanatnyi állapotot
  rögzít, a közben eltelt valós időt hozzá kell számolni). Élesben
  igazolva: valódi videó betöltve és lejátszva, a session túlélte az
  oldal-újratöltést, "leállítás mindenkinek" törölte mindenkinél. A
  többfelhasználós szinkron (két valódi kliens egyszerre) ebben a körben
  csak kód-átolvasással lett átnézve, nem két külön munkamenettel élesben.

## Tizenhatodik önálló kör - felhasználói 14 pontos lista + biztonsági önátvizsgálat (a felhasználó éjszakai kérésére, "dolgozz emberi beavatkozás nélkül", branch `feat/ux-round-16`)
Mind a 14 pont kész, egyenként build+typecheck+oxlint(baseline 50, nincs új)+i18n-paritás (1261 kulcs) ellenőrizve, 8 commitban:
1. **Deep-link regisztráció/bejelentkezés** - `LoginScreen.tsx` `?server=&token=` URL paramétereket olvas be (majd eltünteti a címsorból), előtölti a homeservert és a regisztrációs tokent, automatikusan a Regisztráció fülre vált. "Regisztrációs link másolása" gomb generálja ugyanezt visszafelé.
2. **Regisztráció** - `packages/matrix-core/registration.ts`: `probeRegistration`/`registerAccount` a szerver saját UIA (`m.login.dummy`/`registration_token`/`terms`) folyamatát vezérli közvetlenül; **élesben ellenőrizve valós helyi Synapse ellen**. A Regisztráció fül élőben lekérdezi, engedélyez-e regisztrációt a beírt szerver, és kér-e tokent.
3. **Dark/light/system váltó a login/register képernyőn** - `ThemeQuickToggle`, + az app alapértelmezett témapreferenciája "dark"-ról "system"-re változott.
4. **BUG: fehér villanás sötét módban** - `index.html`-be egy szinkron inline szkript került, ami a `data-theme`-et és a háttérszínt már az első festés ELŐTT beállítja (a korábbi `initTheme()` csak egy `useEffect`-ben, a mountolás UTÁN futott).
5. **Szerepkör-szerkesztő saját fülre** - a különálló `SpaceRolesModal` most `SpaceRolesContent`-ként a `SpaceSettingsModal` egyik füle (`SettingsModalShell` új `activePaneId`/`onPaneChange` prop-okkal, hogy egy fül másik fülre tudjon váltani).
6. **MINDEN natív alert/confirm/prompt lecserélve** - saját `DialogHost`/`lib/dialogs.ts` (uiAlert/uiConfirm/uiPrompt), ~28 hívási hely az egész appban. **⚠️ round 19-ben kiderült: a `DialogHost` sosem lett bemountolva → minden ilyen hívás csendben függött. Javítva, l. a 19. kört.**
7. **Meghívó link elérhetősége** - "Meghívó link másolása" gomb közvetlenül a szoba/space jobbklikk-menüben (eddig csak a Beállítások > Meghívók fülön volt).
8. **Keresés/szál panel animáció** - desktopon `display:contents`-ről valódi flexre + `animate-slide-in-right`-ra váltva (mobilon már volt animáció).
9. **Hívás gyors-beállítások** - mikrofon/kamera/képernyőmegosztás gombokon Discord-stílusú kis "caret" jelvény, ami fókuszált popovert nyit (eszközválasztó, mic volume, zajszűrés, PTT / kamera eszköz / megosztás minőség) a nagy, mindent-egyben "hívás beállítások" fogaskerék helyett.
10. **Képernyőmegosztás minőség** - `lib/screenShareSettings.ts`, livekit-client `ScreenSharePresets` alapján (720p/1080p × 15/30fps + eredeti), élő váltásnál újraindítja a megosztást.
11. **Akadálymentesség bővítve + élő előnézet** - Discord-stílusú alkategóriák (szövegolvashatóság, vizuális sűrűség, szín és kontraszt, csökkentett mozgás, hang és képernyőolvasó), valódi új funkciókkal: sortávolság, linkek mindig aláhúzva, magas kontraszt, mindig látható fókuszkeret, új üzenetek bemondása képernyőolvasónak (`lib/srAnnouncer.ts`, a `NotificationManager` már meglévő helyes "ez tényleg új üzenet" logikáját újrahasznosítva). `AccessibilityPreview.tsx` élő minta-üzenet kártya a fül tetején. **Tudatosan KIHAGYVA**: szín-tévesztés "szimulációs" szűrő - az ilyen szűrő azt mutatja meg, mit látna egy színtévesztő ember, NEM segíti magát a színtévesztőt (ahhoz a fordított, kompenzáló transzformáció kellene, amit ez a kör nem tudott volna kellő biztonsággal ellenőrizni).
12. **Saját (személyes) egyéni emoji** - `packages/matrix-core/personalEmoji.ts` (account data alapú, mint friends.ts), bármely szobában használható; `spaceSettings.ts` új `allow_personal_emoji` kapcsolóval egy szerver ki tudja kapcsolni a sajátjaira. Felhasználói beállítások új "Saját emojik" fül.
13. **Emoji választó csoportosítva forrás szerint** - `RoomEmoji` most `sourceId`/`sourceName`-t is hordoz, az Emoji választó "Egyéni" füle ez alapján csoportosítja (korábban egy nagy, forrás nélküli rácsba volt öntve minden csatlakozott szoba emojija).
14. **BUG: csatorna drag&drop nincs vizuális visszajelzés** - a drop-cél korábban csak egy `ref`-ben élt (nem váltott ki újrarenderelést); most `state`-be is tükrözve, és egy lila vonal (`ChannelDropLine`, ugyanaz a minta mint a Space drag&dropnál) mutatja pontosan hova kerülne a csatorna.

**Biztonsági önátvizsgálat** (a felhasználó kérésére, "mehet... security audit", ha van idő): átnézve a `dangerouslySetInnerHTML` (1 hely, `highlight.js` saját escape-elt kimenete - biztonságos), `eval`/`new Function` (nincs), `innerHTML =` (nincs), és minden `target="_blank"` link (mind rendelkezik `rel="noreferrer"`/`noopener`-rel - reverse tabnabbing ellen véve). Nem talált új, ebben a körben bevitt sebezhetőséget. A rendszer-szintű "hardening" (CSP fejlécek, Electron/Tauri webPreferences audit stb.) továbbra is a lenti TODO listán marad, a felhasználó korábbi kifejezett kérése szerint.

## Tizenhetedik önálló kör - biztonsági keményítés (branch `feat/hardening-round-17`)
A fenti TODO lista "Biztonsági keményítés" pontja alatt dokumentálva részletesen (CSP mindenhol, deploy secret jogosultságok + egy valós titok-szivárgási rés javítása, `cargo audit` - 0 sebezhetőség). L. ott a teljes leírást.

## Tizennyolcadik önálló kör - 4 saját ötlet + Android build (a felhasználó kérésére: "igen ez a 4 darab ötleted mehet. Meg aztán az android appot is elkezdheted", branch `feat/round-18`)
1. **Fiók törlése + adatexport** - `packages/matrix-core/accountDeletion.ts` (UIA jelszó-megerősítéses deaktiválás, ugyanaz a minta mint a devices.ts eszköztörlésnél) + `dataExport.ts` ("töltsd le az adataid" JSON: profil, eszközök, szoba-tagságok, MINDEN account-data típus amit a kliens szinkronizált - nem kézzel karbantartott lista, hanem az SDK saját account-data store-jából olvasva). Üzenet-előzmény szándékosan kihagyva (más nagyságrendű probléma, l. automod.ts/slowmode.ts hasonló becsületes-scope döntései).
2. **E2EE ellenőrzöttség-jelvények** - `verification.ts` új `isUserVerified`/`watchUserTrustChanges`, kis pajzs-ikon a taglistán és a profil popoveren, csak akkor látszik, ha EZ az eszköz ténylegesen ellenőrizte a másik felet, élőben frissül.
3. **Synapse rate limit** - explicit `rc_registration`/`rc_login` (regisztráció + bejelentkezés, mert ezek a MOST hozzáadott funkciók nyitják meg a szervert a visszaélésnek); `rc_message`/`rc_joins` szándékosan Synapse alapértékein hagyva. **Élesben ellenőrizve**: Synapse elfogadta és tisztán újraindult, és ismételt rossz jelszavas próbálkozás ténylegesen HTTP 429-et kapott a beállított burst után.
4. **Health-check endpoint** - a Caddy-ban Synapse saját `/health` végpontja eddig a catch-all `handle` blokk miatt soha nem volt ténylegesen elérve (egy monitor mindig 200-at kapott volna, MÉG HA Synapse le is állt) - saját `handle`-t kapott, élesben ellenőrizve. README "Monitoring" szekció a Synapse `/health` és a LiveKit saját health-válaszáról (coturn HTTP-n nem ellenőrizhető, UDP/TCP TURN only).
5. **Android build** - l. Fázis 9, ez volt a kör nagy tétele: nulláról feltelepítve minden Android tooling (JDK 17+21, Android SDK cmdline-tools/platformok/build-tools, `@capacitor/android`), és **ténylegesen lefordítva egy valódi debug APK-t** (`./gradlew assembleDebug`, `aapt`-vel ellenőrizve). A manifesthez hozzáadva a hívásokhoz ténylegesen kellő jogosultságok (kamera/mikrofon/audio/notification), a képernyőmegosztáshoz szükséges (de nem implementált) jogosultság szándékosan kihagyva. `android/` mostantól git-be véve.

### TODO - tudatosan elhalasztva (a felhasználó kifejezett kérésére: "Hardeninget és bérlős cuccot, web pusht tedd todo-ra")
- [x] **Web push értesítések** - MEGVAN (round 19), l. lent a
  "Tizenkilencedik önálló kör" alatt a részletes bejegyzést.
- [x] **Biztonsági keményítés (hardening)** - a tizenhetedik körben (branch
  `feat/hardening-round-17`) nagyrészt elvégezve:
  - CSP: Tauri `security.csp` korábban explicit `null` (teljesen kikapcsolva)
    volt - most valós, ehhez az apphoz szabott policy (`cargo check`-kel
    ellenőrizve, a Tauri saját dokumentált `ipc:`/`http://ipc.localhost`
    példájával összevetve). Caddy: minden domainen alap keményítő fejléc
    (HSTS, X-Content-Type-Options, Referrer-Policy, rejtett Server fejléc)
    + a JorKonvo webapp saját domainjén teljes CSP + X-Frame-Options -
    élesben ellenőrizve (`caddy validate` + valós reload + curl a helyi
    teszt-stack ellen).
  - Electron/Tauri `webPreferences`-audit: a Tauri `capabilities/default.json`
    már eleve minimális volt (nincs fs/shell/http jogosultság), a
    `main.rs` navigáció-védelme (`on_navigation`/`is_safe_external_url`)
    már eleve helyesen zárja a webview-t a saját origin-jére - nem talált
    hiányosságot, csak megerősítette.
  - XSS-átvizsgálás: `dangerouslySetInnerHTML` az egész appban EGYETLEN
    helyen van (kódblokk-kiemelés, `highlight.js` saját escape-elt
    kimenete - biztonságos), az egyéni CSS (`customCss.ts`) eleve csak
    eszköz-lokális, sosem szinkronizálódik más userekhez.
  - `deploy/` titok-kezelés: `.env` + minden renderelt config fájl most
    `chmod 600`, a FOGYASZTÓ konténer tényleges belső UID-jére chown-olva
    (991 Synapse, 65534 coturn, 65532 MAS - `docker top`-pal ellenőrizve
    valós futó konténereken, nem csak image-dokumentáció alapján). Eközben
    két valódi hibát is talált és javított (tényleges 3x egymás utáni
    lefuttatással, nem csak olvasással): egy könyvtár-szintű chown
    kizárta a host usert a saját re-run-jából, egy plain overwrite pedig
    a második futtatáskor tört el. **Emellett egy valós titok-szivárgási
    rést is talált**: a `deploy/livekit.yaml` git-TRACKELT fájl volt, amit
    a `provision.sh` a helyén renderel át (a valódi LIVEKIT_API_SECRET-tel)
    - átnevezve `livekit.yaml.template`-re, a kimenet gitignore-olva,
    ugyanúgy mint a többi confignál.
  - Docker hálózat-izoláció: átnézve, már eleve rendben (Postgres nincs
    portmappelve a hosztra, csak a belső docker hálózaton érhető el).
  - `cargo audit` (utólag telepítve, `cargo install cargo-audit`) - **0
    valódi sebezhetőség** 643 crate között. 13 "warning" szintű találat
    (elavult/karbantartatlan crate-ek + 2 unsoundness-jelzés szűk, itt nem
    használt API-felületen), MIND a Tauri saját `feat/cef` branch-ének
    tranzitív függősége (a `muda` natív menü-könyvtár régi GTK3-kötései,
    egy build-idejű CSS-selector lánc régi `rand`-ja) - nem ez a repo adta
    hozzá, és mivel már Tauri egy nem-kiadott branch-én vagyunk, nincs
    egyszerű verzió-bump ami eltüntetné; érdemes újra futtatni, ha a Tauri
    branch frissül.
  - **Még nyitva**: a Capacitor natív buildek biztonsági átvizsgálása (még
    nincs legenerálva natív projekt, l. lent).
- [ ] **Szerver-bérlés további munkája** - a `deploy/` alap-stack (Fázis
  "Szerver-bérlés" fent) MÁR elkészült egy korábbi körben (Docker Compose +
  Terraform + `RENTAL.md`), de a tényleges SaaS-réteg (ügyfél-portál,
  számlázás, flotta-szintű üzemeltetés/monitorozás, több-bérlős
  elkülönítés egy géptömbön) továbbra sem készült el - ez tudatosan
  elhalasztott, önálló termék-méretű munka, nem ebben a körben esedékes.

## Tizenkilencedik önálló kör - automata teszt-alapozás (a felhasználó éjszakai kérésére: "profi, deploy-ready" szoftver, teszt-csomag mint fundamentum)

A repo eddig NULLA automata tesztet tartalmazott - minden ellenőrzés kézi
Playwright volt élő szerver ellen. Ez a kör lerakja az alapot.

### Node 20+ a build-géphez
A `rolldown-vite` (Vite 8) Node `^20.19 || >=22.12`-t követel; a gép Node
18-on volt. Megoldás emberi beavatkozás nélkül: hivatalos Node 22.14
binary `~/.local/node20/`-ba kicsomagolva, `~/.local/bin`-be szimlinkelve (ez már
`PATH`-ban van a `.profile`-ból). `npm@11`-re is frissítve, hogy a
`package-lock.json` `libc` mezői ne essenek ki minden `npm install`-nál.

### Vitest egység-teszt harness (`vitest.config.ts`, `test/unit/**`)
- `npm test` → `vitest run`. 97 teszt, ~1.8 s, se böngésző, se homeserver,
  teljesen determinisztikus.
- `test/helpers/fakes.ts`: kézzel írt `FakeRoom` / `FakeClient` - a
  framework-független `matrix-core` helperek csak a `currentState`
  state-event olvasót + pár gettert és a `sendStateEvent`-et érintik, egy
  valódi fake olvashatóbb mint az egész SDK `vi.mock`-olása.
- Lefedve: `formatting` (markdown→HTML, mention/mass-mention payload, fence
  izoláció, XSS-escape), `commands` (slash-parancs parse + dispatch),
  `permissions` (client-tier engedély-öröklés, power-level implikáció),
  `roles` (olvasók + minden state-író: create/rename/delete/move),
  `slowmode`, `automod` (kulcsszó/wildcard/regex/link-szűrő + ReDoS-védelem),
  `inviteLinks` (matrix.to alias/via), `registration` (UIA flow, mockolt
  fetch), `dataExport` (mockolt kliens), `unicodeEmoji`, `mxc`/`initials`,
  `customCss` (jsdom + localStorage).
- **Talált, dokumentált apró hiba** (nem javítva, hogy a teszt-PR tiszta
  maradjon): `buildFormattedContent` - ha egy rövidebb megjelenített név
  szigorú prefixe egy hosszabbnak (pl. "Jo" vs "Jordan"), a rövidebb userId
  is bekerül az `m.mentions.user_ids`-be (ártalmatlan túl-értesítés, a
  látható pill helyes). A `formatting.test.ts` explicit megjegyzéssel rögzíti.

### CI (`.forgejo/workflows/ci.yml`)
- `build-and-test` job: `npm ci && npm run build && npm run lint && npm test`
  egy `node:20-bookworm` konténerben.
- külön `e2e` job (`vars.RUN_E2E == 'true'` mögött), ami a `e2e/` throwaway
  Synapse-t hozza fel Playwright-hoz.
- **Emberi beavatkozás kell**: nincs regisztrált Forgejo Actions runner a
  `git.szabotar.dev`-en, a workflow addig nem fut le. L. `.hub/status.json`.

### Playwright E2E (`e2e/`) - KÉSZ (első kör)
- Dedikált **eldobható** Synapse `docker compose`-zal (`e2e/scripts/up.sh` /
  `down.sh`), minden futáskor nullázva. A rate-limiterek 1000/s-re állítva
  (nem a perzisztens-profil trükk kell, mert a szerver eldobható); a
  `registerUser()` a Synapse admin shared-secret végpontján megy át (gyors,
  sosem rate-limitelt, sosem érinti a tesztelt folyamatot).
- **Caddy TLS-front** a Synapse előtt: az app csak `https://` homeservert
  hív (a prod CSP tiltja a sima `http:`-t), így a teszt a valódi prod
  CSP-t gyakorolja; Playwright `ignoreHTTPSErrors`.
- `npm run test:e2e`. 6 teszt, ~25 s friss stacken:
  - `login.spec` - jelszavas login eléri az appot; rossz jelszó
    elutasítva; app-on belüli regisztráció működik; session túléli a reloadot
  - `messaging.spec` - két user **E2EE** üzenetváltása (meghívás → belépés
    → küldés → dekódolás, mindkét irányban)
  - `spaces.spec` - space + csatorna létrehozás, csatorna túléli a reloadot
  - `settings.spec` - megváltoztatott beállítás túléli a hard reloadot
- ~20 `data-testid` hozzáadva a kulcs-interaktív elemekhez (login form,
  composer, szoba-sorok, space-rail, create-modálok, beállítás-panel).
  Mellékesen `role="dialog"`/`aria-modal`/`aria-pressed` is a modálokra +
  toggle-gombokra (valódi a11y javítás).
- **Talált ÉS javítva** (külön commit): a round-18 FOUC-megelőző inline
  `<script>` az `index.html`-ben a saját CSP-je (`script-src 'self'
  'wasm-unsafe-eval'`, se `'unsafe-inline'`, se hash) **blokkolta** prod
  buildben és Tauri-ban - a villanás-megelőző kód sosem futott le élesben.
  Javítás: a `vite.config.ts` cspPlugin most kiszámolja minden inline
  `<script>` sha256-ját és beteszi a `script-src`-be; ugyanaz a hash
  bekerült a `tauri.conf.json`-ba és a `deploy/caddy/Caddyfile`-ba is
  (mindhárom CSP külön kényszerül). Regresszió-őr: `csp-inline-script.test.ts`
  (unit, ellenőrzi a hash-szinkront) + `e2e/tests/csp.spec.ts` (0 CSP-sértés
  betöltéskor, és a pre-paint script tényleg lefut).
- **Még nem fedve** (TODO): kulcs-verifikáció (SAS), 1:1 / csoport hívás,
  képernyőmegosztás, moderációs műveletek, QR login, szerepkör-kiosztás
  végponttól-végpontig - kéteszközös / valódi média / hiányzó testid kell.

### Hardening: npm audit + XSS-átvizsgálás
- **npm audit**: `vitest` v2→v3 frissítés kitisztította a 6 dev-függőségi
  találatot (vitest→vite→esbuild lánc; egyik sem a shippelt bundle-ben,
  csak a dev-szerverben). Maradt 3 "moderate" a `@capacitor/cli → xcode →
  uuid` láncban - kizárólag iOS-projekt-generáló dev-eszköz (iOS nincs is
  legenerálva), nincs shippelt artefaktban, `npm audit fix --force` egy
  @capacitor/cli downgrade-et akarna (8.5→8.4.3, verzió-ütközés a core-ral)
  - tudatosan hagyva, ugyanaz a mérlegelés mint a cargo audit warningoknál.
- **XSS-átvizsgálás minden user-tartalom render-útra**:
  - `MessageBody.tsx` (más kliensek `formatted_body`-ja) - saját allowlist-
    alapú DOM-bejáró, nincs `dangerouslySetInnerHTML` a kód-kiemelésen
    kívül (highlight.js saját escape-elt kimenete, textContent bemenet).
    `<img>` nincs az allowlistán (csak `data-mx-emoticon` + `mxc://`),
    `javascript:`/`data:` href → sima span, ismeretlen tag attribútumai
    eldobva, `MAX_DEPTH=48` a rosszindulatú mély beágyazás ellen.
    **Új regresszió-tesztek**: `test/unit/web/messageBody.test.tsx` (8 eset:
    `<script>`, `<img onerror>`, `javascript:` link, mély beágyazás, stb.).
  - `RichEmbed.tsx` - szigorú per-provider allowlist, az `iframe` `src`-t
    maga építi a kiparszolt ID-ből, sosem a user nyers URL-jéből.
  - `LinkPreview.tsx` - `url` regexből (`https?://`), cím/leírás React-text,
    kép `AuthedImg` (saját homeserver).
  - `customCss.ts` - eszköz-lokális (`localStorage`), sosem szinkronizál -
    legrosszabb eset a saját CSS-ed a saját gépeden.
  - Sehol nincs nyers `innerHTML` / `eval` / `document.write` / `new Function`
    (grep az egész `apps/web/src` + `packages/matrix-core/src`-en).

### Teljesítmény: a crypto-wasm + QR-login lehasítva a fő bundle-ról
- **Diagnózis**: a `qrLogin.ts` a `matrix-core` barrelből (`index.ts`)
  eagerly exportálva volt, ő pedig statikusan húzza a matrix-js-sdk MSC4108
  rendezvous-osztályait, amik statikusan importálják a ~7.8 MB
  `matrix-sdk-crypto-wasm` glue-t. Így a teljes crypto-glue + rendezvous +
  OAuth kód a fő bundle-be került - a bejelentkezés-előtti login képernyő
  kritikus útjára.
- **Javítás**: `qrLogin` kikerült a barrelből, külön `"@jorkonvo/matrix-core/qr"`
  subpath-export lett belőle (`packages/matrix-core/package.json` `exports`),
  és a két fogyasztó store (`qrLoginStore`, `authStore`) most `await
  import("@jorkonvo/matrix-core/qr")`-rel, akción belül tölti be.
- **Eredmény**: a fő `index-*.js` **2 867 kB → 1 984 kB** (gzip **802 →
  555 kB**), ~883 kB / ~247 kB gzip megtakarítás. A crypto-wasm glue külön
  chunk, csak `initRustCrypto`-nál (login után) VAGY QR-szkenneléskor
  töltődik; a 7.8 MB `.wasm` binary sosem a hidegindítás útján.
- **Regresszió-őr**: `e2e/tests/bundle.spec.ts` - a login képernyő sosem
  tölti le a crypto wasm-ot.

### `deploy/` stack: egy-parancsos bring-up
- `deploy/webapp/Dockerfile` - a webappot a repóból buildeli (context =
  repo-gyökér), semmi bérlő-specifikus nincs beégetve (a homeserver URL-t a
  login képernyőn adja meg a user). `docker compose --profile webapp up -d
  --build`. **Helyben tesztelve**: image épül, `/` + mély SPA-útvonal +
  asset mind 200.
- `.dockerignore` hozzáadva (a build-context karcsúsítására) - **közben egy
  valódi hibát is javított**: a `packages/matrix-core/tsconfig.tsbuildinfo`
  (a tsconfig mellett, nem a `dist/`-ben) bekerült volna a Docker
  contextbe, egy elavult buildinfo pedig `tsc -b`-t rávette volna, hogy
  KIHAGYJA a matrix-core rebuildjét → `@jorkonvo/matrix-core` nem resolve-ol
  → a webapp build elhasal. `*.tsbuildinfo` most dockerignore-olva.
- Healthcheck + `depends_on: service_healthy` a `synapse-admin` / `mas` /
  `lk-jwt` / `webapp` szolgáltatásokra; a Caddy most a `synapse` healthy
  állapotát várja.
- `deploy/scripts/smoke-test.sh` - scratch `.env`-be provisionál, felhozza
  a Postgres+Synapse magot, és ellenőrzi hogy a Synapse a VALÓDI prod
  `homeserver.yaml.template`-lel elindul Postgres ellen + válaszol a
  `/health`, `/_matrix/client/versions`, `/login` végpontokon, majd
  magától lebont. **Sikeresen lefut.** (Caddy/ACME + LiveKit + coturn valós
  DNS-t / publikus IP-t igényel, azt lokálisan nem lehet.)
- `deploy/DEPLOY.md` - pontos friss-VPS lépéssor (DNS-tábla, portok,
  provision, up, első admin, opcionális profilok, backup, upgrade,
  hibaelhárítás).

### Web push értesítések (task 4)
- `services/push-gateway/` - ~200 soros, Sygnal-kompatibilis Matrix Push
  Gateway (`POST /_matrix/push/v1/notify`), Web Push-ra (VAPID / RFC 8291)
  továbbít a `web-push` libbel. Állapotmentes, nincs DB. Dockerizálva
  (`Dockerfile` + `docker-compose.yml` + `.env.example`), `npm run gen-vapid`
  kulcsgeneráláshoz, **6 `node --test` teszt** (fake push-service),
  bekötve a CI `build-and-test` jobba.
- `apps/web/public/sw.js` - service worker: `push` → `showNotification` +
  `setAppBadge`, `notificationclick` → app fókusz / szoba megnyitás. Csak
  háttér-push, semmi asset-cache.
- `apps/web/src/lib/webPush.ts` - SW regisztráció + `pushManager.subscribe` +
  Matrix HTTP pusher regisztráció/törlés (`client.setPusher`, Sygnal
  webpush `data` alak, `format: "event_id_only"` - alapból tartalom nélkül).
  Csak akkor él, ha a build két env-je (`VITE_VAPID_PUBLIC_KEY`,
  `VITE_PUSH_GATEWAY_URL`) be van állítva.
- `WebPushToggle.tsx` - önálló kapcsoló a Beállítások → Értesítések alatt
  (`settings-webpush-toggle`), hu+en. Gateway nélkül nem is jelenik meg.
- **Amit a felhasználónak be kell állítania a matrix.szabotar.dev-en**:
  `services/push-gateway/README.md` "What the operator sets up" - röviden:
  a gateway TLS mögé egy domainre (`push.szabotar.dev`), saját VAPID
  kulcspár (privát a gateway env, publikus a `VITE_VAPID_PUBLIC_KEY`),
  `apps/web` újrabuild. **Synapse `homeserver.yaml` NEM változik.**

### Talált + javított shippelt hiba: DialogHost sosem volt bekötve
A `DialogHost` (round 16, a natív `alert/confirm/prompt` lecserélése) **soha
nem lett bemountolva** egyetlen commitban sem - `git log -S "<DialogHost"`
üres. Így minden `uiConfirm`/`uiAlert`/`uiPrompt` hívás (kick, ban, szoba
elhagyása, kategória törlése, barát eltávolítása, a "másolva" toast, ~28
hívási hely) csendben, örökre függött. A `moderation.spec.ts` e2e teszt
találta meg. Javítás: `App.tsx` most a gyökérben rendereli
(`<>{screen}<DialogHost /></>`), így kijelentkezve is működik. Regressziót
őrzi a `moderation.spec.ts`.

### Bővített e2e lefedettség (moderáció + szerepkörök)
- `moderation.spec.ts` - szoba-admin jobbklikk egy tagra → context menu →
  "Kick from room" → megerősítő dialógus → a tag eltűnik mindkét kliensről.
- `roles.spec.ts` - a hibrid jogosultság-modell végponttól-végpontig: Alice
  space-t hoz létre, Bobot meghívja, Szerepkörök → "Moderator" létrehozás →
  "Kick Members" pipa → hozzárendelés Bobhoz → a teszt közvetlenül a
  Synapse `m.room.power_levels` state event-jéből olvassa, hogy Bob szintje
  tényleg 50-re emelkedett (`computeRequiredPowerLevel` →
  `syncMemberPowerLevelFromRoles` → `setMemberPowerLevel` mind lefutott).
- `moderation.test.ts` unit - 15 eset (`canKick`/`canBan`/
  `canSetMemberPowerLevel` a szigorú `>` power-level szabállyal /
  `canRedactOthers`/`canInviteToRoom`/`describePowerLevel`).
- `i18n-parity.test.ts` - hu/en kulcs-paritás + `{placeholder}` egyezés
  kikényszerítve (eddig kézzel tartva; most teszt őrzi).

### Round 19 összesen
13 commit main-en. 127 unit + 10 e2e + 6 push-gateway teszt, mind zöld.
2 valódi shippelt hiba megtalálva+javítva (CSP inline-script konfliktus;
DialogHost bekötetlensége). `npm run build` + `npm test` a commit-kapu.

## Huszadik önálló kör - Discord-minőség: QR login 2. irány, e2e bővítés, CI, polish (a felhasználó éjszakai kérésére: "Discord-minőségű, deploy-ready termék", emberi beavatkozás nélkül)

### QR login - a hiányzó második irány bekötve
Eddig csak egy irány volt: az ÚJ eszköz mutatja a kódot, a MEGLÉVŐ olvassa
be (`startNewDeviceQrLogin` + `startExistingDeviceQrScan`). Most a másik is
él - az Element-féle szokásos folyamat:
- `matrix-core/qrLogin.ts`: `startExistingDeviceQrDisplay()` a matrix-js-sdk
  `linkNewDeviceByGeneratingQR` köré; `startNewDeviceQrScan()` a
  `startExistingDeviceQrScan` tükörképe - ugyanazok a primitívek
  (`MSC4108RendezvousSession` / `MSC4108SecureChannel` /
  `MSC4108SignInWithQR`), de az új-eszköz szerepben (nincs `client`
  átadva), a homeserver nevét a beolvasott Reciprocate-módú kódból veszi.
- `qrLoginStore.ts`: két új slice - `display*` (meglévő eszköz generál +
  reciprocál) és `newScan*` (új eszköz beolvas + bejelentkezik a
  `loginWithQrSession`-nel).
- `QrLoginPanel`: a bejelentkező képernyőn "Kód mutatása" / "Kód beolvasása"
  al-fülek. `ScanQrLoginModal`: "Beolvasás" / "Mutatás" fülek, átnevezve
  "Eszköz összekapcsolása QR kóddal".
- A crypto wasm import dinamikus marad, nem kerül a pre-auth útra (a
  `bundle.spec.ts` őrzi; a `qrLogin` chunk külön 17 kB).

**Élő teszt státusz:** MÉG MINDIG nincs élőben tesztelve. A matrix.szabotar.dev
nem hirdet OAuth2/OIDC `auth_issuer`-t, és a repo egyik stackjében sincs MAS
(matrix-authentication-service). Egy valódi kéteszközös teszt egy
MSC3861-delegált Synapse + MAS ellen a következő lépés - a kód a
dokumentált SDK-kontraktus szerint helyes, de ez a réteg még nem futott
végig igazi accountokkal. Lásd `needs`.

### E2e: ban + unban
`moderation.spec.ts` új eset: Alice a taglistából jobbklikk → "Ban from
room" → megerősítő dialógus; a kitiltás szerveroldalon `membership: "ban"`
lesz és egy közvetlen újracsatlakozás elutasítva; majd Alice a `/unban`
slash-paranccsal feloldja, és Bob újra meghívható. (Nincs önálló unban UI a
kliensben - csak a `/unban` parancs; ez egy rés, lásd lent.)

### CI: az e2e job végre futtatható
Az e2e job egy Docker-CLI nélküli Playwright image-re volt állítva, így az
`./e2e/scripts/up.sh` sosem futhatott le. Javítások:
- A job most `node:22-bookworm` + `docker-ce-cli` + compose plugin a Docker
  apt-repóból + `npx playwright install --with-deps chromium`.
- A `RUN_E2E` repo-változó `true`-ra állítva (Forgejo API), a job a
  `jorbox-runner`-en fut (annak van docker socketje, `--network host`).
- **A bind-mount buktató:** a runner a workspace-t docker volume-ként
  csatolja, nem host útvonalként, így a socketen keresztül indított
  testvér-konténerek nem tudják bind-mountolni a checkoutolt fájlokat
  (`e2e/synapse/`). Megoldás: a teszt-Synapse config + a build-idejű
  signing key most egy pici image-be van sütve (`e2e/synapse/Dockerfile`),
  a compose `build: ./synapse`-t használ - a build context tarként megy a
  daemonnek, nincs bind mount. `up.sh`/`down.sh` egyszerűsödött, a
  gitignore-olt kulcsfájlok eltűntek.
- `up.sh` egyszer újrapróbál a lógó hálózatok pruningolása után, ha a
  megosztott gép bridge-cím-poolja megtelt (a prune az élő stackeket békén
  hagyja).
- **Hálózat-elérés:** a job-konténer a runner saját bridge-hálózatán van, a
  compose `127.0.0.1:18448` a HOST loopbackján - elérhetetlen. A compose
  hálózatnak fix neve van (`jorkonvo-e2e-net`), a job CI-ben csatlakozik rá,
  és a suite a Caddy-t `https://caddy` néven éri el (`E2E_HOMESERVER`). A
  Caddy egy beégetett Caddyfile-lal (`e2e/caddy/`) mindkét névre kiszolgál
  (`localhost` a lokális published porthoz, `caddy` a CI-hez), `tls internal`.
- **Eredmény: az e2e job zöldre fut a `jorbox-runner`-en** (run #22, 6ffc21c).
  12 teszt, build + Playwright böngésző-telepítés + eldobható Synapse mind a
  CI-ben. RUN_E2E=true a repo-változó.

### a11y kör
- **Fókusz-csapda a modálokban:** a `Modal` (közös primitív ~30 modálhoz)
  most Tab/Shift+Tab-ot a dialóguson belül tartja, nyitáskor bemozgatja a
  fókuszt, záráskor visszaadja a triggernek.
- **Landmark régiók:** `SpaceRail` és `RoomSidebar` `<nav aria-label>`, a
  chat-panel `role="main"` + `id`. "Ugrás az üzenetekhez" skip-link a shell
  első fókuszálható eleme, csak fókuszban látszik.
- **Reduced motion a JS-görgetésben:** az explicit `behavior: "smooth"`
  felülírja a CSS `scroll-behavior: auto !important`-ot, így az olvasatlan-
  ugrás és a beállítás-szekció-ugrás görgetése tovább animált. Új
  `prefersReducedMotion()` / `scrollBehavior()` helper (a beállítás-kapcsolót
  ÉS az OS `prefers-reduced-motion`-t is nézi), a hívási helyek használják.

### Kapcsolat-állapot sáv
`ConnectionBanner` - vékony borostyán csík csak akkor, ha a kapcsolat
degradált: a böngésző offline, vagy a Matrix sync hibázik / újrapróbál /
nincs első válasz. Az `authStore` már továbbítja a `ClientEvent.Sync`-et a
`syncTick`-be, plusz `window` online/offline. `role="status"`,
`aria-live="polite"`. E2e: `connection.spec.ts` a Playwright
`context.setOffline`-nal.

### Első-indítás onboarding
`FirstRunWelcome` - egyszer megjelenő (localStorage flag) üdvözlő modal egy
vadonatúj fióknak, amikor 0 csatlakozott szobával ér az appba (egy Matrix
kliens különben egy üres háromoszlopos shellbe dob következő lépés nélkül).
Három gomb meglévő flow-kba: emberkeresés, tér létrehozás, nyilvános terek
böngészése + "körülnézek magam". Egy visszaállított session szobákkal sosem
látja. E2e: `onboarding.spec.ts` (egyszer-megjelenés + perzisztencia); a
`loginAs` helper beállítja a flaget, így a többi spec-et nem zavarja.

### e2e flakiness megfigyelés
A megosztott gépen (több ágens + lokális futtatások) a "várj a szerver
körforgására" jellegű assertek (`roles.spec` power-level poll, `spaces.spec`
reload utáni session-restore) néha 25-45s alatt sem futnak be - futásonként
más teszt. A CI-ben (kevésbé terhelt runner + `retries: 1`) 3 egymás utáni
zöld futás. Ha CI-ben is flakel: emelni a poll-timeoutokat / retry-t.

### Hardening
- `vitest` 3.2.7 → 4.1.11 (GHSA-82fw-gwwq-j7x9 path-traversal a
  `@vitest/mocker`-ben). Config `.mts`-re átnevezve, az elavult
  `esbuild.jsx` opció kivéve (a vitest 4 oxc-vel transzformál). 127 teszt zöld.
- `npm audit` 6 → 3 moderate, mind dev-only (uuid ← xcode ← `@capacitor/cli`,
  iOS-tooling lánc; a javítás egy törő `@capacitor/cli` downgrade - a
  felhasználóra hagyva).
- **Android (round 18 projekt) újraaudit:** a manifest amúgy minimális
  (INTERNET, CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, POST_NOTIFICATIONS,
  mind kommentálva; nincs cleartext, nincs MediaProjection). Egy javítás:
  `android:allowBackup="false"` - a WebView IndexedDB tartja a rust-crypto
  store-t (E2EE eszközkulcsok, cross-signing titkok), az Android auto-backup
  ezt a Google-fiókba másolná; egy E2EE kliensnek új eszközön újra kell
  építenie a bizalmat, nem csendben visszaállítani.
- **Tauri capability audit:** változatlanul minimális - csak
  `core:default` + `core:event:default` + `core:window:allow-set-badge-count`;
  nincs frontend shell/fs/http/opener jog, a külső linkek Rust-oldalon
  (`on_navigation` + `is_safe_external_url`, csak http/https/mailto), a
  navigáció az első originre zárva. CSP tükrözi a webet.

### Ismert rések a "Discord-minőség" rúdhoz (a lista folytatása)
- **Élő QR teszt:** mindkét irány kódban kész, de MAS/OIDC homeserver nélkül
  sosem futott igazi accountokkal. A `deploy/` és az `e2e/` stack sem futtat
  MAS-t. (needs.)
- **Push-gateway éles:** a gateway-konténer önmagában deployolható, de nincs
  `push.szabotar.dev` DNS és nincs hova a webappot buildelni (a gépen nem fut
  JorKonvo web deployment), így a teljes lánc (Beállítások → teszt-értesítés)
  nem igazolható. (needs.)
- SAS kulcs-verifikáció és 1:1 hívás felépülés: nincs e2e.

### Unban UI (a fenti rés lezárva)
A Beállítások → Szoba → Moderáció alá bekerült a "Kitiltott felhasználók"
szekció: listázza a `ban` tagságúakat (id + indok), gombbal feloldható,
bárkinek látszik akinek van ban jogosultsága. A `moderation.spec.ts` most
ezen az UI-n keresztül old fel, nem a `/unban` paranccsal.

## Huszonegyedik kör - mention-ütközés javítás + két új teszt (a felhasználó kérésére, "dolgozz emberi beavatkozás nélkül")

**Fontos jegyzet a session lefolyásáról**: a feladat kiindulási kontextusa
("round 20 kész, e2e zöld CI-ben, 13 teszt") a valósággal egyezett - ez a
munkamenet viszont egy RÉGI, több körrel korábbi lokális checkoutból
indult (a `feat/round-18` branch commitjaira, mielőtt az #1 PR-en át
mainbe kerültek volna), és emiatt először tévesen azt hitte, hogy a main
le van maradva, saját (redundáns/inferior) unit teszt szvitet, CI
workflow-t és RELEASE.md-t épített rá. Amikor `git push` közben kiderült,
hogy az origin/main 34 commit-tal előrébb jár, a session `git fetch` +
`git reset --hard origin/main`-nel visszaállt a valódi állapotra, és csak
azt a két dolgot vitte át, ami tényleg új volt: egy valódi hibajavítást és
két olyan modul tesztjét, amit a meglévő szvit még nem fedett.

- **Mention-név prefix ütközés javítva** (`formatting.ts`) - ha egy
  mention neve egy másik mention nevének szigorú prefixe (pl. "Jo" vs
  "Jordan"), a korábbi, mention-enként szekvenciális `.replace()` a
  rövidebb nevet ÚJRA megpróbálta illeszteni a hosszabb név cseréje által
  ÉPP BEILLESZTETT `<a>` tag BELSEJÉBE - érvénytelen, egymásba ágyazott
  `<a>` tageket és egy hamis, extra `m.mentions.user_ids` bejegyzést
  okozva (tehát a rövidebb nevű felhasználó hamis push-értesítést kapott
  volna egy üzenetről, amiben valójában sosem lett megemlítve). Ez már
  ismert és dokumentált volt a `formatting.test.ts`-ben egy "KNOWN ISSUE"
  komment formájában, tudatosan nyitva hagyva egy jegyzettel: "a fix that
  tightens the match boundary flips this assertion deliberately" - ez az a
  fix. Az egyenkénti csere helyett most egy EGYETLEN, kombinált
  alternáció-regex fut végig az EREDETI szövegen, így minden karakter-
  szakasz csak egyszer illeszkedhet (a leghosszabb név győz, mert a JS
  regex alternáció adott pozícióban sorrendben próbálja az
  alternatívákat, és a lista hossz szerint csökkenő sorrendben van
  rendezve).
- **Két új tesztfájl** olyan tiszta logikára, amit a meglévő szvit még nem
  fedett: `test/unit/core/crypto.test.ts` (`resolveSecretStorageKey` -
  beillesztett helyreállítási kulcs/jelmondat feloldása és validálása a
  fiók secret storage kulcs-infója ellen, mockolt `MatrixClient`-tel) és
  `test/unit/core/unread.test.ts` (`eventHighlightsUser` - a Matrix-
  esemény alapú "engem érint-e ez az üzenet" ellenőrzés: `m.mentions`,
  `@room`, megjelenített név mint egész szó, vagy egy beállított
  kulcsszó). Összesen 143 teszt zöld (127 régi + 16 új/frissített).
- **`.nvmrc` (20) hozzáadva** - ezen a gépen a rendszer Node-ja 26.8.1,
  ami elég új ahhoz, hogy a saját beépített `localStorage` globálisa
  beárnyékolja a Vitest per-fájl jsdom környezetét, és eltörje a
  `test/unit/web/customCss.test.ts`-t (3 hibás teszt) - reprodukálva, és
  megerősítve, hogy `nvm use 20`-ra váltva mind a 143 teszt zöld. A CI már
  eleve `node:20-bookworm`-öt használ, tehát ez csak a lokális fejlesztést
  érintette egy túl új rendszer-Node-dal rendelkező gépen.
- **Teljes ellenőrzés Node 20 alatt**: `npm run build` (matrix-core +
  web), `npm run lint` (csak a meglévő baseline warningok, 0 hiba), `npm
  test` (143/143 zöld), és a teljes Playwright e2e szvit is (13/13 zöld,
  `./e2e/scripts/up.sh` → `npm run test:e2e` → `./e2e/scripts/down.sh`, a
  valódi eldobható Synapse+Caddy stack ellen, lokálisan, ~50s alatt).
- **RELEASE.md hozzáadva**: rövid, tényszerű állapotfelmérés egy első
  kiadáshoz (mi kell a desktop/Android release-hez, mi a nyitott
  blocker) - l. külön a repo gyökerében.

## Huszonkettedik kör - iOS target scaffold (a felhasználó kérésére: "npx cap add ios ... buildelni majd a Codemagic fogja Macen")

Eddig csak Android natív projekt volt (`apps/web/android/`, git-be véve).
Ez a kör legenerálja és git-be veszi az iOS Capacitor projektet is
(`apps/web/ios/`), hogy egy Mac (Codemagic) minden további scaffold-lépés
nélkül tudja fordítani. Semmilyen Mac/Xcode nem kellett hozzá - a
`npx cap add ios` Linuxon is legenerálja az Xcode projektet.

- **`@capacitor/ios@^8.5.1`** hozzáadva az `apps/web` függőségeihez (a
  `@capacitor/core`/`android` már 8.5.x volt).
- **`npx cap add ios` + `npx cap sync ios`** - hiba nélkül lefut. A
  generált projekt SPM-alapú (`App/CapApp-SPM/Package.swift`,
  `capacitor-swift-pm` exact 8.5.1), nincs CocoaPods/Podfile.
- **`apps/web/ios/` git-be véve** (20 fájl), az Android mintájára. A
  `apps/web/ios/.gitignore` (a `cap add` generálja) csak build-
  artifactot zár ki: `App/Pods`, `App/build`, `DerivedData`, `xcuserdata`,
  `App/App/public` (bemásolt web assetek), és a generált
  `capacitor.config.json` / `config.xml`. A projektfájlok
  (`project.pbxproj`, `Info.plist`, a Swift shell, a `Package.swift`)
  trackeltek. A repo-gyökér `.gitignore`-ból a `ios/` sor törölve.
- **`Info.plist` kézzel bővítve** (a Capacitor sosem írja felül `cap
  sync`-nél, ellenőrizve) - az Android "csak amit a kód tényleg használ"
  elvét követve, minden string magyarul, a konkrét funkciót megnevezve:
  - `NSCameraUsageDescription` - QR-login szkenner (`QrScanner.tsx`),
    hívás előtti kamera-ellenőrzés (`CameraPreview.tsx`), videohívás,
    "Fénykép készítése" a csatolmány-választóban.
  - `NSMicrophoneUsageDescription` - hangüzenet-felvétel
    (`VoiceRecorderBar.tsx`), hang-/videohívás.
  - `NSPhotoLibraryUsageDescription` - `<input type="file" accept="image/*">`
    a kép-csatoláshoz és a profil-/tér-/szoba-kép beállításához.
  - `NSLocationWhenInUseUsageDescription` - `navigator.geolocation`
    (`ShareLocationModal.tsx` `getCurrentPosition`, `LiveLocationSharer.tsx`
    + `locationShareStore.ts` `watchPosition`). A `LocationMessage` /
    `LiveLocationCard` csak térkép-URL-re linkel - önmagában nem indokolná.
  - `NSPhotoLibraryAddUsageDescription` **kihagyva** - a médialetöltés
    `<a download>`-ra épül, ami a WKWebView-ban natív kód nélkül nem ment
    a Fotókba; nincs valódi kód-út, ami kérné (mint az Android screen-
    share rés).
  - `ITSAppUsesNonExemptEncryption = false` - export-compliance döntés
    kommenttel indokolva: a JorKonvo E2EE-je kizárólag szabványos, nyílt
    algoritmusokat használ (Curve25519, AES-256, HMAC-SHA256) a
    matrix-rust-sdk-crypto-wasm-on át, saját primitív nincs → EAR Cat. 5
    Part 2 tömegpiaci kivétel, önálló BIS jelentés nem kell. A tulajdonos
    erősítse meg beküldés előtt.
  - `UIBackgroundModes = remote-notification` **tudatosan kihagyva** - a
    natív APNs push sehol nincs bekötve (Androidon sincs:
    `@capacitor/push-notifications` és `google-services.json` hiányzik),
    az App Review pedig elutasítja a háttérmódot, ha semmi nem hív
    `registerForRemoteNotifications`-t. A push plugin bekötésével együtt
    kerül majd be - l. `.hub/status.json` "next". A plain (push nélküli)
    iOS build így működőképes marad.
- **Bundle ID / display name**: a `cap add` már helyesen
  `dev.szabotar.jorkonvo` / "JorKonvo" (`project.pbxproj`
  `PRODUCT_BUNDLE_IDENTIFIER`, `Info.plist` `CFBundleDisplayName`), a
  bundle ID az Apple fejlesztői portálon regisztrálva (Push + App Groups).
- **App ikon / splash**: egyelőre a Capacitor placeholder marad. A
  `@capacitor/assets` generálná mindkét platformra, de (1) nincs 1024px-es
  forrás-ikon (a legnagyobb elérhető az `apps/desktop/.../icon.png`,
  512px, ill. az Android foreground 432px), (2) nincs `sharp`/ImageMagick
  a gépen. Külön lépés, jobb egy rendes 1024px-es masterrel, akár a
  Codemagic pipeline-ban - l. `.hub`.
- **`codemagic.yaml`** hozzáadva a repo gyökeréhez: két workflow.
  `build-unsigned` (Apple-fiók nélkül, `CODE_SIGNING_ALLOWED=NO`,
  minden push/PR-en) igazolja, hogy a scaffold fordul; `ios-release`
  (`ios-v*` tag-re) aláírt IPA + TestFlight, App Store Connect API-kulcs
  integrációval - a tulajdonos állítja be a Codemagic UI-ban. A web +
  Android build/teszt/lint marad a Forgejo CI-ben.
- **GATE**: `npm run build` zöld (matrix-core + web), `npm test` 143/143
  zöld, `npm run lint` csak baseline warningok, `npx cap sync ios` hiba
  nélkül. A Forgejo CI-t nem érinti (nincs benne iOS lépés).

## Huszonharmadik önálló kör - Discord-stílusú automatikus szoba-hozzáférés (a felhasználó kérésére: "csináld meg mindet emberi beavatkozás nélkül... a cél, hogy discord szerűen működjenek a dolgok")

Valódi, két emberrel végzett élő teszt hozott fel egy komoly hiányosságot:
JorKonvo szobái alapból Matrix `invite` join_rule-lal jönnek létre, ami azt
jelenti, hogy egy space TAGSÁGA önmagában NEM ad hozzáférést a space
szobáihoz - mindenkit egyenként kell meghívni minden egyes szobába, még
azokba is, amik a tagság UTÁN jöttek létre. Egy szerver-admin, aki a
Synapse admin API-val kézzel vette fel a usert egy space-hez, azt találta,
hogy a user semmilyen szobát nem lát, és amikor kézzel a szobákhoz is
hozzáadta, még mindig nem fért hozzájuk (`M_FORBIDDEN`, mert a join_rule
sima meghívásos, nem kopogtatásos).

- **A join_rule-kezelés (`joinRules.ts`, `RoomSettingsModal.tsx`) MÁR
  KÉSZ volt** ebben a körben talált állapot szerint - `restricted`/
  `knock_restricted` join_rule-t is be lehet állítani egy meglévő
  szobához a Beállítások > Hozzáférés fülön, `getOwningSpace`-szel
  automatikusan a space-hez kötve. Ami hiányzott: (1) ÚJ szobák
  létrehozásakor semmi nem állította be automatikusan ezt, mindig sima
  invite/public preset ment; (2) nem volt space-szintű alapbeállítás
  arról, hogy az új csatornák engedjenek-e kopogtatást kívülállóktól.
- **`spaceSettings.ts`**: új `allow_room_knocking` mező (alapból
  `false`/hiányzik) + `isSpaceKnockingAllowed`/`setSpaceKnockingAllowed`.
  Ugyanaz az `io.jorkonvo.space_settings` state event minta, mint a
  `default_room_id`/`max_upload_mb`-nél.
- **`room-admin.ts` `createRoom`**: ha a szoba egy space-ben jön létre és
  NEM publikus, a join_rule-t explicit `initial_state`-ként küldi a
  `client.createRoom()` hívásban (nem egy külön `sendStateEvent`
  utólag - a `CLAUDE.md` "nincs local echo" szabálya miatt egy
  létrehozás-utáni azonnali visszaolvasás/felülírás kockázatos lenne,
  az `initial_state` viszont a spec szerint felülírja a preset
  alapértelmezett join_rule-ját, egy híváson belül, versenyhelyzet
  nélkül): `restricted` (a space aktuális `allow_room_knocking`
  beállítása szerint `knock_restricted`-re vált), `allow: [{type:
  "m.room_membership", room_id: <spaceId>}]` (MSC3083, RestrictedAllowType
  a matrix-js-sdk-ból). Publikus szoba marad `public` (már eleve nyitottabb
  a restricted-nél). MEGLÉVŐ szobák join_rule-ja NEM változik automatikusan
  - a `RoomSettingsModal` Hozzáférés fülén már meglévő kézi váltás kezeli,
  ha egy admin utólag akarja alkalmazni.
- **`room-admin.ts` `createSpace`**: új `allowRoomKnocking` opció, a
  space LÉTREHOZÁSAKOR állítja be a `SPACE_SETTINGS_EVENT`-et
  `initial_state`-ként (ugyanazon versenyhelyzet-mentesség miatt, mint
  fent - a szoba első csatornája simán a space-t olvasná ki
  `createRoom`-ban, egy utólagos írás és köztes állapot nélkül).
- **UI**: `CreateSpaceModal.tsx` egy "Csatlakozási kérések engedélyezése
  a szerveren kívülről" jelölőnégyzetet kapott, alapból KIKAPCSOLVA, egy
  mondatos magyarázattal. `SpaceSettingsModal.tsx` "Meghívók" fülén
  ugyanez utólag is állítható (`mayManageInvitePolicy` mögé zárva, mint a
  többi hozzáférés-jogosultsági beállítás).
- **e2e**: új `e2e/tests/restricted-rooms.spec.ts` - Aliz létrehoz egy
  space-t (alapértelmezett, kopogtatás KI), csatornát hoz létre benne,
  majd (mivel nincs "user meghívása a space-hez" UI, ugyanúgy ahogy egy
  valódi Synapse admin tenné) nyers API hívással (`inviteToRoom`
  helper) meghívja Bobot CSAK a space-hez, sosem a csatornához. Bob
  elfogadja a space-meghívást a felületen, majd a "Szobák felfedezése"
  (space hierarchy, MSC2946 `/hierarchy`) modálban meglátja a csatornát
  és EGY kattintással csatlakozik - se meghívás, se kopogtatás nem kell,
  mert a join_rule `restricted` a space tagságára. A hierarchy modálon
  eddig hiányzó `data-testid`-k (`hierarchy-room`, `hierarchy-join`,
  `hierarchy-open`) és a felfedező gombon (`discover-rooms-button`)
  bepótolva, hogy a teszt egyáltalán vezérelni tudja.
- **GATE**: `npm run build` (matrix-core + web) tiszta, `npm test`
  471/471 zöld (+1 skip, változatlan), `npm run lint` 0 hiba, teljes
  Playwright e2e szvit zöld (a régi 13 + az új 1 = 14). Egy környezeti
  jelenség útközben: mivel ez a kör egy időben futott két másik,
  szintén e2e-t futtató önálló körrel (worktree-kban), és az
  `e2e/docker-compose.yml` FIX konténer- és hálózat-nevet használ
  (`jorkonvo-e2e-net`, `e2e-caddy-1`, `e2e-synapse-1`) minden worktree-ből
  ugyanazzal - a párhuzamos futások összeakadtak (egyik `up.sh`/`down.sh`
  ciklusa a másik alatt cserélte/törölte a konténereket), ami egy teljes
  szvit-futtatáson át tartó, minden tesztre kiterjedő, hamis piros
  hullámot okozott (backdrop-elem beragadt kattintás-blokkolása, 90s
  timeoutok). Nem valódi regresszió volt - a saját worktree-stack
  újraindítása után minden zöld lett. **Ismert, valódi hiányosság a repo
  e2e-infrastruktúrájában**: több párhuzamos e2e-futtatás (pl. több
  önálló branch/worktree egyszerre) nem biztonságos ezzel a fix
  konténer-elnevezéssel - egy jövőbeli körnek érdemes worktree-specifikus
  projekt-/hálózat-nevet adni az `up.sh`/`down.sh`-nak.
- **Branch**: `feat/restricted-space-rooms`, pusholva originre, NEM
  mergelve mainbe (architektúra-szintű döntés, PR-en át kéri review-t a
  repo saját szabálya szerint).

## Kör: E2E helyreállítási kulcs onboarding - első belépéskor mutatja a kulcsot (branch `feat/e2e-key-onboarding`, a felhasználó valós visszajelzése alapján)

Valós tesztelésből jött a jelzés: "az első belépéskor nem is mutatja az E2E
kulcsot". Igaz is volt - a kulcskészítés motora (`createFreshCrossSigningIdentity`)
és a mutatás+moregolás UI (`RecoveryKeyModal`) régóta kész volt, de utóbbi csak
egy kis ikonról, a space-ről nyílt beállítások mélyén volt elérhető; a
bejelentkezés/regisztráció útja sosem indította el. Ez a kör a hiányzó
bekötést pótolja, három, gondosan szétválasztott esetre:

- **Új regisztráció / első bejelentkezés, a fiókban még SEMMI nincs beállítva**
  (`getCrossSigningStatus()`: se publikus kulcsok, se secret storage): a boot
  után automatikusan `createFreshCrossSigningIdentity()` fut, a bejelentkezési
  űrlapon még kéznél lévő jelszóval (nincs újra-bekérés), és egy
  `FirstLoginSecurityModal` felfedi a helyreállítási kulcsot: sima nyelvi
  magyarázat ("ez az egyetlen mód, hogy új eszközön is elolvasd a régi
  üzeneteidet, senki más nem tudja visszaadni, még jelszó-visszaállítással
  sem"), egy kattintásos vágólapra-másolás, és a folytatáshoz explicit
  gomb - a "Moregoltam, tovább" mellett mindig elérhető a "Majd később"
  menekülőút is (Discord/Signal-os "erősen ajánlott, de nem foglyul ejtő" hang).
- **Meglévő fiók, új eszköz, a kulcsok nincsenek itt** (van identitás
  máshol, de ezen a munkameneten nincs): NEM hoz létre új identitást (az
  minden más eszköz bizalmát visszaállítaná - ez az egyetlen komoly hiba,
  amit ki lehetett volna követni, és szándékosan nem fut bele), hanem
  választást kínál: meglévő helyreállítási kulcs megadása
  (`restoreKeyBackupWithRecoveryKey` + `restoreCrossSigningWithRecoveryKey`)
  VAGY ellenőrzés egy már bejelentkezett eszközről (a meglévő
  `verificationStore.start` újrahasznosításával) VAGY "majd később".
- **Minden kész ezen az eszközön**: egyáltalán nem zavar (újratöltésre,
  meglévő session-ökre nem jön fel semmi).

Technika: `runPostAuthKeySetup()` az authStore-ban a boot után dönt a
`getCrossSigningStatus()` alapján és nyitja a modalt (`firstLoginSecurity`,
create/restore módban); a modal a `RecoveryKeyModal` mintájára épül. A
`loginAs()` e2e helper alapból elnyomja (elkattintja a "majd később" gombot),
hogy a többi specet ne törje meg a modál háttér-fátyla, és
`handleSecuritySetup: false`-szal vezethető kézzel. Új e2e spec
(`firstLoginSecurity.spec.ts`): friss fiók első bejelentkezésénél automatikusan
megjelenik a kulcs, másolható, és újratöltésre NEM jön elő újra.

- **GATE**: `npm run build` zöld, `npm test` 471 passed + 1 skipped, lint 0
  hiba, teljes Playwright e2e suite **14/14 zöld** (13 régi + 1 új).

## Huszonhatodik kör - meghívó linkek tényleges megnyitása + a webapp éles hosztolása (a felhasználó kérésére, valódi több-felhasználós teszt után talált hibák egyike)

Két valódi felhasználóval tesztelve kiderült: egy `matrix.to` meghívó
linkre kattintva sosem nyílt meg a JorKonvo - sehol nem volt regisztrálva
deep link (sem az Android manifestben, sem az iOS Info.plist-ben, sem a
Tauri configban), és az app maga sem olvasta be a `matrix.to` URL-t
induláskor. A copy-paste az `JoinRoomModal`-ba volt az egyetlen működő út.

A tulajdonos eközben regisztrált egy aldomaint (`jorkonvo.szabotar.dev`,
FreeDNS afraid.org, már a gépre mutat), ami valódi megoldást tesz
lehetővé: mivel a `matrix.to`-t nem a JorKonvo fejlesztője üzemelteti,
Androidon/iOS-en soha nem lehetett volna azt SILENTLY (ellenőrzött App
Link/Universal Link formájában) megnyitni, csak egy "megnyitás ezzel"
választóval - egy SAJÁT domainhez viszont igazolható a tulajdonjog.

- **`packages/matrix-core/src/inviteLinks.ts`**: a `getRoomInviteLink()`
  mostantól `https://jorkonvo.szabotar.dev/join#/...` linket generál a
  régi `https://matrix.to/#/...` helyett (ugyanaz a fragment-alak - alias
  vagy szoba-id + `via` szerverek -, csak más domainen). Új
  `parseInviteLink()` export mindhárom alakot elfogadja: a saját domaint,
  a sima `matrix.to`-t (más kliensek még ezt generálják, ezt továbbra is
  el kell fogadni), és egy `jorkonvo://join#/...` custom scheme-et (iOS
  fallback, l. lent). A `room-admin.ts` korábbi privát
  `parseMatrixToLink`-je törölve, mindenhol (`joinRoomByIdOrAlias`,
  `resolveRoomTarget`) az új közös parsert használja.
- **Android App Link**: `AndroidManifest.xml` `android:autoVerify="true"`
  intent-filter a `https://jorkonvo.szabotar.dev/join*`-ra, plusz egy NEM
  verifikált intent-filter sima `matrix.to` linkekre is (legalább egy
  "megnyitás ezzel" választóban megjelenik JorKonvo, jobb mint a semmi).
  `apps/web/public/.well-known/assetlinks.json` hozzáadva - a jelenlegi
  aláírás-ujjlenyomat a DEBUG keystore-é (`keytool -list -v -keystore
  ~/.android/debug.keystore`), mert még nincs valódi upload keystore (l.
  `docs/ANDROID.md` "Release signing", 25. kör) - ezt majd cserélni kell a
  valódi kiadási cert ujjlenyomatára, különben a verifikáció csendben
  elbukik és visszaesik "megnyitás ezzel" választóra.
- **iOS Universal Link**: `App.entitlements` (új fájl,
  `com.apple.developer.associated-domains: applinks:jorkonvo.szabotar.dev`)
  bekötve mindkét build configba (`CODE_SIGN_ENTITLEMENTS`).
  `apps/web/public/.well-known/apple-app-site-association` hozzáadva - az
  Apple Team ID helyén egyelőre `TEAMID_PLACEHOLDER` áll, mert ez sehol
  nincs a repóban rögzítve (csak a Codemagic App Store Connect
  integrációja ismeri) - a tulajdonosnak kell a valódi Team ID-re
  cserélnie. `Info.plist`-ben egy `jorkonvo://` custom scheme fallback is
  bekerült (`CFBundleURLTypes`) arra az esetre, ha a Universal Link
  valamiért nem verifikálódna (a fenti Team ID placeholder pontosan ilyen
  eset) - nem helyettesíti, kiegészíti.
- **Kliens-oldali kezelés**: új `apps/web/src/lib/inviteLinkHandler.ts` -
  induláskor beolvassa a `/join` útvonalat (webes cold-start), illetve
  Capacitor `appUrlOpen` eseményt figyel (natív App Link/Universal
  Link/custom scheme, hidegindítás ÉS már-futó app esetén is). A talált
  céltárgyat egy új `pendingInviteStore`-ban tárolja, mert bejelentkezés
  előtt még nincs hova nyitni a csatlakozás-modalt; az `App.tsx` egy
  effektje figyeli az auth-státuszt és a pending célt, és amint
  `status === "ready"`, megnyitja a `JoinRoomModal`-t `initialTarget`-tel.
  A `JoinRoomModal` `initialTarget` esetén AZONNAL megpróbálja a
  csatlakozást megnyitáskor (nem vár egy extra kattintásra) - Discord
  stílusban "kattints a linkre, bent vagy", nem "kattints a linkre, majd
  még egyszer a Csatlakozásra".
- **`test/unit/core/inviteLinks.test.ts`** bővítve: `getRoomInviteLink`
  tesztek frissítve az új domainre, plusz új `parseInviteLink` tesztek
  (kör-teszt mindhárom linkformára, és hogy egy sima szoba-id/alias NEM
  linkként értelmeződik).
- **GATE**: `npm run build` zöld, `npm test` 476/477 zöld (öt új teszttel
  bővült a korábbi 471-ről), `npm run lint` 0 hiba, teljes Playwright e2e
  szvit lefuttatva egy worktree-ben.

### A webapp éles hosztolása (`~/jorkonvo-web/`, a JorKonvo repón kívül)

A tulajdonos kifejezetten kérte, hogy a webapp fusson élesben a
`jorkonvo.szabotar.dev` címen - ez a fenti deep link munka
előfeltétele is (a `.well-known` fájloknak egy valódi, élő HTTPS host
alól kell elérhetőnek lenniük az App Link/Universal Link
ellenőrzéshez).

- Egy `nginx:alpine` konténer (`~/jorkonvo-web/docker-compose.yml`) a
  `~/JorKonvo/apps/web/dist`-et szolgálja ki (bind mount, élőben látja az
  új buildeket, nincs újraindítás) a host `127.0.0.1:8181`-én, SPA
  fallback-kal és a `/.well-known/` explicit `application/json`
  content-type-tal (az `apple-app-site-association`-nak nincs
  kiterjesztése, nginx alapból rosszul szolgálná ki).
- **Talált akadály, amit NEM oldottam meg**: a gép 80/443-as portját egy
  `nginxproxymanager` konténer birtokolja (`--network host`), ez routolja
  valószínűleg az összes eddigi `*.szabotar.dev` aldomaint. Nem volt
  elérhető admin belépés hozzá ezen a sessionön (nem találtam se tárolt
  tokent, se jelszót) - ez emberi lépés: egy Proxy Host felvétele a
  `jorkonvo.szabotar.dev → 127.0.0.1:8181` irányba, Let's Encrypt
  certtel. L. `~/jorkonvo-web/README.md` a pontos lépésekért.
- Idáig (`curl http://127.0.0.1:8181/` a gépen belülről) minden
  igazoltan működik - csak a kifelé irányuló proxy-bekötés hiányzik.

## Kör: SAS-verifikáció + 1:1 hívás e2e lefedettség (önálló folytatás, `.hub/status.json` "next" listája alapján, branch `feat/e2e-verification-call`, worktree-ben)

A `.hub/status.json` két, korábban végig üresen hagyott alrendszert
jelölt meg: az eszköz-ellenőrzés (SAS emoji) és az 1:1 hívás soha nem
futott végig valódi homeserver ellen automatizálva, csak SDK-mockolt unit
teszttel. Ez a kör mindkettőt lefedi a Playwright e2e szvitben.

- **Valódi hiányosság találva: a self-verification (saját másik eszköz
  ellenőrzése) sehonnan nem indítható a felületről.** A
  `requestUserVerification(client, userId)` (matrix-core) semmiben nem
  különbözteti meg a "saját magam" esetet - de mind az
  `UserProfilePopover.tsx` (`{!isSelf && (...)}`), mind a
  `memberMenu.tsx` (`if (userId === ownUserId) return selfItems` -
  csak "Copy ID" + "My profile") explicit kizárja a Verify gombot, ha a
  cél a saját fiók. A `DeviceManagementSection.tsx` (Beállítások > Fiók >
  Bejelentkezett eszközök) pedig csak Kijelentkeztetést tud, ellenőrzést
  nem. Vagyis a kód-szintű SAS-verifikáció végig kész volt, de a
  felhasználó soha nem tudta volna elindítani a saját második eszköze
  ellenőrzését semmilyen gombbal - ez önmagában is valódi UX-hiányosság,
  nem csak egy tesztelhetőségi rés.
  - **Javítva**: a `DeviceManagementSection` minden NEM-aktuális eszköz
    sorához egy "Verify" gombot kapott (`devices-verify` testid,
    `data-device-id` attribútummal), ami `startVerification(client,
    client.getUserId())`-t hív. Megjegyzés a kódban: mivel
    `requestUserVerification` nem eszköz-specifikus (mindig az adott
    userId első ismert eszközét választja - ez már eddig is dokumentált
    korlát volt cross-user esetre), pontosan 2 eszköz esetén (a szokásos
    eset) ez mindig a helyeset találja el; egy jövőbeli teljes
    eszközválasztó ezen javítana, ha valaha 3+ eszközzel kellene
    dolgozni.
  - Új i18n kulcs mindkét nyelven: `devices.verify` (en: "Verify", hu:
    "Ellenőrzés").
- **Teszt-infrastruktúra hiba is előkerült eközben**: a
  `e2e/tests/helpers.ts` `registerUser()` a Synapse admin
  shared-secret regisztrációs végpontját hívja - ami, kiderült,
  MELLÉKESEN egy valódi, élő eszközt/munkamenetet is létrehoz és
  visszaad (`access_token` + `device_id` a válaszban), amit a helper
  eddig egyszerűen eldobott. Ez azt jelentette, hogy MINDEN e2e teszt
  fiókja egy "szellem" eszközzel indult, amit semmi nem vezérel - ez
  eddig senkinek nem számított, mert egyik teszt sem nézte pontosan az
  eszközök számát, de a self-verification tesztnél két KÜLÖNBÖZŐ,
  látszólag valódi "más eszköz" Verify gomb jelent meg (a szellem +
  a második böngésző-kontextus valódi eszköze), ami stric-mode
  Playwright hibát okozott. Javítva: `registerUser()` most azonnal
  kijelentkezteti (`/logout`) ezt a regisztráció-melléktermék eszközt,
  mielőtt visszaadja a tesztfelhasználót - minden más teszt számára is
  tisztább, 0-eszközös induló állapotot ad.
- **`e2e/tests/verification.spec.ts`** (új): két böngésző-kontextus
  UGYANAZZAL a fiókkal (= két eszköz), A eszköz indítja az
  ellenőrzést a saját fiókja ellen a Beállítások > Fiók eszközlistájából,
  B eszköz a felugró toast-on (`verify-incoming-accept`) elfogadja, A
  választja a SAS módszert, mindkét oldalon megjelenő emoji-sorozat
  (`verify-sas-emoji-name`) egyezését assertálja, mindkét oldal
  megerősít (`verify-sas-match`), és mindkettő eléri a "Done" képernyőt
  (`verify-done`) - ez a felület saját jele arra, hogy a folyamat sikerrel
  zárult mindkét oldalról nézve.
- **`e2e/tests/call.spec.ts`** (új): két fiók, Alice DM-et indít Bobbal
  (`sidebar-start-dm` + `start-dm-userid` + `start-dm-submit` - ezeken
  eddig nem volt testid, hozzáadva), Bob elfogadja és csatlakozik, Alice
  a szoba fejlécének "More" menüjéből hangot hív (`chat-header` testid
  hozzáadva a fejléc konténerhez, mert a composer eszköztárnak IS van egy
  "More" gombja - `composer.more` vs `chat.more`, ugyanaz az angol
  szöveg, két külön elem -, enélkül Playwright strict-mode hibát dobott).
  Bob elfogadja (`call-accept`), mindkét oldal eléri a "Connected"
  állapotot (`call-state` szöveg-assertion) - ez VALÓDI peer-to-peer
  WebRTC (nem LiveKit/SFU, az csak csoportos hívásnál kell), a
  `playwright.config.ts`-ben már korábban előkészített fake media
  device flag-ekkel (`--use-fake-ui-for-media-stream` /
  `--use-fake-device-for-media-stream`) - ezeket még nem használta
  semmi, most először. Alice leteszi, mindkét oldalon eltűnik a hívás
  overlay.
- **Új testidek** (a `CLAUDE.md` "New interactive elements that a test
  needs" elve szerint, mert egyik sem létezett még): `devices-verify`,
  `verify-method-sas`, `verify-sas-emoji`, `verify-sas-emoji-name`,
  `verify-sas-match`, `verify-sas-no-match`, `verify-done`,
  `verify-incoming-accept`, `verify-incoming-ignore`, `sidebar-start-dm`,
  `start-dm-userid`, `start-dm-submit`, `call-accept`, `call-decline`,
  `call-state`, `call-hangup`, `chat-header`.
- **Megfigyelt, de nem hiba**: a verifikációs teszt EGYSZER instabil volt
  a teljes szvit részeként (a `verify-incoming-accept` toast 20s-en
  belül nem jelent meg egy erősen terhelt, sok más docker-konténert
  futtató gépen) - kétszeri megismétlésnél mindig lezöldült.
  Óvatosságból 20s → 30s-re emelve ez az egy várakozás; ez egy valódi
  szerver-oda-vissza (to-device esemény szinkronon át), nem helyi UI
  állapot, úgyhogy indokolt neki több türelmet adni, mint a többi,
  tisztán kliens-oldali assertnek ebben a fájlban.
- **GATE** (a `/tmp/jorkonvo-e2e-verification` worktree-ben, `feat/e2e-verification-call`
  branch-en, Node 22): `npm run build` (matrix-core + web) zöld, `npm
  test` 471 passed + 1 skipped (változatlan - a store/i18n/komponens
  módosítások egyike sem érintett meglévő unit tesztet), `npm run lint`
  0 hiba / 55 warning (ugyanaz a bázisvonal, nincs új figyelmeztetés),
  teljes Playwright e2e szvit 15/15 zöld (13 régi + 2 új), kétszer
  egymás után megismételve.
- Ág pusholva originre (`git@git.szabotar.dev:thatumi/JorKonvo.git`),
  NEM mainbe mergelve - Forgejo PR-t kér a tulajdonostól, mert ez valódi
  funkcióbővítés (`CLAUDE.md` commit-szabálya).

## Kör: Android képernyőmegosztás - valódi MediaProjection-híd a WebView-ba (önálló, egész estés munka, branch `feat/android-screenshare`, NEM mergelve)

A round-18 bejegyzésben jelzett hiány ("Képernyőmegosztáshoz
`FOREGROUND_SERVICE_MEDIA_PROJECTION` szándékosan NINCS deklarálva - az egy
valódi MediaProjection-alapú foreground service-t igényelne, amit semmi nem
implementál még") most megszűnt: megépült a híd, élőben tesztelve, a
jogosultságok deklarálva.

- **Miért kellett**: az Android WebView nem implementálja a
  `getDisplayMedia`-t - élőben újraellenőrizve a projektes P30 Pro-n
  (WebView/Chromium 151: `getUserMedia` van, `getDisplayMedia` undefined), a
  kamerát/mikrót a Capacitor `BridgeWebChromeClient`-je hidalta csak.
- **Architektúra** (részletesen: `docs/ANDROID_SCREENSHARE.md`):
  `ScreenCapturePlugin` (Capacitor plugin, consent
  `ActivityResultLauncher`/`@ActivityCallback` úton, NEM a deprecated
  `onActivityResult`) + `ScreenCaptureService` (mediaProjection-típusú
  foreground service a `getMediaProjection` ELŐTT indul - Android 14+
  sorrend-szabály; VirtualDisplay→ImageReader→JPEG→base64 `Bridge.eval`-en
  át) + `apps/web/src/lib/androidScreenShare.ts` polyfill (képkockák
  offscreen canvas-ra, `canvas.captureStream(0)` trackjét adja vissza), a
  livekit-client szerződését pontosan betartva (preset-ideálok→maxLongSide,
  `track.stop()`→natív leállítás, külső stop→`ended` event, elutasítás→
  `NotAllowedError`) - a `GroupCallScreen.tsx` és minden nem-Android kódút
  érintetlen.
- **Élő tesztek a fizikai P30 Pro-n**, CDP-n vezetve (WebView devtools socket
  adb forward + uiautomator consent-koppintások): 590x1280 / 886x1920
  aspect-hű felvétel, ~15 fps fenntartva (78-82 KiB JPEG-ek), FGS-értesítés
  Stop akcióval, mindhárom leállási út (értesítés / track.stop / plugin.stop)
  tiszta lebontással + pontosan egy `ended` event, DENY→NotAllowedError,
  CPU legrosszabb esetben ~1-1.7 mag, üresjáratban 0%.
- **Élő kétrésztvevős LiveKit-hívás az éles szerveren** (telefon a
  párhuzamos-telepítésű tesztappal mint thatumi + asztali böngésző egy
  tulaj által készített második fiókkal): a TÁVOLI OLDAL a telefon
  képernyőjét látta ~12.8 fps-en (screenshot: `.hub/screenshots/
  android-screenshare-remote-view.png`); gombbal-kikapcsolás és
  értesítésből-állítás azonnal eltüntették a távoli csempét; HOME-ra a
  megosztás életben maradt, képernyő-változásra jöttek a kockák.
- **Teszt-infrastruktúra tanulságok**: (1) egy Matrix-fiók = egy
  LiveKit-résztvevő (user-szintű identitás) - a második eszköz csatlakozása
  KIRÚGJA az elsőt, kétrésztvevős teszthez két fiók kell (guest login
  tiltva, regisztráció token-védes, ezért kellett a tulajnak fiókot
  készítenie); (2) a telefonon lévő debug build más gép debug-kulcsával
  volt aláírva (apksigner SHA-256 összehasonlítva) - az uninstall a tulaj
  bejelentkezését+E2EE-kulcsait törölné volna, ezért
  `-PjkParallelInstall` flagre kapcsoló `applicationIdSuffix .screencap`
  (`dev.szabotar.jorkonvo.screencap` települ a meglévő MELLÉ).
- **GATE** (`feat/android-screenshare` branch-en): `npm run build` zöld,
  `npm run lint` 0 hiba / 54 régi warning, `npm test` 432 passed + 74 failed
  - a 74 hiba tiszta main-en IDENTIKUS (a gép localStorage-nélküli
  tesztkörnyezete miatt, előző állapot, nem regresszió; stash-sel
  bizonyítva).
- Ág pusholva originre, NEM mainbe mergelve - a teljes élő ellenőrzés
  (híd-szintű + kétrésztvevős hívás) lefutott, a merge a tulaj jóváhagyására
  vár. Teszt-hulladék a tulaj döntésére: "ScreenShare Test" space +
  share-test voice channel (thatumi fiókon), tesztapp a telefonon bejelentkezve
  (ellenőrizetlen-eszköz munkamenet).
