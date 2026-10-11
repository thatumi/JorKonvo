# iOS screen sharing (ReplayKit broadcast extension)

Status: **working end to end on the owner's real iPhone (2026-09-27,
build 90)** with the visible-picker start flow: broadcast starts, the other
call participant sees the screen, stopping via iOS's own control works.
Being reworked to one-tap start + in-app stop (see "Known limitations");
that revision still needs its own device test. Written on Linux with no
Mac/Xcode - every compile happens on Codemagic.

Getting there took several device rounds, all from integration mistakes,
not ReplayKit itself: ScreenSharePlugin.swift missing from project.pbxproj;
the plugin never registered (Capacitor iOS only auto-registers npm plugins
from capacitor.config.json's packageClassList - app-local ones need
`bridge.registerPluginInstance`, done in MainViewController, which
SceneDelegate - not Main.storyboard - must instantiate); and the
getDisplayMedia polyfill installed once at boot before WKWebView exposed
navigator.mediaDevices. The call UI swallowed every one of those errors
silently until GroupCallScreen's startScreenShare() began showing them.

## Why this exists, and why it's shaped differently from Android's

Like Android's WebView, iOS's WKWebView has no
`navigator.mediaDevices.getDisplayMedia`. But the fix can't be a straight
port of `androidScreenShare.ts` / `ScreenCapturePlugin.java`, because iOS's
screen-recording model is fundamentally different from Android's
`MediaProjectionManager`:

- **Android**: the app calls an API, gets a system consent dialog through an
  `ActivityResultLauncher` callback, and — once granted — owns a
  `MediaProjection` object it can start and stop whenever it wants, in its
  own process.
- **iOS**: an app can only show `RPSystemBroadcastPickerView`, a
  system-owned button. Tapping it opens Apple's own "Start Broadcasting"
  sheet, which only the user can confirm — there is no app-triggerable
  consent API. Once confirmed, capture happens in a **separate,
  short-lived, memory-constrained process**: a broadcast *upload extension*
  the system launches on its own, not a callback into the app. The app gets
  no object to call `stop()` on; only the user can end the broadcast, via
  iOS's own red status-bar / Dynamic Island recording indicator.

Both of those are real Apple platform constraints, not missing plumbing —
see "Known limitations" below for exactly how this surfaces in the UI.

## Architecture

```
GroupCallScreen.tsx (unchanged)
  └─ livekit-client setScreenShareEnabled(true, { resolution })
       └─ navigator.mediaDevices.getDisplayMedia(constraints)   ← polyfilled
            └─ apps/web/src/lib/iosScreenShare.ts
                 └─ ScreenShare.start()  (Capacitor plugin, JS side)
                      └─ App/ScreenSharePlugin.swift (main app process)
                           ├─ shows a dimmed backdrop with a real, visible
                           │    RPSystemBroadcastPickerView centered on top -
                           │    the user taps it themselves to open Apple's
                           │    "Start Broadcasting" sheet (an invisible-
                           │    picker + sendActions() auto-tap was tried
                           │    first and confirmed dead on a real device,
                           │    see "Known limitations")
                           └─ observes Darwin notifications (the only
                                cross-process signal available) for frames
                                and lifecycle state

                                        ⇣ (separate process, launched by iOS
                                           once the user confirms the sheet)

            ScreenShareBroadcast/SampleHandler.swift (RPBroadcastSampleHandler)
                 ├─ processSampleBuffer(_:with:) for each video frame
                 │    - downscale (CIImage, max long side 1280px) + JPEG
                 │      encode (~12 fps ceiling, matches Android's real-
                 │      world ceiling) + autoreleasepool per frame (tight
                 │      extension memory budget)
                 ├─ writes latest_frame.jpg to the shared App Group
                 │    container (group.dev.szabotar.jorkonvo), atomically
                 │    (write-to-tmp + replaceItemAt)
                 ├─ writes broadcast_state.txt on
                 │    broadcastStarted/Paused/Resumed/Finished
                 └─ posts a Darwin notification after each write
                      (CFNotificationCenter has no per-app sandboxing,
                      unlike NSNotificationCenter, so it's the only way a
                      separate-process extension can wake the app)

ScreenSharePlugin.swift, woken by that notification:
  ├─ "frame" notification  → reads latest_frame.jpg, base64s it,
  │    notifyListeners("frame", ...) to JS
  └─ "state" notification  → reads broadcast_state.txt,
       notifyListeners("state", ...) to JS; stops observing on "finished"

iosScreenShare.ts:
  ├─ "frame" listener → decodes base64 JPEG onto an offscreen <canvas>,
  │    canvas.captureStream(0) + track.requestFrame() per frame - the exact
  │    same decode/paint idiom as androidScreenShare.ts
  ├─ "state": "started" → resolves the promise that ScreenShare.start()'s
  │    caller is awaiting (see "No cancel signal" below)
  └─ "state": "finished" → the user stopped broadcasting from iOS's own
       system control; fires the track's 'ended' event, exactly like
       Android's own external-stop path, so livekit-client and the call UI
       don't need to know the two platforms end a share differently
```

## Setup that had to happen outside the repo (2026-09-27)

All in the Apple Developer Portal, by the account owner (an AI session
can't touch Apple's UI):

1. **App Group** `group.dev.szabotar.jorkonvo` registered.
2. **New App ID** `dev.szabotar.jorkonvo.ScreenShareBroadcast` registered,
   with the App Groups capability enabled and assigned to the group above.
3. **App Groups capability added to the main App ID** (`dev.szabotar.jorkonvo`
   already had Associated Domains from the 2026-09-27 Universal Links fix),
   assigned to the same group.
4. **Main app's "JorKonvo App Store" provisioning profile regenerated**
   (capability changes always require this) and re-uploaded to Codemagic.
5. **New provisioning profile** `jorkonvo-screenshare-broadcast` created for
   the extension's App ID and uploaded to Codemagic.
6. `codemagic.yaml`'s `ios_signing.provisioning_profiles` now lists both
   `jorkonvo` and `jorkonvo-screenshare-broadcast` — `xcode-project
   use-profiles` matches each to its target by bundle identifier.

## What's in the repo

- `apps/web/ios/App/ScreenShareBroadcast/` — the extension target:
  `SampleHandler.swift`, `Info.plist` (`NSExtensionPointIdentifier =
  com.apple.broadcast-services-upload`, `RPBroadcastProcessMode =
  RPBroadcastProcessModeSampleBuffer`), `ScreenShareBroadcast.entitlements`
  (App Group only).
- `apps/web/ios/App/App/ScreenSharePlugin.swift` — the main app's Capacitor
  plugin (`CAPBridgedPlugin`, pure Swift, auto-discovered by Capacitor's
  runtime class scan - no separate registration file needed).
- `apps/web/ios/App/App/App.entitlements` — gained the App Group array
  alongside the existing Associated Domains entry.
- `apps/web/ios/App.xcodeproj/project.pbxproj` — hand-edited (no Xcode
  available) to add the second target: its own `PBXNativeTarget`
  (`com.apple.product-type.app-extension`), build phases, an "Embed App
  Extensions" copy-files phase + target dependency on the main `App`
  target, and Debug/Release `XCBuildConfiguration`s pointing at the
  extension's own Info.plist/entitlements/bundle ID. Verified with a
  hand-rolled parser for the old-style ASCII plist grammar (balanced
  braces, every UUID reference resolves to a real object) — real
  structural validation still only comes from Xcode itself building it.
- `apps/web/src/lib/iosScreenShare.ts` + a call from `main.tsx` alongside
  the existing `installAndroidScreenShareBridge()`.

## Known limitations (real platform gaps, not shortcuts)

- **Stopping from the app goes through the extension.** The app gets no
  `RPBroadcastController` for a picker-started broadcast, so
  `ScreenSharePlugin.stop()` (reached from the call UI's own stop button via
  livekit's `track.stop()`) posts a `screenshare.stop` Darwin notification;
  `SampleHandler` answers by ending the broadcast itself with
  `finishBroadcastWithError`. iOS always shows a short system alert with that
  error's description when a broadcast ends this way - there is no silent
  variant - so it reads "Képernyőmegosztás leállítva." / "Screen sharing
  stopped." iOS's own red status-bar / Dynamic Island control also still works.
  (Earlier revisions of this doc said there was no in-app stop at all - wrong.)
- **No cancel signal.** If the user dismisses the picker overlay (tapping
  outside it) or backs out of the "Start Broadcasting" sheet instead of
  confirming it, there is no callback saying so — the extension may never
  even launch. `iosScreenShare.ts` covers this with a 30-second timeout
  waiting for the extension's "started" state before treating
  `getDisplayMedia()` as having failed (generous, since the user now has to
  notice the overlay, tap it, *then* confirm Apple's sheet - three human
  beats, not one); a user slower than that would see a spurious failure.
  Untunable without a real device to time it against.
- **No screen audio, no mic audio.** `SampleHandler` only processes
  `.video` sample buffers; `.audioApp`/`.audioMic` buffers are received but
  dropped, matching Android's own audio-less screen share.
- **~12 fps ceiling, ≤1280px long side.** A deliberate, untuned guess
  matching Android's real-world ceiling (`docs/ANDROID_SCREENSHARE.md`),
  chosen for the extension's tight memory budget — broadcast upload
  extensions have historically run with ~50MB, and an unthrottled pipeline
  of full-resolution frames would very plausibly get the extension killed.
  Real numbers need a real device.
- **One tap to start, with a visible fallback.** Our "Share screen" button
  adds the system picker invisibly and `sendActions()`-taps its internal
  button, so the user goes straight to Apple's mandatory "Start Broadcasting"
  sheet - the Discord-style one tap. That button is private view structure;
  if a future iOS changes it and the button can't be found, the real picker
  is shown on a dimmed backdrop for the user to tap instead. (An earlier
  revision of this doc called the auto-tap "confirmed dead on a real device".
  Wrong: in those builds ScreenSharePlugin wasn't compiled into the app or
  registered at all - see the git history of App/SceneDelegate.swift and
  project.pbxproj - so the auto-tap never actually ran.)

## Still to do (needs a real device + Codemagic build loop)

1. **First compile.** Confirm the hand-edited `.pbxproj` actually builds on
   Codemagic — the most likely first failure mode for a manually-added
   Xcode target.
2. **Real-device test**: start a share in a call, confirm the remote
   participant sees frames; stop via iOS's system control and confirm the
   call UI reacts (the local `'ended'` event path); background the app
   mid-share (does the extension keep running / does the app's own
   listener survive backgrounding — untested, ReplayKit extensions do
   keep running when the host app backgrounds, but the *Darwin
   notification observer in the app's own process* may or may not still
   fire promptly while backgrounded, which needs a real test).
3. **UI copy**: the call UI needs a line telling the user how to actually
   stop sharing on iOS (tap the red status-bar / Dynamic Island indicator),
   since there is deliberately no in-app stop button doing that job.
4. **Store/privacy copy**: `store/privacy-policy.md` and the Play/App Store
   listings currently only describe Android's screen-share behaviour;
   iOS's (once verified working) needs the same honest treatment,
   including the platform's own screen-recording indicator disclosure
   Apple expects apps to rely on rather than duplicate.
