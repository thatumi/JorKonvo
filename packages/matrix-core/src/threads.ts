import { type MatrixClient, type MatrixEvent, MsgType, RelationType, type Room } from "matrix-js-sdk";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";

/**
 * Thread replies, aggregated by scanning the room's live timeline for
 * `m.thread` relations targeting `rootEventId` - the same approach used for
 * reactions (see getReactionsForEvent). Deliberately does NOT rely on
 * matrix-js-sdk's `Room.getThread()`/`Thread` class: that requires the
 * homeserver to bundle bundled `m.relations` on the root event (or the SDK
 * to have separately fetched `/relations`), which some homeservers don't
 * reliably provide - the manual scan works uniformly for local echoes and
 * synced events alike.
 */
export function getThreadReplies(room: Room, rootEventId: string): MatrixEvent[] {
  return room
    .getLiveTimeline()
    .getEvents()
    .filter((ev) => {
      if (ev.isRedacted()) return false;
      if (ev.getType() !== "m.room.message") return false;
      const relation = ev.getContent()?.["m.relates_to"];
      return relation?.rel_type === RelationType.Thread && relation.event_id === rootEventId;
    });
}

export function getThreadReplyCount(room: Room, rootEventId: string): number {
  return getThreadReplies(room, rootEventId).length;
}

export interface ThreadSummary {
  rootId: string;
  root: MatrixEvent | undefined;
  replyCount: number;
  /** Timestamp of the newest reply (or the root, if somehow none). */
  lastActivityTs: number;
  participants: string[];
}

/**
 * Every thread in the room (from the loaded portion of the live timeline),
 * newest-activity first - backs the "all threads" side panel. Same manual
 * m.thread scan as getThreadReplies, done once for the whole room.
 */
export function getRoomThreads(room: Room): ThreadSummary[] {
  const events = room.getLiveTimeline().getEvents();
  const byRoot = new Map<string, MatrixEvent[]>();
  for (const ev of events) {
    if (ev.isRedacted() || ev.getType() !== "m.room.message") continue;
    const relation = ev.getContent()?.["m.relates_to"];
    if (relation?.rel_type !== RelationType.Thread || typeof relation.event_id !== "string") continue;
    const list = byRoot.get(relation.event_id) ?? [];
    list.push(ev);
    byRoot.set(relation.event_id, list);
  }

  const summaries: ThreadSummary[] = [];
  for (const [rootId, replies] of byRoot) {
    const root = room.findEventById(rootId);
    const lastReply = replies[replies.length - 1];
    summaries.push({
      rootId,
      root,
      replyCount: replies.length,
      lastActivityTs: lastReply?.getTs() ?? root?.getTs() ?? 0,
      participants: getThreadParticipants(room, rootId),
    });
  }
  return summaries.sort((a, b) => b.lastActivityTs - a.lastActivityTs);
}

/** Participant user IDs in a thread, most-recent-reply-first, deduplicated. */
export function getThreadParticipants(room: Room, rootEventId: string): string[] {
  const replies = getThreadReplies(room, rootEventId);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const ev of [...replies].reverse()) {
    const sender = ev.getSender();
    if (sender && !seen.has(sender)) {
      seen.add(sender);
      order.push(sender);
    }
  }
  return order;
}

export async function sendThreadReply(
  client: MatrixClient,
  roomId: string,
  rootEventId: string,
  body: string,
): Promise<void> {
  const room = client.getRoom(roomId);
  // Per spec convention, the plain-text fallback (for clients that don't
  // understand threads) should point at the latest reply so it reads as a
  // normal reply chain, falling back to the root if there are none yet.
  const latestReply = room ? getThreadReplies(room, rootEventId).at(-1) : undefined;

  // Passed without a threadId: matrix-js-sdk's thread-aware local-echo
  // placement depends on Room.getThread() already existing, which (see
  // module doc) isn't reliable here - the m.relates_to content below is
  // what actually matters, and plain sendMessage still lands the event in
  // the room's live timeline where getThreadReplies() will find it.
  await client.sendMessage(roomId, {
    msgtype: MsgType.Text,
    body,
    "m.relates_to": {
      rel_type: RelationType.Thread,
      event_id: rootEventId,
      is_falling_back: true,
      "m.in_reply_to": { event_id: latestReply?.getId() ?? rootEventId },
    },
  } as RoomMessageEventContent);
}
