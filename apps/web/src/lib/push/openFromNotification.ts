import { getOwningSpace } from "@jorkonvo/matrix-core";
import { useAuthStore } from "../../state/authStore";
import { useMatrixStore } from "../../state/matrixStore";
import { useUiStore } from "../../state/uiStore";

/**
 * "Tapped a push notification → open that room", for every platform (the
 * native push plugin's action event, the web service worker's click). A tap
 * on a closed app arrives long before login restore + the first /sync know
 * the room, so the request is parked and retried on every sync tick until
 * the room shows up (or it gives up - e.g. the notification belonged to a
 * different, currently inactive account).
 */

const GIVE_UP_MS = 60_000;

let pending: { roomId: string; since: number } | null = null;

function tryOpen(roomId: string): boolean {
  if (useAuthStore.getState().status !== "ready") return false;
  const client = useMatrixStore.getState().client;
  const room = client?.getRoom(roomId);
  if (!client || !room) return false;
  const ui = useUiStore.getState();
  // Rooms of a space open inside that space; DMs and loose rooms on Home.
  ui.selectSpace(getOwningSpace(client, roomId)?.roomId ?? null, roomId);
  // selectRoom on top: resets thread/search panes and bumps roomPickSeq so
  // the tablet list drawer closes, exactly like tapping the room by hand.
  ui.selectRoom(roomId);
  return true;
}

export function openRoomFromNotification(roomId: string): void {
  if (!roomId) return;
  pending = tryOpen(roomId) ? null : { roomId, since: Date.now() };
}

/** Retries a parked request as login/sync progress. Returns the unsubscribe. */
export function initNotificationRoomOpener(): () => void {
  const retry = () => {
    if (!pending) return;
    if (Date.now() - pending.since > GIVE_UP_MS) {
      pending = null;
      return;
    }
    if (tryOpen(pending.roomId)) pending = null;
  };
  const unsubMatrix = useMatrixStore.subscribe(retry);
  const unsubAuth = useAuthStore.subscribe(retry);
  return () => {
    unsubMatrix();
    unsubAuth();
  };
}
