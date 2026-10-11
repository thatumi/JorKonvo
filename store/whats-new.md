# JorKonvo — What's New / Kiadási jegyzék

**Version / Verzió: 0.1.2**

Refreshed 2026-10-11: the previous draft of this note was from the very
first TestFlight build (0.1.0) and had gone stale in exactly the way it
warned about — it still said native push wasn't wired up and that QR
sign-in was unverified. Both have since shipped/changed; see below.
Version numbers are now synced across every target (root/web/matrix-core
`package.json`, `tauri.conf.json`, Android `versionCode 4`/`versionName
0.1.2`, iOS `MARKETING_VERSION 0.1.2`).

---

## English

### JorKonvo 0.1.2

JorKonvo is a familiar chat-app client for the Matrix protocol —
end-to-end encrypted messaging, spaces and rooms, voice/video calls and
screen sharing, one codebase across web, desktop, Android and iOS.

What's in this build:

- End-to-end encrypted messaging (device verification, key backup)
- Spaces and rooms with familiar categories, roles, and permissions
- 1:1 and group voice/video calls, screen sharing, plus persistent voice
  channels with noise suppression and push-to-talk
- Threads, reactions, polls, message search, link previews, file/image
  sharing
- **Native push notifications** on Android and iOS (encrypted messages
  are decrypted on-device before the notification is shown; the push
  server never sees plaintext)
- Bring-your-own Matrix homeserver — the sign-in screen now defaults to
  the public, open-registration **matrix.org**, with a quick-pick
  dropdown (matrix.org / this project's own server / other) next to the
  always-editable URL field
- Light/dark/system theming, multiple accounts, moderation tools
  (kick/ban/mute/slowmode/automod)
- Mobile polish: edge-swipe-back navigation in settings and full-screen
  panels, call screens and the compose bar clear the home
  indicator/notch, long-press context menus on rooms/members/messages
  with no stray text-selection, and the hardware/gesture back button on
  Android correctly steps back through panels, hangs up an active call,
  and only exits the app from the top level

Known limits in this build: **QR sign-in is beta** — it needs the
homeserver to run matrix-authentication-service (MSC4108 rendezvous),
which this project's own server does not have enabled yet, so QR login
may not work depending on which homeserver you pick. Password sign-in
and registration are unaffected. See `store/testflight-beta-notes.md`
for the full list and what to test.

This is still early software. Expect rough edges — please report
anything that breaks.

---

## Magyar

### JorKonvo 0.1.2

A JorKonvo egy ismerős felületű kliens a Matrix csevegési protokollhoz —
végpontok közötti titkosított üzenetküldés, terek és szobák, hang-/
videóhívások és képernyőmegosztás, egyetlen kódbázis weben, asztali
gépen, Androidon és iOS-en.

Mi van ebben a buildben:

- Végpontok közötti titkosított üzenetküldés (eszköz-ellenőrzés, kulcs-
  mentés)
- Terek és szobák ismerős kategóriákkal, szerepkörökkel és
  jogosultságokkal
- 1:1 és csoportos hang-/videóhívások, képernyőmegosztás, valamint
  állandó hangcsatornák zajszűréssel és push-to-talkkal
- Szálak, reakciók, szavazások, üzenetkeresés, link-előnézetek, fájl-/
  képmegosztás
- **Natív push-értesítések** Androidon és iOS-en (a titkosított üzenet
  a készüléken fejtődik vissza, mielőtt megjelenik az értesítés — a
  push-szerver sosem látja a nyílt szöveget)
- Saját Matrix szerver használata — a bejelentkező képernyő mostantól
  alapból a nyilvános, nyitott regisztrációjú **matrix.org**-ot ajánlja
  fel, egy gyorsválasztó legördülővel (matrix.org / ennek a projektnek a
  saját szervere / egyéb) a mindig szabadon szerkeszthető URL-mező
  mellett
- Világos/sötét/rendszer téma, több fiók, moderációs eszközök (kirúgás/
  kitiltás/némítás/lassított mód/automata szűrés)
- Mobil finomítások: szél-húzásos visszalépés a beállításokban és a
  teljes képernyős paneleken, a hívás-képernyők és az üzenetküldő sáv
  nem lóg bele a home-indikátorba/kivágásba, hosszan nyomva tartásos
  helyi menük szoba-/tag-/üzenetsorokon kijelölési műtermék nélkül, és
  Androidon a hardveres/gesztus vissza gomb helyesen lép vissza
  paneleken, leteszi az aktív hívást, és csak a legfelső szintről lépteti
  ki az appot

Ismert korlátok ebben a buildben: a **QR-bejelentkezés béta** — ehhez a
szervernek futtatnia kell a matrix-authentication-service-t (MSC4108
rendezvous), ami ennek a projektnek a saját szerverén még nincs
bekapcsolva, így a QR-bejelentkezés a választott szervertől függően
nem feltétlenül működik. A jelszavas bejelentkezést és regisztrációt ez
nem érinti. Lásd a `store/testflight-beta-notes.md`-t a teljes listáért
és a tesztelendő lépésekért.

Ez még korai szoftver. Számíts rá, hogy vannak még durva élek — kérjük,
jelezz mindent, ami elromlik.
