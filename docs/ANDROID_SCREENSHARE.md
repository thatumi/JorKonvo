# Android screen sharing (getDisplayMedia bridge)

Status: **implemented and fully live-verified on the physical P30 Pro —
including a real two-participant LiveKit call with a remote viewer (branch
`feat/android-screenshare`, not merged; awaiting owner merge approval)**.

## Why this exists

The Android WebView does not implement `navigator.mediaDevices.getDisplayMedia`.
This was re-verified live before writing any code (2026-09-22, Huawei P30 Pro,
Android 10, `com.google.android.webview` **151.0.7922.199** — i.e. a current
Chromium): inside the running JorKonvo WebView,

```js
typeof navigator.mediaDevices.getDisplayMedia  // "undefined"
typeof navigator.mediaDevices.getUserMedia     // "function"
```

Camera/mic work because Capacitor's `BridgeWebChromeClient.onPermissionRequest`
translates a page's `getUserMedia` into native runtime permission prompts — but
there is no system counterpart for screen capture in the WebView, and no sign
of one landing in Chromium 151. (Upstream tracking: Chromium issue
"Android doesn't support screen capturing"; caniwebview.com lists the Screen
Capture API as unsupported.) So the app ships its own bridge.

## Architecture

```
GroupCallScreen.tsx (unchanged)
  └─ livekit-client setScreenShareEnabled(true, { resolution })
       └─ navigator.mediaDevices.getDisplayMedia(constraints)   ← polyfilled
            └─ ScreenCapture.start()  (Capacitor plugin, JS side)
                 └─ ScreenCapturePlugin.java (native)
                      ├─ MediaProjectionManager.createScreenCaptureIntent()
                      │    consent via Capacitor's @ActivityCallback
                      │    (ActivityResultLauncher, NOT deprecated
                      │    onActivityResult)
                      └─ ScreenCaptureService (foreground, mediaProjection)
                           ├─ startForeground BEFORE getMediaProjection
                           │    (Android 14+ ordering rule; A10 doesn't mind)
                           ├─ VirtualDisplay → ImageReader (RGBA_8888,
                           │    downscaled to the requested max long side)
                           ├─ Bitmap → JPEG(q70) → base64
                           └─ Bridge.eval → window.__jorkonvoScreenShareFrame(b64)
            └─ androidScreenShare.ts decodes each JPEG onto an offscreen
               <canvas>, canvas.captureStream(0) + requestFrame() per frame
            └─ MediaStream(canvas track) returned to livekit-client,
               which publishes it like any desktop screen share
```

Files:

- `apps/web/android/app/src/main/java/dev/szabotar/jorkonvo/ScreenCapturePlugin.java`
  — Capacitor plugin (`ScreenCapture.start/stop` + `stopped` event + frame push)
- `apps/web/android/app/src/main/java/dev/szabotar/jorkonvo/ScreenCaptureService.java`
  — foreground service owning MediaProjection / VirtualDisplay / ImageReader
- `apps/web/android/app/src/main/java/dev/szabotar/jorkonvo/MainActivity.java`
  — registers the plugin (`registerPlugin` BEFORE `super.onCreate()`, because
  the bridge is built inside `BridgeActivity.onCreate`)
- `apps/web/android/app/src/main/AndroidManifest.xml` — `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `<service android:foregroundServiceType="mediaProjection">`
- `apps/web/src/lib/androidScreenShare.ts` — the JS polyfill
- `apps/web/src/main.tsx` — installs the polyfill before anything renders

### The JS↔LiveKit contract (why no app code had to change)

livekit-client's `setScreenShareEnabled` path was read from its bundle to pin
this down:

- it calls `navigator.mediaDevices.getDisplayMedia({ audio: false, video:
  { width: {ideal}, height: {ideal}, frameRate } })` (from `ScreenSharePresets`;
  `video: true` for the "original" preset) — the polyfill maps those ideals to
  a `maxLongSide` cap (long screen edge, preserving aspect) and an fps ceiling;
- it wraps `stream.getVideoTracks()[0]` in a `LocalVideoTrack` and publishes it
  — a `canvas.captureStream()` video track is a plain MediaStreamTrack, so
  WebRTC publishing works like on desktop;
- stopping from the app goes `unpublishTrack` → `LocalTrack.stop()` →
  `Track.stop()` → `this._mediaStreamTrack.stop()` — the polyfill overrides
  `track.stop` on the canvas track to also tear down the native projection;
- stopping from the system (notification Stop, projection killed, another app
  takes the projection) surfaces as the plugin's `stopped` event, on which the
  polyfill stops the track and dispatches `new Event("ended")` on it (spec:
  `stop()` alone does not fire `ended`) — exactly what livekit-client listens
  for to unpublish;
- a denied consent dialog rejects with `NotAllowedError`, same as on the web;
- install order: `main.tsx` installs the override before React renders.
  livekit-client's bundled webrtc-adapter would otherwise install its legacy
  getUserMedia-fallback shim at import time; whichever installs first, the
  polyfill's assignment wins because it runs last.

## Why route (a): base64 JPEG over evaluateJavascript

The task suggested starting with (a) `evaluateJavascript` + base64 JPEG frames
and falling back to (b) a loopback HTTP/MJPEG server if (a) is too slow.
Measured live on the P30 Pro (see below), (a) sustains the target frame rate
at usable frame sizes with the *degenerate worst case* — the capture feeding a
fullscreen `<video>` of itself (a feedback tunnel) — so (b) was not needed.
(a) is also strictly less machinery: no sockets, no cleartext listeners, no
extra lifecycle. If higher fidelity per frame ever matters, bumping
`JPEG_QUALITY` (70 today) or the fps cap is a one-line change; (b) remains the
documented escape hatch.

## In-call end-to-end verification (2026-09-22, two real accounts)

After the bridge-level matrix below, the full in-call path was verified with
two participants: the phone (test app, logged in as the owner's account) and
a desktop browser (jorkonvo.szabotar.dev, logged in as a second test account
created for this purpose), both in a voice channel ("ScreenShare Test /
share-test") on the live homeserver:

| Step | Result |
| --- | --- |
| Real call UI "Share screen" button | raises the system consent dialog (ALLOW granted via uiautomator tap) |
| Publish → remote view | the desktop participant's tile shows the phone's live screen (886×1920) — see `.hub/screenshots/android-screenshare-remote-view.png` (the shared content recursively contains the phone's own call UI, "Group call · 2 participants") |
| Remote frame liveness | `getVideoPlaybackQuality().totalVideoFrames` advanced at **~12.8 fps** on the remote side |
| Toggle OFF from the phone's call UI | remote tile removed instantly, call intact (2 participants) |
| External stop via the notification's "LEÁLLÍTÁS" action mid-call | remote tile removed with zero phone-side interaction — the `stopped` event → track `ended` → LiveKit unpublish chain propagates through the SFU |
| HOME (background) with share active mid-call | share survives; frames resume on screen changes (87→112 frames across shade toggles while backgrounded — static screens correctly produce no frames) |
| Local tile on the phone | the sharing participant's own call UI renders its screen-share tile; button state correct |

Two test-infrastructure findings worth remembering:

- **One account = one call participant.** The LiveKit identity minted by
  lk-jwt-service is user-level, so joining the same call from a second device
  of the same account *replaces* the first connection (the phone was kicked
  when the desktop joined as the same user). Real two-party testing needs two
  accounts.
- Guest login is disabled on the live homeserver and registration is
  token-gated, so the second account had to be created by the owner.

## Bridge-level live test results (physical P30 Pro, Android 10 / EMUI, WebView 151)

Method: the debug app installed under the parallel suffix (see below), driven
over Chrome DevTools Protocol (`adb forward` of the WebView's devtools socket,
`Runtime.evaluate`) plus `uiautomator dump` + `input tap` to answer the system
consent dialog. Every number below is from the device, not an emulator.

| Check | Result |
| --- | --- |
| Polyfill present before app code runs | `typeof getDisplayMedia === "function"` |
| Consent dialog (system) | Appears; `ALLOW` → stream resolves |
| 720p preset constraints (`1280×720` ideals) | canvas track **590×1280** (aspect-true scale of the 1080×2340 panel) |
| `video: true` ("original", defaults 1920×1080) | canvas track **886×1920** |
| Frames native→JS | 60 base64 frames delivered across a few screen transitions |
| Presented frames on a `<video>` (rVFC) | 91 frames / ~6 s ≈ **15 fps** sustained (feedback tunnel) |
| Native-side stats (fixed log) | **15.4–16.0 fps**, JPEG **78–82 KiB** @ 886×1920 q70 |
| 1080p30 preset (app default) | saturates ≈ **15.5 fps** effective — 30 fps is not reachable; degradation is frame-drop, never failure |
| Feedback screenshot | screenshot shows a clean ~15-generation recursion tunnel (quality survives many lossy generations) |
| Foreground notification | channel + title "Képernyőmegosztás folyamatban" + "Leállítás" action, present while capturing, gone after |
| App backgrounded (HOME) during capture | service stays foreground, **frames keep flowing** (EMUI 10 does not kill the projection under the FGS) |
| Stop via notification action | track `readyState: "ended"`, **exactly 1 `ended` event** (what livekit-client needs to unpublish), JS hook removed, service destroyed |
| Stop via `track.stop()` (the LiveKit unpublish path) | same full teardown incl. service gone from `dumpsys` |
| Stop via `ScreenCapture.stop()` (plugin) | "stopped" event cleans up JS side standalone |
| Consent DENY | rejects `NotAllowedError: User denied screen capture permission` |
| CPU during active capture (feedback worst case) | ~1.0–1.7 cores at 590×1280/886×1920; **0% idle after stop** |

Known-behaviour notes: a `dumpsys activity services` record for the service
can linger for seconds after a clean stop (display artifact; the service is
functionally dead — 0% CPU, no frames, notification archived). Frames only
arrive when screen content changes (that's how VirtualDisplay mirroring works),
so a static screen correctly produces ~0 fps.

## Android version specifics

- **Ordering (API 34+):** the `mediaProjection`-typed foreground service must
  be running *before* `getMediaProjection()` — reversed order throws
  `SecurityException` on Android 14+. The service therefore calls
  `startAsForeground()` first; Android 10 doesn't care but takes the same path.
- **Consent is single-use (API 34+):** every `start()` requests fresh consent;
  result data is never reused, so the Android 14 "consent already consumed"
  failure cannot happen.
- **`registerCallback` before `createVirtualDisplay` (API 34+)** is satisfied.
- **`FOREGROUND_SERVICE_MEDIA_PROJECTION`** is declared for API 34+ devices;
  the target device (API 29) only needs the service type + `FOREGROUND_SERVICE`.
- **POST_NOTIFICATIONS (API 33+):** on devices where the user denied
  notification permission the FGS still runs (capture keeps working) but its
  notification is hidden — the runtime prompt is the app's general one, not
  screen-share specific. Untested (no API 33+ device here).

## Limitations (honest list)

- **Effective fps ceiling ≈ 15–16 at 1080-class sizes on this phone.** The
  30 fps presets degrade to that gracefully (drop-oldest keeps latency low).
  Screen content is mostly static, so this is rarely visible; bump it only
  with a faster transport than (a) if ever needed.
- **No screen audio.** MediaProjection audio capture is not bridged; the
  polyfill ignores `audio` constraints (a video-only screen share, like
  desktop shares without audio).
- **Rotation is not re-negotiated.** The VirtualDisplay has a fixed size;
  rotating the device mirrors the rotated content into that surface. Not
  verified live yet (P30 Pro was held portrait throughout).
- **The notification's small icon is the app launcher mipmap** — acceptable,
  but a monochrome glyph would be nicer on some OEM shades.
- **In-call end-to-end (LiveKit publish → other participant sees the share)
  is verified** (see the section above); remaining untested-in-call slivers
  are only multi-party (>2) scaling and long-session stability.

## Testing note: parallel install (`-PjkParallelInstall`)

The phone already carried a debug build of `dev.szabotar.jorkonvo` signed by a
*different* machine's debug key (verified by comparing APK signer SHA-256 via
`apksigner`), so a plain `installDebug` fails with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE` and uninstalling would wipe that
install's logged-in session + E2EE keys — not acceptable mid-test. Therefore:

```
cd apps/web/android
JAVA_HOME=/usr/lib/jvm/java-21-openjdk ./gradlew installDebug -PjkParallelInstall
```

installs **beside** it as `dev.szabotar.jorkonvo.screencap` (an
`applicationIdSuffix` that only activates with that flag; default builds are
byte-identical in identity). The test app is currently installed on the phone
and can be removed with a normal uninstall whenever convenient.

## Open items

1. **Merge approval**: the branch's gate is green (build + lint 0 errors +
   vitest identical to the main baseline) and both the bridge-level and the
   in-call live verifications are done — merging `feat/android-screenshare`
   just needs the owner's go.
2. **Installing on the owner's signed install**: build on the machine whose
   debug keystore signed it, or `adb uninstall dev.szabotar.jorkonvo` +
   reinstall (re-login required — E2EE keys re-establish on login). The
   parallel test app (`dev.szabotar.jorkonvo.screencap`) is still installed
   on the P30 Pro and logged in as the owner; its session shows up as an
   unverified device until removed/verified.
3. Test residue on the live server (kept deliberately for the owner's own
   re-verification): space "ScreenShare Test" with voice channel "share-test"
   on the thatumi account, and the second test account used by the remote
   viewer.
4. Optional polish: rotation re-negotiation, dedicated small notification
   icon, and revisiting transport (b) if higher fps/fidelity is ever needed.
