import {
  EventType,
  KnownMembership,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  RoomMemberEvent,
  RoomStateEvent,
} from "matrix-js-sdk";
import { getCategoryOfRoom } from "./categories.js";
import { getMemberPowerLevel } from "./moderation.js";
import { joinEligibleSpaceHierarchyRooms } from "./room-admin.js";
import { getMemberRoleIds, SPACE_ROLES_EVENT } from "./roles.js";
import { getOwningSpace, getRoomsInSpace } from "./rooms.js";

/**
 * Discord-style "private channels": a channel visible only to members holding
 * one of a chosen set of the space's roles (plus anyone with a management
 * power level, who can always see everything).
 *
 * Matrix has no "hide a room from some members" - membership IS visibility.
 * So a restricted channel is set `join_rule: invite`, and this module keeps
 * its membership in sync with the role assignments: people who gain an
 * allowed role are invited (and auto-join, see maybeAutoJoinSpaceChild), and
 * people who lose their last allowed role are removed. Enforcement is
 * best-effort, only while a JorKonvo client with enough power is online -
 * same honesty as AutoMod / policy lists / timed mutes.
 *
 * `io.jorkonvo.channel_access` (state key "") on the CHANNEL:
 *   { mode: "open" | "restricted", role_ids: string[] }
 * No event, or mode "open" = everyone in the space (join_rule restricted/public).
 */
export const CHANNEL_ACCESS_EVENT = "io.jorkonvo.channel_access";

/** A member at or above this level always keeps access to every channel in the space. */
const ADMIN_LEVEL = 50;

export interface ChannelAccess {
  mode: "open" | "restricted";
  roleIds: string[];
}

type LooseSendStateEvent = (
  roomId: string,
  eventType: string,
  content: unknown,
  stateKey?: string,
) => Promise<unknown>;

export function getChannelAccess(room: Room): ChannelAccess {
  const content = room.currentState.getStateEvents(CHANNEL_ACCESS_EVENT, "")?.getContent() as
    | { mode?: string; role_ids?: string[] }
    | undefined;
  if (content?.mode === "restricted") {
    return { mode: "restricted", roleIds: Array.isArray(content.role_ids) ? content.role_ids : [] };
  }
  return { mode: "open", roleIds: [] };
}

export function isChannelRestricted(room: Room): boolean {
  return getChannelAccess(room).mode === "restricted";
}

export function canManageChannelAccess(room: Room, userId: string): boolean {
  return (
    room.currentState.maySendStateEvent(CHANNEL_ACCESS_EVENT, userId) &&
    room.currentState.maySendStateEvent(EventType.RoomJoinRules, userId)
  );
}

/** Whether a member currently qualifies for a restricted channel (has an allowed role, or is an admin). */
export function memberQualifiesForChannel(
  space: Room,
  userId: string,
  access: ChannelAccess,
  channel?: Room,
): boolean {
  if (channel && getMemberPowerLevel(channel, userId) >= ADMIN_LEVEL) return true;
  if (getMemberPowerLevel(space, userId) >= ADMIN_LEVEL) return true;
  const held = new Set(getMemberRoleIds(space, userId));
  return access.roleIds.some((id) => held.has(id));
}

/**
 * Sets a channel's access mode. Restricted -> join_rule "invite" and an
 * immediate membership sync; open -> join_rule "restricted" (auto-join for
 * space members) and the access event cleared.
 */
export async function setChannelAccess(
  client: MatrixClient,
  roomId: string,
  access: ChannelAccess,
): Promise<void> {
  const send = client.sendStateEvent as unknown as LooseSendStateEvent;
  const space = getOwningSpace(client, roomId);

  if (access.mode === "restricted") {
    await send(roomId, CHANNEL_ACCESS_EVENT, { mode: "restricted", role_ids: access.roleIds }, "");
    await send(roomId, EventType.RoomJoinRules, { join_rule: "invite" }, "");
  } else {
    await send(roomId, CHANNEL_ACCESS_EVENT, {}, "");
    const allow = space
      ? { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: space.roomId }] }
      : { join_rule: "restricted" };
    await send(roomId, EventType.RoomJoinRules, allow, "");
  }

  if (space) await syncChannelMembership(client, space.roomId, roomId);
}

/** Bring one restricted channel's membership in line with the role assignments. */
export async function syncChannelMembership(
  client: MatrixClient,
  spaceId: string,
  channelId: string,
): Promise<void> {
  const space = client.getRoom(spaceId);
  const channel = client.getRoom(channelId);
  if (!space || !channel) return;
  const access = getChannelAccess(channel);
  if (access.mode !== "restricted") return;
  const me = client.getUserId() ?? "";
  if (getMemberPowerLevel(channel, me) < ADMIN_LEVEL) return;

  const spaceMembers = space.getMembersWithMembership(KnownMembership.Join);
  for (const member of spaceMembers) {
    const qualifies = memberQualifiesForChannel(space, member.userId, access, channel);
    const current = channel.getMember(member.userId)?.membership;
    if (qualifies && current !== KnownMembership.Join && current !== KnownMembership.Invite) {
      await client.invite(channelId, member.userId).catch(() => undefined);
    } else if (!qualifies && current === KnownMembership.Join && member.userId !== me) {
      await client.kick(channelId, member.userId, "Channel role access changed").catch(() => undefined);
    }
  }
}

/**
 * Applies one access setting to EVERY channel in a category at once
 * (Discord's "sync permissions to channels"). Best-effort per channel.
 */
export async function applyCategoryAccess(
  client: MatrixClient,
  spaceId: string,
  categoryId: string,
  access: ChannelAccess,
): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const channels = getRoomsInSpace(client, spaceId).filter(
    (room) => getCategoryOfRoom(space, room.roomId) === categoryId,
  );
  for (const channel of channels) {
    await setChannelAccess(client, channel.roomId, access).catch(() => undefined);
  }
}

/** The single access setting shared by every channel in a category, or null when they differ / the category is empty. */
export function getCategoryAccess(
  client: MatrixClient,
  spaceId: string,
  categoryId: string,
): ChannelAccess | null {
  const space = client.getRoom(spaceId);
  if (!space) return null;
  const channels = getRoomsInSpace(client, spaceId).filter(
    (room) => getCategoryOfRoom(space, room.roomId) === categoryId,
  );
  if (channels.length === 0) return null;
  const first = getChannelAccess(channels[0]!);
  const same = channels.every((c) => {
    const a = getChannelAccess(c);
    return (
      a.mode === first.mode &&
      a.roleIds.slice().sort().join() === first.roleIds.slice().sort().join()
    );
  });
  return same ? first : null;
}

/** syncChannelMembership for every restricted channel in the space. */
export async function syncSpaceChannelAccess(client: MatrixClient, spaceId: string): Promise<void> {
  for (const channel of getRoomsInSpace(client, spaceId)) {
    if (isChannelRestricted(channel)) {
      await syncChannelMembership(client, spaceId, channel.roomId);
    }
  }
}

/**
 * Discord-like: an invite to a room that is a child of a space you're already
 * in should just drop you into the channel, not sit in an "invites" tray -
 * the space admins decide which channels you see. Call this for a fresh
 * invite; it joins only when the inviting room is a known space child.
 */
export async function maybeAutoJoinSpaceChild(client: MatrixClient, roomId: string): Promise<boolean> {
  const joinedSpaceChildIds = new Set<string>();
  for (const room of client.getRooms()) {
    if (room.getMyMembership() !== KnownMembership.Join) continue;
    if (!room.isSpaceRoom()) continue;
    for (const child of room.currentState.getStateEvents("m.space.child")) {
      if (Object.keys(child.getContent()).length > 0) joinedSpaceChildIds.add(child.getStateKey() ?? "");
    }
  }
  if (!joinedSpaceChildIds.has(roomId)) return false;
  await client.joinRoom(roomId).catch(() => undefined);
  return true;
}

/**
 * Watches for role-assignment / channel-access changes and re-syncs the
 * affected space's restricted channels, plus auto-joins space-child invites
 * and - the actual fix for a real bug hit live 2026-09-16 - courtesy-joins
 * any new `m.space.child` that appears on a space this account is ALREADY a
 * member of. createRoom (room-admin.ts) makes new channels join-by-space-
 * membership by default specifically so this should need no invite, but
 * nothing was reactively performing that join for existing members before
 * this - they'd see nothing at all unless they happened to open "Discover
 * rooms" themselves. Also runs once at startup for every already-joined
 * space, to heal channels created while this account was offline or before
 * this fix shipped. Debounced; best-effort.
 */
export function watchChannelAccess(client: MatrixClient): () => void {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const spaceIds = [...pending];
    pending.clear();
    for (const spaceId of spaceIds) {
      void syncSpaceChannelAccess(client, spaceId);
      void joinEligibleSpaceHierarchyRooms(client, spaceId);
    }
  };
  const queue = (spaceId: string) => {
    pending.add(spaceId);
    if (!timer) timer = setTimeout(flush, 2000);
  };

  const onState = (event: MatrixEvent) => {
    const type = event.getType();
    const roomId = event.getRoomId();
    if (!roomId) return;
    if (type === SPACE_ROLES_EVENT) {
      queue(roomId);
    } else if (type === CHANNEL_ACCESS_EVENT) {
      const space = getOwningSpace(client, roomId);
      if (space) queue(space.roomId);
    } else if (type === "m.space.child" && Object.keys(event.getContent()).length > 0) {
      const space = client.getRoom(roomId);
      if (space?.isSpaceRoom() && space.getMyMembership() === KnownMembership.Join) queue(roomId);
    }
  };

  const onMembership = (_event: MatrixEvent, member: { userId: string; membership?: string; roomId: string }) => {
    if (member.userId !== client.getUserId()) return;
    if (member.membership === KnownMembership.Invite) {
      void maybeAutoJoinSpaceChild(client, member.roomId);
    }
  };

  client.on(RoomStateEvent.Events, onState);
  client.on(RoomMemberEvent.Membership, onMembership);

  for (const room of client.getRooms()) {
    if (room.isSpaceRoom() && room.getMyMembership() === KnownMembership.Join) queue(room.roomId);
  }

  return () => {
    client.removeListener(RoomStateEvent.Events, onState);
    client.removeListener(RoomMemberEvent.Membership, onMembership);
    if (timer) clearTimeout(timer);
  };
}
