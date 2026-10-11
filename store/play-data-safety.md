# JorKonvo — Play "Data safety" form answers

Derived from the code, the merged release manifest and `store/privacy-policy.md`
(2026-09-19; permissions re-checked 2026-09-24 after the Android screen-share
merge; push notifications added 2026-09-29 — versionCode 3, `event_id_only`
pusher with on-device fetch + decryption). JorKonvo is a **Matrix client**: user data goes to the *homeserver
the user chooses*. The sign-in screen pre-fills `https://matrix.szabotar.dev`,
which the developer operates → for users of that default server the developer
*is* the operator and collects the data below. For users who type another
homeserver the data goes to that (third-party) operator, not the developer.
Declare on the conservative side (developer-operated default server).

**E2EE precision (do not overstate):** message content, attachments, edits and
reactions are end-to-end encrypted **only in rooms marked with a lock icon**
(matrix-sdk-crypto-wasm / rust-crypto). The homeserver still sees account id,
device list, room membership, timestamps, who-talks-to-which-room, IP, and the
full content of *unencrypted* rooms. Group calls through the LiveKit SFU are
**not** E2EE media; 1:1 calls are peer-to-peer WebRTC (TURN relays see
ciphertext only). Play has no E2EE checkbox: declare the data as collected and
"encrypted in transit"; the E2EE statement goes only in the store description.

**Push notifications (from versionCode 3):** the app registers an FCM token as
a Matrix pusher in the **`event_id_only`** format; the homeserver sends each
notification to the developer's push gateway (`push.szabotar.dev`, Sygnal),
which forwards it through Google FCM. Gateway and FCM carry **identifiers
only**: room ID, event ID, unread count, the FCM token, and the Matrix user ID
(`jk_uid`, which the app puts in the pusher's default payload so a
multi-account device knows which account the push is for). **No sender, room
name, message text or ciphertext passes through the gateway or Google.** The
phone then fetches the event from the user's homeserver over HTTPS with the
account's access token and, for encrypted rooms, decrypts it on the device
(Megolm keys the app exported to local storage while it ran). Google acts as a
**service provider** delivering the push on the developer's behalf, which Play
does not count as "sharing"; the identifiers it carries are covered by the
User-ID and Device-ID rows below. The event fetch goes to the homeserver, i.e.
the Messages collection already declared — nothing new. The on-device
notification store (homeserver URL, access token, preview mode, Megolm keys in
"Full preview" mode only, a room-name / DM / space / member-display-name
directory, avatar thumbnails; app-private storage, AES-256-GCM with a
non-exportable Android Keystore key) **never leaves the device**, so it is not
"collected" in Play's sense (data processed only on the device isn't
collected) — no extra row. It is deleted when push is turned off on the
device, the preview is set to "Hidden", or the account signs out. The Firebase
Messaging SDK also creates a Firebase installation ID; no Firebase Analytics.

## Overview
| Question | Answer | Basis |
|---|---|---|
| Collects/shares required data types? | **Yes** (with the developer-run default homeserver) | above |
| Encrypted in transit? | **Yes** | CSP `connect-src https:` only; `usesCleartextTraffic="false"`; homeserver URLs must be https |
| Deletion request? | **Yes** | In-app account deletion (User settings → Account → "Delete account" → "Delete my account", `packages/matrix-core/src/accountDeletion.ts`; depends on the homeserver supporting it); email szabotar@szabotar.dev |
| Account creation | Username + password (Matrix), in-app *Register* tab | `LoginScreen` |
| Account-deletion URL | https://jorkonvo.szabotar.dev/delete-account.html (also `/delete-account`) — in-app steps, what is deleted/kept, email fallback | `apps/web/public/delete-account.html` |
| Privacy policy URL | https://jorkonvo.szabotar.dev/privacy.html (also `/privacy`) | `apps/web/public/privacy.html`, rendered from `store/privacy-policy.md` |

## Data types
| Play type | Collected | Shared | Purpose | Optional |
|---|---|---|---|---|
| Personal info → User IDs (Matrix ID) | Yes; with push on, also carried in the push payload (`jk_uid`) via the gateway and Google FCM (service provider) | No | Account management, App functionality | No |
| Personal info → Email address / Phone | Only if the user adds one (password recovery) | No | Account management | Yes |
| Personal info → Name (display name), profile picture | Yes if set | Visible to other room members (user-directed) | App functionality | Yes |
| Messages → Emails/SMS/**Other in-app messages** | Yes — E2EE content in encrypted rooms (server cannot read), **plaintext in unencrypted rooms** (at the homeserver). Push notifications do **not** carry message content: FCM gets room/event IDs only, the phone fetches and decrypts the message itself | Delivered to recipients/federated servers by user action | App functionality | No (core) |
| Photos and videos; Files and docs | Yes (attachments; E2EE in encrypted rooms) | to recipients by user action | App functionality | Yes |
| Audio → **Voice or sound recordings** | Yes (voice messages uploaded like attachments; call audio is not stored) | to recipients by user action | App functionality | Yes |
| Location → Approximate/precise | Only if the user shares a location message / live location (WebView Geolocation prompt; no Android location permission in the manifest) | to room members by user action | App functionality | Yes |
| Device or other IDs (device id / session list; FCM push token + Firebase installation ID when push is on) | Yes | No (FCM = service provider) | Account management, Security, App functionality (notifications) | No |
| App activity (read receipts, typing, presence) | Yes if enabled | room members | App functionality | Yes |
| Web browsing, financial info, health, contacts, calendar | **No** | — | — | — |
| Diagnostics / crash logs / analytics / ads | **No** (no such SDK) | — | — | — |

**Sharing:** no data is shared with third parties for their own purposes. Federation
(delivering messages to users on other homeservers), LiveKit/coturn call
infrastructure operated by the homeserver operator, and push delivery through the
developer's gateway + Google FCM (identifiers only) are part of the requested service; the privacy
policy explains all three.

## Security practices
Encrypted in transit: Yes · Deletion mechanism: Yes · Independent review: No ·
Families policy: No.

## Merged manifest permissions ↔ policy
INTERNET; CAMERA (QR sign-in, video calls, take-photo) — `uses-feature camera
required=false`; RECORD_AUDIO (voice messages, call audio) — `microphone
required=false`; MODIFY_AUDIO_SETTINGS (route call audio to speaker);
POST_NOTIFICATIONS (push notifications via FCM while the app is closed,
`JorKonvoMessagingService`; also the ongoing screen-share notification);
`com.google.android.c2dm.permission.RECEIVE`, WAKE_LOCK, ACCESS_NETWORK_STATE
(added by the Firebase Messaging library to receive FCM pushes); VIBRATE
(haptics / notification vibration); FOREGROUND_SERVICE +
FOREGROUND_SERVICE_MEDIA_PROJECTION (the `mediaProjection`-typed
`ScreenCaptureService` for in-call screen sharing — starts only after the user
taps "Share screen" and accepts the system MediaProjection consent prompt,
shows an ongoing notification with a Stop action while active; frames go only
into the call, nothing is stored). All are listed in `privacy-policy.md`
§ Device permissions. The merged manifest also carries AndroidX's internal
signature-level `dev.szabotar.jorkonvo.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`
(not user-facing). No location, contacts or storage permission.

**Play Console note:** declaring `FOREGROUND_SERVICE_MEDIA_PROJECTION` means the
Console's *Foreground service permissions* declaration must be filled in
(type: media projection; use: user-initiated in-call screen sharing; a short
video of starting a share from a call is typically requested). Screen content
shared in a call is transmitted ephemerally to the call and not collected or
stored — no extra Data safety data type is needed for it.
