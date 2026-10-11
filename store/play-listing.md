# JorKonvo — Google Play listing (HU + EN)

Package **`dev.szabotar.jorkonvo`** (note: the task brief said `dev.jorkonvo.mobile`;
the real applicationId in `apps/web/android/app/build.gradle` and
`capacitor.config.ts` is `dev.szabotar.jorkonvo`) · 0.1.0. Facts: `README.md`,
`store/app-store-listing.md`, `store/privacy-policy.md`, and the release build
run on an Android 16 emulator against a disposable Synapse.

**E2EE wording rule:** only rooms shown with the lock icon are end-to-end
encrypted; group calls through the SFU are *not* E2EE media; the homeserver
operator sees metadata. The copy below never says "everything is encrypted".

## Magyar (hu-HU) — elsődleges
**Cím (≤30):** `JorKonvo – Matrix csevegő` (25)

**Rövid leírás (≤80):**
```
Ismerős, terekbe/csatornákba szervezett Matrix kliens titkosított szobákkal.
```
(76)

**Teljes leírás (≤4000):**
```
A JorKonvo egy ismerős, könnyen kezelhető felületű, nyílt forráskódú Matrix kliens: csoportos csevegés terekbe (space) és szobákba rendezve, végpontok közötti titkosítású szobákkal, hang- és videóhívásokkal.

A Matrix nyílt, decentralizált csevegési protokoll. A JorKonvo nem egyetlen közös szolgáltatás: bármelyik Matrix szerverhez csatlakozhatsz a saját fiókoddal, vagy futtathatsz sajátot. A szerver-mező bejelentkezéskor szabadon szerkeszthető (előre kitöltve a fejlesztő saját szervere látható).

CSEVEGÉS
• Terek és szobák kategóriákba rendezve
• Szálak, reakciók, szavazások, szerkesztés/törlés, válasz-idézés, @említések
• Kép- és fájlmegosztás, hangüzenetek, hivatkozás-előnézetek
• Üzenetkeresés (titkosított szobákban az eszközön, mert a szerver nem olvashatja)

TITKOSÍTÁS
• Végpontok közötti titkosítás a titkosított szobákban (zár ikon jelzi) – a titkosított tartalmat a szerver üzemeltetője sem olvassa
• Eszközellenőrzés emoji-összehasonlítással, kulcsmentés helyreállító kulccsal
• Fontos: a titkosítatlan szobák tartalmát a szerver látja, a metaadatot (kivel, mikor) a szerver minden szobában; a csoportos hívások médiája nem végpontok közötti titkosított

HANG ÉS VIDEÓ
• 1:1 hívás peer-to-peer WebRTC-vel, csoportos hívás LiveKit-tel
• Állandó hangcsatornák, zajszűrés, push-to-talk
• Kamera- és mikrofonengedélyt csak akkor kér, amikor hívást vagy hangüzenetet használsz

TEREK KEZELÉSE
• Szerepkörök és jogosultságok, kirúgás, kitiltás, naplózás
• Felhasználók letiltása, üzenetek jelentése
• Meghívó linkek és QR-kódok

TOVÁBBI
• Világos/sötét téma, több fiók egyszerre
• A fiókod az appból törölhető (a szerver támogatásától függően)

Az alkalmazás korai fejlesztési fázisban van. Bezárt appnál is kapsz push-értesítést; a titkosított üzenetek szövegét a telefon maga fejti vissza.
```

**Kategória:** Kommunikáció · **Mi újság:**
```
Első Android-kiadás: ismerős felületű Matrix kliens titkosított szobákkal, hang- és videóhívásokkal, terekkel és jogosultság-kezeléssel.
```

## English (en-US)
**Title:** `JorKonvo – Matrix Chat` (22)

**Short description:**
```
Familiar server-and-channel Matrix client with encrypted rooms.
```
(63)

**Full description:**
```
JorKonvo is an open-source Matrix client with a familiar, easy-to-pick-up interface: group chat organised into spaces and rooms, with end-to-end encrypted rooms and voice and video calls.

Matrix is an open, decentralised chat protocol. JorKonvo is not a single shared service: sign in to any Matrix homeserver with your own account, or run your own. The homeserver field is freely editable on the sign-in screen (it is pre-filled with the developer's own server).

CHAT
• Spaces and rooms organised into categories
• Threads, reactions, polls, edit/delete, replies, @mentions
• Image and file sharing, voice messages, link previews
• Message search (on-device in encrypted rooms, because the server cannot read them)

ENCRYPTION
• End-to-end encryption in encrypted rooms (shown with a lock icon) — the server operator cannot read encrypted content
• Device verification by emoji comparison, key backup with a recovery key
• Please note: unencrypted rooms are readable by the server, the server sees metadata (who, when) in every room, and group-call media is not end-to-end encrypted

VOICE AND VIDEO
• 1:1 calls over peer-to-peer WebRTC, group calls via LiveKit
• Persistent voice channels, noise suppression, push-to-talk
• Camera and microphone permissions are requested only when you start a call or record a voice message

SPACE MANAGEMENT
• Roles and permissions, kick, ban, audit log
• Block users, report messages
• Invite links and QR codes

MORE
• Light/dark theme, multiple accounts
• Delete your account from inside the app (where your homeserver supports it)

Early-stage software. Push notifications work while the app is closed; your phone decrypts encrypted messages for them itself.
```

**Category:** Communication · **Contact:** szabotar@szabotar.dev · **Privacy policy:** https://jorkonvo.szabotar.dev/privacy.html · **Account deletion:** https://jorkonvo.szabotar.dev/delete-account.html (both served from `apps/web/public/`).

## Graphics
`store/play/graphics/` (512 icon, 1024×500 feature graphic), `store/play/screenshots/` (1080×2160: home, encrypted DM, settings — taken on a disposable local Synapse, not on matrix.szabotar.dev). Call screenshots need two devices — human to add. Tablet/Wear not covered.
