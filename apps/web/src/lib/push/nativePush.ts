import { App as CapApp } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import type { MatrixClient } from "@jorkonvo/matrix-core";
import { useI18nStore } from "../../i18n";
import { useAuthStore } from "../../state/authStore";
import { useMatrixStore } from "../../state/matrixStore";
import { useUiStore } from "../../state/uiStore";
import { clearNativeStore, initNativeStoreSync, syncNativeStore } from "./nativeStore";
import { openRoomFromNotification } from "./openFromNotification";
import {
  buildPusher,
  buildPusherDeletion,
  hasMatchingPusher,
  isPushConfigured,
  type PushPlatform,
  staleCasePushkeys,
} from "./pusher";
import type { PushState } from "./webPush";

/**
 * Background push for the Capacitor iOS/Android app (app fully closed).
 *
 *   APNs / FCM device token (@capacitor/push-notifications)
 *     → Matrix HTTP pusher with app_id dev.szabotar.jorkonvo.{ios,android}
 *     → Synapse → Sygnal (services/sygnal) → APNs / FCM → the phone.
 *
 * iOS renders the alert itself from the loc-key Sygnal sends (App/*.lproj/
 * Localizable.strings). Android gets a data-only FCM message that the
 * plugin never displays, so JorKonvoMessagingService builds the
 * notification natively. Either way a tap comes back here as
 * `pushNotificationActionPerformed` with the room id in `data`.
 *
 * On by default in the app: the first time an account is ready the OS
 * permission prompt appears. Turning it off in Settings is remembered per
 * device and deletes this device's pusher for the active account.
 */

const DISABLED_KEY = "jk.push.nativeDisabled";
/** Set once the OS prompt was shown, so startup never nags a second time. */
const PROMPTED_KEY = "jk.push.nativePrompted";
const tokenKey = (userId: string) => `jk.push.nativeToken.${userId}`;

function platform(): PushPlatform | null {
  const p = Capacitor.getPlatform();
  return p === "ios" || p === "android" ? p : null;
}

export function isNativePushAvailable(): boolean {
  return platform() !== null && isPushConfigured();
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode etc. - worst case we re-register next launch */
  }
}

function isDisabledByUser(): boolean {
  return readLocal(DISABLED_KEY) === "1";
}

function deviceName(p: PushPlatform): string {
  return p === "ios" ? "JorKonvo (iPhone/iPad)" : "JorKonvo (Android)";
}

let currentToken: string | null = null;
let tokenWaiters: Array<(token: string | null) => void> = [];

/** Asks the OS for the APNs/FCM token; resolves null on failure/timeout. */
function requestToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      tokenWaiters = tokenWaiters.filter((w) => w !== done);
      resolve(currentToken);
    }, 15_000);
    const done = (token: string | null) => {
      clearTimeout(timer);
      resolve(token);
    };
    tokenWaiters.push(done);
    PushNotifications.register().catch((err: unknown) => {
      console.warn("[push] register() failed", err);
      tokenWaiters = tokenWaiters.filter((w) => w !== done);
      done(null);
    });
  });
}

/** Registers (or refreshes) this device's pusher for the given account. */
async function ensurePusher(client: MatrixClient, token: string): Promise<void> {
  const p = platform();
  const userId = client.getUserId();
  if (!p || !userId) return;
  const lang = useI18nStore.getState().locale;
  const wanted = buildPusher(p, token, { lang, deviceDisplayName: deviceName(p), userId });

  const previous = readLocal(tokenKey(userId));
  if (previous && previous !== token) {
    // APNs/FCM rotated the token: drop the dead pusher so Synapse doesn't
    // keep POSTing to it until the gateway reports it rejected.
    await client.setPusher(buildPusherDeletion(p, previous, lang) as never).catch(() => {});
  }

  const { pushers } = await client.getPushers();
  for (const stale of staleCasePushkeys(pushers as never, wanted)) {
    // Deleted with its exact server-side key (no lowercasing here).
    await client
      .setPusher({ ...buildPusherDeletion(p, stale, lang), pushkey: stale } as never)
      .catch((err: unknown) => console.warn("[push] stale pusher delete failed", err));
  }
  if (!hasMatchingPusher(pushers as never, wanted)) {
    await client.setPusher(wanted as never);
  }
  writeLocal(tokenKey(userId), token);
}

export async function getNativePushState(client: MatrixClient): Promise<PushState> {
  const p = platform();
  if (!p) return "unsupported";
  if (!isPushConfigured()) return "unconfigured";
  const perm = await PushNotifications.checkPermissions();
  if (perm.receive === "denied") return "denied";
  if (isDisabledByUser()) return "off";
  const userId = client.getUserId();
  const token = currentToken ?? (userId ? readLocal(tokenKey(userId)) : null);
  if (!token) return "off";
  try {
    const { pushers } = await client.getPushers();
    const wanted = buildPusher(p, token, {
      lang: useI18nStore.getState().locale,
      deviceDisplayName: deviceName(p),
      userId: userId ?? undefined,
    });
    return hasMatchingPusher(pushers as never, wanted) ? "on" : "off";
  } catch {
    return "on";
  }
}

/**
 * Permission → token → pusher. `prompt: false` (the automatic path on
 * startup) never shows the OS dialog a second time after a "no".
 */
export async function enableNativePush(client: MatrixClient, opts: { prompt: boolean }): Promise<PushState> {
  if (!platform()) return "unsupported";
  if (!isPushConfigured()) return "unconfigured";

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
    if (!opts.prompt && readLocal(PROMPTED_KEY) === "1") return "off";
    writeLocal(PROMPTED_KEY, "1");
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== "granted") return perm.receive === "denied" ? "denied" : "off";

  writeLocal(DISABLED_KEY, null);
  const token = await requestToken();
  if (!token) throw new Error("No push token from the OS (APNs/FCM registration failed)");
  await ensurePusher(client, token);
  void syncNativeStore(client, { directory: true });
  return "on";
}

export async function disableNativePush(client: MatrixClient): Promise<PushState> {
  const p = platform();
  writeLocal(DISABLED_KEY, "1");
  const userId = client.getUserId();
  const token = currentToken ?? (userId ? readLocal(tokenKey(userId)) : null);
  if (p && token) {
    await client
      .setPusher(buildPusherDeletion(p, token, useI18nStore.getState().locale) as never)
      .catch((err: unknown) => console.warn("[push] pusher delete failed", err));
  }
  if (userId) {
    writeLocal(tokenKey(userId), null);
    await clearNativeStore(userId).catch((err: unknown) => console.warn("[push] native store clear failed", err));
  }
  return "off";
}

/** Removes the already-delivered notifications of a room (it's being read now). */
async function clearRoomNotifications(roomId: string): Promise<void> {
  try {
    const { notifications } = await PushNotifications.getDeliveredNotifications();
    const ofRoom = notifications.filter((n) => (n.data as { room_id?: unknown } | undefined)?.room_id === roomId);
    if (ofRoom.length > 0) await PushNotifications.removeDeliveredNotifications({ notifications: ofRoom });
  } catch {
    /* cosmetic */
  }
}

/**
 * App-lifetime wiring: plugin listeners, the automatic enable once an
 * account is ready (and again after an account switch), and clearing a
 * room's notifications while it's on screen.
 */
export function initNativePush(): () => void {
  if (!isNativePushAvailable()) return () => {};

  const handles: Array<Promise<PluginListenerHandle>> = [
    PushNotifications.addListener("registration", ({ value }) => {
      currentToken = value;
      const waiters = tokenWaiters;
      tokenWaiters = [];
      waiters.forEach((w) => w(value));
      // A rotated token delivered outside our own register() call.
      const client = useMatrixStore.getState().client;
      if (waiters.length === 0 && client && !isDisabledByUser()) {
        void ensurePusher(client, value).catch((err: unknown) => console.warn("[push] pusher refresh failed", err));
      }
    }),
    PushNotifications.addListener("registrationError", ({ error }) => {
      console.warn("[push] registration error", error);
      const waiters = tokenWaiters;
      tokenWaiters = [];
      waiters.forEach((w) => w(null));
    }),
    PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const roomId = (notification.data as { room_id?: unknown } | undefined)?.room_id;
      if (typeof roomId === "string") openRoomFromNotification(roomId);
    }),
    CapApp.addListener("appStateChange", ({ isActive }) => {
      const roomId = useUiStore.getState().selectedRoomId;
      if (isActive && roomId) void clearRoomNotifications(roomId);
    }),
  ];

  let enabledFor: MatrixClient | null = null;
  const maybeEnable = () => {
    const client = useMatrixStore.getState().client;
    if (useAuthStore.getState().status !== "ready" || !client || client === enabledFor) return;
    enabledFor = client;
    if (isDisabledByUser()) return;
    void enableNativePush(client, { prompt: false }).catch((err: unknown) =>
      console.warn("[push] automatic enable failed", err),
    );
  };
  maybeEnable();
  const unsubAuth = useAuthStore.subscribe(maybeEnable);
  const unsubMatrix = useMatrixStore.subscribe(maybeEnable);

  const removeStoreSync = initNativeStoreSync();

  const unsubUi = useUiStore.subscribe((s, prev) => {
    if (s.selectedRoomId && s.selectedRoomId !== prev.selectedRoomId) void clearRoomNotifications(s.selectedRoomId);
  });

  return () => {
    removeStoreSync();
    unsubAuth();
    unsubMatrix();
    unsubUi();
    for (const h of handles) void h.then((x) => x.remove());
  };
}
