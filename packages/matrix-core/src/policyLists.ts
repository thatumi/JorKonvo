import {
  type MatrixClient,
  type MatrixEvent,
  type Room,
  RoomMemberEvent,
  RoomStateEvent,
} from "matrix-js-sdk";

/**
 * Moderation policy lists (MSC2313 / now part of the spec): a room can hold
 * `m.policy.rule.user`/`m.policy.rule.room`/`m.policy.rule.server` state
 * events, each recommending an action (almost always "m.ban") against an
 * entity identified by a glob pattern (e.g. `@spammer:*`). This is exactly
 * the mechanism Mjolnir/Draupnir bots use for shared community ban lists -
 * ANY plain room can serve as a policy list, there's nothing special about
 * it beyond hosting these state events, and other rooms/bots can subscribe
 * to it just by being joined and watching its state.
 *
 * The spec itself does NOT define how a *room* subscribes to a policy
 * list (Mjolnir keeps that in its own bot config, not in Matrix state) -
 * `io.jorkonvo.policy_subscriptions` here is this app's own invention for
 * that part, the same kind of lightweight custom state event already used
 * for AutoMod/forum tags/widgets. Enforcement (auto-banning a member who
 * matches a subscribed list's user rule) is honestly scoped exactly like
 * AutoMod: best-effort, only happens while a client with ban permission in
 * the affected room is online, never a guarantee.
 */

export type PolicyRuleKind = "user" | "room" | "server";

const POLICY_EVENT_TYPES: Record<PolicyRuleKind, string> = {
  user: "m.policy.rule.user",
  room: "m.policy.rule.room",
  server: "m.policy.rule.server",
};

export const POLICY_SUBSCRIPTIONS_EVENT = "io.jorkonvo.policy_subscriptions";

export interface PolicyRule {
  stateKey: string;
  kind: PolicyRuleKind;
  entity: string;
  reason: string;
  recommendation: string;
}

/** Reads every (non-empty, i.e. non-removed) policy rule of all three kinds currently in a room's state. */
export function getPolicyRules(room: Room): PolicyRule[] {
  const rules: PolicyRule[] = [];
  for (const kind of Object.keys(POLICY_EVENT_TYPES) as PolicyRuleKind[]) {
    const events = room.currentState.getStateEvents(POLICY_EVENT_TYPES[kind]) as MatrixEvent[];
    for (const ev of events) {
      const content = ev.getContent();
      if (typeof content.entity !== "string" || !content.entity) continue; // empty content = removed, state events can't be deleted
      rules.push({
        stateKey: ev.getStateKey() ?? "",
        kind,
        entity: content.entity,
        reason: typeof content.reason === "string" ? content.reason : "",
        recommendation: typeof content.recommendation === "string" ? content.recommendation : "m.ban",
      });
    }
  }
  return rules;
}

export function canManagePolicyRules(room: Room, userId: string, kind: PolicyRuleKind): boolean {
  return room.currentState.maySendStateEvent(POLICY_EVENT_TYPES[kind], userId);
}

function generateRuleId(): string {
  return `jorkonvo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// m.policy.rule.* isn't in matrix-js-sdk's known StateEvents union, so
// sendStateEvent's overloaded typing rejects it - same loose-cast pattern
// already used for io.jorkonvo.* custom state events elsewhere (automod.ts,
// widgets.ts). The SDK just forwards whatever content is given as JSON.
type LooseSendStateEvent = (roomId: string, eventType: string, content: unknown, stateKey?: string) => Promise<unknown>;

export async function addPolicyRule(
  client: MatrixClient,
  listRoomId: string,
  kind: PolicyRuleKind,
  entity: string,
  reason: string,
): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(
    listRoomId,
    POLICY_EVENT_TYPES[kind],
    { entity, reason, recommendation: "m.ban" },
    generateRuleId(),
  );
}

/** State events can't truly be deleted - overwriting with empty content is the spec-correct "removed" signal, same pattern as widgets.ts. */
export async function removePolicyRule(
  client: MatrixClient,
  listRoomId: string,
  kind: PolicyRuleKind,
  stateKey: string,
): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(listRoomId, POLICY_EVENT_TYPES[kind], {}, stateKey);
}

export function getPolicySubscriptions(room: Room): string[] {
  const content = room.currentState.getStateEvents(POLICY_SUBSCRIPTIONS_EVENT, "")?.getContent();
  const ids = content?.listRoomIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export function canManagePolicySubscriptions(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(POLICY_SUBSCRIPTIONS_EVENT, userId);
}

export async function setPolicySubscriptions(client: MatrixClient, roomId: string, listRoomIds: string[]): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, POLICY_SUBSCRIPTIONS_EVENT, { listRoomIds }, "");
}

/**
 * MSC2313 entities are glob patterns (`*`/`?`, SQL-LIKE style, not full
 * regex) - e.g. `@spammer:*` bans that local part on any server. Matching
 * is case-insensitive (Matrix IDs are already lowercase by convention, but
 * server names/rooms aren't guaranteed to be).
 */
export function matchesPolicyEntity(entity: string, value: string): boolean {
  const pattern = entity
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex specials, but not * and ?
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${pattern}$`).test(value.toLowerCase());
}

/**
 * Best-effort enforcement, honestly scoped like AutoMod: for every room this
 * account can ban in, if it's subscribed (`io.jorkonvo.policy_subscriptions`)
 * to a policy list room this account is ALSO joined to, a member matching a
 * subscribed list's `m.policy.rule.user` "m.ban" recommendation gets banned.
 * Runs on two triggers: (1) a member freshly joins a moderated room, (2) a
 * policy list room's own state changes (a rule was just added), which
 * re-scans current members of every room subscribed to that list - this
 * mirrors Mjolnir's real behaviour (retroactive bans when a rule appears
 * after the fact), not just "block new joiners". Room/server-kind rules are
 * NOT auto-enforced (there's no client-side action that maps to them the
 * way ban does for a user match) - they remain visible/manageable, just not
 * automatically acted on.
 */
export function watchPolicyLists(client: MatrixClient): () => void {
  function subscribedListRoomIds(room: Room): Room[] {
    return getPolicySubscriptions(room)
      .map((id) => client.getRoom(id))
      .filter((r): r is Room => r != null);
  }

  function userBanRules(listRoom: Room): PolicyRule[] {
    return getPolicyRules(listRoom).filter((r) => r.kind === "user" && r.recommendation === "m.ban");
  }

  async function enforceInRoom(room: Room) {
    const selfId = client.getUserId();
    if (!selfId) return;
    const ownPl = room.getMember(selfId)?.powerLevel ?? 0;
    if (!room.currentState.hasSufficientPowerLevelFor("ban", ownPl)) return;
    const lists = subscribedListRoomIds(room);
    if (lists.length === 0) return;
    const rules = lists.flatMap(userBanRules);
    if (rules.length === 0) return;

    for (const member of room.getMembers()) {
      if (member.membership !== "join") continue;
      if (member.userId === selfId) continue;
      if (ownPl <= member.powerLevel) continue; // spec's own kick/ban rule: only strictly-lower targets
      const match = rules.find((r) => matchesPolicyEntity(r.entity, member.userId));
      if (!match) continue;
      try {
        await client.ban(room.roomId, member.userId, `Kitiltási lista: ${match.reason || match.entity}`);
      } catch {
        // best effort - another moderator's client may already be handling it, or permissions changed underneath us
      }
    }
  }

  function onMembership(_event: MatrixEvent, member: { roomId: string; membership?: string }) {
    if (member.membership !== "join") return;
    const room = client.getRoom(member.roomId);
    if (room) void enforceInRoom(room);
  }

  function onListRoomStateChanged(event: MatrixEvent) {
    const type = event.getType();
    if (!Object.values(POLICY_EVENT_TYPES).includes(type)) return;
    const listRoomId = event.getRoomId();
    if (!listRoomId) return;
    // A new/changed rule in a policy list room - re-scan every room subscribed to it.
    for (const room of client.getRooms()) {
      if (getPolicySubscriptions(room).includes(listRoomId)) void enforceInRoom(room);
    }
  }

  client.on(RoomMemberEvent.Membership, onMembership);
  client.on(RoomStateEvent.Events, onListRoomStateChanged);
  return () => {
    client.removeListener(RoomMemberEvent.Membership, onMembership);
    client.removeListener(RoomStateEvent.Events, onListRoomStateChanged);
  };
}
