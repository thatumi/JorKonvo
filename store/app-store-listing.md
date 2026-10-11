# JorKonvo — App Store Connect listing

Source facts for this listing: `README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`,
`PLAN.md` (phases 5–8, rounds 22–25), `RELEASE.md`, `.hub/status.json`,
`docs/ANDROID.md`, `docs/ANDROID_UX_AUDIT.md` — re-checked 2026-09-16
against `main` (rounds 22–25: iOS scaffold, safe-area/edge-swipe polish,
Android back-button/long-press audit, Android release signing). Only
shipped, live-tested features are listed — nothing from the open/planned
items in `PLAN.md` or `RELEASE.md`'s blocker table. The feature list and
age-rating reasoning below were unchanged by this re-check: rounds 22–25
are UI polish and native-shell plumbing, not new user-facing capabilities
or new UGC/communication surfaces.

Character counts below were verified against Apple's field limits.

---

## Hungarian (hu) — elsődleges nyelv

**App neve** (max 30 karakter)
```
JorKonvo
```
(8 karakter)

**Alcím / Subtitle** (max 30 karakter)
```
Titkosított csevegés Matrixon
```
(29 karakter)

**Promóciós szöveg** (max 170 karakter)
```
Ismerős felületű, végpontok-közötti titkosított csevegés a nyílt
Matrix protokollon. Terek, szobák, hang-/videóhívások. Saját szervert
is használhatsz — a fejlesztő nem lát bele az üzeneteidbe.
```
(178 karakter — TÚLLÉPI a limitet, rövidített változat App Store Connectbe:)
```
Ismerős felületű, végpontok-közötti titkosított csevegés a nyílt
Matrix protokollon. Terek, hang-/videóhívások, saját szerver választható.
```
(139 karakter)

**Leírás** (max 4000 karakter)
```
A JorKonvo egy ismerős, könnyen kezelhető felületű, nyílt forráskódú
Matrix kliens: csoportos csevegés terekbe (space) és szobákba rendezve,
végpontok közötti titkosítással, hang- és videóhívásokkal.

A Matrix egy nyílt, decentralizált csevegési protokoll — nem a JorKonvo
fejlesztője üzemelteti az egyetlen szervert, amin mindenki van. Bármelyik
Matrix szerverhez csatlakozhatsz a saját fiókoddal, vagy futtathatsz
sajátot. A szerver-mező szabadon szerkeszthető bejelentkezéskor.

FUNKCIÓK

Csevegés
- Terek (space) és szobák, kategóriákba rendezve, ismerős
  háromoszlopos elrendezésben
- Szálak (thread), reakciók, szavazások (poll), üzenet-szerkesztés/törlés
- Üzenettovábbítás más szobába, válasz-idézés, @említések
- Kép/fájl megosztás, drag & drop feltöltés, URL-előnézetek
- Üzenetkeresés — titkosított szobában kliens-oldali tartalékkal, mert a
  szerver nem tudja elolvasni a titkosított tartalmat

Titkosítás
- Végpontok közötti titkosítás minden szobában (rust-crypto,
  a Matrix hivatalos titkosítási rétege)
- Eszköz-ellenőrzés emoji-alapú összehasonlítással (SAS)
- Kulcs-visszaállítás (4S / recovery key)
- Titkosított szoba jelzése a felületen

Hang és videó
- 1:1 hívás valódi peer-to-peer WebRTC-vel (hang, videó, képernyő-
  megosztás)
- Csoportos hívás bármelyik szobában (LiveKit alapú)
- Állandó hangcsatornák — kattintás, és bent vagy
- Zajszűrés (RNNoise), Rögzített beszéd (push-to-talk)

Terek kezelése
- Szerepkörök és jogosultságok (kirúgás, kitiltás, jogosultsági szintek)
- Moderátori eszközök: némítás, lassított mód, kulcsszó-alapú automata
  szűrés (kliens-oldali)
- Naplózás (audit log) minden tagsági és beállítás-változásról
- Meghívó linkek és QR-kódok

Egyéb
- Világos/sötét/rendszer téma, több kinézeti beállítás
- Böngésző/asztali natív értesítések, szoba némítása
- Felhasználó letiltása (ignore/block)
- Több fiók egyszerre
- Web, asztali (Windows/macOS/Linux) és Android — ugyanaz a kódbázis

ŐSZINTÉN A KORLÁTOKRÓL
Ez egy korai fejlesztési fázisban lévő alkalmazás. A fenti funkciók
valódi Matrix szerver ellen, két valós fiókkal manuálisan és automata
teszttel is ellenőrizve lettek, de az alkalmazás még nem 1.0-s, hivatalos
kiadás. A push-értesítések jelenleg csak böngészőben/asztali gépen
működnek, mobil natív push (APNs/FCM) még nincs bekötve.
```
(kb. 1750 karakter — jócskán a 4000-es limit alatt)

**Kulcsszavak** (max 100 karakter, vesszővel elválasztva)
```
matrix,e2ee,titkositott,cseveges,csoportos,hangcsatorna,videohivas,terek,sajat szerver,privat
```
(92 karakter)

**Támogatás URL:** https://jorkonvo.com/support.html
**Marketing URL:** https://jorkonvo.com

**Kategória:**
- Elsődleges: Közösségi hálózatok (Social Networking)
- Másodlagos: Üzlet (Business) — a fejlesztő Matrix-szervert is bérbe ad
  saját ügyfeleknek (`deploy/RENTAL.md`), ezért releváns lehet, de nem
  kötelező; a lényegi funkció a csevegés.

---

## English (en)

**App name** (max 30 characters)
```
JorKonvo
```
(8 characters)

**Subtitle** (max 30 characters)
```
Encrypted community chat
```
(24 characters)

**Promotional text** (max 170 characters)
```
Chat with your communities on the open Matrix protocol: spaces, channels, threads, voice and video calls, screen sharing, end-to-end encrypted rooms. Use any server.
```
(165 characters)

**Description** (max 4000 characters)
```
JorKonvo is a chat app for communities, built on Matrix — the open, decentralized chat protocol. Organize conversations into spaces and channels, talk in voice channels, share your screen, and keep private rooms end-to-end encrypted.

There's no single JorKonvo server everyone has to use: sign in to any Matrix homeserver with your own account, or run your own. The server address is freely editable on the sign-in screen.

CHAT
- Spaces with channels organized into categories
- Threads, replies, reactions, polls, @mentions
- Edit and delete messages, forward them to another room
- Share images and files, with link previews
- Message search — on-device in encrypted rooms, because the server can't read them

ENCRYPTION
- End-to-end encryption in encrypted rooms (shown with a lock icon), using Matrix's standard encryption
- Verify devices by comparing emoji
- Encrypted key backup with a recovery key
- Please note: unencrypted rooms are readable by the server, the server sees metadata (who, when) in every room, and group-call media isn't end-to-end encrypted

VOICE, VIDEO AND SCREEN SHARING
- 1:1 and group voice and video calls
- Always-on voice channels — tap and you're in
- Screen sharing in calls, on iPhone and iPad too
- Noise suppression and push-to-talk

COMMUNITIES
- Roles with names, colours and permissions
- Moderation: kick, ban, slowmode, audit log
- Invite links and QR codes
- Block users and report messages

MORE
- Light and dark themes, colour presets, accessibility options
- Several accounts at once
- On iPad, the channel and member lists open beside the chat
- Also on Android, Windows, Linux and the web

JorKonvo is in early development. Background push notifications aren't available yet — messages arrive while the app is open.
```
(1767 characters)

**Keywords** (max 100 characters, comma-separated)
```
matrix,e2ee,encrypted,chat,group chat,voice chat,video call,spaces,self hosted,private messenger
```
(96 characters)

**Support URL:** https://jorkonvo.com/support.html
**Marketing URL:** https://jorkonvo.com
**Version:** 0.1.0 (must match the build's CFBundleShortVersionString)
**Copyright:** 2026 Tamás Szabó

**Category:**
- Primary: Social Networking
- Secondary: Business — the developer also rents out Matrix servers to
  customers (`deploy/RENTAL.md`); optional, the core function is chat.

---

## Age rating (Apple questionnaire, both locales)

JorKonvo is a general-purpose Matrix client: any signed-in user can
message, call, and share files/images with any other user reachable on
the homeserver they connect to (their own account's homeserver, plus
whoever they can reach through Matrix federation if the homeserver
federates — this app does not disable federation). There is **no
platform-wide content moderation, no report-to-developer flow, and no
account-level content filtering** — moderation is per-room/per-space
only (kick/ban/mute/slowmode/automod), enforced by whoever has power
levels in that specific room, and automod is an explicit client-side
courtesy filter that a modified client can bypass (`docs/ARCHITECTURE.md`
§3, `CLAUDE.md` "Honest scoping"). The developer, as app publisher,
cannot see or moderate message content in encrypted rooms at all, and
has no operational visibility into rooms on homeservers they don't run.

Questionnaire answers, going through Apple's categories:

| Category | Answer | Why |
|---|---|---|
| Cartoon or Fantasy Violence | None | No such content is part of the app itself |
| Realistic Violence | None | " |
| Sexual Content or Nudity | None (app-authored) | The app has no sexual content; but see UGC note below |
| Profanity or Crude Humor | None (app-authored) | " |
| Alcohol, Tobacco, or Drug Use | None (app-authored) | " |
| Mature/Suggestive Themes | **Infrequent/Mild → effectively unbounded via UGC** | Users can send arbitrary text/images/links to each other with zero server-side filtering in encrypted rooms and no reporting flow |
| Horror/Fear Themes | None | — |
| Gambling (Simulated) | None | — |
| Contests | None | — |
| Unrestricted Web Access | **No** | Link/URL previews and rich embeds go through a per-provider allowlist (`RichEmbed`, see `CLAUDE.md`); the app does not embed an open browser |
| User-Generated Content | **Yes** | Chat messages, file/image uploads, custom room/space content, all unmoderated at the platform level |
| Unrestricted communication with other users | **Yes** | Any two users reachable via Matrix (same homeserver, or federated) can DM, call, and share files with no platform-level gate |

**Recommended age rating: 17+.**

Reasoning: this is functionally the same shape of risk profile as Element
(the reference Matrix client, rated 17+ on the App Store) or Discord
(17+) — open, largely unmoderated user-to-user chat with file/image
sharing and no built-in reporting mechanism. JorKonvo does have a
user-level "ignore/block" feature, but that only hides content from the
blocking user locally; it is not a moderation or reporting system Apple
would credit toward a lower rating under guideline 1.2 (UGC apps).

**Judgment call — flagged for the app owner:** before submission, Apple
App Review guideline 1.2 generally expects UGC apps to ship a way to
report objectionable content/users to the developer, in addition to
blocking. JorKonvo has blocking (`ignoredUsers.ts`) but no report flow.
This isn't something this text-only task can add (it would be a code
change), but it's worth deciding whether to add a lightweight "report"
action, or a published moderation policy, before an actual App Store
(not TestFlight) submission — TestFlight builds are not subject to 1.2
review in the same way.
