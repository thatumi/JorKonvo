import type { MatrixClient, Room } from "matrix-js-sdk";
import { canManagePowerLevels, getMemberPowerLevel } from "./moderation.js";

/**
 * Discord-style "time out" a member: for a fixed duration they can read but
 * not send anything (messages, reactions, edits...). Matrix has no native
 * timed restriction, so this is built from two pieces:
 *
 *  1. their power level in the room is dropped to -1 (below events_default,
 *     which is 0 in every normal room) - a real, server-enforced restriction;
 *  2. an `io.jorkonvo.timeout` state event (state key = the user id) records
 *     when it expires and what their level was before, so any JorKonvo client
 *     - and the moderator UI - can see the timeout and restore the level when
 *     the timer runs out.
 *
 * Like timed mutes / policy lists, the expiry is only actually enforced while
 * a JorKonvo client with sufficient power is online (best-effort watcher).
 * The power-level drop itself is permanent until cleared, so a stuck timer
 * fails safe (stays muted) rather than open.
 */
export const TIMEOUT_EVENT = "io.jorkonvo.timeout";

const TIMED_OUT_LEVEL = -1;
const CHECK_INTERVAL_MS = 20_000;

export interface TimeoutInfo {
  until: number;
  prevLevel: number;
  by: string;
}

export const TIMEOUT_PRESETS: { labelKey: string; ms: number }[] = [
  { labelKey: "timeout.d60s", ms: 60_000 },
  { labelKey: "timeout.d5m", ms: 5 * 60_000 },
  { labelKey: "timeout.d10m", ms: 10 * 60_000 },
  { labelKey: "timeout.d1h", ms: 60 * 60_000 },
  { labelKey: "timeout.d1d", ms: 24 * 60 * 60_000 },
  { labelKey: "timeout.d1w", ms: 7 * 24 * 60 * 60_000 },
];

type LooseSendStateEvent = (
  roomId: string,
  eventType: string,
  content: unknown,
  stateKey?: string,
) => Promise<unknown>;

function readTimeout(room: Room, userId: string): TimeoutInfo | null {
  const content = room.currentState.getStateEvents(TIMEOUT_EVENT, userId)?.getContent() as
    | Partial<TimeoutInfo>
    | undefined;
  if (!content || typeof content.until !== "number") return null;
  return {
    until: content.until,
    prevLevel: typeof content.prevLevel === "number" ? content.prevLevel : 0,
    by: typeof content.by === "string" ? content.by : "",
  };
}

/** The active timeout for a member, or null if none / already expired. */
export function getUserTimeout(room: Room, userId: string): TimeoutInfo | null {
  const info = readTimeout(room, userId);
  if (!info) return null;
  return info.until > Date.now() ? info : null;
}

export function isUserTimedOut(room: Room, userId: string): boolean {
  return getUserTimeout(room, userId) !== null;
}

/**
 * Whether the acting user can time `targetUserId` out here: they must be able
 * to edit power levels AND outrank the target (same rule as a power-level
 * change), and the target must not already be a moderator-or-above we'd be
 * unable to restore.
 */
export function canTimeOut(room: Room, actingUserId: string, targetUserId: string): boolean {
  if (actingUserId === targetUserId) return false;
  if (!canManagePowerLevels(room, actingUserId)) return false;
  return getMemberPowerLevel(room, actingUserId) > getMemberPowerLevel(room, targetUserId);
}

export async function setUserTimeout(
  client: MatrixClient,
  roomId: string,
  userId: string,
  durationMs: number,
): Promise<void> {
  const room = client.getRoom(roomId);
  if (!room) return;
  const existing = readTimeout(room, userId);
  // If they're already timed out, keep the ORIGINAL prevLevel so a second,
  // longer timeout doesn't "capture" the -1 as their level to restore to.
  const prevLevel = existing && existing.until > Date.now() ? existing.prevLevel : getMemberPowerLevel(room, userId);
  await client.setPowerLevel(roomId, userId, TIMED_OUT_LEVEL);
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(
    roomId,
    TIMEOUT_EVENT,
    { until: Date.now() + durationMs, prevLevel, by: client.getUserId() ?? "" },
    userId,
  );
}

export async function clearUserTimeout(client: MatrixClient, roomId: string, userId: string): Promise<void> {
  const room = client.getRoom(roomId);
  if (!room) return;
  const info = readTimeout(room, userId);
  if (info && getMemberPowerLevel(room, userId) <= TIMED_OUT_LEVEL) {
    await client.setPowerLevel(roomId, userId, info.prevLevel);
  }
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, TIMEOUT_EVENT, {}, userId);
}

/** Restores power levels for any timeout that has expired, in every room where this client can. */
export function watchUserTimeouts(client: MatrixClient): () => void {
  async function tick() {
    const me = client.getUserId() ?? "";
    for (const room of client.getRooms()) {
      const events = room.currentState.getStateEvents(TIMEOUT_EVENT);
      const list = Array.isArray(events) ? events : events ? [events] : [];
      for (const ev of list) {
        const userId = ev.getStateKey();
        if (!userId) continue;
        const info = readTimeout(room, userId);
        if (!info || info.until > Date.now()) continue;
        if (!canManagePowerLevels(room, me)) continue;
        try {
          await clearUserTimeout(client, room.roomId, userId);
        } catch {
          // best effort - retried next tick
        }
      }
    }
  }
  const interval = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  void tick();
  return () => clearInterval(interval);
}
