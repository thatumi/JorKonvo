import type { MatrixClient, Room } from "matrix-js-sdk";

/**
 * Element-style room tags (m.tag account data, spec-standard, per-account
 * not per-room-membership) - "Kedvenc" (m.favourite) and "Alacsony
 * prioritás" (m.lowpriority) pin/demote a room in the sidebar independent
 * of our own custom categories (which only apply within a space; tags work
 * everywhere, DMs included). A room can carry both tags at once (rare but
 * not disallowed by the spec) - favourite is treated as taking priority for
 * sidebar placement, same as Element does.
 */

const FAVOURITE = "m.favourite";
const LOW_PRIORITY = "m.lowpriority";

export function isFavourite(room: Room): boolean {
  return FAVOURITE in room.tags;
}

export function isLowPriority(room: Room): boolean {
  return LOW_PRIORITY in room.tags;
}

export async function setFavourite(client: MatrixClient, roomId: string, favourite: boolean): Promise<void> {
  if (favourite) await client.setRoomTag(roomId, FAVOURITE, {});
  else await client.deleteRoomTag(roomId, FAVOURITE);
}

export async function setLowPriority(client: MatrixClient, roomId: string, lowPriority: boolean): Promise<void> {
  if (lowPriority) await client.setRoomTag(roomId, LOW_PRIORITY, {});
  else await client.deleteRoomTag(roomId, LOW_PRIORITY);
}
