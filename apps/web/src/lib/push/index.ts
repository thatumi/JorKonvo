import type { MatrixClient } from "@jorkonvo/matrix-core";
import { isNativePlatform } from "../platform";
import { disableNativePush, enableNativePush, getNativePushState, initNativePush } from "./nativePush";
import { initNotificationRoomOpener } from "./openFromNotification";
import { disableWebPush, enableWebPush, getWebPushState, initWebPushClickHandling, type PushState } from "./webPush";

/**
 * Background push notifications, one entry point for every platform:
 * browser (Web Push via sw.js), iOS (APNs) and Android (FCM) - all through
 * the same Sygnal gateway (services/sygnal). The Tauri desktop app has no
 * background push; it keeps NotificationManager's in-app notifications.
 */

export type { PushState };

export function initPush(): () => void {
  const removeOpener = initNotificationRoomOpener();
  const removePlatform = isNativePlatform() ? initNativePush() : initWebPushClickHandling();
  return () => {
    removeOpener();
    removePlatform();
  };
}

export function getPushState(client: MatrixClient): Promise<PushState> {
  return isNativePlatform() ? getNativePushState(client) : getWebPushState(client);
}

export function enablePush(client: MatrixClient): Promise<PushState> {
  return isNativePlatform() ? enableNativePush(client, { prompt: true }) : enableWebPush(client);
}

export function disablePush(client: MatrixClient): Promise<PushState> {
  return isNativePlatform() ? disableNativePush(client) : disableWebPush(client);
}
