import { type MatrixClient, type MatrixEvent, RelationType, type Room } from "matrix-js-sdk";
import { getSortedJoinedRooms, isSpaceRoom } from "./rooms.js";

/**
 * Discord-style scheduled events ("naptár" / calendar events), entirely
 * JorKonvo-own (io.jorkonvo.* namespace) - unlike polls/voice messages there
 * is no widely-deployed MSC for this, so it follows the same pattern as
 * friends.ts/roles.ts: a plain custom event type rather than borrowing an
 * unstable spec proposal. An event is a normal timeline message
 * (io.jorkonvo.calendar.event) that other clients will at least render as
 * plain text via `body`; an RSVP is a separate event related to it via the
 * standard m.reference relation, the same aggregation pattern used
 * throughout this package (polls/reactions/threads/audit log/voice
 * presence) - scan the room's already-loaded timeline for related events.
 * Cancelling an event reuses plain redaction (redactEvent in messages.ts) -
 * no separate mechanism needed, and it matches how every other "delete this"
 * action in the app already works.
 */

export const CALENDAR_EVENT_TYPE = "io.jorkonvo.calendar.event";
const RSVP_TYPE = "io.jorkonvo.calendar.rsvp";

export type RsvpStatus = "going" | "maybe" | "not_going";

export interface CalendarEventData {
  eventId: string;
  roomId: string;
  senderId: string;
  title: string;
  description: string;
  location: string;
  startTs: number;
  endTs: number | null;
  createdTs: number;
}

export interface CalendarEventTally {
  event: CalendarEventData;
  countsByStatus: Record<RsvpStatus, number>;
  myStatus: RsvpStatus | null;
  goingUserIds: string[];
}

type LooseSendEvent = (roomId: string, eventType: string, content: unknown) => Promise<unknown>;

export function isCalendarEventStart(ev: MatrixEvent): boolean {
  return ev.getType() === CALENDAR_EVENT_TYPE;
}

export function parseCalendarEvent(ev: MatrixEvent): CalendarEventData | null {
  const eventId = ev.getId();
  const roomId = ev.getRoomId();
  if (!eventId || !roomId) return null;
  const content = ev.getContent() as {
    title?: string;
    description?: string;
    location?: string;
    start_ts?: number;
    end_ts?: number;
  };
  if (!content.title || typeof content.start_ts !== "number") return null;

  return {
    eventId,
    roomId,
    senderId: ev.getSender() ?? "",
    title: content.title,
    description: content.description ?? "",
    location: content.location ?? "",
    startTs: content.start_ts,
    endTs: typeof content.end_ts === "number" ? content.end_ts : null,
    createdTs: ev.getTs(),
  };
}

export async function createCalendarEvent(
  client: MatrixClient,
  roomId: string,
  opts: { title: string; description?: string; location?: string; startTs: number; endTs?: number },
): Promise<void> {
  const when = new Date(opts.startTs).toLocaleString("hu-HU", { dateStyle: "medium", timeStyle: "short" });
  const content = {
    body: `📅 ${opts.title} — ${when}${opts.location ? ` (${opts.location})` : ""}`,
    title: opts.title,
    description: opts.description?.trim() || undefined,
    location: opts.location?.trim() || undefined,
    start_ts: opts.startTs,
    end_ts: opts.endTs,
  };
  await (client.sendEvent as unknown as LooseSendEvent)(roomId, CALENDAR_EVENT_TYPE, content);
}

export async function rsvpToCalendarEvent(
  client: MatrixClient,
  roomId: string,
  calendarEventId: string,
  status: RsvpStatus,
): Promise<void> {
  const content = {
    status,
    "m.relates_to": { rel_type: RelationType.Reference, event_id: calendarEventId },
  };
  await (client.sendEvent as unknown as LooseSendEvent)(roomId, RSVP_TYPE, content);
}

/** Tallies RSVPs from the room's already-loaded timeline (same manual-scan pattern used throughout this package). */
export function tallyCalendarEventRsvps(room: Room, calendarEventId: string, ownUserId: string): CalendarEventTally | null {
  const startEvent = room.findEventById(calendarEventId);
  if (!startEvent || startEvent.isRedacted()) return null;
  const event = parseCalendarEvent(startEvent);
  if (!event) return null;

  const latestBySender = new Map<string, { status: RsvpStatus; ts: number }>();
  for (const ev of room.getLiveTimeline().getEvents()) {
    if (ev.getType() !== RSVP_TYPE) continue;
    const relates = ev.getContent()?.["m.relates_to"];
    if (relates?.rel_type !== RelationType.Reference || relates.event_id !== calendarEventId) continue;
    const sender = ev.getSender();
    const status = ev.getContent().status as RsvpStatus | undefined;
    if (!sender || (status !== "going" && status !== "maybe" && status !== "not_going")) continue;
    const existing = latestBySender.get(sender);
    if (!existing || ev.getTs() >= existing.ts) latestBySender.set(sender, { status, ts: ev.getTs() });
  }

  const countsByStatus: Record<RsvpStatus, number> = { going: 0, maybe: 0, not_going: 0 };
  const goingUserIds: string[] = [];
  for (const [userId, { status }] of latestBySender) {
    countsByStatus[status]++;
    if (status === "going") goingUserIds.push(userId);
  }

  return {
    event,
    countsByStatus,
    myStatus: latestBySender.get(ownUserId)?.status ?? null,
    goingUserIds,
  };
}

/**
 * All upcoming (not yet ended, not cancelled/redacted), already-loaded
 * calendar events across every joined non-space room, soonest first - the
 * data backing the "Közelgő események" panel. Like the rest of this
 * package's manual-scan helpers, this only sees events already loaded into
 * each room's live timeline (no server-side query exists for a fully custom
 * event type), which is exactly what every joined room already has after a
 * normal sync.
 */
export function getUpcomingCalendarEvents(client: MatrixClient): CalendarEventData[] {
  const now = Date.now();
  const events: CalendarEventData[] = [];
  for (const room of getSortedJoinedRooms(client)) {
    if (isSpaceRoom(room)) continue;
    for (const ev of room.getLiveTimeline().getEvents()) {
      if (!isCalendarEventStart(ev) || ev.isRedacted()) continue;
      const data = parseCalendarEvent(ev);
      if (!data) continue;
      const endsAt = data.endTs ?? data.startTs;
      if (endsAt < now) continue;
      events.push(data);
    }
  }
  events.sort((a, b) => a.startTs - b.startTs);
  return events;
}

/**
 * Upcoming events this account RSVP'd "going"/"maybe" to, starting within
 * `leadMs` from now - the data backing a "reminder" notification. Pure
 * function (no side effects, no dedup/already-notified tracking) so the
 * caller decides how often to poll and how to avoid re-notifying for the
 * same event - see apps/web/src/lib/calendarReminders.ts.
 */
export function getEventsNeedingReminder(client: MatrixClient, leadMs: number): CalendarEventData[] {
  const ownUserId = client.getUserId();
  if (!ownUserId) return [];
  const now = Date.now();
  return getUpcomingCalendarEvents(client).filter((ev) => {
    if (ev.startTs - now > leadMs || ev.startTs <= now) return false;
    const room = client.getRoom(ev.roomId);
    if (!room) return false;
    const tally = tallyCalendarEventRsvps(room, ev.eventId, ownUserId);
    return tally?.myStatus === "going" || tally?.myStatus === "maybe";
  });
}
