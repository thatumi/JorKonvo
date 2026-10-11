# Android UI/UX audit

Physical device: Huawei P30 Pro, Android 10, 1080×2340. 2026-09-12. Real
account (`matrix.szabotar.dev`), not just guest browsing — see
docs/ANDROID.md for build/login notes.

## Fixed: hardware back button exited the app from inside a room
The big one — full writeup in docs/ANDROID.md. Confirmed broken live,
fixed, reconfirmed live: room→back now returns to the room list; a
modal→back now closes the modal; room-list→back still exits the app as
expected.

## Login screen
- Clean Material dark card, tabbed Password/Register/QR code control
  reads as Material, not an iOS segmented control.
- A real network round-trip against the live homeserver surfaced inline
  ("Guest access is disabled") without a crash or a stuck spinner —
  error states are handled gracefully.
- No `defaultTargetPlatform`/Cupertino-style branching found anywhere in
  `src/` (`grep -rl Cupertino` is empty — this is a plain web/CSS app,
  unlike JorFood/JorGym's Flutter+Cupertino gating) so there's no
  "wrong platform's widget" class of bug to check here beyond the back-
  button fix above.

## Space rail + room list (mobile single-pane)
- Renders as a proper single-pane list (space rail + room list stacked,
  no chat pane squeezed in beside it) at this phone's width — confirms
  `useIsMobile()`'s breakpoint is doing its job on a real device, not
  just in the responsive-mode simulator.
- Long room names truncate with an ellipsis rather than overflowing or
  wrapping awkwardly.

## Opening a room
- Header row (back arrow, room name, notification bell, search,
  overflow, members) all fit and are tappable at this width.
- E2E: messages sent before this device joined/verified show "This
  message couldn't be decrypted... or try re-verifying your session" —
  this is correct Matrix behavior for a new, unverified device, not a
  bug. Did not attempt cross-signing verification this pass (would
  need the recovery key flow end-to-end, out of scope for a build/nav
  audit).

## Modals
- "Discover servers" modal (from the compass icon) renders as a proper
  centered card with a dimmed backdrop and a visible ✕, reads as
  Material/neutral rather than iOS-flavored.
- Confirmed via the back-button fix above that it closes on hardware
  back without exiting the app.

## System bars / WindowInsets
- No content observed rendering under the status bar in any screen
  reached (login, room list, an open room, a modal). Did not
  specifically audit `env(safe-area-inset-*)` usage in the CSS this
  pass — JorKonvo's Capacitor Android setup matches JorNotes'
  (non-edge-to-edge default template, no `WindowCompat
  .setDecorFitsSystemWindows(false)`), so the same reasoning likely
  applies (native chrome reserves the space, CSS insets are iOS-only
  concerns) but wasn't independently re-verified file-by-file here.

## Fixed (deeper pass): back skipped panels, and killed active calls outright
Full writeup in docs/ANDROID.md. Two more gaps in the same back-button
listener, found by going deeper into mobile-only room UI:
- **Members panel** (and by the same code path: search, threads list, a
  single thread, the widgets panel) — back used to skip straight past it
  to the room list instead of just closing the panel. Confirmed live,
  fixed, reconfirmed live: Members open → back → closes Members, stays
  in the room.
- **Active calls** — joining a voice channel (a LiveKit group call) and
  pressing back killed the whole app process with no hangup sent.
  Confirmed live twice (two different voice channels), fixed,
  reconfirmed live both times: back now leaves the call cleanly and
  returns to the room list, app stays foregrounded. A 1:1 call would hang
  up the same way (same code path, not separately live-tested — no
  second account available to place one).

## Voice channel / group call screen
- Joining shows a clean full-screen call UI: avatar placeholder tile,
  "You" muted-mic badge, and a control row (mute, camera, headset/audio
  route, screen-share, speaker, settings gear, red hang-up) — all
  Material, good touch-target sizing, no iOS control shapes.
- Two system-level interruptions during testing, **neither an app bug**:
  the standard Android "Allow JorKonvo to record audio?" permission
  prompt (denied — testing didn't need a live mic), and Android's
  own repeated-denial "Deny & Don't ask again" escalation dialog on the
  second join attempt. Both are OS chrome, not app UI.

## Login screen
- Clean Material dark card, tabbed Password/Register/QR code control
  reads as Material, not an iOS segmented control.
- A real network round-trip against the live homeserver surfaced inline
  ("Guest access is disabled") without a crash or a stuck spinner —
  error states are handled gracefully.
- No `defaultTargetPlatform`/Cupertino-style branching found anywhere in
  `src/` (`grep -rl Cupertino` is empty — this is a plain web/CSS app,
  unlike JorFood/JorGym's Flutter+Cupertino gating) so there's no
  "wrong platform's widget" class of bug to check here beyond the back-
  button fixes above.

## Fixed: long-press context menus fought with native text selection
Full writeup in docs/ANDROID.md — raised directly by the user ("desktop
left-click does a lot; on mobile there's no left-click, so long-press
should stand in for it"). Turned out the long-press-to-context-menu path
already worked (Android's WebView fires the same `contextmenu` event on
long-press as a desktop right-click), but the OS's own text-selection
gesture fired at the same time, leaving a highlight + selection handle
visible under the menu. Confirmed live on a room row before the fix
(visible in the screenshot: a highlighted "kopo…" and a teal selection
handle peeking out from under "Set channel status"/"Mark as read"), and
confirmed clean after (menu opens identically, no artifact) — same
device, same room row, same gesture.

## Not checked this pass
- Video calls, screen share specifically (audio-only call tested),
  watch-together, forum posts, calendar events, 1:1 calls (no second
  account available on this device).
- Dark/light theme toggle (top-right corner control) — visible on the
  login screen but not exercised; the app opened directly into dark
  mode.
- System font-scale accessibility setting.
- The `MESSAGES`/`ROOMS` list's own touch-target sizing under a
  systematic tap-target audit (looked adequately sized by eye, not
  measured).
