import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";
import { setRoomMuted } from "./notifications.js";

/**
 * Discord-style "mute for 15m/1h/8h/24h" on top of the existing plain mute
 * (notifications.ts's setRoomMuted, a real server-side push rule). Matrix
 * has no concept of a push rule expiring on its own, so the "until when"
 * is this app's own private account data (syncs across the account's OTHER
 * clients for free, same as the friends list) - but only THIS app's watcher
 * actually re-enables notifications when the timer runs out, best-effort,
 * only while a JorKonvo client is open (same honesty as AutoMod/policy
 * lists, just on a timer instead of an event).
 */
const TIMED_MUTES_ACCOUNT_DATA = "io.jorkonvo.timed_mutes";
const CHECK_INTERVAL_MS = 15_000;

type LooseGetAccountData = (eventType: string) => MatrixEvent | undefined;
type LooseSetAccountData = (eventType: string, content: unknown) => Promise<unknown>;

function getMutedUntilMap(client: MatrixClient): Record<string, number> {
  const ev = (client.getAccountData as unknown as LooseGetAccountData)(TIMED_MUTES_ACCOUNT_DATA);
  return ev?.getContent<{ mutedUntil?: Record<string, number> }>().mutedUntil ?? {};
}

async function writeMutedUntilMap(client: MatrixClient, map: Record<string, number>): Promise<void> {
  await (client.setAccountData as unknown as LooseSetAccountData)(TIMED_MUTES_ACCOUNT_DATA, { mutedUntil: map });
}

/** When this room's timed mute expires, or null if it's not timed-muted (either never set, or muted indefinitely/manually). */
export function getMutedUntil(client: MatrixClient, roomId: string): number | null {
  return getMutedUntilMap(client)[roomId] ?? null;
}

export async function setTimedMute(client: MatrixClient, roomId: string, durationMs: number): Promise<void> {
  await setRoomMuted(client, roomId, true);
  const map = getMutedUntilMap(client);
  await writeMutedUntilMap(client, { ...map, [roomId]: Date.now() + durationMs });
}

/** Clears the timer bookkeeping - does NOT itself unmute or mute (call setRoomMuted/setRoomNotificationMode separately). Exported for the "mute indefinitely" UI path (needs the old timer gone but the room to STAY muted, unlike clearTimedMute below). */
export async function clearTimedMuteEntry(client: MatrixClient, roomId: string): Promise<void> {
  const map = getMutedUntilMap(client);
  if (!(roomId in map)) return;
  const next = { ...map };
  delete next[roomId];
  await writeMutedUntilMap(client, next);
}

/** Unmutes immediately and clears any pending timer for this room - what the UI calls for a manual "unmute now". */
export async function clearTimedMute(client: MatrixClient, roomId: string): Promise<void> {
  await setRoomMuted(client, roomId, false);
  await clearTimedMuteEntry(client, roomId);
}

export const TIMED_MUTE_PRESETS = [
  { label: "15 perc", ms: 15 * 60 * 1000 },
  { label: "1 óra", ms: 60 * 60 * 1000 },
  { label: "8 óra", ms: 8 * 60 * 60 * 1000 },
  { label: "24 óra", ms: 24 * 60 * 60 * 1000 },
] as const;

export function watchTimedMutes(client: MatrixClient): () => void {
  async function tick() {
    const map = getMutedUntilMap(client);
    const now = Date.now();
    for (const [roomId, expiresAt] of Object.entries(map)) {
      if (expiresAt > now) continue;
      try {
        await clearTimedMute(client, roomId);
      } catch {
        // best effort - will retry on the next tick if this failed transiently
      }
    }
  }
  const interval = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  void tick(); // catch anything that already expired while this account wasn't open
  return () => clearInterval(interval);
}
