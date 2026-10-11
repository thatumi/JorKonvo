import {
  EventType,
  JoinRule,
  KnownMembership,
  type MatrixClient,
  type Room,
  type RoomMember,
  RestrictedAllowType,
} from "matrix-js-sdk";
import { parseInviteLink } from "./inviteLinks.js";

// matrix-js-sdk's own RoomJoinRulesEventContent type pins join_rule to its
// JoinRule enum, which has no "knock_restricted" member (MSC3787) - the
// typed sendStateEvent overload can't express that value, so this loosens
// it the same way other custom/newer content shapes in this package do.
type LooseSendStateEvent = (
  roomId: string,
  eventType: string,
  content: unknown,
  stateKey?: string,
) => Promise<unknown>;

/**
 * Join rules beyond plain invite-only/public: "knock" (Discord-style
 * membership screening - anyone can request to join, an admin approves or
 * denies) and "restricted"/"knock_restricted" (auto-join for members of a
 * given space, the Matrix equivalent of "you're already in this server, so
 * you can join its channels freely"). Unlike roles/friends/polls elsewhere
 * in this package, these are native, spec-stable Matrix room primitives
 * (MSC2403 and MSC3083, both long since merged) - this module is a thin,
 * typed wrapper around what matrix-js-sdk already provides
 * (knockRoom/invite/kick), not a custom mechanism.
 */

export type JoinRuleValue = "invite" | "public" | "knock" | "restricted" | "knock_restricted";

export interface JoinRuleOption {
  value: JoinRuleValue;
  labelKey: string;
  hintKey: string;
}

export const JOIN_RULE_OPTIONS: JoinRuleOption[] = [
  { value: "invite", labelKey: "joinRule.inviteLabel", hintKey: "joinRule.inviteHint" },
  { value: "public", labelKey: "joinRule.publicLabel", hintKey: "joinRule.publicHint" },
  { value: "knock", labelKey: "joinRule.knockLabel", hintKey: "joinRule.knockHint" },
  {
    value: "restricted",
    labelKey: "joinRule.restrictedLabel",
    hintKey: "joinRule.restrictedHint",
  },
  {
    value: "knock_restricted",
    labelKey: "joinRule.knockRestrictedLabel",
    hintKey: "joinRule.knockRestrictedHint",
  },
];

function getJoinRuleContent(room: Room): { join_rule: string; allow?: { type: string; room_id?: string }[] } {
  return (
    (room.currentState.getStateEvents(EventType.RoomJoinRules, "")?.getContent() as
      | { join_rule: string; allow?: { type: string; room_id?: string }[] }
      | undefined) ?? { join_rule: JoinRule.Invite }
  );
}

export function getJoinRule(room: Room): JoinRuleValue {
  const content = getJoinRuleContent(room);
  if (content.join_rule === JoinRule.Restricted) {
    // MSC3787: a restricted room whose allow list also grants Knock.Knock
    // conditions is reported by some servers as "restricted" with a
    // separate knock affordance; matrix-js-sdk's own JoinRule enum has no
    // dedicated "knock_restricted" member, so this package tracks it as a
    // distinct value purely from the raw content (see setJoinRule below,
    // which writes "knock_restricted" verbatim into join_rule for servers
    // that support it - falling back to plain "restricted" is safe either
    // way since knocking still works via the room's power levels).
    return "restricted";
  }
  if ((content.join_rule as string) === "knock_restricted") return "knock_restricted";
  if (content.join_rule === JoinRule.Knock) return "knock";
  if (content.join_rule === JoinRule.Public) return "public";
  return "invite";
}

export function canSetJoinRule(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(EventType.RoomJoinRules, userId);
}

/**
 * Sets the room's join rule. For "restricted"/"knock_restricted", `allowSpaceId`
 * must be the space whose membership grants automatic access - normally the
 * room's own owning space (getOwningSpace).
 */
export async function setJoinRule(
  client: MatrixClient,
  roomId: string,
  rule: JoinRuleValue,
  allowSpaceId?: string,
): Promise<void> {
  const needsAllow = rule === "restricted" || rule === "knock_restricted";
  const content: { join_rule: string; allow?: { type: string; room_id: string }[] } = {
    join_rule: rule,
  };
  if (needsAllow && allowSpaceId) {
    content.allow = [{ type: RestrictedAllowType.RoomMembership, room_id: allowSpaceId }];
  }
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, EventType.RoomJoinRules, content, "");
}

/** Requests to join a knock-only (or knock_restricted) room. Parses a pasted matrix.to/JorKonvo invite link the same way joinRoomByIdOrAlias does. */
export async function knockRoomByIdOrAlias(
  client: MatrixClient,
  idOrAlias: string,
  reason?: string,
): Promise<void> {
  const parsed = parseInviteLink(idOrAlias);
  if (parsed) {
    await client.knockRoom(parsed.target, { reason, viaServers: parsed.viaServers });
    return;
  }
  await client.knockRoom(idOrAlias.trim(), { reason });
}

/** Withdraws a knock the current user made (or was never approved for). */
export async function withdrawKnock(client: MatrixClient, roomId: string): Promise<void> {
  await client.leave(roomId);
}

/** Rooms the current user has an outstanding, unanswered knock request for. */
export function getMyPendingKnocks(client: MatrixClient): Room[] {
  return client.getRooms().filter((room) => room.getMyMembership() === KnownMembership.Knock);
}

/** Members currently knocking on a room, waiting for an admin's decision. */
export function getPendingKnocks(room: Room): RoomMember[] {
  return room.getMembersWithMembership(KnownMembership.Knock);
}

/** The reason text a knocking member gave, if any (from their m.room.member event content). */
export function getKnockReason(member: RoomMember): string | null {
  return (member.events.member?.getContent().reason as string | undefined) ?? null;
}

export function canApproveKnocks(room: Room, userId: string): boolean {
  const ownPowerLevel = room.getMember(userId)?.powerLevel ?? 0;
  return room.currentState.hasSufficientPowerLevelFor("invite", ownPowerLevel);
}

/** Approves a knock by inviting the requester - they still need to accept (join) after this. */
export async function approveKnock(client: MatrixClient, roomId: string, userId: string): Promise<void> {
  await client.invite(roomId, userId);
}
