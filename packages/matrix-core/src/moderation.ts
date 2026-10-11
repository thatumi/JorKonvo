import { EventType, type MatrixClient, type Room } from "matrix-js-sdk";

export const POWER_LEVEL_PRESETS = [
  { labelKey: "power.owner", value: 100, hintKey: "power.ownerHint" },
  { labelKey: "power.admin", value: 50, hintKey: "power.adminHint" },
  { labelKey: "power.moderator", value: 25, hintKey: "power.moderatorHint" },
  { labelKey: "power.member", value: 0, hintKey: "power.memberHint" },
] as const;

/** The preset whose value is closest to (but not above) the given level, for labelling arbitrary power levels. */
export function describePowerLevel(level: number): { labelKey: string; hintKey: string; exact: boolean } {
  const exact = POWER_LEVEL_PRESETS.find((p) => p.value === level);
  if (exact) return { labelKey: exact.labelKey, hintKey: exact.hintKey, exact: true };
  const below = [...POWER_LEVEL_PRESETS].sort((a, b) => b.value - a.value).find((p) => p.value <= level);
  return { labelKey: below?.labelKey ?? "power.custom", hintKey: below?.hintKey ?? "power.customHint", exact: false };
}

export function getPinnedEventIds(room: Room): string[] {
  return (room.currentState.getStateEvents(EventType.RoomPinnedEvents, "")?.getContent().pinned as
    | string[]
    | undefined) ?? [];
}

export function isPinned(room: Room, eventId: string): boolean {
  return getPinnedEventIds(room).includes(eventId);
}

export async function pinMessage(client: MatrixClient, roomId: string, eventId: string): Promise<void> {
  const room = client.getRoom(roomId);
  const current = room ? getPinnedEventIds(room) : [];
  if (current.includes(eventId)) return;
  await client.sendStateEvent(roomId, EventType.RoomPinnedEvents, { pinned: [...current, eventId] }, "");
}

export async function unpinMessage(client: MatrixClient, roomId: string, eventId: string): Promise<void> {
  const room = client.getRoom(roomId);
  const current = room ? getPinnedEventIds(room) : [];
  await client.sendStateEvent(
    roomId,
    EventType.RoomPinnedEvents,
    { pinned: current.filter((id) => id !== eventId) },
    "",
  );
}

export function canPinInRoom(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(EventType.RoomPinnedEvents, userId);
}

/**
 * Reports a message to the HOMESERVER's admins (spec's `POST
 * /rooms/{roomId}/report/{eventId}`) - moderation for public rooms where
 * you aren't yourself a moderator, distinct from pin/kick/ban which act
 * within the room itself. The server doesn't expose reports back to
 * clients (no read side), it's a one-way signal for server admins, so
 * there's nothing here to list or undo. `score` follows the spec's -100
 * (very offensive) to 0 (not offensive) convention; a fixed strongly-
 * negative value is used since this app doesn't ask the reporter to rate
 * severity, only to give a reason.
 */
export async function reportMessage(
  client: MatrixClient,
  roomId: string,
  eventId: string,
  reason: string,
): Promise<void> {
  await client.reportEvent(roomId, eventId, -100, reason);
}

/** Reports an entire room (not one message) to the HOMESERVER's admins - spec's `POST /rooms/{roomId}/report`, same one-way, no-read-side signal as reportMessage. */
export async function reportRoom(client: MatrixClient, roomId: string, reason: string): Promise<void> {
  await client.reportRoom(roomId, reason);
}

/**
 * NOTE on `hasSufficientPowerLevelFor(action, powerLevel)`: despite its
 * name, this SDK helper does NOT take "who" - it just checks whether the
 * `powerLevel` value you pass in meets the room's configured threshold for
 * `action` (matrix-js-sdk's own maySendRedactionForEvent always passes the
 * ACTING user's own level, confirmed by reading its source). It does not
 * compare against a target's level at all. The previous version of these
 * two functions passed the *target's* power level instead of the actor's,
 * and never compared the two - which both misidentified who the check was
 * about, and skipped the spec's own kick/ban auth rule entirely (a sender
 * may only kick/ban a target whose power level is strictly lower than
 * their own). Found live: it showed Kirúgás/Kitiltás for a same-level
 * target (both room owners at PL 100) via the new profile popover, which
 * should never be an available action there.
 */
export function canKick(room: Room, actingUserId: string, targetUserId: string): boolean {
  if (actingUserId === targetUserId) return false;
  const ownPowerLevel = room.getMember(actingUserId)?.powerLevel ?? 0;
  const targetPowerLevel = room.getMember(targetUserId)?.powerLevel ?? 0;
  return room.currentState.hasSufficientPowerLevelFor("kick", ownPowerLevel) && ownPowerLevel > targetPowerLevel;
}

export function canBan(room: Room, actingUserId: string, targetUserId: string): boolean {
  if (actingUserId === targetUserId) return false;
  const ownPowerLevel = room.getMember(actingUserId)?.powerLevel ?? 0;
  const targetPowerLevel = room.getMember(targetUserId)?.powerLevel ?? 0;
  return room.currentState.hasSufficientPowerLevelFor("ban", ownPowerLevel) && ownPowerLevel > targetPowerLevel;
}

export function canRedactOthers(room: Room, actingUserId: string): boolean {
  const ownPowerLevel = room.getMember(actingUserId)?.powerLevel ?? 0;
  return room.currentState.hasSufficientPowerLevelFor("redact", ownPowerLevel);
}

export async function kickMember(
  client: MatrixClient,
  roomId: string,
  userId: string,
  reason?: string,
): Promise<void> {
  await client.kick(roomId, userId, reason);
}

export async function banMember(
  client: MatrixClient,
  roomId: string,
  userId: string,
  reason?: string,
): Promise<void> {
  await client.ban(roomId, userId, reason);
}

export async function unbanMember(client: MatrixClient, roomId: string, userId: string): Promise<void> {
  await client.unban(roomId, userId);
}

export function getMemberPowerLevel(room: Room, userId: string): number {
  return room.getMember(userId)?.powerLevel ?? 0;
}

export function canManagePowerLevels(room: Room, actingUserId: string): boolean {
  return room.currentState.maySendStateEvent(EventType.RoomPowerLevels, actingUserId);
}

/**
 * Mirrors the Matrix spec's own m.room.power_levels authorization rule
 * (enforced server-side): you may only change ANOTHER user's power level
 * when your own level is *strictly greater* than theirs - equal levels are
 * rejected by the server (confirmed live: "You don't have permission to
 * remove ops level equal to your own"), not just "greater or equal". Also
 * blocks editing your own level via this UI, to avoid self-lockout.
 */
export function canSetMemberPowerLevel(
  room: Room,
  actingUserId: string,
  targetUserId: string,
  newLevel: number,
): boolean {
  if (actingUserId === targetUserId) return false;
  if (!canManagePowerLevels(room, actingUserId)) return false;
  const ownLevel = getMemberPowerLevel(room, actingUserId);
  return ownLevel > getMemberPowerLevel(room, targetUserId) && ownLevel >= newLevel;
}

export async function setMemberPowerLevel(
  client: MatrixClient,
  roomId: string,
  userId: string,
  powerLevel: number,
): Promise<void> {
  await client.setPowerLevel(roomId, userId, powerLevel);
}

/**
 * Whether `userId` may invite others to (or hand out a working invite link
 * for) this room/space. Backed by the real `m.room.power_levels` `invite`
 * threshold, so it's server-enforced too - not a client-only nicety.
 */
export function canInviteToRoom(room: Room, userId: string): boolean {
  const ownPowerLevel = room.getMember(userId)?.powerLevel ?? 0;
  return room.currentState.hasSufficientPowerLevelFor("invite", ownPowerLevel);
}

/** The room's configured `invite` power-level threshold (spec default: 0 = everyone). */
export function getInvitePowerLevel(room: Room): number {
  const pl = room.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() as
    | { invite?: number }
    | undefined;
  return typeof pl?.invite === "number" ? pl.invite : 0;
}

/**
 * Sets who can invite to a room/space by writing the `invite` field of
 * `m.room.power_levels` (merged into the existing content). Server-enforced
 * from then on. Caller must hold power-level management rights.
 */
export async function setInvitePowerLevel(
  client: MatrixClient,
  roomId: string,
  level: number,
): Promise<void> {
  const room = client.getRoom(roomId);
  const current = (room?.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() ??
    {}) as Record<string, unknown>;
  await client.sendStateEvent(roomId, EventType.RoomPowerLevels, { ...current, invite: level }, "");
}
