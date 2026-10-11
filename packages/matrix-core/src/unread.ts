import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { ClientEvent, MatrixEventEvent, RoomEvent } from "matrix-js-sdk";
import { isCalendarEventStart } from "./calendarEvents.js";
import { isLiveLocationStartEvent } from "./location.js";
import { ensurePushRules, getKeywordPatterns, getRoomNotificationMode } from "./notifications.js";
import { isPollStartEvent } from "./polls.js";
import { getRoomsInSpace } from "./rooms.js";
import { isStickerEvent } from "./stickers.js";
import { isVoiceChannel } from "./voiceChannels.js";

/**
 * Client-side unread state.
 *
 * On a homeserver where every room is E2EE the server can never see message
 * content, so it can count "a message arrived" but can never tell whether it
 * MENTIONS you (m.mentions is inside the ciphertext). Discord-style mention
 * badges therefore have to be computed here, from the decrypted events, and
 * accumulated per room while the room is not being looked at.
 *
 * Counters live in localStorage so they survive reloads; on boot they are
 * seeded with the server-side notification counts to cover messages that
 * arrived while the client was completely offline.
 */

export interface RoomUnread {
  total: number;
  mentions: number;
}

const STORAGE_KEY = "jorkonvo-unread-counts";

const counts = new Map<string, RoomUnread>();

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, RoomUnread>;
    for (const [roomId, entry] of Object.entries(parsed)) {
      counts.set(roomId, { total: entry.total ?? 0, mentions: entry.mentions ?? 0 });
    }
  } catch {
    // Corrupt state is treated as "no unread" - it rebuilds itself over time.
  }
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(counts)));
  } catch {
    // Storage full/unavailable - badges just won't persist across reloads.
  }
}

export function getLocalUnread(roomId: string): RoomUnread {
  return counts.get(roomId) ?? { total: 0, mentions: 0 };
}

/**
 * MSC2867 "mark as unread" - a per-room account-data flag a user sets by hand
 * ("I've seen this but want to come back to it"), independent of read receipts.
 * The stable type is `m.marked_unread`; older servers/clients (incl. Element)
 * used `com.famedly.marked_unread`, so we write and read both.
 */
const MARKED_UNREAD_STABLE = "m.marked_unread";
const MARKED_UNREAD_UNSTABLE = "com.famedly.marked_unread";

export function isRoomMarkedUnread(room: Room): boolean {
  const read = (type: string) =>
    (room.getAccountData(type)?.getContent() as { unread?: boolean } | undefined)?.unread === true;
  return read(MARKED_UNREAD_STABLE) || read(MARKED_UNREAD_UNSTABLE);
}

export async function setRoomMarkedUnread(
  client: MatrixClient,
  roomId: string,
  unread: boolean,
): Promise<void> {
  const setRoomAccountData = client.setRoomAccountData.bind(client) as unknown as (
    roomId: string,
    type: string,
    content: Record<string, unknown>,
  ) => Promise<unknown>;
  await Promise.all([
    setRoomAccountData(roomId, MARKED_UNREAD_STABLE, { unread }),
    setRoomAccountData(roomId, MARKED_UNREAD_UNSTABLE, { unread }),
  ]);
}

export function clearLocalUnread(roomId: string): void {
  counts.delete(roomId);
  save();
}

export interface RoomUnreadState {
  /** Whether to show a plain "you have unread" indicator (a dot / bold name) for this room - fully suppressed when muted. */
  unread: boolean;
  /** How many of the unread messages are mentions - 0 when muted, regardless of how many actually arrived. */
  mentionCount: number;
  /** The number to show as this room's badge: mentions only in "mentions" mode, everything in "all" mode, nothing when muted. */
  badge: number;
}

/**
 * The single source of truth for "does this room deserve the user's
 * attention right now" - shared by the room list row and the space-level
 * aggregate below, so muting a room suppresses ITS badge (already true) and
 * its contribution to the space icon's indicator (previously nothing
 * enforced that consistently in one place).
 */
export function getRoomUnreadState(client: MatrixClient, room: Room): RoomUnreadState {
  const mode = getRoomNotificationMode(client, room.roomId);
  if (mode === "muted") return { unread: false, mentionCount: 0, badge: 0 };
  const local = getLocalUnread(room.roomId);
  const total = Math.max(local.total, room.getUnreadNotificationCount());
  const markedUnread = isRoomMarkedUnread(room);
  return {
    unread: total > 0 || markedUnread,
    mentionCount: local.mentions,
    badge: mode === "all" ? total : local.mentions,
  };
}

export interface SpaceUnreadSummary {
  /** Any non-voice room in the space has an unread indicator (muted rooms never contribute). */
  hasUnread: boolean;
  /** Total mentions across the space's rooms (muted rooms never contribute). */
  mentionCount: number;
}

/**
 * App-wide unread rollup for the OS dock/taskbar badge (Discord's "Enable
 * Unread Message Badge") - every joined non-voice room, muted rooms
 * excluded, same rules as the per-space summary.
 */
export function getGlobalUnreadSummary(client: MatrixClient): SpaceUnreadSummary {
  let hasUnread = false;
  let mentionCount = 0;
  for (const room of client.getRooms()) {
    if (room.getMyMembership() !== "join") continue;
    if (room.isSpaceRoom() || isVoiceChannel(room)) continue;
    const state = getRoomUnreadState(client, room);
    if (state.unread) hasUnread = true;
    mentionCount += state.mentionCount;
  }
  return { hasUnread, mentionCount };
}

export function getSpaceUnreadSummary(client: MatrixClient, spaceId: string): SpaceUnreadSummary {
  let hasUnread = false;
  let mentionCount = 0;
  for (const room of getRoomsInSpace(client, spaceId)) {
    if (isVoiceChannel(room)) continue;
    const state = getRoomUnreadState(client, room);
    if (state.unread) hasUnread = true;
    mentionCount += state.mentionCount;
  }
  return { hasUnread, mentionCount };
}

/**
 * "Mark as read": advance the read receipt + m.fully_read marker to the
 * newest sent event and clear the local mention/unread counters. Same
 * mechanism the Timeline uses while a room is open, exposed so a context
 * menu can do it without opening the room.
 */
export async function markRoomRead(
  client: MatrixClient,
  roomId: string,
  privateReceipt = false,
): Promise<void> {
  const room = client.getRoom(roomId);
  if (room) {
    if (isRoomMarkedUnread(room)) void setRoomMarkedUnread(client, roomId, false).catch(() => undefined);
    const events = room.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev && !ev.isSending() && ev.getId()) {
        await client
          .setRoomReadMarkers(
            roomId,
            ev.getId()!,
            privateReceipt ? undefined : ev,
            privateReceipt ? ev : undefined,
          )
          .catch(() => undefined);
        break;
      }
    }
  }
  clearLocalUnread(roomId);
}

/** Marks every joined room in a space (its direct child rooms) as read. */
export async function markSpaceRead(client: MatrixClient, roomIds: string[], privateReceipt = false): Promise<void> {
  await Promise.all(roomIds.map((id) => markRoomRead(client, id, privateReceipt)));
}

function bumpLocalUnread(roomId: string, highlight: boolean): void {
  const entry = counts.get(roomId) ?? { total: 0, mentions: 0 };
  entry.total += 1;
  if (highlight) entry.mentions += 1;
  counts.set(roomId, entry);
  save();
}

/** Reverse a bumpLocalUnread call - see the "provisional bump" comment in watchUnread. */
function undoLocalUnread(roomId: string, highlight: boolean): void {
  const entry = counts.get(roomId);
  if (!entry) return;
  entry.total = Math.max(0, entry.total - 1);
  if (highlight) entry.mentions = Math.max(0, entry.mentions - 1);
  counts.set(roomId, entry);
  save();
}

/** Seed counters from the server's own notification counts after a fresh boot. */
export function seedUnreadFromServer(client: MatrixClient): void {
  for (const room of client.getRooms()) {
    const serverTotal = room.getUnreadNotificationCount();
    if (serverTotal <= 0) continue;
    const local = counts.get(room.roomId);
    if (!local || local.total < serverTotal) {
      counts.set(room.roomId, { total: serverTotal, mentions: local?.mentions ?? 0 });
    }
  }
  save();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary match that also works for non-ASCII (accented) words. */
function matchesWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}_])`, "iu");
  return re.test(haystack);
}

/**
 * Discord-style "does this message highlight me" check: explicit m.mentions,
 * @room, my (room-local) display name as a word, or one of the user's
 * notification keywords.
 */
export function eventHighlightsUser(
  ev: MatrixEvent,
  userId: string,
  displayName: string | null,
  keywords: string[],
): boolean {
  if (ev.getSender() === userId) return false;
  const content = ev.getContent();
  const mentions = content["m.mentions"] as { user_ids?: string[]; room?: boolean } | undefined;
  if (mentions?.user_ids?.includes(userId) || mentions?.room) return true;
  const body = typeof content.body === "string" ? content.body : "";
  if (!body) return false;
  if (displayName && matchesWord(body, displayName)) return true;
  return keywords.some((keyword) => matchesWord(body, keyword));
}

function countsAsMessage(ev: MatrixEvent): boolean {
  if (ev.isRedacted()) return false;
  if (isPollStartEvent(ev) || isCalendarEventStart(ev) || isStickerEvent(ev) || isLiveLocationStartEvent(ev)) return true;
  if (ev.getType() !== "m.room.message") return false;
  if (ev.getContent()?.["m.relates_to"]?.rel_type === "m.replace") return false;
  return typeof ev.getContent().body === "string";
}

let keywordsPromise: Promise<void> | null = null;

/**
 * Make sure the account's push rules are loaded before keyword matching.
 * Patterns are always read live from the client's cached push rules
 * (getKeywordPatterns) so keywords added mid-session take effect immediately
 * everywhere - a snapshot cache would go stale.
 */
export function ensureKeywordCache(client: MatrixClient): Promise<void> {
  if (client.pushRules) return Promise.resolve();
  keywordsPromise ??= ensurePushRules(client).finally(() => {
    keywordsPromise = null;
  });
  return keywordsPromise;
}

export interface UnreadWiring {
  /** Whether the user is currently looking at this room (and can see new events). */
  isRoomVisible: (roomId: string) => boolean;
  /** Called whenever a counter changes so the UI can re-render. */
  onUnreadChange: () => void;
}

/**
 * Wire live-unread accumulation to a running client. Rooms being actively
 * looked at don't accumulate (opening a room clears it instead), everything
 * else counts messages and mentions.
 *
 * Returns an unsubscribe that detaches every listener - call it before
 * switching accounts so a stopped client's listeners don't linger (matches
 * watchFriendEvents et al.).
 */
export function watchUnread(client: MatrixClient, wiring: UnreadWiring): () => void {
  load();
  void ensureKeywordCache(client);

  // Events already counted, so a late decryption can't count an event twice
  // (the live Timeline emission for an already-decrypted event, and this
  // room's own decrypted-later path, could otherwise both fire for it).
  const counted = new Set<string>();
  const markCounted = (id: string) => {
    counted.add(id);
    if (counted.size > 500) {
      const oldest = counted.values().next().value;
      if (oldest) counted.delete(oldest);
    }
  };
  // Only bump for events seen "live" (via the Timeline listener below), not
  // for arbitrary decryptions elsewhere (e.g. scrollback, thread panels).
  const liveCandidates = new Set<string>();

  // A fresh client restart re-syncs "since" its last persisted token, which
  // can legitimately redeliver events the user already read in a PREVIOUS
  // session as brand-new live Timeline emissions - on a busy account (other
  // real client sessions of the same user generating their own sync/receipt
  // traffic) it can take a few sync cycles before OUR OWN read receipt for
  // them becomes visible to this freshly booted client. Rather than delay
  // every legitimate new-message badge waiting to rule this out, bump
  // OPTIMISTICALLY right away (correct badge instantly for the normal case),
  // remember it as "provisional", and reconcile on each following sync cycle
  // for a short window: if the event turns out to already be read, undo the
  // bump. This self-corrects within a couple of seconds instead of leaving a
  // stale badge until the room is next opened.
  const RECONCILE_WINDOW_MS = 15000;
  const provisional: { id: string; room: Room; highlight: boolean; deadline: number }[] = [];

  const onSync = () => {
    if (provisional.length === 0) return;
    const myId = client.getUserId();
    const now = Date.now();
    for (let i = provisional.length - 1; i >= 0; i--) {
      const entry = provisional[i]!;
      const alreadyRead = myId ? entry.room.hasUserReadEvent(myId, entry.id) : false;
      if (alreadyRead) {
        undoLocalUnread(entry.room.roomId, entry.highlight);
        wiring.onUnreadChange();
        provisional.splice(i, 1);
      } else if (now >= entry.deadline) {
        // Confirmed unread for long enough - stop tracking, the bump stands.
        provisional.splice(i, 1);
      }
    }
  };
  client.on(ClientEvent.Sync, onSync);

  const tryBump = (event: MatrixEvent, room: Room): void => {
    if (!countsAsMessage(event)) return;
    if (event.getSender() === client.getUserId()) return;
    if (wiring.isRoomVisible(room.roomId)) return;
    const id = event.getId();
    if (id !== undefined) {
      if (counted.has(id)) return;
      markCounted(id);
    }

    const displayName = room.getMember(client.getUserId() ?? "")?.name ?? null;
    const highlight = eventHighlightsUser(event, client.getUserId() ?? "", displayName, getKeywordPatterns(client));
    bumpLocalUnread(room.roomId, highlight);
    wiring.onUnreadChange();
    if (id !== undefined) {
      provisional.push({ id, room, highlight, deadline: Date.now() + RECONCILE_WINDOW_MS });
    }
  };

  const onTimeline = (event: MatrixEvent, room: Room | undefined, toStartOfTimeline: boolean | undefined, removed: boolean, data: { liveEvent?: boolean }) => {
    if (!data?.liveEvent || toStartOfTimeline || removed || !room) return;

    // In E2EE rooms the timeline event initially arrives as m.room.encrypted.
    // When the megolm session key is already cached the SDK decrypts it
    // before adding it, so this emission carries the decrypted content - but
    // for a brand-new session decryption happens in the background, and the
    // SDK does not re-emit RoomEvent.Timeline afterwards. The client-level
    // MatrixEventEvent.Decrypted listener below picks those up instead; here
    // we just remember this event was seen live so that listener knows to
    // count it once decryption finishes.
    if (event.getType() === "m.room.encrypted") {
      const id = event.getId();
      if (id !== undefined) liveCandidates.add(id);
      return;
    }

    tryBump(event, room);
  };
  client.on(RoomEvent.Timeline, onTimeline);

  // The SDK reEmits every event's own Decrypted event onto the client
  // (event-mapper.js), which fires once background decryption of a
  // just-arrived encrypted message completes.
  const onDecrypted = (event: MatrixEvent) => {
    const id = event.getId();
    if (id === undefined || !liveCandidates.has(id)) return;
    liveCandidates.delete(id);
    const room = client.getRoom(event.getRoomId() ?? "");
    if (room) tryBump(event, room);
  };
  client.on(MatrixEventEvent.Decrypted, onDecrypted);

  return () => {
    client.removeListener(ClientEvent.Sync, onSync);
    client.removeListener(RoomEvent.Timeline, onTimeline);
    client.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
  };
}
