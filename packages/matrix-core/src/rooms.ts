import { EventType, type MatrixClient, type Room, RoomType } from "matrix-js-sdk";

/** True if the room is a Matrix Space (m.space), i.e. a "server" in Discord terms. */
export function isSpaceRoom(room: Room): boolean {
  return room.getType() === RoomType.Space;
}

/** True if the room is a direct message (1:1 or small group DM). */
export function isDirectRoom(room: Room, client: MatrixClient): boolean {
  const dmRoomMap = client.getAccountData(EventType.Direct)?.getContent<Record<string, string[]>>();
  if (!dmRoomMap) return false;
  return Object.values(dmRoomMap).some((roomIds) => roomIds.includes(room.roomId));
}

/** Rooms the client has joined, sorted by most recent activity first. */
export function getSortedJoinedRooms(client: MatrixClient): Room[] {
  return client
    .getRooms()
    .filter((room) => room.getMyMembership() === "join")
    .sort((a, b) => {
      const aTs = a.getLastActiveTimestamp();
      const bTs = b.getLastActiveTimestamp();
      return bTs - aTs;
    });
}

/** Top-level spaces: joined spaces that are not themselves a child of another joined space. */
export function getTopLevelSpaces(client: MatrixClient): Room[] {
  const allSpaces = getSortedJoinedRooms(client).filter(isSpaceRoom);
  const childRoomIds = new Set<string>();

  for (const space of allSpaces) {
    for (const child of space.currentState.getStateEvents("m.space.child")) {
      if (Object.keys(child.getContent()).length > 0) {
        childRoomIds.add(child.getStateKey() ?? "");
      }
    }
  }

  return allSpaces.filter((space) => !childRoomIds.has(space.roomId));
}

/** Joined, non-space rooms that belong to the given space (direct children only). */
export function getRoomsInSpace(client: MatrixClient, spaceId: string): Room[] {
  const space = client.getRoom(spaceId);
  if (!space) return [];

  const childIds = space.currentState
    .getStateEvents("m.space.child")
    .filter((ev) => Object.keys(ev.getContent()).length > 0)
    .map((ev) => ev.getStateKey());

  return getSortedJoinedRooms(client).filter(
    (room) => !isSpaceRoom(room) && childIds.includes(room.roomId),
  );
}

/** Joined rooms that don't belong to any space and aren't DMs - the "home" channel list. */
export function getUngroupedRooms(client: MatrixClient): Room[] {
  const spaceChildIds = new Set<string>();
  for (const space of getSortedJoinedRooms(client).filter(isSpaceRoom)) {
    for (const child of space.currentState.getStateEvents("m.space.child")) {
      if (Object.keys(child.getContent()).length > 0) {
        spaceChildIds.add(child.getStateKey() ?? "");
      }
    }
  }

  return getSortedJoinedRooms(client).filter(
    (room) =>
      !isSpaceRoom(room) && !spaceChildIds.has(room.roomId) && !isDirectRoom(room, client),
  );
}

/** Joined DM rooms. */
export function getDirectRooms(client: MatrixClient): Room[] {
  return getSortedJoinedRooms(client).filter((room) => isDirectRoom(room, client));
}

/** The joined top-level space that has this room as a direct child, if any. */
export function getOwningSpace(client: MatrixClient, roomId: string): Room | null {
  return getTopLevelSpaces(client).find((space) => getRoomsInSpace(client, space.roomId).some((r) => r.roomId === roomId)) ?? null;
}

export interface SpaceHierarchyRoom {
  roomId: string;
  name: string;
  topic?: string;
  avatarMxcUrl?: string;
  memberCount: number;
  isSpace: boolean;
  canonicalAlias?: string;
  /** Candidate servers to route a join through, from whichever space's m.space.child linked to this room - matters for rooms on servers this client hasn't otherwise seen. */
  viaServers: string[];
}

/**
 * The FULL contents of a space - including rooms this account hasn't
 * joined yet - via the spec's own `/hierarchy` endpoint (MSC2946, long
 * stable), rather than getRoomsInSpace's local `m.space.child` scan (which
 * can only ever see rooms already in this client's synced room list). This
 * is what lets a member of a space actually discover and join a room a
 * fellow member added, rather than needing an individual invite link for
 * each one - a real, previously-hit friction point this session (space
 * membership doesn't cascade to new child rooms).
 *
 * Paginates through every page the server returns (spec allows the server
 * to cap page size arbitrarily) rather than exposing next_batch to the
 * caller - a space's full room list is small enough in practice that this
 * app doesn't need incremental/lazy loading here.
 */
export async function getSpaceHierarchy(client: MatrixClient, spaceId: string): Promise<SpaceHierarchyRoom[]> {
  type HierarchyRoom = Awaited<ReturnType<MatrixClient["getRoomHierarchy"]>>["rooms"][number];
  const allRooms: HierarchyRoom[] = [];
  const viaByRoomId = new Map<string, string[]>();
  let fromToken: string | undefined;
  do {
    const page = await client.getRoomHierarchy(spaceId, 50, undefined, false, fromToken);
    for (const room of page.rooms) {
      allRooms.push(room);
      for (const relation of room.children_state) {
        const childRoomId = relation.state_key;
        if (childRoomId && Array.isArray(relation.content?.via)) {
          viaByRoomId.set(childRoomId, relation.content.via);
        }
      }
    }
    fromToken = page.next_batch;
  } while (fromToken);

  return allRooms
    .filter((room) => room.room_id !== spaceId) // the space itself - the caller already has it
    .map((room) => ({
      roomId: room.room_id,
      name: room.name ?? room.canonical_alias ?? room.room_id,
      topic: room.topic,
      avatarMxcUrl: room.avatar_url,
      memberCount: room.num_joined_members,
      isSpace: room.room_type === RoomType.Space,
      canonicalAlias: room.canonical_alias,
      viaServers: viaByRoomId.get(room.room_id) ?? [],
    }));
}
