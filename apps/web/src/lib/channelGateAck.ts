/**
 * Per-device memory of which age-restricted channels the viewer has already
 * confirmed they're old enough for, and which spoiler-channel warnings
 * they've dismissed - so the gate/warning only interrupts once per channel.
 */
const AGE_KEY = "jorkonvo-age-gate-ack";
const SPOILER_KEY = "jorkonvo-spoiler-channel-ack";

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function writeSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // private mode / storage disabled - the gate just asks again next time
  }
}

export function hasAckedAgeGate(roomId: string): boolean {
  return readSet(AGE_KEY).has(roomId);
}

export function ackAgeGate(roomId: string): void {
  const set = readSet(AGE_KEY);
  set.add(roomId);
  writeSet(AGE_KEY, set);
}

export function hasDismissedSpoilerChannel(roomId: string): boolean {
  return readSet(SPOILER_KEY).has(roomId);
}

export function dismissSpoilerChannel(roomId: string): void {
  const set = readSet(SPOILER_KEY);
  set.add(roomId);
  writeSet(SPOILER_KEY, set);
}
