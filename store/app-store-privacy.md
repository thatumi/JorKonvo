# JorKonvo — App Store Connect "App Privacy" answers

For App Store Connect → App → **App Privacy** (the "nutrition label").
Derived from the code, `Info.plist` / `App.entitlements` and
`store/privacy-policy.md` (2026-09-29, with push notifications phase 2). Same basis
as `store/play-data-safety.md`: JorKonvo is a Matrix client, the sign-in
screen pre-fills the developer-operated `https://matrix.szabotar.dev`, and push
notifications go through the developer-operated gateway `push.szabotar.dev` —
so declare on the conservative side, as if the developer collects it.

**What push changes (why this form waited for it):** the app registers its APNs
device token as a Matrix pusher in the **`event_id_only`** format. The
homeserver sends the developer's gateway — and the gateway sends Apple (APNs) —
**identifiers only**: room ID, event ID, unread count, and the Matrix user ID of
the target account (`jk_uid`, which the app itself put in the pusher's default
payload), plus a fixed "New message" alert key. No sender, room name, message
text or ciphertext. The app's **Notification Service Extension** then fetches
the event from the user's homeserver over HTTPS with the account's access
token and, for encrypted rooms, decrypts it **on the device** (Megolm keys the
app exported to local storage while it ran). So what the developer's gateway
and Apple handle is the APNs token (Device ID) and the Matrix user ID (User
ID) — no user content. The on-device notification store (homeserver URL,
access token, preview mode, Megolm keys in "Full preview" mode only, a
room-name / DM / space / member-name directory, avatar thumbnails; App Group
container shared with the extension, AES-256-GCM with a this-device-only
Keychain key, excluded from backups) never leaves the device, so it is not
"collected" in Apple's sense (data processed only on the device isn't
collected).

## Top-level questions

| Question | Answer |
|---|---|
| Do you or your third-party partners collect data from this app? | **Yes** |
| Is any data used to track users (across apps/websites of other companies)? | **No** — no ads, analytics or tracking SDKs, no data broker |
| Privacy policy URL | https://jorkonvo.szabotar.dev/privacy.html |

## Data types to select

For every type below: **Linked to the user: Yes** (it belongs to the Matrix
account) · **Used for tracking: No**.

| App Store category → type | Purpose(s) | Notes |
|---|---|---|
| Contact Info → **Email Address** | App Functionality (account recovery) | Only if the user adds one; optional |
| Contact Info → **Phone Number** | App Functionality | Only if the user adds one; optional |
| Contact Info → **Name** | App Functionality | The display name, if set; visible to room members |
| User Content → **Emails or Text Messages** | App Functionality | Chat messages. Plain text in unencrypted rooms (homeserver); E2EE content in encrypted rooms. Push notifications no longer carry message text (`event_id_only`; the extension fetches and decrypts on the device) |
| User Content → **Photos or Videos** | App Functionality | Attachments, profile/room pictures |
| User Content → **Audio Data** | App Functionality | Voice messages (call audio is not stored) |
| User Content → **Other User Content** | App Functionality | Reactions, polls, stickers, files |
| Location → **Precise Location** | App Functionality | Only when the user shares a location / live location |
| Identifiers → **User ID** | App Functionality | Matrix ID — with push on, also sent in the push payload (`jk_uid`) through the developer's gateway to APNs, to pick the right account |
| Identifiers → **Device ID** | App Functionality | Matrix device id + the **APNs push token** (push notifications) |

**Do not select:** Health & Fitness, Financial Info, Contacts, Browsing
History, Search History, Purchases, Diagnostics (no crash/analytics SDK),
Usage Data for analytics, Sensitive Info, Other Data.

## Owner decisions / checks

- Read receipts, typing and presence are Matrix protocol events delivered to
  other room members; they are covered by "Emails or Text Messages / Other
  User Content" above. If Apple review asks, "Product Interaction" is *not*
  collected for analytics.
- Screen sharing (ReplayKit) frames go only into the call and are not stored
  — no data type needed (same reasoning as the Play form).
- Communication Notifications (sender's / space's picture on the
  notification) use a locally donated `INSendMessageIntent`. That is
  on-device OS behaviour (iOS may use it for Siri / share-sheet
  suggestions); nothing is sent to the developer — no data type needed.
- Re-check this page whenever the pusher format, the gateway or an SDK
  changes. Push phase 2 (`event_id_only` + fetch/decrypt in the Notification
  Service Extension) shipped on 2026-09-29 and added no data type. If a
  pusher ever uses the full format again, message text would pass through
  the gateway and APNs, and the User Content note above must change.
