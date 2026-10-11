import type { MatrixClient, Room } from "matrix-js-sdk";
import { getRoomsInSpace, isSpaceRoom } from "./rooms.js";
import { isVoiceChannel } from "./voiceChannels.js";

/**
 * Per-space UX preferences that aren't part of any Matrix spec:
 *   - the "landing channel" - which room opens when you click into the space
 *   - client-side upload limits: a soft max file size and whether large images
 *     get transparently downscaled/recompressed before sending. (The *hard*
 *     limit is the homeserver's `m.upload.size` and can only be changed in the
 *     server config; these are an additional, admin-set client-side policy.)
 *
 * Modelled as one lightweight state event on the SPACE room (same approach as
 * categories.ts), so write access is naturally gated to people who can manage
 * the space (state_default, commonly PL 50) and every member reads the same
 * value.
 */

export const SPACE_SETTINGS_EVENT = "io.jorkonvo.space_settings";

export interface SpaceSettingsContent {
  /** Room a first-time visitor to the space should land in. */
  default_room_id?: string;
  /** Soft max upload size in MB (client-enforced). 0 / undefined = no extra limit beyond the server's. */
  max_upload_mb?: number;
  /** Whether the client should downscale + recompress large images before upload. Default true. */
  compress_images?: boolean;
  /** mxc:// of a dedicated wide banner image for the channel sidebar header. Falls back to the space avatar when unset. */
  banner_url?: string;
  /** Whether members may use their own personal custom emoji (see personalEmoji.ts) in this space's rooms, on top of the space's own pack. Default true (unrestricted, matching how "Use External Emoji" also defaults open). */
  allow_personal_emoji?: boolean;
  /**
   * Whether NEW rooms created in this space should let non-members knock
   * (request to join) in addition to auto-joining space members. Default
   * false/unset: new rooms are "restricted" (space members auto-join,
   * nobody else can get in without an invite) - the safer default, since
   * opening a space up to knock requests from strangers is an explicit
   * choice, not something a space owner would expect by just creating a
   * room. Only affects room creation going forward; existing rooms keep
   * whatever join_rule they already have (see room-admin.ts createRoom).
   */
  allow_room_knocking?: boolean;
}

export interface SpaceUploadPolicy {
  maxUploadMb: number | null;
  compressImages: boolean;
}

type LooseSendStateEvent = (
  roomId: string,
  eventType: string,
  content: unknown,
  stateKey?: string,
) => Promise<unknown>;

export function getSpaceSettings(space: Room): SpaceSettingsContent {
  return (
    (space.currentState.getStateEvents(SPACE_SETTINGS_EVENT, "")?.getContent() as
      | SpaceSettingsContent
      | undefined) ?? {}
  );
}

/** The admin-configured landing room for new members, or null if unset/invalid. */
export function getSpaceDefaultRoomId(space: Room): string | null {
  return getSpaceSettings(space).default_room_id ?? null;
}

/** The admin-set client-side upload policy for a space (sane defaults when unset). */
export function getSpaceUploadPolicy(space: Room | null): SpaceUploadPolicy {
  const c = space ? getSpaceSettings(space) : {};
  return {
    maxUploadMb: typeof c.max_upload_mb === "number" && c.max_upload_mb > 0 ? c.max_upload_mb : null,
    compressImages: c.compress_images ?? true,
  };
}

export function canManageSpaceSettings(space: Room, userId: string): boolean {
  return space.currentState.maySendStateEvent(SPACE_SETTINGS_EVENT, userId);
}

/** Whether members of `space` may use their own personal emoji pack here. A room with no owning space (a DM, or a bare room) has no admin to restrict this, so callers should treat "no space" as always-allowed. */
export function isPersonalEmojiAllowed(space: Room): boolean {
  return getSpaceSettings(space).allow_personal_emoji ?? true;
}

/** Whether NEW rooms created in this space should be knock-enabled (see allow_room_knocking doc above). Default false - space members always auto-join regardless of this setting; it only governs whether outsiders can knock too. */
export function isSpaceKnockingAllowed(space: Room): boolean {
  return getSpaceSettings(space).allow_room_knocking ?? false;
}

export async function setSpaceKnockingAllowed(client: MatrixClient, spaceId: string, allowed: boolean): Promise<void> {
  await updateSpaceSettings(client, spaceId, { allow_room_knocking: allowed || undefined });
}

/**
 * The channel-sidebar header image for a space: a dedicated banner if one was
 * uploaded, otherwise the space's own avatar (mxc://), otherwise null. The
 * caller resolves the mxc through authed media.
 */
export function getSpaceBannerMxc(space: Room): string | null {
  const banner = getSpaceSettings(space).banner_url;
  if (typeof banner === "string" && banner.startsWith("mxc://")) return banner;
  const avatar = space.currentState.getStateEvents("m.room.avatar", "")?.getContent().url as
    | string
    | undefined;
  return typeof avatar === "string" && avatar.startsWith("mxc://") ? avatar : null;
}

/** True when the space has its OWN banner (not just falling back to the avatar). */
export function hasCustomSpaceBanner(space: Room): boolean {
  return typeof getSpaceSettings(space).banner_url === "string";
}

/** Uploads and sets a dedicated space banner. */
export async function setSpaceBanner(client: MatrixClient, spaceId: string, file: File): Promise<void> {
  const upload = await client.uploadContent(file, { type: file.type });
  await updateSpaceSettings(client, spaceId, { banner_url: upload.content_uri });
}

export async function clearSpaceBanner(client: MatrixClient, spaceId: string): Promise<void> {
  await updateSpaceSettings(client, spaceId, { banner_url: undefined });
}

/** Merges a partial update into the space settings state event. */
export async function updateSpaceSettings(
  client: MatrixClient,
  spaceId: string,
  patch: Partial<SpaceSettingsContent>,
): Promise<void> {
  const space = client.getRoom(spaceId);
  const content: SpaceSettingsContent = { ...(space ? getSpaceSettings(space) : {}) };
  for (const [key, value] of Object.entries(patch) as [keyof SpaceSettingsContent, unknown][]) {
    if (value === undefined || value === null || value === "") delete content[key];
    else (content as Record<string, unknown>)[key] = value;
  }
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(spaceId, SPACE_SETTINGS_EVENT, content, "");
}

export async function setSpaceDefaultRoomId(
  client: MatrixClient,
  spaceId: string,
  roomId: string | null,
): Promise<void> {
  await updateSpaceSettings(client, spaceId, { default_room_id: roomId ?? undefined });
}

/** A joined, non-space, non-voice room the client can actually open right now. */
function isOpenableRoom(client: MatrixClient, roomId: string | null | undefined): boolean {
  if (!roomId) return false;
  const room = client.getRoom(roomId);
  return (
    !!room &&
    room.getMyMembership() === "join" &&
    !isSpaceRoom(room) &&
    !isVoiceChannel(room)
  );
}

/**
 * Picks which room to open when the user enters a space (or Home, when
 * `spaceId` is null). Preference order:
 *   1. the room they last had open in that scope (`lastRoomId`)
 *   2. (spaces only) the admin-configured landing room for new members
 *   3. (spaces only) the first text channel in the space
 * Returns null when nothing fits - the caller then shows the plain room list
 * (or, on Home, the Friends tab).
 */
export function resolveSpaceEntryRoomId(
  client: MatrixClient,
  spaceId: string | null,
  lastRoomId: string | null,
): string | null {
  if (spaceId === null) {
    return isOpenableRoom(client, lastRoomId) ? lastRoomId : null;
  }

  const space = client.getRoom(spaceId);
  if (!space) return null;

  const roomsInSpace = getRoomsInSpace(client, spaceId);
  const inSpace = (roomId: string | null | undefined) =>
    !!roomId && roomsInSpace.some((r) => r.roomId === roomId);

  if (inSpace(lastRoomId) && isOpenableRoom(client, lastRoomId)) return lastRoomId;

  const adminDefault = getSpaceDefaultRoomId(space);
  if (inSpace(adminDefault) && isOpenableRoom(client, adminDefault)) return adminDefault;

  const firstText = roomsInSpace.find((r) => !isVoiceChannel(r));
  return firstText?.roomId ?? null;
}
