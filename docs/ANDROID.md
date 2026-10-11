# Android

## Build

```
npm install                     # repo root
npm run build                   # matrix-core + apps/web (npm run build:matrix-core && build:web)
cd apps/web && npx cap sync android
cd android && ./gradlew assembleDebug
```

`android/` already existed in the repo (Capacitor 8.5, appId
`dev.szabotar.jorkonvo`) — no scaffolding needed.

**JDK note**: this Capacitor 8.5/AGP toolchain needs JDK 21 —
`./gradlew assembleDebug` fails with `Java compilation initialization
error: invalid source release: 21` on JDK 17. If the system only has 17
(true on this build box as of 2026-09-12), download a local JDK 21
(no root/apt needed) and point `JAVA_HOME` at it just for the build:

```
mkdir -p ~/jdks && cd ~/jdks
curl -L -o jdk21.tar.gz "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
tar xzf jdk21.tar.gz && rm jdk21.tar.gz
export JAVA_HOME=~/jdks/jdk-21.0.12.1+1   # exact folder name varies by release
```

Output: `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`.

## Verified live on a physical device (2026-09-12)

Huawei P30 Pro, Android 10. Installed and signed in with a real
`matrix.szabotar.dev` account. Verified live: password sign-in, session
restore across a fresh app launch, the space rail + room list, opening a
room (E2E messages correctly show "couldn't be decrypted" pending this
device's own key verification — expected, not a bug), sending/receiving
reactions, opening a modal (Discover Servers), and logout.

Two system dialogs appeared during first sign-in that are **not** app bugs,
just this device's own OS/OEM chrome layered over any login form:
Chrome's "Save username and password?" prompt, and — more surprising —
Huawei's own `HwKeychainSaveActivity` asking the **same** question a
second time via the OEM keychain, which briefly triggered Android's
"Enter lock screen password" system credential-confirmation screen (a
`FLAG_SECURE` screen — screenshots come back empty on it, confirmed via
`uiautomator dump` instead). Dismissing both (Cancel / Never Save) let
sign-in proceed normally. Nothing for the app to handle differently.

## Found and fixed: hardware back button exited the app from inside a room

**This app has no router** — no `react-router`, no `history.pushState`
anywhere (`grep -rl react-router src/` is empty). Every view (room list,
an open room, Friends/Events/Inbox, a modal) is plain Zustand state
(`state/uiStore.ts`, `state/modalStore.ts`), never a URL change. That
means the WebView's own back-history is permanently empty on Android.

Capacitor's default Android back-button behavior is: if
`webView.canGoBack()`, navigate the WebView back; otherwise finish/
background the activity. With no router, `canGoBack()` is always false,
so **every** hardware/gesture back press exited straight to the
launcher — confirmed live on-device before the fix: opening a room and
pressing back closed JorKonvo entirely instead of returning to the room
list.

Fix: added the official `@capacitor/app` plugin (was not a dependency
before this) and a new `src/lib/nativeBackButton.ts`, wired from
`App.tsx`, that intercepts `backButton` with this priority:
1. A modal (`useModalStore`) or dialog (`useDialogStore`, the app's
   alert/confirm/prompt replacements) is open → dispatch a synthetic
   `Escape` `KeyboardEvent`. Both `Modal.tsx` and `DialogHost.tsx`
   already close on Escape, so this reuses that tested path instead of
   reaching into their state directly.
2. Else, on the mobile single-pane layout (`lib/useIsMobile.ts`, now
   also exporting a non-hook `isMobileNow()` for this call site) with a
   room or a view (Friends/Events/Inbox) open → `selectRoom(null)`,
   returning to the room list, mirroring what `MainLayout`'s own
   list↔chat swipe-back gesture already does.
3. Else → `CapApp.exitApp()`. Registering **any** `backButton` listener
   opts the app out of Capacitor's default handling entirely, so this
   explicit exit call is what keeps "back from the top level exits the
   app" working at all.

Verified live on-device, both before and after:
- Before: room open → back → app exited to the Lawnchair launcher.
- After: room open → back → returns to the room list; back again at the
  room list → app exits normally; a modal open → back → modal closes,
  app stays foregrounded.

Gate: `npx tsc -b` (typecheck) clean, `npm run lint` clean (0 new
warnings — only the pre-existing baseline ones), `npx vitest run` 471
passed + 1 pre-existing skip, `npm run build` clean, `gradlew
assembleDebug` clean.

Only touches `apps/web` — `@capacitor/app` was added as a normal npm
dependency (present in `apps/web/package.json`, synced into
`android/`); the iOS project wasn't touched and doesn't need this fix
(no hardware back button), but will pick up the same dependency on its
next `cap sync ios` — worth a build-sanity check next time iOS is built,
though nothing in this change is Android-conditional at the JS level
other than the module being a no-op via `Capacitor.isNativePlatform()`
guard on web.

## Found and fixed (deeper pass, 2026-09-12 later): back also skipped panels and killed active calls

A deeper screen-by-screen pass went past the room list/modal cases above
into deeper mobile-only UI and found two more gaps in the same
back-button listener:

**1. Full-screen room sub-panels weren't in the priority chain.**
`ChatArea.tsx` has several mobile-only `fixed inset-0` overlays on top of
a room — the member list (`memberListOpen`), search (`searchOpen`), the
threads list (`threadsListOpen`), a single thread (`activeThreadRootId`),
and the widgets panel (`widgetsPanelOpen`) — each with its own on-screen
back arrow, all backed by plain `useUiStore` booleans the original
listener never checked. Confirmed live: opening Members from inside a
room and pressing hardware back skipped straight past the room to the
room *list*, instead of just closing the Members panel and staying in
the room. `nativeBackButton.ts` now checks these first (mobile-only,
before the room/view check), in most-specific-first order, reusing each
panel's own close action — `closeThread()` in particular already knows
to land on the threads list rather than the chat, if that's where the
thread was opened from, so reusing it here is free.

**2. An active call had nothing to catch it at all.** Confirmed live:
joining a voice channel and pressing hardware back fell all the way
through to `CapApp.exitApp()` — killing the whole app process outright,
with no hangup signal sent to the room and no chance to warn the user
(no worse than what Capacitor's own default back handling would have
done here, since this is a single-Activity app and "finish the activity"
kills the process the same way, but not an improvement either — the gap
just wasn't there to fix at all originally). Now checked immediately
after the modal/dialog case, before anything else: a 1:1 call
(`useCallStore`) hangs up via `call.hangup(CallErrorCode.UserHangup,
false)` (the same call the on-screen hang-up button makes); a group/
LiveKit call (`useGroupCallStore`) leaves via the store's own `leave()`.

Verified live, both bugs, before and after:
- Members panel open → back → (before) skipped to room list; (after)
  closes Members, stays in the room.
- Group call joined → back → (before) app exited to the launcher
  outright; (after) leaves the call cleanly, returns to the room list,
  app stays foregrounded. Repeated with a second voice channel to
  confirm it wasn't a fluke.

Gate: `npx tsc -b` clean (needs `npm run build:matrix-core` first in a
fresh checkout — `@jorkonvo/matrix-core` is a workspace package with its
own build step), `npm run lint` clean (0 new warnings), `npx vitest run`
471 passed + 1 pre-existing skip (unchanged), `npm run build` clean,
`gradlew assembleDebug` clean.

## Found and fixed: long-press context menus fired the native text selection too

The user flagged this directly: on desktop, right-click opens context
menus (room rows, member rows, messages — `useContextMenu` in
`ContextMenu.tsx`) for a bunch of actions; those same rows only ever
wire an `onContextMenu` handler, no separate touch/long-press code at
all. Checked live on the physical device whether that's actually a gap:
**it isn't, functionally** — Android's WebView already synthesizes a
`contextmenu` DOM event on long-press, same as a desktop right-click, so
the exact same menu already opens correctly on a long-press (confirmed
live: long-pressing a room row opened the full "Set channel status /
Mark as read / Notifications / Favourite / …" menu).

What *is* broken, and was visible in the same screenshot: the OS's own
long-press text-selection also starts at the same time — the event's
`preventDefault()` stops the *contextmenu* default action but doesn't
retroactively cancel the selection gesture the touch already kicked off,
so a text-highlight and a selection handle bled out from under the
custom menu. Confirmed live before the fix, on a room row.

Fix: a new `.jk-ctx-target` CSS class (`user-select: none` +
`-webkit-touch-callout: none`) in `index.css`, added to every element
that carries an `onContextMenu` handler — `RoomRow`, `VoiceChannelRow`
(and its inline member rows), the category header, `MemberList`'s
`MemberRow`, and `MessageLine`'s row wrapper. All of these are either
identity/label text (room and member names) or, for messages, a row that
already has its own "Copy Text" menu action (`msgMenu.copyText`) — native
drag-select was never the intended way to copy from any of them, so
suppressing it outright is safe and, for messages, actually more
consistent with how the app already expects users to copy text.

Verified live, before and after: long-pressing a room row — (before) menu
opens correctly but a text-selection highlight/handle bleeds out from
under it; (after) menu opens the same way, with no selection artifact at
all.

Gate: `npx tsc -b` clean, `npm run lint` clean (0 new warnings),
`npx vitest run` 471 passed + 1 pre-existing skip (unchanged), `npm run
build` clean, `gradlew assembleDebug` clean.

## Release signing

`app/build.gradle` reads `apps/web/android/key.properties` for the
`release` build type's signing config, falling back to the debug key when
that file is absent — a fresh checkout or CI still builds fine, just with
a debug-signed release APK/AAB. **Neither a real keystore nor
`key.properties` is ever committed** (`android/.gitignore` excludes
`*.jks`, `*.keystore`, and `key.properties` explicitly).

To set up a real upload keystore for a signed release build:

```
cd apps/web/android
keytool -genkey -v -keystore my-upload-key.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias upload
```

Then create `apps/web/android/key.properties` (gitignored) next to it:

```properties
storeFile=../my-upload-key.jks
storePassword=<the keystore password>
keyAlias=upload
keyPassword=<the key password>
```

**`key.properties` itself is read relative to `android/` (the Gradle root
project), but the `storeFile` path inside it is resolved by
`app/build.gradle`'s own `file(...)` call — relative to `android/app/`,
not `android/`.** Keeping the `.jks` next to `key.properties` in
`android/` (as generated above) means `storeFile` needs the `../` prefix
shown here; verified empirically (a `storeFile=my-upload-key.jks` without
`../` fails with `Keystore file '.../android/app/my-upload-key.jks' not
found` even though the real file sits in `android/`) — put the keystore
inside `android/app/` instead if you'd rather not think about the prefix.
With `key.properties` correctly pointing at the file, `./gradlew assembleRelease` (or
`bundleRelease` for an AAB) signs with it instead of the debug key —
verify with `apksigner verify --print-certs` on the output. Google Play
App Signing means this "upload key" doesn't have to be the same key
users' installed APKs are ultimately signed with; Play re-signs with its
own managed key on upload, so losing this one later is recoverable
through Play Console, unlike a pre-App-Signing-era key loss.

## Native plugins — Android behavior

Before this change, the only Capacitor dependency was `@capacitor/core`
itself — no push notifications, no status bar/splash plugins, no custom
native Android or iOS code beyond the stock generated `MainActivity`.
Nothing to check for Android-vs-iOS native-plugin divergence; the app is
a plain WebView wrapper. `@capacitor/app` (added by this pass, see
above) is now the only plugin, and it's cross-platform by design — no
Android-specific no-ops to document.
