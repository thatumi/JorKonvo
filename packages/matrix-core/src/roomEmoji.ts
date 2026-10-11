import type { MatrixClient, Room } from "matrix-js-sdk";
import { getPersonalEmojis } from "./personalEmoji.js";
import { getOwningSpace } from "./rooms.js";
import { isPersonalEmojiAllowed } from "./spaceSettings.js";

/**
 * Custom per-room emoji, using the `im.ponies.room_emotes` room-state
 * convention ("image packs") rather than a JorKonvo-only scheme - this is
 * NOT a finalized MSC (it never fully stabilized), but it's the one Element,
 * SchildiChat and FluffyChat have all actually shipped and interoperated on
 * for years, so a real emoji added here shows up correctly in those clients
 * too, and vice versa - genuine interop, unlike inventing our own
 * io.jorkonvo.* shortcode scheme that only we'd understand.
 *
 * One pack per room (state_key ""), content: `{ images: { shortcode: {
 * url: "mxc://..." } } }`. Rendering (MessageBody.tsx) substitutes a known
 * `:shortcode:` in the composed text with `<img data-mx-emoticon
 * src="mxc://...">`, the spec's own convention - readers resolve the mxc://
 * URL themselves at render time, which is also why this needs no per-sender
 * bookkeeping the way role mentions do.
 */

export const ROOM_EMOTES_EVENT = "im.ponies.room_emotes";

export interface RoomEmoji {
  shortcode: string;
  mxcUrl: string;
  /** Room/space id this emoji's pack lives on, or personalEmoji.ts's PERSONAL_EMOJI_SOURCE_ID - lets a picker group "which server is this from" (see EmojiPicker.tsx's Custom tab). */
  sourceId: string;
  /** Display name for that source, already resolved (empty for the personal pack - the UI supplies its own localized label for that one). */
  sourceName: string;
}

interface RoomEmotesContent {
  images?: Record<string, { url?: string }>;
}

type LooseSendStateEvent = (roomId: string, eventType: string, content: unknown, stateKey?: string) => Promise<unknown>;

function getContent(room: Room): RoomEmotesContent {
  return (room.currentState.getStateEvents(ROOM_EMOTES_EVENT, "")?.getContent() as RoomEmotesContent | undefined) ?? {};
}

export function getRoomEmojis(room: Room): RoomEmoji[] {
  const images = getContent(room).images ?? {};
  const sourceName = room.name || room.roomId;
  return Object.entries(images)
    .filter((entry): entry is [string, { url: string }] => typeof entry[1]?.url === "string")
    .map(([shortcode, { url }]) => ({ shortcode, mxcUrl: url, sourceId: room.roomId, sourceName }));
}

export function canManageRoomEmojis(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(ROOM_EMOTES_EVENT, userId);
}

/** Uploads an image and adds it to the room's emoji pack under the given shortcode (letters/digits/underscore/dash only, matching the spec's own convention). */
export async function addRoomEmoji(client: MatrixClient, roomId: string, shortcode: string, file: File): Promise<void> {
  const room = client.getRoom(roomId);
  const content = room ? getContent(room) : {};
  const upload = await client.uploadContent(file, { type: file.type });
  const nextImages = { ...content.images, [shortcode]: { url: upload.content_uri } };
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, ROOM_EMOTES_EVENT, { ...content, images: nextImages }, "");
}

export async function removeRoomEmoji(client: MatrixClient, roomId: string, shortcode: string): Promise<void> {
  const room = client.getRoom(roomId);
  const content = room ? getContent(room) : {};
  const nextImages = { ...content.images };
  delete nextImages[shortcode];
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, ROOM_EMOTES_EVENT, { ...content, images: nextImages }, "");
}

/**
 * Space-wide ("server") custom emoji: the exact same `im.ponies.room_emotes`
 * pack, just hosted on the SPACE room instead of one channel. Every channel
 * in the space can use them. `getAvailableEmojis` below merges a channel's
 * own pack over its owning space's pack (channel shortcodes win a clash), so
 * the composer autocomplete and the send-time :shortcode: substitution pick
 * both up automatically. `addSpaceEmoji`/`removeSpaceEmoji`/
 * `canManageSpaceEmojis` are just the room helpers pointed at the space id.
 */
export function getSpaceEmojis(space: Room): RoomEmoji[] {
  return getRoomEmojis(space);
}

export function canManageSpaceEmojis(space: Room, userId: string): boolean {
  return canManageRoomEmojis(space, userId);
}

export function addSpaceEmoji(client: MatrixClient, spaceId: string, shortcode: string, file: File): Promise<void> {
  return addRoomEmoji(client, spaceId, shortcode, file);
}

export function removeSpaceEmoji(client: MatrixClient, spaceId: string, shortcode: string): Promise<void> {
  return removeRoomEmoji(client, spaceId, shortcode);
}

/** Every custom emoji usable in `room`: its own pack plus its owning space's pack (own wins on a shortcode clash). */
export function getAvailableEmojis(client: MatrixClient, room: Room): RoomEmoji[] {
  const own = getRoomEmojis(room);
  const space = getOwningSpace(client, room.roomId);
  if (!space || space.roomId === room.roomId) return own;
  const ownCodes = new Set(own.map((e) => e.shortcode));
  return [...own, ...getRoomEmojis(space).filter((e) => !ownCodes.has(e.shortcode))];
}

/**
 * Discord-Nitro's "use emoji from any server" - free here, since a custom
 * emoji is just an `<img mxc://…>` the reader resolves through federated
 * media. Aggregates the packs of EVERY room/space this account is joined to;
 * `room`'s own available emoji come first and win on a shortcode clash, then
 * everything else in room order, deduped by shortcode. Somewhat expensive
 * (one state-event read per joined room) - callers should memoise it.
 *
 * `includeExternal` (default true) gates only the "every OTHER joined room"
 * part - `room`'s own/space emoji are always included regardless, matching
 * Discord's own permission (which only restricts emoji from OTHER
 * servers, never a server's own). Pass false for a member whose role
 * denies the "Use External Emoji" permission (see permissions.ts) -
 * client-side only, same honesty as every other client-tier permission.
 */
export function getAllUsableEmojis(client: MatrixClient, room: Room | null, includeExternal = true): RoomEmoji[] {
  const seen = new Set<string>();
  const out: RoomEmoji[] = [];
  const add = (list: RoomEmoji[]) => {
    for (const e of list) {
      if (seen.has(e.shortcode)) continue;
      seen.add(e.shortcode);
      out.push(e);
    }
  };
  if (room) add(getAvailableEmojis(client, room));
  const owningSpace = room ? getOwningSpace(client, room.roomId) : null;
  if (!owningSpace || isPersonalEmojiAllowed(owningSpace)) add(getPersonalEmojis(client));
  if (!includeExternal) return out;
  for (const r of client.getRooms()) {
    if (r.getMyMembership() !== "join" || r.roomId === room?.roomId) continue;
    add(getRoomEmojis(r));
  }
  return out;
}
