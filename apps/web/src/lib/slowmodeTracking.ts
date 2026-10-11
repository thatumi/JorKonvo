/**
 * This device's own record of when it last sent a message in each room -
 * purely local bookkeeping for the client-side slowmode countdown (see
 * slowmode.ts in matrix-core for why this can only ever be a courtesy
 * limit, not real enforcement). Deliberately per-DEVICE, not synced via
 * account data: slowmode is meant to pace a person's own sending rate on
 * whichever device they're actively typing from, not follow them around.
 */

const KEY_PREFIX = "jorkonvo-slowmode-last-sent-";

export function getLastSentAt(roomId: string): number {
  return Number(localStorage.getItem(KEY_PREFIX + roomId)) || 0;
}

export function markSentNow(roomId: string): void {
  localStorage.setItem(KEY_PREFIX + roomId, String(Date.now()));
}
