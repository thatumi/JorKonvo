import {
  ensureKeywordCache,
  ensurePushRules,
  eventHighlightsUser,
  getKeywordPatterns,
  getOwningSpace,
  getRoomNotificationMode,
  isDirectRoom,
  type MatrixClient,
  type MatrixEvent,
  MatrixEventEvent,
  type Room,
  RoomEvent,
} from "@jorkonvo/matrix-core";
import { useEffect } from "react";
import { shouldAnnounceMessages } from "../lib/displayPrefs";
import { playNotificationSoundForRoom } from "../lib/notificationSound";
import { getReactionNotifyMode } from "../lib/reactionNotifyPrefs";
import { announceForScreenReader } from "../lib/srAnnouncer";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";

/**
 * Discord's "Someone reacts to my messages" - fires a sound (+ popup) when
 * another user reacts to one of MY messages. Gated by its own device-local
 * setting and still silenced by a muted room.
 */
function maybeNotifyReaction(activeClient: MatrixClient, event: MatrixEvent, room: Room): void {
  if (event.getType() !== "m.reaction") return;
  const userId = activeClient.getUserId() ?? "";
  if (event.getSender() === userId) return;

  const mode = getReactionNotifyMode();
  if (mode === "off") return;
  if (mode === "dms" && !isDirectRoom(room, activeClient)) return;

  const relation = event.getContent()["m.relates_to"];
  const targetId = relation?.event_id;
  const key = relation?.key;
  if (!targetId || typeof key !== "string") return;
  const target = room.findEventById(targetId);
  if (!target || target.getSender() !== userId) return;

  const owningSpace = getOwningSpace(activeClient, room.roomId) ?? undefined;
  if (getRoomNotificationMode(activeClient, room.roomId, owningSpace) === "muted") return;

  const { selectedRoomId } = useUiStore.getState();
  if (selectedRoomId === room.roomId && document.visibilityState === "visible") return;

  playNotificationSoundForRoom(room.roomId);

  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const sender = room.getMember(event.getSender() ?? "")?.name ?? event.getSender() ?? "";
  const notification = new Notification(`${sender} — ${room.name}`, {
    body: `${key} ${(target.getContent().body as string | undefined)?.slice(0, 100) ?? ""}`.trim(),
    tag: `${room.roomId}:reaction`,
  });
  notification.onclick = () => {
    window.focus();
    useUiStore.getState().selectRoom(room.roomId);
    notification.close();
  };
}

function maybeNotify(activeClient: MatrixClient, event: MatrixEvent, room: Room): void {
  if (event.getType() === "m.reaction") {
    maybeNotifyReaction(activeClient, event, room);
    return;
  }
  if (event.getType() !== "m.room.message") return;
  const userId = activeClient.getUserId() ?? "";
  if (event.getSender() === userId) return;

  // Respect the room's notification mode. Mentions are evaluated from the
  // decrypted event because the server can't see them in E2EE rooms.
  // The owning space (if any) supplies the admin-set fallback mode for a
  // member who hasn't personally overridden this room's notifications.
  const owningSpace = getOwningSpace(activeClient, room.roomId) ?? undefined;
  const mode = getRoomNotificationMode(activeClient, room.roomId, owningSpace);
  if (mode === "muted") return;
  if (mode === "mentions") {
    const displayName = room.getMember(userId)?.name ?? null;
    if (!eventHighlightsUser(event, userId, displayName, getKeywordPatterns(activeClient))) return;
  }

  const content = event.getContent();
  const body = content.body as string | undefined;
  if (!body) return;
  // Skip edits - the fallback "* new text" would be a confusing notification.
  if (content["m.relates_to"]?.rel_type === "m.replace") return;

  const { selectedRoomId } = useUiStore.getState();
  const roomIsOpen = selectedRoomId === room.roomId && document.visibilityState === "visible";
  if (roomIsOpen) return;

  // The sound plays regardless of desktop-notification permission - it's a
  // separate, purely local preference (see UserSettingsModal's "Csengőhang"
  // section) that shouldn't require granting OS notification popups too.
  playNotificationSoundForRoom(room.roomId);

  const sender = room.getMember(event.getSender() ?? "")?.name ?? event.getSender() ?? "";
  // Same reasoning as the sound above: screen-reader announcements are their
  // own opt-in preference, independent of the OS notification-popup permission.
  if (shouldAnnounceMessages()) announceForScreenReader(`${sender}, ${room.name}: ${body}`);

  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const notification = new Notification(`${sender} — ${room.name}`, {
    body,
    tag: room.roomId,
  });
  notification.onclick = () => {
    window.focus();
    useUiStore.getState().selectRoom(room.roomId);
    notification.close();
  };
}

/** Invisible component: wires up desktop notifications for new messages. */
export function NotificationManager() {
  const client = useMatrixStore((s) => s.client);

  useEffect(() => {
    if (!client) return;
    const activeClient = client;
    // Desktop popups are opt-in via this permission prompt, but the sound
    // (maybeNotify, above) is a separate, always-available preference - the
    // listeners below still need wiring even where Notification doesn't exist.
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }

    // In E2EE rooms a freshly-arrived message initially reaches the Timeline
    // as m.room.encrypted; when its megolm session is new, decryption happens
    // in the background and the SDK does NOT re-emit RoomEvent.Timeline once
    // it finishes (only the event's own Decrypted event fires, reEmitted onto
    // the client). Without this such messages would silently never notify.
    const liveCandidates = new Set<string>();

    function onTimeline(
      event: MatrixEvent,
      room: Room | undefined,
      toStartOfTimeline: boolean | undefined,
      removed: boolean,
      data: { liveEvent?: boolean },
    ) {
      if (toStartOfTimeline || removed || !data.liveEvent || !room) return;
      if (event.getType() === "m.room.encrypted") {
        const id = event.getId();
        if (id !== undefined) liveCandidates.add(id);
        return;
      }
      maybeNotify(activeClient, event, room);
    }

    function onDecrypted(event: MatrixEvent) {
      const id = event.getId();
      if (id === undefined || !liveCandidates.has(id)) return;
      liveCandidates.delete(id);
      const room = activeClient.getRoom(event.getRoomId() ?? "");
      if (room) maybeNotify(activeClient, event, room);
    }

    void ensureKeywordCache(activeClient);
    void ensurePushRules(activeClient);
    activeClient.on(RoomEvent.Timeline, onTimeline);
    activeClient.on(MatrixEventEvent.Decrypted, onDecrypted);
    return () => {
      activeClient.removeListener(RoomEvent.Timeline, onTimeline);
      activeClient.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
    };
  }, [client]);

  return null;
}
