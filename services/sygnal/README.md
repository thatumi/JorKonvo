# Sygnal - JorKonvo push gateway (iOS, Android, Web)

[Sygnal](https://github.com/matrix-org/sygnal) is the official Matrix
[Push Gateway](https://spec.matrix.org/latest/push-gateway-api/). One
container on jorbox serves all three platforms at
`https://push.szabotar.dev/_matrix/push/v1/notify`:

| app_id | pushkin | upstream |
|---|---|---|
| `dev.szabotar.jorkonvo.ios` | `apns` (token auth, `.p8`) | Apple APNs, production |
| `dev.szabotar.jorkonvo.android` | `gcm`, `api_version: v1` | Firebase Cloud Messaging (project `jorkonvo`) |
| `dev.szabotar.jorkonvo.web` | `webpush` (VAPID) | the browser's push service |

It replaces the hand-written Web-Push-only gateway that used to live in
`services/push-gateway` (never deployed).

```
 someone sends you a message
        │
        ▼
 Synapse evaluates your push rules ──match──▶ POST push.szabotar.dev/_matrix/push/v1/notify
                                                 (NPM → 127.0.0.1:5000 → sygnal)
                                                        │
                        ┌───────────────────────────────┼──────────────────────────┐
                        ▼                               ▼                          ▼
                 APNs (alert, loc-key)        FCM v1 (data-only)          Web Push (encrypted)
                        │                               │                          │
              iOS shows it from           JorKonvoMessagingService        apps/web/public/sw.js
              Localizable.strings         builds the notification         shows the notification
```

**The homeserver needs no configuration change.** The client registers an
HTTP pusher (`POST /_matrix/client/v3/pushers/set`) whose `data.url` is the
gateway; Synapse POSTs to it like it would to matrix.org's Sygnal.

## Deploy (jorbox)

Lives in `~/sygnal` on jorbox (not in the repo checkout, because of the
secrets):

```
~/sygnal/
  docker-compose.yml          (copy of this directory's)
  sygnal.yaml       600       (from sygnal.example.yaml, key id filled in)
  secrets/          700
    AuthKey_<KEYID>.p8        APNs auth key - Apple lets you download it ONCE
    firebase-service-account.json
    vapid_private_key.pem
```

```bash
cd ~/sygnal && docker compose up -d
curl -s http://127.0.0.1:5000/health        # 200
```

Nginx Proxy Manager: proxy host `push.szabotar.dev` → `http://127.0.0.1:5000`,
Let's Encrypt, Force SSL. The notify path `/_matrix/push/v1/notify` is
mandatory - Synapse validates it.

Secrets and where they came from:

- **APNs key**: Apple Developer Portal → Keys → "Apple Push Notifications
  service (APNs)", Sandbox & Production, team scoped. Key ID goes into
  `sygnal.yaml`. No per-app push certificate is involved.
- **FCM service account**: Firebase console → Project settings → Service
  accounts → Generate new private key.
- **VAPID key**: generated on the server (command in `sygnal.example.yaml`).
  Its public half (`applicationServerKey`) is not secret and is baked into the
  web build as `VITE_VAPID_PUBLIC_KEY`.

## What each platform actually receives

The **mobile apps** (iOS, Android) register **`event_id_only`** pushers and
resolve the notification on the device (push phase 2): Synapse then sends
Sygnal only room id, event id and counts, and the pusher's `default_payload`
is merged in. The **web** registers a full-format pusher (sender, room name,
content). Verified against the v0.15.1 source:

**APNs, event_id_only** (`apnspushkin._get_payload_event_id_only`) - exactly
the `default_payload` the app set (src/lib/push/pusher.ts) plus the ids:

```json
{"aps": {"alert": {"loc-key": "JK_NEW_MESSAGE"}, "mutable-content": 1, "sound": "default"},
 "jk_uid": "@ava:example.org",
 "room_id": "!…", "event_id": "$…", "unread_count": 3}
```

`mutable-content` wakes the app's Notification Service Extension
(ios/App/NotificationService), which fetches the event from the homeserver
with the token the app left in its App Group store, decrypts it with the
exported Megolm keys and replaces "New message" with sender + text (a
Communication Notification with the sender's picture). There is no `badge`
in an event_id_only payload; the extension sets it from `unread_count`.
Badge-only notifications (no event, e.g. after reading elsewhere) take the
full path without the `default_payload`: just `aps.badge`, no alert.

The loc-keys of the old full format (`MSG_FROM_USER…`, `IMAGE_FROM_USER…`,
etc.) stay in `Localizable.strings` for pushers registered by older builds;
the app re-registers its pusher as event_id_only on the next launch.

**FCM v1, event_id_only** (`gcmpushkin._build_data`) - a data-only message,
every value a string: `event_id`, `room_id`, `prio`, `unread`,
`missed_calls`, plus `jk_uid` from the `default_payload`. The app's own
`FirebaseMessagingService` resolves and builds the notification
(android/.../push/PushContent.java).

**Web Push, full format** (`webpushpushkin._build_payload`) - JSON with
room/sender fields and `content` (body truncated; ciphertext dropped if too
long). The pusher's `pushkey` is the subscription's **p256dh key**, with
`data.endpoint` and `data.auth`.

## Privacy

For the mobile apps only identifiers pass through this gateway and Apple's /
Google's push services (room/event id, unread count, the target Matrix user
id). For the web (full format), the plain text of messages in **unencrypted**
rooms passes through the gateway and the browser vendor's push service;
encrypted rooms expose metadata (sender, room name, event id) and the
ciphertext, which nobody but the recipients can read. This is described in
`store/privacy-policy.md` and `apps/web/public/privacy.html`.

## Troubleshooting

```bash
docker logs --since 10m sygnal | grep -v sygnal.access
```

- APNs `BadDeviceToken` for a real device → token from a debug (sandbox)
  build; the pushkin is `platform: production`.
- FCM 404 `UNREGISTERED` → the app was uninstalled; Sygnal tells Synapse to
  drop the pusher.
- FCM 400 `INVALID_ARGUMENT` on a token → not an FCM token (e.g. a test value).
