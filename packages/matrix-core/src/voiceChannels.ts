import type { MatrixClient, Room } from "matrix-js-sdk";

/**
 * Discord-style persistent voice channels, layered on top of the existing
 * ad-hoc LiveKit group-call machinery (groupCalls.ts) - a voice channel is
 * just a regular room flagged with a state event, that clients auto-join
 * the group call for on click instead of opening the composer first.
 *
 * "Who's currently in the call" has no first-class Matrix primitive that
 * works for rooms you haven't opened (LiveKit only tells you once you've
 * connected). We approximate it the same way threads/reactions already
 * work in this app: a lightweight, non-state timeline event that each
 * connected client re-sends periodically (a heartbeat) while connected,
 * and readers trust only within a short freshness window. A plain
 * (non-state) event type is used deliberately - state events for a custom
 * type default to the room's `state_default` power level (commonly 50),
 * which would lock regular members out of ever announcing their own
 * presence; a normal event only needs `events_default` (commonly 0), same
 * as sending a message.
 */

export const CHANNEL_TYPE_EVENT = "io.jorkonvo.channel_type";
export const VOICE_MEMBER_EVENT = "io.jorkonvo.voice_member_update";

/** The client re-announces well within this window while connected (see groupCallStore's heartbeat). */
export const VOICE_PRESENCE_FRESHNESS_MS = 90_000;
export const VOICE_PRESENCE_HEARTBEAT_MS = 30_000;

export type ChannelType = "text" | "voice" | "stage" | "forum";

export function getChannelType(room: Room): ChannelType {
  const type = room.currentState.getStateEvents(CHANNEL_TYPE_EVENT, "")?.getContent()?.type;
  return type === "voice" || type === "stage" || type === "forum" ? type : "text";
}

/** True for either kind of voice-backed channel (plain voice or stage) - most sidebar/join-flow logic doesn't care which. */
export function isVoiceChannel(room: Room): boolean {
  const type = getChannelType(room);
  return type === "voice" || type === "stage";
}

export function isStageChannel(room: Room): boolean {
  return getChannelType(room) === "stage";
}

export function isForumChannel(room: Room): boolean {
  return getChannelType(room) === "forum";
}

/**
 * Who may run a stage: promote/demote speakers, and (implicitly) who joins
 * a stage's call as a speaker by default rather than muted audience. Reuses
 * the same "kick" power-level threshold every other moderation gate in this
 * app already uses (canKick/canBan/knock-denial) - a stage is a form of
 * room moderation, not a separate permission concept.
 */
export function canModerateStage(room: Room, userId: string): boolean {
  const ownPowerLevel = room.getMember(userId)?.powerLevel ?? 0;
  return room.currentState.hasSufficientPowerLevelFor("kick", ownPowerLevel);
}

export function canSetChannelType(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(CHANNEL_TYPE_EVENT, userId);
}

// matrix-js-sdk's sendStateEvent/sendEvent generics are constrained to its
// own known StateEvents/TimelineEvents key unions, with no plain-string
// overload for app-defined custom event types - narrow the escape to just
// these two calls rather than widening the shared MatrixClient type.
type LooseSendStateEvent = (
  roomId: string,
  eventType: string,
  content: unknown,
  stateKey?: string,
) => Promise<unknown>;
type LooseSendEvent = (roomId: string, eventType: string, content: unknown) => Promise<unknown>;

export async function setChannelType(client: MatrixClient, roomId: string, type: ChannelType): Promise<void> {
  const room = client.getRoom(roomId);
  const prev = room?.currentState.getStateEvents(CHANNEL_TYPE_EVENT, "")?.getContent() ?? {};
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, CHANNEL_TYPE_EVENT, { ...prev, type }, "");
}

/** Max simultaneous participants in this voice channel's call (0 = unlimited). Discord caps the slider at 99. */
export function getVoiceUserLimit(room: Room): number {
  const limit = room.currentState.getStateEvents(CHANNEL_TYPE_EVENT, "")?.getContent()?.userLimit;
  return typeof limit === "number" && limit > 0 ? Math.min(99, Math.floor(limit)) : 0;
}

export async function setVoiceUserLimit(client: MatrixClient, roomId: string, limit: number): Promise<void> {
  const room = client.getRoom(roomId);
  const prev = room?.currentState.getStateEvents(CHANNEL_TYPE_EVENT, "")?.getContent() ?? {};
  const clamped = limit > 0 ? Math.min(99, Math.floor(limit)) : 0;
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(
    roomId,
    CHANNEL_TYPE_EVENT,
    { ...prev, userLimit: clamped },
    "",
  );
}

export const VOICE_BITRATE_MIN_KBPS = 8;
export const VOICE_BITRATE_MAX_KBPS = 128;
export const VOICE_BITRATE_DEFAULT_KBPS = 64;

/** This voice channel's target audio bitrate in kbps (Discord's Bitrate slider, 8-128, default 64). */
export function getVoiceBitrateKbps(room: Room): number {
  const kbps = room.currentState.getStateEvents(CHANNEL_TYPE_EVENT, "")?.getContent()?.bitrateKbps;
  if (typeof kbps !== "number") return VOICE_BITRATE_DEFAULT_KBPS;
  return Math.min(VOICE_BITRATE_MAX_KBPS, Math.max(VOICE_BITRATE_MIN_KBPS, Math.round(kbps)));
}

export async function setVoiceBitrateKbps(client: MatrixClient, roomId: string, kbps: number): Promise<void> {
  const room = client.getRoom(roomId);
  const prev = room?.currentState.getStateEvents(CHANNEL_TYPE_EVENT, "")?.getContent() ?? {};
  const clamped = Math.min(VOICE_BITRATE_MAX_KBPS, Math.max(VOICE_BITRATE_MIN_KBPS, Math.round(kbps)));
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(
    roomId,
    CHANNEL_TYPE_EVENT,
    { ...prev, bitrateKbps: clamped },
    "",
  );
}

export type VoiceVideoQuality = "auto" | "720p";

/** This voice channel's camera-quality cap (Discord's Video Quality: Auto / 720p). */
export function getVoiceVideoQuality(room: Room): VoiceVideoQuality {
  return room.currentState.getStateEvents(CHANNEL_TYPE_EVENT, "")?.getContent()?.videoQuality === "720p"
    ? "720p"
    : "auto";
}

export async function setVoiceVideoQuality(
  client: MatrixClient,
  roomId: string,
  quality: VoiceVideoQuality,
): Promise<void> {
  const room = client.getRoom(roomId);
  const prev = room?.currentState.getStateEvents(CHANNEL_TYPE_EVENT, "")?.getContent() ?? {};
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(
    roomId,
    CHANNEL_TYPE_EVENT,
    { ...prev, videoQuality: quality },
    "",
  );
}

/** Announces (or clears) this device's presence in a voice channel's call. Call again every VOICE_PRESENCE_HEARTBEAT_MS while connected. */
export async function announceVoicePresence(client: MatrixClient, roomId: string, active: boolean): Promise<void> {
  await (client.sendEvent as unknown as LooseSendEvent)(roomId, VOICE_MEMBER_EVENT, { active });
}

/** User ids currently (within the freshness window) announcing themselves as connected to this voice channel's call. */
export function getActiveVoiceMemberIds(room: Room): string[] {
  const latestBySender = new Map<string, { active: boolean; ts: number }>();
  for (const ev of room.getLiveTimeline().getEvents()) {
    if (ev.getType() !== VOICE_MEMBER_EVENT) continue;
    const sender = ev.getSender();
    if (!sender) continue;
    latestBySender.set(sender, { active: Boolean(ev.getContent().active), ts: ev.getTs() });
  }
  const now = Date.now();
  const result: string[] = [];
  for (const [userId, info] of latestBySender) {
    if (info.active && now - info.ts < VOICE_PRESENCE_FRESHNESS_MS) result.push(userId);
  }
  return result;
}

/**
 * Stage speaker/audience role, raised hands, and promote/demote - all the
 * same lightweight timeline-event pattern as the voice presence heartbeat
 * above, deliberately NOT LiveKit participant attributes/data-channel
 * messages. Attempting that first (client-side setAttributes) turned out to
 * fail outright on this homeserver's LiveKit deployment ("does not have
 * permission to update own metadata") - the JWT that grants call access is
 * minted by a separate service (matrix-org/lk-jwt-service, via
 * groupCalls.ts) that this app doesn't control and isn't guaranteed to grant
 * canUpdateOwnMetadata. Matrix events sidestep that entirely (no LiveKit
 * permission dependency at all) and reuse infrastructure already proven
 * live: the same manual-timeline-scan/heartbeat pattern voice presence,
 * reactions, threads, and polls all already use in this package.
 */
export const STAGE_ROLE_EVENT = "io.jorkonvo.stage_role_update";
export const STAGE_HAND_EVENT = "io.jorkonvo.stage_hand_raised";
export const STAGE_PROMOTE_EVENT = "io.jorkonvo.stage_promote";
export const STAGE_DEMOTE_EVENT = "io.jorkonvo.stage_demote";

export type StageRole = "speaker" | "audience";

/** Announces this device's stage role - call once on joining a stage call, and again whenever promoted/demoted. */
export async function announceStageRole(client: MatrixClient, roomId: string, role: StageRole): Promise<void> {
  await (client.sendEvent as unknown as LooseSendEvent)(roomId, STAGE_ROLE_EVENT, { role });
}

/** Raises or lowers this (audience) participant's hand. */
export async function setStageHandRaised(client: MatrixClient, roomId: string, raised: boolean): Promise<void> {
  await (client.sendEvent as unknown as LooseSendEvent)(roomId, STAGE_HAND_EVENT, { raised });
}

/** Moderator action: asks a participant to become a speaker - the TARGET's own client reacts to this by unmuting and re-announcing its role (a Matrix event can only ever be sent as yourself, not on someone else's behalf). */
export async function promoteToSpeaker(client: MatrixClient, roomId: string, targetUserId: string): Promise<void> {
  await (client.sendEvent as unknown as LooseSendEvent)(roomId, STAGE_PROMOTE_EVENT, { target: targetUserId });
}

/** Moderator action: asks a speaker to go back to (muted) audience. */
export async function demoteToAudience(client: MatrixClient, roomId: string, targetUserId: string): Promise<void> {
  await (client.sendEvent as unknown as LooseSendEvent)(roomId, STAGE_DEMOTE_EVENT, { target: targetUserId });
}

/**
 * Current stage role per currently-connected user (cross-referenced against
 * getActiveVoiceMemberIds so a stale role announcement from a since-
 * disconnected participant, or one from a wholly different past session in
 * this same room, is never trusted).
 */
export function getStageRoles(room: Room): Record<string, StageRole> {
  const activeIds = new Set(getActiveVoiceMemberIds(room));
  const latestBySender = new Map<string, { role: StageRole; ts: number }>();
  for (const ev of room.getLiveTimeline().getEvents()) {
    if (ev.getType() !== STAGE_ROLE_EVENT) continue;
    const sender = ev.getSender();
    if (!sender) continue;
    const role = ev.getContent().role;
    if (role !== "speaker" && role !== "audience") continue;
    const existing = latestBySender.get(sender);
    if (!existing || ev.getTs() >= existing.ts) latestBySender.set(sender, { role, ts: ev.getTs() });
  }
  const result: Record<string, StageRole> = {};
  for (const [userId, { role }] of latestBySender) {
    if (activeIds.has(userId)) result[userId] = role;
  }
  return result;
}

/** User ids of currently-connected audience members with a raised hand. */
export function getRaisedHandUserIds(room: Room): string[] {
  const roles = getStageRoles(room);
  const latestBySender = new Map<string, { raised: boolean; ts: number }>();
  for (const ev of room.getLiveTimeline().getEvents()) {
    if (ev.getType() !== STAGE_HAND_EVENT) continue;
    const sender = ev.getSender();
    if (!sender) continue;
    const existing = latestBySender.get(sender);
    if (!existing || ev.getTs() >= existing.ts) {
      latestBySender.set(sender, { raised: Boolean(ev.getContent().raised), ts: ev.getTs() });
    }
  }
  return [...latestBySender.entries()]
    .filter(([userId, { raised }]) => raised && roles[userId] === "audience")
    .map(([userId]) => userId);
}
