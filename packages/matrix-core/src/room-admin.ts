import {
  EventType,
  type MatrixClient,
  Preset,
  RestrictedAllowType,
  type Room,
  RoomType,
  Visibility,
} from "matrix-js-sdk";
import { parseInviteLink } from "./inviteLinks.js";
import { getSpaceHierarchy } from "./rooms.js";
import { isSpaceKnockingAllowed, SPACE_SETTINGS_EVENT } from "./spaceSettings.js";

export interface CreateRoomOptions {
  name: string;
  topic?: string;
  isEncrypted?: boolean;
  isPublic?: boolean;
  parentSpaceId?: string;
}

export async function createRoom(client: MatrixClient, options: CreateRoomOptions): Promise<string> {
  const initialState: { type: string; state_key: string; content: Record<string, unknown> }[] = [];

  if (options.isEncrypted) {
    initialState.push({
      type: EventType.RoomEncryption,
      state_key: "",
      content: { algorithm: "m.megolm.v1.aes-sha2" },
    });
  }

  // Discord-style access: being a member of the owning space is enough to
  // join this room automatically - no invite needed, including for people
  // who join the space (or get the room's permissions) after this room
  // already exists. MSC3083 "restricted" join_rule, long stable in Synapse.
  // A public room stays public (already more open than restricted, and
  // Preset.PublicChat's own join_rule would otherwise be overridden here).
  // The space's own allow_room_knocking setting (spaceSettings.ts, default
  // off) additionally lets non-members request to join via knock; either
  // way, space members never see a knock prompt, just an instant join.
  if (options.parentSpaceId && !options.isPublic) {
    const space = client.getRoom(options.parentSpaceId);
    const knockingAllowed = space ? isSpaceKnockingAllowed(space) : false;
    initialState.push({
      type: EventType.RoomJoinRules,
      state_key: "",
      content: {
        join_rule: knockingAllowed ? "knock_restricted" : "restricted",
        allow: [{ type: RestrictedAllowType.RoomMembership, room_id: options.parentSpaceId }],
      },
    });
  }

  const { room_id: roomId } = await client.createRoom({
    name: options.name,
    topic: options.topic,
    preset: options.isPublic ? Preset.PublicChat : Preset.PrivateChat,
    visibility: options.isPublic ? Visibility.Public : Visibility.Private,
    initial_state: initialState.length > 0 ? initialState : undefined,
  });

  if (options.parentSpaceId) {
    await addRoomToSpace(client, options.parentSpaceId, roomId);
  }

  return roomId;
}

export interface CreateSpaceOptions {
  name: string;
  topic?: string;
  /** Whether the space is LISTED in the homeserver's public directory - independent of who can join it (see requireApprovalToJoin). Default false: unlisted, findable only by whoever has the invite link/id. */
  isPublic?: boolean;
  /**
   * Discord-style default: an invite link (or the bare room id) is enough
   * to join this space outright, no approval needed - Matrix's `public`
   * join_rule (which, unlike `isPublic` above, has nothing to do with
   * directory listing; a `public`-join, directory-UNLISTED space is
   * exactly Discord's "anyone with the invite link is in, but the server
   * isn't browsable" model). Set true to require an admin to approve each
   * join request instead (`knock`) - a deliberate opt-in, not the default:
   * a real live-testing report tonight (2026-09-16) found that a
   * plain-invite-only space made every invite link a dead end, since
   * joining a space's `restricted` child rooms first requires being a
   * space member, and a `restricted` room's join_rule can't itself grant
   * that - "click a link, you're in" needs the SPACE to be open, not just
   * its rooms.
   */
  requireApprovalToJoin?: boolean;
  /** Whether rooms created in this space later should let non-members knock, in addition to auto-joining members. Default false - see spaceSettings.ts allow_room_knocking. */
  allowRoomKnocking?: boolean;
}

export async function createSpace(client: MatrixClient, options: CreateSpaceOptions): Promise<string> {
  const initialState: { type: string; state_key: string; content: Record<string, unknown> }[] = [
    // Overrides whatever join_rule the preset below would otherwise imply
    // (PrivateChat -> invite) - initial_state entries apply after preset
    // defaults, so this wins. See the option's own doc comment for why
    // "public" (not "invite") is the default.
    { type: EventType.RoomJoinRules, state_key: "", content: { join_rule: options.requireApprovalToJoin ? "knock" : "public" } },
  ];
  if (options.allowRoomKnocking) {
    initialState.push({ type: SPACE_SETTINGS_EVENT, state_key: "", content: { allow_room_knocking: true } });
  }
  const { room_id: roomId } = await client.createRoom({
    name: options.name,
    topic: options.topic,
    preset: options.isPublic ? Preset.PublicChat : Preset.PrivateChat,
    visibility: options.isPublic ? Visibility.Public : Visibility.Private,
    creation_content: { type: RoomType.Space },
    // Set atomically at creation (rather than a follow-up sendStateEvent)
    // so there's no window where the space exists without these settings -
    // matters because createRoom() (above) reads allow_room_knocking via
    // isSpaceKnockingAllowed the moment a member creates the space's first
    // channel, and an open join_rule matters from the very first shared
    // invite link.
    initial_state: initialState,
  });
  return roomId;
}

export async function addRoomToSpace(client: MatrixClient, spaceId: string, roomId: string): Promise<void> {
  const via = client.getDomain();
  await client.sendStateEvent(
    spaceId,
    EventType.SpaceChild,
    { via: via ? [via] : [], suggested: false },
    roomId,
  );
}

/**
 * Unlinks a room from a space (the space no longer lists it as a child).
 * Per the m.space.child spec, "removed" is an empty-content state event,
 * not a state-event deletion - matches how getRoomsInSpace/getTopLevelSpaces
 * already treat an empty-content child event as absent.
 */
export async function removeRoomFromSpace(client: MatrixClient, spaceId: string, roomId: string): Promise<void> {
  await client.sendStateEvent(spaceId, EventType.SpaceChild, {}, roomId);
}

/**
 * Resolves a pasted room id, alias, or invite link (JorKonvo's own or a
 * plain matrix.to one - see parseInviteLink) down to an actual room id -
 * for actions (like linking an existing room into a space via
 * m.space.child, whose state key must be a room id) that need a real id,
 * not something joinRoom's more permissive alias-or-id handling covers.
 */
export async function resolveRoomTarget(client: MatrixClient, idOrAliasOrLink: string): Promise<string> {
  const parsed = parseInviteLink(idOrAliasOrLink);
  const target = (parsed?.target ?? idOrAliasOrLink).trim();
  if (target.startsWith("#")) {
    const { room_id: roomId } = await client.getRoomIdForAlias(target);
    return roomId;
  }
  return target;
}

export async function joinRoomByIdOrAlias(client: MatrixClient, idOrAlias: string): Promise<Room> {
  const parsed = parseInviteLink(idOrAlias);
  if (parsed) return client.joinRoom(parsed.target, { viaServers: parsed.viaServers });
  return client.joinRoom(idOrAlias.trim());
}

export interface JoinViaLinkResult {
  room: Room;
  /** Whether the owning space also had to be joined first (i.e. this wasn't already a room the caller had access to). */
  joinedSpace: boolean;
  /** Other rooms in the same space auto-joined as a courtesy after joining it - see the doc comment below. */
  autoJoinedRoomIds: string[];
}

/**
 * Joins a room from a parsed invite link (see inviteLinks.ts parseInviteLink),
 * transparently joining its owning space first when that's what's actually
 * blocking access - this app's rooms default to a `restricted` join_rule
 * keyed on space membership (createRoom above), so a link to just the room
 * is a dead end for someone who was never added to the space: their first
 * join attempt fails M_FORBIDDEN no matter what, because Matrix's
 * `restricted` rule only ever looks at CURRENT membership, and joining a
 * `restricted`-only room can't itself grant the space membership that rule
 * requires - real bug hit live 2026-09-16, a shared room link left a
 * non-space-member with no path in at all beyond "you need an invite".
 *
 * Once in the space (an ordinary join, not restricted - a space itself
 * still needs its own invite/public/knock join_rule to allow it, unrelated
 * to what it does for its children), best-effort auto-joins every other
 * room the space's hierarchy exposes that the new membership now
 * satisfies - one invite link should land you in every room you have
 * access to, not just the one you were sent, matching Discord's "you're on
 * the server" model. Failures on the courtesy joins (a knock/invite-only
 * sibling room, one you're banned from, etc.) are expected and silently
 * skipped - they don't fail the join that already succeeded above.
 */
export async function joinRoomFromInviteLink(
  client: MatrixClient,
  parsed: { target: string; viaServers: string[]; spaceId?: string },
): Promise<JoinViaLinkResult> {
  try {
    const room = await client.joinRoom(parsed.target, { viaServers: parsed.viaServers });
    return { room, joinedSpace: false, autoJoinedRoomIds: [] };
  } catch (err) {
    const errcode = (err as { errcode?: string }).errcode;
    if (errcode !== "M_FORBIDDEN" || !parsed.spaceId) throw err;

    const spaceId = parsed.spaceId;
    if (client.getRoom(spaceId)?.getMyMembership() !== "join") {
      await client.joinRoom(spaceId, { viaServers: parsed.viaServers });
    }
    const room = await client.joinRoom(parsed.target, { viaServers: parsed.viaServers });
    const autoJoinedRoomIds = await joinEligibleSpaceHierarchyRooms(client, spaceId, room.roomId);

    return { room, joinedSpace: true, autoJoinedRoomIds };
  }
}

/**
 * Best-effort joins every room in a space's hierarchy this account is
 * eligible for (restricted/public join_rule satisfied by space membership)
 * but hasn't joined yet - the courtesy-join step shared by joinRoomFromInviteLink
 * above and channelAccess.ts's reactive watcher, which calls this whenever a
 * new `m.space.child` appears on a space the user is already in, or once at
 * boot for every already-joined space. Without that reactive call, this loop
 * alone only ever runs at the moment of joining the space itself, which is
 * exactly the gap that left an existing member unable to see a channel a
 * fellow member created later - real bug hit live 2026-09-16.
 */
export async function joinEligibleSpaceHierarchyRooms(
  client: MatrixClient,
  spaceId: string,
  excludeRoomId?: string,
): Promise<string[]> {
  const autoJoinedRoomIds: string[] = [];
  try {
    const hierarchy = await getSpaceHierarchy(client, spaceId);
    const others = hierarchy.filter((r) => !r.isSpace && r.roomId !== excludeRoomId);
    await Promise.all(
      others.map(async (r) => {
        if (client.getRoom(r.roomId)?.getMyMembership() === "join") return;
        try {
          await client.joinRoom(r.roomId, { viaServers: r.viaServers });
          autoJoinedRoomIds.push(r.roomId);
        } catch {
          // Not eligible (invite/knock-only, banned, ...) - fine, skip.
        }
      }),
    );
  } catch {
    // A failed hierarchy fetch shouldn't throw - this is always best-effort.
  }
  return autoJoinedRoomIds;
}

/** Joins a room discovered via getSpaceHierarchy (rooms.ts) - a bare room id needs its via servers explicitly for federation routing, unlike an alias which already resolves through DNS/well-known. */
export async function joinHierarchyRoom(client: MatrixClient, roomId: string, viaServers: string[]): Promise<Room> {
  return client.joinRoom(roomId, { viaServers });
}

/**
 * Accepts an invite. If the invite was flagged as a direct message (the
 * inviter set `is_direct: true`), also records it in our own `m.direct`
 * account data - otherwise the room would join fine but never show up
 * under "Üzenetek" for the person who was invited, only for the inviter.
 */
export async function acceptInvite(client: MatrixClient, roomId: string): Promise<void> {
  const room = client.getRoom(roomId);
  const ownUserId = client.getUserId();
  const inviteEvent = ownUserId ? room?.getMember(ownUserId)?.events.member : undefined;
  const isDirect = Boolean(inviteEvent?.getContent().is_direct);
  const inviterId = inviteEvent?.getSender();

  await client.joinRoom(roomId);

  if (isDirect && inviterId) {
    const dmMap =
      client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {};
    const existing = dmMap[inviterId] ?? [];
    if (!existing.includes(roomId)) {
      await client.setAccountData(EventType.Direct, { ...dmMap, [inviterId]: [...existing, roomId] });
    }
  }
}

export async function rejectInvite(client: MatrixClient, roomId: string): Promise<void> {
  await client.leave(roomId);
}

export async function leaveRoom(client: MatrixClient, roomId: string): Promise<void> {
  await client.leave(roomId);
}

export async function renameRoom(client: MatrixClient, roomId: string, name: string): Promise<void> {
  await client.setRoomName(roomId, name);
}

export async function setRoomTopic(client: MatrixClient, roomId: string, topic: string): Promise<void> {
  await client.setRoomTopic(roomId, topic);
}

/** Uploads a new image and sets it as the room's avatar (m.room.avatar). */
export async function setRoomAvatarImage(client: MatrixClient, roomId: string, file: File): Promise<void> {
  const upload = await client.uploadContent(file, { type: file.type });
  await client.sendStateEvent(roomId, EventType.RoomAvatar, { url: upload.content_uri }, "");
}

/**
 * Finds an existing DM with the user, or creates a new encrypted one.
 *
 * The recipient's per-space "allow DMs from members of this server"
 * preference (spacePrivacy.ts) is enforced recipient-side
 * (watchDmInvitePrivacy) rather than here: a blocked invite is still sent,
 * then auto-declined by the recipient's client - Matrix has no way to ask
 * the server whether another user would accept it.
 */
export async function startDirectMessage(client: MatrixClient, userId: string): Promise<string> {
  const dmMap =
    client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>() ?? {};
  const existingRoomIds = dmMap[userId] ?? [];
  for (const roomId of existingRoomIds) {
    const room = client.getRoom(roomId);
    if (room && room.getMyMembership() === "join") return roomId;
  }

  const { room_id: roomId } = await client.createRoom({
    is_direct: true,
    invite: [userId],
    preset: Preset.TrustedPrivateChat,
    initial_state: [
      { type: EventType.RoomEncryption, state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
    ],
  });

  const nextDmMap = { ...dmMap, [userId]: [...existingRoomIds, roomId] };
  await client.setAccountData(EventType.Direct, nextDmMap);

  return roomId;
}

export function getInvitedRooms(client: MatrixClient): Room[] {
  return client.getRooms().filter((room) => room.getMyMembership() === "invite");
}

export interface PublicRoomResult {
  roomId: string;
  name: string;
  topic?: string;
  avatarMxcUrl?: string;
  memberCount: number;
  canonicalAlias?: string;
}

export async function searchPublicRooms(
  client: MatrixClient,
  term: string,
  limit = 20,
): Promise<PublicRoomResult[]> {
  const res = await client.publicRooms({
    limit,
    filter: term.trim() ? { generic_search_term: term.trim() } : undefined,
  });
  return res.chunk.map((r) => ({
    roomId: r.room_id,
    name: r.name ?? r.canonical_alias ?? r.room_id,
    topic: r.topic,
    avatarMxcUrl: r.avatar_url,
    memberCount: r.num_joined_members,
    canonicalAlias: r.canonical_alias,
  }));
}

/**
 * The same directory, filtered to public SPACES ("server discovery") -
 * MSC3827's room_types filter on /publicRooms, supported by Synapse.
 */
export async function searchPublicSpaces(
  client: MatrixClient,
  term: string,
  limit = 24,
): Promise<PublicRoomResult[]> {
  const res = await client.publicRooms({
    limit,
    filter: {
      ...(term.trim() ? { generic_search_term: term.trim() } : {}),
      room_types: ["m.space"],
    } as never,
  });
  return res.chunk.map((r) => ({
    roomId: r.room_id,
    name: r.name ?? r.canonical_alias ?? r.room_id,
    topic: r.topic,
    avatarMxcUrl: r.avatar_url,
    memberCount: r.num_joined_members,
    canonicalAlias: r.canonical_alias,
  }));
}

export interface UserSearchResult {
  userId: string;
  displayName?: string;
  avatarMxcUrl?: string;
}

export async function searchUsers(client: MatrixClient, term: string, limit = 20): Promise<UserSearchResult[]> {
  if (!term.trim()) return [];
  const res = await client.searchUserDirectory({ term: term.trim(), limit });
  return res.results.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    avatarMxcUrl: r.avatar_url,
  }));
}

/**
 * Publishing a room to the directory (searchPublicRooms above browses it) -
 * a separate concern from the room's join rule (a room can be "Nyilvános"
 * to join but still unlisted, or vice versa on servers that allow it).
 * Listing and having a human-readable alias are two different spec
 * mechanisms that are conventionally used together (an unlisted room found
 * only by its opaque room id isn't very "discoverable" even once listed),
 * so both are offered side by side in RoomSettingsModal.
 */
export function canSetRoomAlias(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(EventType.RoomCanonicalAlias, userId);
}

/** Creates (or re-points) a `#localpart:homeserver` alias and sets it as the room's canonical one. */
export async function setRoomAlias(client: MatrixClient, roomId: string, localpart: string): Promise<void> {
  const domain = client.getDomain();
  if (!domain) throw new Error("Ismeretlen szerver domain");
  const alias = `#${localpart}:${domain}`;
  await client.createAlias(alias, roomId);
  await client.sendStateEvent(roomId, EventType.RoomCanonicalAlias, { alias }, "");
}

export async function isRoomListedInDirectory(client: MatrixClient, roomId: string): Promise<boolean> {
  try {
    const res = await client.getRoomDirectoryVisibility(roomId);
    return res.visibility === Visibility.Public;
  } catch {
    return false;
  }
}

export async function setRoomListedInDirectory(client: MatrixClient, roomId: string, listed: boolean): Promise<void> {
  await client.setRoomDirectoryVisibility(roomId, listed ? Visibility.Public : Visibility.Private);
}
