import type { MatrixClient, Room } from "matrix-js-sdk";
import { getOwningSpace } from "./rooms.js";

/**
 * Which emoji trigger a celebratory "super reaction" burst (see the web
 * app's ReactionEffects). Configurable per room and per space via a small
 * state event; a room falls back to its owning space's list, which falls
 * back to the built-in default. Purely cosmetic, so no power-level nuance
 * beyond "can you send this state event".
 */
export const SUPER_REACTIONS_EVENT = "io.jorkonvo.super_reactions";

export const DEFAULT_SUPER_REACTIONS = ["🎉", "❤️", "🔥", "🥳", "💯", "🚀", "✨", "😭", "🙌", "💜"];

type LooseSendStateEvent = (
  roomId: string,
  eventType: string,
  content: unknown,
  stateKey?: string,
) => Promise<unknown>;

/** The configured list for this room/space, or null if it has none of its own. */
export function getSuperReactionsConfig(room: Room): string[] | null {
  const content = room.currentState.getStateEvents(SUPER_REACTIONS_EVENT, "")?.getContent() as
    | { emoji?: unknown }
    | undefined;
  if (!content || !Array.isArray(content.emoji)) return null;
  const list = content.emoji.filter((e): e is string => typeof e === "string" && e.length > 0);
  return list;
}

/** The effective list for `room`: its own -> its space's -> the default. */
export function resolveSuperReactions(client: MatrixClient, room: Room): string[] {
  const own = getSuperReactionsConfig(room);
  if (own) return own;
  const space = getOwningSpace(client, room.roomId);
  if (space && space.roomId !== room.roomId) {
    const spaceList = getSuperReactionsConfig(space);
    if (spaceList) return spaceList;
  }
  return DEFAULT_SUPER_REACTIONS;
}

export function canManageSuperReactions(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(SUPER_REACTIONS_EVENT, userId);
}

/** Sets the list for a room/space. An empty array is stored as "no bursts here" (distinct from "not configured"). */
export async function setSuperReactions(
  client: MatrixClient,
  roomId: string,
  emoji: string[],
): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(
    roomId,
    SUPER_REACTIONS_EVENT,
    { emoji },
    "",
  );
}

/** Clears the room/space's own list so it falls back to the space default / built-in default. */
export async function clearSuperReactions(client: MatrixClient, roomId: string): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(
    roomId,
    SUPER_REACTIONS_EVENT,
    {},
    "",
  );
}
