import { EventType, type MatrixClient } from "matrix-js-sdk";
import { getRoomsInSpace } from "./rooms.js";

// sendStateEvent's content type for m.room.member requires `membership` to
// always be present, but we're only ever patching displayname/avatar_url on
// top of whatever the current (already-valid) content is - safe to widen.
type LooseSendStateEvent = (
  roomId: string,
  eventType: string,
  content: unknown,
  stateKey?: string,
) => Promise<unknown>;

/**
 * Per-room nickname/avatar (Discord's "server profile"). This is natively
 * part of the Matrix spec, not a JorKonvo extension: a user's own
 * m.room.member event can carry a `displayname`/`avatar_url` that differs
 * from their global profile, and every existing room.getMember(...).name/
 * getAvatarUrl() call in this app already resolves the room-specific value
 * when present (that's just how RoomMember works) - so reading it needed
 * no changes anywhere; only a way to SET it was missing.
 */

export async function setRoomNickname(client: MatrixClient, roomId: string, displayName: string | null): Promise<void> {
  const room = client.getRoom(roomId);
  const ownUserId = client.getUserId();
  if (!room || !ownUserId) return;
  const current = room.currentState.getStateEvents(EventType.RoomMember, ownUserId)?.getContent() ?? {};
  const content = { ...current };
  if (displayName && displayName.trim()) content.displayname = displayName.trim();
  else delete content.displayname;
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, EventType.RoomMember, content, ownUserId);
}

export async function setRoomAvatarOverride(client: MatrixClient, roomId: string, file: File | null): Promise<void> {
  const room = client.getRoom(roomId);
  const ownUserId = client.getUserId();
  if (!room || !ownUserId) return;
  const current = room.currentState.getStateEvents(EventType.RoomMember, ownUserId)?.getContent() ?? {};
  const content = { ...current };
  if (file) {
    const upload = await client.uploadContent(file, { type: file.type });
    content.avatar_url = upload.content_uri;
  } else {
    delete content.avatar_url;
  }
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, EventType.RoomMember, content, ownUserId);
}

/**
 * Discord's "server profile": one nickname/avatar applied across a whole
 * space (the space room itself + every child channel), best-effort per room
 * like the other multi-room operations. Under the hood it's the same
 * per-room m.room.member patch as above, repeated - Matrix has no
 * server-wide profile, but this gets the same result in one action.
 */
export async function setSpaceProfile(
  client: MatrixClient,
  spaceId: string,
  displayName: string | null,
  avatarFile?: File | null,
): Promise<void> {
  // undefined = leave the avatar untouched; null = clear it; a File = upload+set.
  const avatarMxc =
    avatarFile instanceof File
      ? (await client.uploadContent(avatarFile, { type: avatarFile.type })).content_uri
      : avatarFile === null
        ? null
        : undefined;
  const rooms = [spaceId, ...getRoomsInSpace(client, spaceId).map((r) => r.roomId)];
  for (const roomId of rooms) {
    const room = client.getRoom(roomId);
    const ownUserId = client.getUserId();
    if (!room || !ownUserId) continue;
    const current = room.currentState.getStateEvents(EventType.RoomMember, ownUserId)?.getContent() ?? {};
    const content = { ...current } as Record<string, unknown>;
    if (displayName && displayName.trim()) content.displayname = displayName.trim();
    else delete content.displayname;
    if (avatarMxc) content.avatar_url = avatarMxc;
    else if (avatarMxc === null) delete content.avatar_url;
    await (client.sendStateEvent as unknown as LooseSendStateEvent)(
      roomId,
      EventType.RoomMember,
      content,
      ownUserId,
    ).catch(() => undefined);
  }
}
