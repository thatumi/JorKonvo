/**
 * The Matrix HTTP pusher every JorKonvo platform registers with the
 * homeserver (`POST /_matrix/client/v3/pushers/set`). Synapse then POSTs
 * each notification to our Sygnal instance (services/sygnal), which picks
 * the pushkin by `app_id`.
 *
 * Pure module - no Capacitor, no DOM - so the exact wire shape is unit
 * tested (test/unit/web/pushPusher.test.ts). Sygnal is strict about it:
 * the webpush pushkin rejects a pusher whose pushkey isn't the p256dh key,
 * and the APNs pushkin is configured for hex device tokens.
 */

export type PushPlatform = "ios" | "android" | "web";

/** Must match the `apps:` keys in services/sygnal/sygnal.example.yaml. */
export const PUSH_APP_IDS: Record<PushPlatform, string> = {
  ios: "dev.szabotar.jorkonvo.ios",
  android: "dev.szabotar.jorkonvo.android",
  web: "dev.szabotar.jorkonvo.web",
};

const APP_DISPLAY_NAMES: Record<PushPlatform, string> = {
  ios: "JorKonvo iOS",
  android: "JorKonvo Android",
  web: "JorKonvo Web",
};

/**
 * Build-time override: VITE_PUSH_GATEWAY_URL="" turns push off entirely
 * (e.g. a self-hosted deployment without its own gateway). Unset means the
 * JorKonvo gateway, which serves users of any homeserver.
 */
const GATEWAY_URL = (import.meta.env.VITE_PUSH_GATEWAY_URL as string | undefined) ?? "https://push.szabotar.dev";

/** Public half of the gateway's VAPID key (not a secret - browsers need it to subscribe). */
export const VAPID_PUBLIC_KEY =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ??
  "BJNajBZHnpTzqax_pibKaoQRQ8FX9nxo7N3-kBCE6z6_ltNU9DXp9UUrsdoIzKsh5JegKqtgzz5MapsqZ5s1ldw";

export function isPushConfigured(): boolean {
  return GATEWAY_URL.trim() !== "";
}

/** Synapse requires exactly this path on the gateway. */
export function pushNotifyUrl(gatewayUrl: string = GATEWAY_URL): string {
  return `${gatewayUrl.replace(/\/+$/, "")}/_matrix/push/v1/notify`;
}

/** A browser PushSubscription, reduced to what the webpush pushkin needs. */
export interface WebPushSubscriptionKeys {
  endpoint: string;
  /** base64url, as PushSubscription.getKey("p256dh") */
  p256dh: string;
  /** base64url, as PushSubscription.getKey("auth") */
  auth: string;
}

export interface PusherRequest {
  app_id: string;
  app_display_name: string;
  device_display_name: string;
  kind: "http" | null;
  lang: string;
  pushkey: string;
  append?: boolean;
  data: Record<string, unknown>;
}

export function pushkeyFor(platform: PushPlatform, token: string | WebPushSubscriptionKeys): string {
  if (platform === "web") {
    if (typeof token === "string") throw new Error("web push needs the full subscription");
    return token.p256dh;
  }
  if (typeof token !== "string") throw new Error(`${platform} push needs a device token`);
  // Capacitor hands the APNs token over as UPPERCASE hex; the canonical
  // (and Sygnal/aioapns-logged) form is lowercase.
  return platform === "ios" ? token.toLowerCase() : token;
}

/**
 * Platforms whose app resolves the notification ON THE DEVICE (fetches the
 * event, decrypts it with locally exported Megolm keys - push phase 2), so
 * the pusher can be event_id_only: Synapse then sends no sender, room name
 * or text, and neither the gateway nor Apple/Google see any of it.
 * Elsewhere the default ("full") format carries sender + room + content so
 * the notification can say who wrote what (for encrypted rooms: metadata +
 * ciphertext only) - the web, whose service worker has no keys.
 */
const RESOLVES_ON_DEVICE: Record<PushPlatform, boolean> = { ios: true, android: true, web: false };

export function buildPusher(
  platform: PushPlatform,
  token: string | WebPushSubscriptionKeys,
  opts: { lang: string; deviceDisplayName: string; notifyUrl?: string; userId?: string },
): PusherRequest {
  const url = opts.notifyUrl ?? pushNotifyUrl();
  const data: Record<string, unknown> = { url };
  if (RESOLVES_ON_DEVICE[platform]) {
    data.format = "event_id_only";
    // Which of this device's accounts a push is for - event_id_only pushes
    // don't say. Sygnal merges default_payload into the FCM data.
    if (opts.userId) data.default_payload = { jk_uid: opts.userId };
  }
  if (platform === "ios") {
    // Sygnal sends an event_id_only push to APNs as exactly this (plus
    // room_id / event_id / unread_count): a visible "New message" alert
    // (loc-key in ios/App/App/*.lproj/Localizable.strings) whose
    // mutable-content wakes the NotificationService extension, which swaps
    // in the sender, text and picture. Without a sound it arrives silently.
    data.default_payload = {
      aps: { alert: { "loc-key": "JK_NEW_MESSAGE" }, "mutable-content": 1, sound: "default" },
      ...(opts.userId ? { jk_uid: opts.userId } : {}),
    };
  } else if (platform === "web") {
    const sub = token as WebPushSubscriptionKeys;
    data.endpoint = sub.endpoint;
    data.auth = sub.auth;
    // Badge-only pushes (no event) would force the browser to show a
    // generic "updated in the background" notification.
    data.events_only = true;
  }
  return {
    app_id: PUSH_APP_IDS[platform],
    app_display_name: APP_DISPLAY_NAMES[platform],
    device_display_name: opts.deviceDisplayName.slice(0, 90),
    kind: "http",
    lang: opts.lang,
    pushkey: pushkeyFor(platform, token),
    // Keep this account's pushers on its OTHER devices.
    append: true,
    data,
  };
}

/**
 * The request that deletes a pusher (kind: null). `pushkey` may be the raw
 * device token: iOS tokens are lowercased the same way buildPusher does,
 * or the deletion would miss the registered pusher.
 */
export function buildPusherDeletion(platform: PushPlatform, pushkey: string, lang: string): PusherRequest {
  return {
    app_id: PUSH_APP_IDS[platform],
    app_display_name: APP_DISPLAY_NAMES[platform],
    device_display_name: "",
    kind: null,
    lang,
    pushkey: platform === "ios" ? pushkey.toLowerCase() : pushkey,
    data: { url: pushNotifyUrl() },
  };
}

interface ServerPusher {
  app_id: string;
  pushkey: string;
  data?: Record<string, unknown>;
}

/** JSON with object keys sorted, so two equal `data` objects compare equal. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Whether the homeserver already has exactly this pusher - same key AND
 * same data, so a pusher left over from an older build (other gateway,
 * event_id_only format, no sound) gets replaced rather than trusted.
 */
export function hasMatchingPusher(pushers: ServerPusher[], wanted: PusherRequest): boolean {
  const wantedData = canonicalJson(wanted.data);
  return pushers.some(
    (p) => p.app_id === wanted.app_id && p.pushkey === wanted.pushkey && canonicalJson(p.data ?? {}) === wantedData,
  );
}

/**
 * This device's pushers under a differently cased key - builds before the
 * iOS token was lowercased registered it as Capacitor hands it over (upper
 * case). Same device, so with `append: true` both would stay and every
 * message would arrive twice; these must be deleted.
 */
export function staleCasePushkeys(pushers: ServerPusher[], wanted: PusherRequest): string[] {
  const key = wanted.pushkey.toLowerCase();
  return pushers
    .filter((p) => p.app_id === wanted.app_id && p.pushkey !== wanted.pushkey && p.pushkey.toLowerCase() === key)
    .map((p) => p.pushkey);
}
