import { EventType, type MatrixClient, MatrixEventEvent, type MatrixEvent, RelationType, type Room, RoomEvent } from "matrix-js-sdk";
import { getOwningSpace } from "./rooms.js";
import { canManageRoles, getMemberRoleIds, setMemberRoleAssigned } from "./roles.js";

/**
 * Discord-style "react to this message to get a role" - a moderator marks
 * one message's (eventId, emoji) pair as bound to a space role; any member
 * reacting with that emoji gets the role, removing the reaction removes it
 * again. Storage mirrors AutoMod's/policy-lists' pattern: a single room
 * state blob rather than one state event per binding, since a room
 * realistically only ever has a handful of these.
 *
 * Enforcement (watchReactionRoles) is the same honest "best effort" as
 * AutoMod/policyLists - only happens while a client that can actually
 * manage the owning space's roles is online, never a guarantee.
 */

export const REACTION_ROLES_EVENT = "io.jorkonvo.reaction_roles";

export interface ReactionRoleBinding {
  eventId: string;
  emoji: string;
  roleId: string;
}

interface ReactionRolesContent {
  bindings?: ReactionRoleBinding[];
}

type LooseSendStateEvent = (roomId: string, eventType: string, content: unknown, stateKey?: string) => Promise<unknown>;

function getContent(room: Room): ReactionRolesContent {
  return (room.currentState.getStateEvents(REACTION_ROLES_EVENT, "")?.getContent() as ReactionRolesContent | undefined) ?? {};
}

export function getReactionRoleBindings(room: Room): ReactionRoleBinding[] {
  return getContent(room).bindings ?? [];
}

export function canManageReactionRoles(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(REACTION_ROLES_EVENT, userId);
}

async function writeBindings(client: MatrixClient, roomId: string, bindings: ReactionRoleBinding[]): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, REACTION_ROLES_EVENT, { bindings }, "");
}

export async function addReactionRoleBinding(
  client: MatrixClient,
  roomId: string,
  eventId: string,
  emoji: string,
  roleId: string,
): Promise<void> {
  const room = client.getRoom(roomId);
  const current = room ? getReactionRoleBindings(room) : [];
  const next = [...current.filter((b) => !(b.eventId === eventId && b.emoji === emoji)), { eventId, emoji, roleId }];
  await writeBindings(client, roomId, next);
}

export async function removeReactionRoleBinding(
  client: MatrixClient,
  roomId: string,
  eventId: string,
  emoji: string,
): Promise<void> {
  const room = client.getRoom(roomId);
  const current = room ? getReactionRoleBindings(room) : [];
  await writeBindings(client, roomId, current.filter((b) => !(b.eventId === eventId && b.emoji === emoji)));
}

/**
 * Watches every room this account is in for reaction events matching a
 * configured binding, assigning/unassigning the role live. Reaction
 * REMOVAL arrives as a plain redaction of the reaction event, whose
 * content (relation target + emoji) is already stripped by the time the
 * redaction is visible - so incoming reactions are indexed by their own
 * event id as they arrive live, purely so a later redaction can be
 * correlated back to what it removed (the same kind of "remember it while
 * it's still visible" bookkeeping AutoMod's dedup set uses, for a
 * different reason).
 */
export function watchReactionRoles(client: MatrixClient): () => void {
  const reactionIndex = new Map<string, { roomId: string; targetEventId: string; emoji: string; senderId: string }>();
  // Reaction events in an E2EE room arrive encrypted like anything else and
  // don't re-emit RoomEvent.Timeline once background-decrypted - the same
  // gap AutoMod's watcher works around, via the same pattern.
  const liveCandidates = new Set<string>();

  function markIndexed(id: string, info: { roomId: string; targetEventId: string; emoji: string; senderId: string }) {
    reactionIndex.set(id, info);
    if (reactionIndex.size > 1000) {
      const oldest = reactionIndex.keys().next().value;
      if (oldest) reactionIndex.delete(oldest);
    }
  }

  async function applyRole(roomId: string, userId: string, roleId: string, assign: boolean) {
    const room = client.getRoom(roomId);
    const space = room ? getOwningSpace(client, roomId) : null;
    if (!space) return;
    if (!canManageRoles(space, client.getUserId() ?? "")) return;
    const has = getMemberRoleIds(space, userId).includes(roleId);
    if (assign === has) return;
    try {
      await setMemberRoleAssigned(client, space.roomId, userId, roleId, assign);
    } catch {
      // best effort - permissions may have changed underneath us, or another moderator's client already handled it
    }
  }

  function maybeApply(event: MatrixEvent, room: Room) {
    if (event.getType() !== EventType.Reaction) return;
    const relation = event.getContent()?.["m.relates_to"] as { rel_type?: string; event_id?: string; key?: string } | undefined;
    if (relation?.rel_type !== RelationType.Annotation || !relation.event_id || !relation.key) return;
    const reactionId = event.getId();
    const senderId = event.getSender();
    if (!reactionId || !senderId) return;
    markIndexed(reactionId, { roomId: room.roomId, targetEventId: relation.event_id, emoji: relation.key, senderId });

    const match = getReactionRoleBindings(room).find((b) => b.eventId === relation.event_id && b.emoji === relation.key);
    if (match) void applyRole(room.roomId, senderId, match.roleId, true);
  }

  function onTimeline(
    event: MatrixEvent,
    room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
    removed: boolean,
    data: { liveEvent?: boolean },
  ) {
    if (!data?.liveEvent || toStartOfTimeline || removed || !room) return;
    if (event.getType() === "m.room.encrypted") {
      const id = event.getId();
      if (id !== undefined) liveCandidates.add(id);
      return;
    }
    maybeApply(event, room);
  }

  function onDecrypted(event: MatrixEvent) {
    const id = event.getId();
    if (id === undefined || !liveCandidates.has(id)) return;
    liveCandidates.delete(id);
    const room = client.getRoom(event.getRoomId() ?? "");
    if (room) maybeApply(event, room);
  }

  function onRedaction(event: MatrixEvent, room: Room) {
    const redactedId = event.getAssociatedId();
    if (!redactedId) return;
    const info = reactionIndex.get(redactedId);
    if (!info) return;
    reactionIndex.delete(redactedId);
    const match = getReactionRoleBindings(room).find((b) => b.eventId === info.targetEventId && b.emoji === info.emoji);
    if (match) void applyRole(info.roomId, info.senderId, match.roleId, false);
  }

  client.on(RoomEvent.Timeline, onTimeline);
  client.on(MatrixEventEvent.Decrypted, onDecrypted);
  client.on(RoomEvent.Redaction, onRedaction);
  return () => {
    client.removeListener(RoomEvent.Timeline, onTimeline);
    client.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
    client.removeListener(RoomEvent.Redaction, onRedaction);
  };
}
