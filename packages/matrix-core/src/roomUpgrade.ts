import { EventType, KnownMembership, type MatrixClient, type Room } from "matrix-js-sdk";

/**
 * Room version upgrades (`/rooms/{id}/upgrade` + `m.room.tombstone`). A rare,
 * irreversible operation: the server creates a BRAND NEW room on the target
 * version, copies over state / power levels / the name & topic, drops an
 * `m.room.tombstone` in the old room pointing at the new one, and links the
 * new room back with `m.room.create`'s `predecessor`. Members are NOT moved
 * automatically - `upgradeRoom` here re-invites everyone who was joined.
 *
 * There is no "downgrade" and no undo; the old room stays forever as a
 * read-only archive. This module is deliberately thin - all the heavy
 * "are you sure" belongs in the UI.
 */

export function getRoomVersion(room: Room): string {
  const content = room.currentState.getStateEvents(EventType.RoomCreate, "")?.getContent() as
    | { room_version?: string }
    | undefined;
  return content?.room_version ?? "1";
}

export interface RoomTombstone {
  replacementRoomId: string;
  body: string;
}

export function getRoomTombstone(room: Room): RoomTombstone | null {
  const content = room.currentState.getStateEvents(EventType.RoomTombstone, "")?.getContent() as
    | { replacement_room?: string; body?: string }
    | undefined;
  if (!content?.replacement_room) return null;
  return { replacementRoomId: content.replacement_room, body: content.body ?? "" };
}

export function isRoomTombstoned(room: Room): boolean {
  return getRoomTombstone(room) !== null;
}

/** Whether `userId` may upgrade this room (needs to be able to send m.room.tombstone). */
export function canUpgradeRoom(room: Room, userId: string): boolean {
  if (isRoomTombstoned(room)) return false;
  return room.currentState.maySendStateEvent(EventType.RoomTombstone, userId);
}

/** The homeserver's recommended (default) room version from its advertised capabilities. */
export async function getRecommendedRoomVersion(client: MatrixClient): Promise<string | null> {
  try {
    const caps = await client.getCapabilities();
    const versions = caps["m.room_versions"] as { default?: string } | undefined;
    return versions?.default ?? null;
  } catch {
    return null;
  }
}

export interface RoomVersionOption {
  version: string;
  stable: boolean;
}

/**
 * Every room version the homeserver is willing to create, not just its
 * recommended default - some admins deliberately pin an older stable
 * version, or want an unstable one for a specific feature. Stable versions
 * first, newest first within each group.
 */
export async function getAvailableRoomVersions(client: MatrixClient): Promise<RoomVersionOption[]> {
  try {
    const caps = await client.getCapabilities();
    const versions = caps["m.room_versions"] as { available?: Record<string, string> } | undefined;
    const available = versions?.available ?? {};
    return Object.entries(available)
      .map(([version, stability]) => ({ version, stable: stability === "stable" }))
      .sort((a, b) => {
        if (a.stable !== b.stable) return a.stable ? -1 : 1;
        const na = Number(a.version);
        const nb = Number(b.version);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return nb - na;
        return b.version.localeCompare(a.version);
      });
  } catch {
    return [];
  }
}

/**
 * Upgrades the room, then re-invites every currently-joined member (except the
 * caller, who is already in the new room) so they can move over. Returns the
 * new room's id. Best-effort on the invites - one failing invite does not
 * abort the rest, and the upgrade itself has already happened by then.
 */
export async function upgradeRoom(
  client: MatrixClient,
  roomId: string,
  newVersion: string,
): Promise<string> {
  const { replacement_room } = await client.upgradeRoom(roomId, newVersion);

  const oldRoom = client.getRoom(roomId);
  const me = client.getUserId();
  if (oldRoom) {
    const toInvite = oldRoom
      .getMembersWithMembership(KnownMembership.Join)
      .map((m) => m.userId)
      .filter((userId) => userId !== me);
    for (const userId of toInvite) {
      await client.invite(replacement_room, userId).catch(() => undefined);
    }
  }

  return replacement_room;
}
