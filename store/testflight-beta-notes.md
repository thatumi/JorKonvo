# JorKonvo — TestFlight "What to Test" notes

Text below is written to fit App Store Connect's "What to Test" field
(max 4000 characters), one block per locale — use whichever locale
matches the build's localization.

Updated 2026-10-11 for version 0.1.2: several ios-v0.1.x TestFlight
builds have since gone out through real Xcode compiles on Codemagic (not
"never compiled" as the original 2026-09-10 draft said), native push
(APNs) now ships (JorPushCore + a Notification Service Extension decrypt
the message on-device before showing it — see `apps/web/ios/App/JorPushCore`),
and the sign-in screen's default homeserver changed from this project's
own server to the public matrix.org, with QR sign-in now explicitly
flagged as beta (it needs matrix-authentication-service on the
homeserver, which matrix.org and this project's own server may not both
support the same way). The rest of the steps below are unchanged and
still the right things to test.

---

## Hungarian (hu)

```
KÖSZÖNJÜK, HOGY TESZTELED A JORKONVÓT

Ez egy korai, fejlesztés alatt álló build. A webes/asztali változat sok
kört futott már valódi Matrix szerver ellen, de ez az iOS build az első,
ami ténylegesen lefordul és fut Apple hardveren — légy kritikus.

MIT ÉRDEMES KIPRÓBÁLNI

1. Bejelentkezés / regisztráció
   - Jelentkezz be egy létező Matrix-fiókkal, VAGY hozz létre egy újat.
   - A szerver-mező szabadon átírható — próbáld ki a saját szerveredet
     is, ha van, ne csak az alapból beírt címet.
   - Vendég belépés, ha a szervered engedi.

2. Tér és szoba létrehozása
   - Hozz létre egy teret (space), majd benne egy szöveges és egy hang-
     csatornát.
   - Hívj meg egy második fiókot/eszközt, csatlakozzatok mindketten.

3. Titkosított üzenetküldés
   - Küldj üzenetet egy titkosított szobában két különböző fiókkal/
     eszközzel — mindkét oldalon olvashatónak kell lennie.
   - Küldj képet/fájlt is — titkosított csatolmányként kell megérkeznie.

4. Eszköz-ellenőrzés
   - Indíts eszköz-ellenőrzést (emoji-összehasonlítás) a másik fiókod/
     eszközöd felé. Mindkét oldalon UGYANAZ az emoji-sor kell megjelenjen.

5. Hang-/videóhívás
   - 1:1 hívás egy DM-ben (hang és videó is).
   - Csoportos hívás egy szobában, majd csatlakozás egy állandó
     hangcsatornához.
   - Mikrofon némítás/feloldás, zajszűrés be/ki, push-to-talk, ha
     beállítod.

6. Értesítések
   - Engedélyezd az értesítéseket, küldj üzenetet a másik fiókról, amíg
     az app háttérben van — jönnie kell egy push/helyi értesítésnek.

7. Kezelőfelület mobilon (új, round 23-25)
   - Beállítások (felhasználó/szoba/tér): húzd jobbra a képernyő BAL
     szélétől - egy szintet vissza kell lépnie (részletes nézet →
     kategórialista → bezárás), az ujjadat 1:1 kell kövesse útközben.
   - Szálak/keresés/tagok panel: húzd lefelé vagy oldalra a bezáráshoz,
     ugyanígy ujjkövetéssel.
   - Hívás közben (1:1 és csoportos): a némítás/kamera/letétel gombsor NE
     lógjon bele az iPhone home-indikátor sávjába.
   - Hosszan nyomva tartás egy szoba/tag/üzenet során: a helyi menünek
     tisztán kell megnyílnia, kijelölési csík/fogantyú nélkül alatta.
   - Billentyűparancsok NINCSENEK ezen a buildben (csak asztali/böngésző
     funkció) - ha nem találod a "?" gyorsbillentyű-súgót, ez szándékos,
     ne jelentsd hibaként.

MI TUDOTTAN HIÁNYZIK / RÉSZLEGES (ne jelents ezekre hibát, tudjuk róla)

- A natív push (APNs) most már bekötött — kérjük, teszteld: engedélyezd
  az értesítéseket, küldj üzenetet egy másik fiókról, amíg az app teljesen
  háttérben/bezárva van, és nézd meg, hogy megjön-e az értesítés a valós
  tartalommal (a titkosított üzenet a készüléken fejtődik vissza).
- A QR-bejelentkezés (másik eszközről szkennelve) **béta** — a
  szervernek futtatnia kell a matrix-authentication-service-t (MSC4108
  rendezvous) ehhez, amit nem minden szerver (így ennek a projektnek a
  saját szervere sem) támogat még. Ha a bejelentkező képernyőn
  kiválasztott szerveren nem működik, ez várható; jelszavas bejelentkezés
  és regisztráció nem érintett.
- A szerver-oldali üzenetkeresés titkosított szobában 0 találatot ad
  (ez a Matrix E2EE természetes velejárója — a szerver nem tudja
  elolvasni a titkosított tartalmat). Az app ilyenkor a már betöltött
  üzenetek közt keres helyben — ezt teszteld, ne a szerver-keresést.
- Csoportos híváskor a JorKonvón kívüli Matrix kliensek (pl. Element
  Call) nem tudnak automatikusan csatlakozni egy JorKonvo-indította
  híváshoz — ez ismert, dokumentált korlát.
- App-ikon/splash-kép egyelőre a Capacitor alapértelmezés — ideiglenes.

MIT JELENTS

Eszköz + iOS verzió, pontos lépések, és ha lehet, képernyőkép. A
titkosítással/hívásokkal kapcsolatos hibák a legfontosabbak.
```

## English (en)

```
THANKS FOR TESTING JORKONVO

This is an early, actively-developed build. The web/desktop app has been
through many rounds against a real Matrix server; this iOS build is the
first one that actually compiles and runs on real Apple hardware — be
critical of it.

WHAT TO TEST

1. Sign in / register
   - Sign in with an existing Matrix account, OR create a new one.
   - The homeserver field is freely editable — try your own server too,
     not just the prefilled one.
   - Guest access, if your server allows it.

2. Create a space and rooms
   - Create a space, then a text channel and a voice channel inside it.
   - Invite a second account/device and have both join.

3. Encrypted messaging
   - Send a message in an encrypted room from two different
     accounts/devices — both sides must be able to read it.
   - Send an image/file too — it should arrive as an encrypted
     attachment.

4. Device verification
   - Start device verification (emoji comparison) against your other
     account/device. Both sides must show the SAME emoji sequence.

5. Voice/video calls
   - A 1:1 call in a DM (both audio and video).
   - A group call in a room, then join a persistent voice channel.
   - Mute/unmute, toggle noise suppression, push-to-talk if you enable
     it.

6. Notifications
   - Enable notifications, send a message from the other account while
     the app is backgrounded — a push/local notification should arrive.

7. Mobile UI polish (new, rounds 23-25)
   - Settings (user/room/space): drag rightward from the screen's LEFT
     edge — it should go back one level (detail pane -> category rail ->
     close), tracking your finger 1:1 as you drag.
   - Threads/search/members panels: drag to dismiss, same finger-tracking
     behavior.
   - During a call (1:1 and group): the mute/camera/hang-up control row
     must not sit inside the iPhone's home-indicator zone.
   - Long-press a room/member/message row: the context menu should open
     cleanly, with no text-selection highlight or handle bleeding out
     from under it.
   - Keyboard shortcuts are NOT present in this build (desktop/browser
     only) — if you can't find the "?" shortcuts help overlay, that's
     intentional, not a bug.

KNOWN GAPS / PARTIAL (please don't file these as new bugs, we know)

- Native push (APNs) is now wired up — please test it: enable
  notifications, send a message from another account while the app is
  fully backgrounded/closed, and check that the real content shows up
  (the encrypted message is decrypted on-device).
- QR sign-in (scanning from another device) is **beta** — it needs the
  homeserver to run matrix-authentication-service (MSC4108 rendezvous),
  which not every server (including this project's own) has enabled
  yet. If it doesn't work on the server you picked on the sign-in
  screen, that's expected; password sign-in and registration are
  unaffected.
- Server-side message search returns 0 results in encrypted rooms (an
  inherent property of Matrix E2EE — the server can't read encrypted
  content). The app falls back to searching already-loaded messages
  locally — test that path, not server search.
- In group calls, Matrix clients other than JorKonvo (e.g. Element
  Call) can't auto-join a call JorKonvo started — known, documented
  limitation.
- App icon/splash are still Capacitor placeholders — temporary.

WHAT TO REPORT

Device + iOS version, exact steps, and a screenshot if you can.
Encryption and call bugs are the highest priority.
```
