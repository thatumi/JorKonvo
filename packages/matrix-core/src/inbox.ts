import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";
import { eventHighlightsUser } from "./unread.js";

/**
 * Discord-style "Inbox" / Mentions view: recent messages across EVERY joined
 * room that are (a) mentions of the user - explicit m.mentions, @room, their
 * room-local display name or a notification keyword (same matcher the unread
 * badges use) - or (b) direct replies to one of the user's own messages.
 *
 * Scanned from the loaded portion of each room's live timeline (same
 * limitation as everywhere else in this package: no homeserver search API
 * covers this, and E2EE content is only visible client-side anyway).
 */

export interface ActivityItem {
  event: MatrixEvent;
  roomId: string;
  kind: "mention" | "reply";
  ts: number;
}

const MENTION_KEYWORDS_PLACEHOLDER: string[] = [];
export const MAX_INBOX_ITEMS = 80;

export function getRecentActivity(client: MatrixClient, ownUserId: string): ActivityItem[] {
  const items: ActivityItem[] = [];
  const me = ownUserId;

  for (const room of client.getRooms()) {
    if (room.getMyMembership() !== "join") continue;
    if (room.isSpaceRoom()) continue;
    const displayName = room.getMember(ownUserId)?.name ?? null;
    // Keywords are already folded into the mention matcher by the caller via
    // eventHighlightsUser; pass none here to keep the inbox to real mentions
    // and replies (keywords fire far too often for a mixed activity feed).
    const ownEventIds = new Set<string>();

    const events = room.getLiveTimeline().getEvents();
    // First pass: collect the user's own message ids so replies to them can
    // be matched without needing the full relation graph.
    for (const ev of events) {
      const id = ev.getId();
      if (ev.getSender() === me && ev.getType() === "m.room.message" && id !== undefined) {
        ownEventIds.add(id);
      }
    }

    for (const ev of events) {
      if (ev.isRedacted() || ev.isSending()) continue;
      if (ev.getType() !== "m.room.message") continue;
      if (ev.getSender() === ownUserId) continue;
      const content = ev.getContent();
      const relation = content["m.relates_to"];
      const replyTo = relation?.["m.in_reply_to"]?.event_id as string | undefined;

      let kind: ActivityItem["kind"] | null = null;
      if (replyTo && ownEventIds.has(replyTo)) kind = "reply";
      else if (eventHighlightsUser(ev, ownUserId, displayName, MENTION_KEYWORDS_PLACEHOLDER)) kind = "mention";
      if (!kind) continue;

      items.push({ event: ev, roomId: room.roomId, kind, ts: ev.getTs() });
    }
  }

  return items.sort((a, b) => b.ts - a.ts).slice(0, MAX_INBOX_ITEMS);
}
