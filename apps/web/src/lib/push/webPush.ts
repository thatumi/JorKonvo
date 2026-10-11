import type { MatrixClient } from "@jorkonvo/matrix-core";
import { useI18nStore } from "../../i18n";
import { openRoomFromNotification } from "./openFromNotification";
import {
  buildPusher,
  buildPusherDeletion,
  hasMatchingPusher,
  isPushConfigured,
  VAPID_PUBLIC_KEY,
  type WebPushSubscriptionKeys,
} from "./pusher";

/**
 * Background (closed-tab) push notifications in the browser: a Service
 * Worker (public/sw.js) + PushManager + a Matrix HTTP pusher for Sygnal's
 * webpush pushkin (services/sygnal). When the tab is open,
 * NotificationManager's in-page Notification handles alerts and sw.js
 * stays quiet.
 */

export type PushState = "unsupported" | "unconfigured" | "denied" | "off" | "on";

export function isWebPushSupported(): boolean {
  // The Tauri (CEF) desktop shell exposes PushManager but has no browser
  // push service behind it; it keeps the in-app notifications only.
  if ("__TAURI__" in globalThis) return false;
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/sw.js");
  return existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** Base64url of a raw subscription key, the shape Web Push wants. */
function keyToB64Url(sub: PushSubscription, name: "p256dh" | "auth"): string {
  const buf = sub.getKey(name);
  if (!buf) return "";
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function subscriptionKeys(sub: PushSubscription): WebPushSubscriptionKeys {
  return { endpoint: sub.endpoint, p256dh: keyToB64Url(sub, "p256dh"), auth: keyToB64Url(sub, "auth") };
}

function pusherFor(sub: PushSubscription) {
  return buildPusher("web", subscriptionKeys(sub), {
    lang: useI18nStore.getState().locale,
    deviceDisplayName: navigator.userAgent,
  });
}

export async function getWebPushState(client: MatrixClient): Promise<PushState> {
  if (!isWebPushSupported()) return "unsupported";
  if (!isPushConfigured()) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return "off";
  // Confirm the homeserver still has our pusher (a logout elsewhere clears it).
  try {
    const { pushers } = await client.getPushers();
    return hasMatchingPusher(pushers as never, pusherFor(sub)) ? "on" : "off";
  } catch {
    return "on";
  }
}

/** Subscribe this browser + register the Matrix pusher. Returns the new state. */
export async function enableWebPush(client: MatrixClient): Promise<PushState> {
  if (!isWebPushSupported()) return "unsupported";
  if (!isPushConfigured()) return "unconfigured";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const reg = await getRegistration();
  await navigator.serviceWorker.ready;

  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }));

  // matrix-js-sdk types `data` narrowly ({url, format, brand}); the Push
  // Gateway API allows arbitrary keys and Sygnal's webpush pushkin reads
  // the subscription from there.
  await client.setPusher(pusherFor(sub) as never);
  return "on";
}

/** Remove the Matrix pusher and unsubscribe this browser. */
export async function disableWebPush(client: MatrixClient): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    try {
      const deletion = buildPusherDeletion("web", keyToB64Url(sub, "p256dh"), useI18nStore.getState().locale);
      await client.setPusher(deletion as never);
    } catch {
      /* best effort */
    }
    await sub.unsubscribe().catch(() => {});
  }
  return "off";
}

/**
 * Notification clicks from sw.js: a running tab gets a postMessage, a
 * freshly opened one carries the room in `?room=` (a hash route would be
 * swallowed - the app has no router).
 */
export function initWebPushClickHandling(): () => void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return () => {};

  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get("room");
  if (roomFromUrl) {
    openRoomFromNotification(roomFromUrl);
    params.delete("room");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }

  if (!("serviceWorker" in navigator)) return () => {};
  const onMessage = (e: MessageEvent) => {
    const data = e.data as { type?: string; roomId?: string } | null;
    if (data?.type === "jk-open-room" && data.roomId) openRoomFromNotification(data.roomId);
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}

