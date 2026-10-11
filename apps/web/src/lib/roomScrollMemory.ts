/**
 * Per-room "where did I leave off scrolling" memory, purely local to this
 * client - distinct from the server-synced read receipt (which drives the
 * unread divider): you can scroll up into history without necessarily
 * moving your read marker, and this is specifically about resuming that
 * scroll position when you come back to the room, not about what's been
 * marked read.
 */
const KEY_PREFIX = "jorkonvo-room-scroll-";

export interface RoomScrollMemory {
  /** The topmost (partially or fully) visible event when the room was left. */
  eventId: string;
}

export function getRoomScrollMemory(roomId: string): RoomScrollMemory | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + roomId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RoomScrollMemory>;
    return typeof parsed.eventId === "string" ? { eventId: parsed.eventId } : null;
  } catch {
    return null;
  }
}

/** Pass null to forget the room's memory (e.g. it was near the bottom, which isn't a position worth remembering). */
export function setRoomScrollMemory(roomId: string, memory: RoomScrollMemory | null): void {
  if (!memory) {
    localStorage.removeItem(KEY_PREFIX + roomId);
    return;
  }
  localStorage.setItem(KEY_PREFIX + roomId, JSON.stringify(memory));
}

/**
 * Timeline registers a callback here that captures ITS OWN current scroll
 * position; uiStore's selectRoom/selectSpace call it synchronously, before
 * changing which room is selected. This has to happen at the exact instant
 * the switch is initiated, not reactively (e.g. from an effect cleanup or a
 * debounced scroll listener) - once the new room's messages start replacing
 * the old ones in the DOM, the browser can clamp/reflow the still-mounted
 * scroll container's scrollTop as a side effect of that content changing,
 * which fires a real 'scroll' event with numbers that have nothing to do
 * with where the user actually left off reading. Capturing before any of
 * that begins sidesteps the race entirely.
 */
let captureCurrent: (() => void) | null = null;

export function registerScrollMemoryCapture(fn: (() => void) | null): void {
  captureCurrent = fn;
}

export function captureCurrentRoomScrollMemory(): void {
  captureCurrent?.();
}
