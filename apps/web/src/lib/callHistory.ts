/**
 * A local call log - Discord/phone-style "who called, when, did you
 * answer". Deliberately client-local (localStorage), not account data:
 * this app has no server-side call log of its own (Matrix itself doesn't
 * keep one either), and unlike a push rule or a friends list, "what calls
 * did I see on THIS device" has no obvious cross-device meaning - the
 * user's other real clients (Element X, Sable, etc.) already keep their
 * own separate call history.
 */

export interface CallHistoryEntry {
  id: string;
  roomId: string;
  direction: "incoming" | "outgoing";
  isGroupCall: boolean;
  startedAt: number;
  endedAt: number;
  /** Whether the call ever actually connected (had two-way media) at any point - the difference between "missed"/"cancelled" and a real, if short, call. */
  everConnected: boolean;
}

const KEY = "jorkonvo-call-history";
const MAX_ENTRIES = 100;

export function getCallHistory(): CallHistoryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function addCallHistoryEntry(entry: Omit<CallHistoryEntry, "id">): void {
  const full: CallHistoryEntry = { ...entry, id: `call_${entry.startedAt}_${Math.random().toString(36).slice(2, 8)}` };
  const next = [full, ...getCallHistory()].slice(0, MAX_ENTRIES);
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function clearCallHistory(): void {
  localStorage.removeItem(KEY);
}
