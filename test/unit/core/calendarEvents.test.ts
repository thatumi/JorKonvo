import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatrixEvent } from "matrix-js-sdk";
import {
  CALENDAR_EVENT_TYPE,
  getEventsNeedingReminder,
  getUpcomingCalendarEvents,
  isCalendarEventStart,
  parseCalendarEvent,
  tallyCalendarEventRsvps,
  type RsvpStatus,
} from "../../../packages/matrix-core/src/calendarEvents.js";
import { FakeClient, FakeRoom } from "../../helpers/fakes.js";

/**
 * `RSVP_TYPE` is module-private in calendarEvents.ts; the wire format is the
 * documented one (an io.jorkonvo.calendar.rsvp event with an m.reference
 * relation to the start event), so the tests hardcode the literal.
 */
const RSVP_TYPE = "io.jorkonvo.calendar.rsvp";
const REFERENCE = "m.reference"; // RelationType.Reference

/** Fixed "now": 2026-09-09T12:00:00Z. */
const NOW = Date.UTC(2026, 8, 9, 12, 0, 0);
const MINUTE = 60_000;

let nextAutoId = 0;

interface EvOpts {
  type?: string;
  id?: string;
  roomId?: string | null;
  sender?: string | undefined;
  ts?: number;
  content?: Record<string, unknown>;
  redacted?: boolean;
}

/** Minimal MatrixEvent fake - only the getters matrix-core's helpers touch. */
function makeEvent(opts: EvOpts = {}): MatrixEvent {
  const content = opts.redacted ? {} : (opts.content ?? {});
  return {
    getType: () => opts.type ?? "m.room.message",
    // `in`-checks so an explicitly undefined/null id/room id stays absent.
    getId: () => ("id" in opts ? opts.id : `$auto${++nextAutoId}`),
    getRoomId: () => ("roomId" in opts ? opts.roomId : "!room:test"),
    getSender: () => ("sender" in opts ? opts.sender : "@someone:test"),
    getContent: () => content,
    getTs: () => opts.ts ?? 0,
    isRedacted: () => opts.redacted ?? false,
  } as unknown as MatrixEvent;
}

function calContent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { body: "📅 Összejövetel", title: "Összejövetel", start_ts: NOW + 5 * MINUTE, ...over };
}

function calendarStartEvent(over: EvOpts & { content?: Record<string, unknown> } = {}): MatrixEvent {
  return makeEvent({
    type: CALENDAR_EVENT_TYPE,
    id: "$start1",
    roomId: "!room:test",
    sender: "@organizer:test",
    ts: NOW - 10 * MINUTE,
    content: calContent(),
    ...over,
  });
}

function rsvpEvent(status: string, targetId: string, over: EvOpts = {}): MatrixEvent {
  return makeEvent({
    type: RSVP_TYPE,
    sender: "@someone:test",
    ts: NOW - 5 * MINUTE,
    content: { status, "m.relates_to": { rel_type: REFERENCE, event_id: targetId } },
    ...over,
  });
}

/** FakeRoom plus the two timeline members the calendar helpers need. */
class FakeEventRoom extends FakeRoom {
  private timeline: MatrixEvent[] = [];
  private byId = new Map<string, MatrixEvent>();

  addEvent(ev: MatrixEvent): this {
    this.timeline.push(ev);
    const id = ev.getId();
    if (id) this.byId.set(id, ev);
    return this;
  }

  addEvents(evs: MatrixEvent[]): this {
    for (const ev of evs) this.addEvent(ev);
    return this;
  }

  getLiveTimeline(): { getEvents: () => MatrixEvent[] } {
    return { getEvents: () => [...this.timeline] };
  }

  findEventById(id: string): MatrixEvent | null {
    return this.byId.get(id) ?? null;
  }
}

describe("isCalendarEventStart", () => {
  it("is true for io.jorkonvo.calendar.event messages", () => {
    expect(isCalendarEventStart(calendarStartEvent())).toBe(true);
  });

  it("is false for ordinary messages and RSVP votes alike", () => {
    expect(isCalendarEventStart(makeEvent({ type: "m.room.message" }))).toBe(false);
    expect(isCalendarEventStart(rsvpEvent("going", "$start1"))).toBe(false);
  });
});

describe("parseCalendarEvent", () => {
  it("parses a fully populated event", () => {
    const ev = calendarStartEvent({
      content: {
        title: "Kirándulás",
        description: "Vigyél szendvicset",
        location: "Városliget",
        start_ts: NOW + 60 * MINUTE,
        end_ts: NOW + 120 * MINUTE,
      },
    });
    expect(parseCalendarEvent(ev)).toEqual({
      eventId: "$start1",
      roomId: "!room:test",
      senderId: "@organizer:test",
      title: "Kirándulás",
      description: "Vigyél szendvicset",
      location: "Városliget",
      startTs: NOW + 60 * MINUTE,
      endTs: NOW + 120 * MINUTE,
      createdTs: NOW - 10 * MINUTE,
    });
  });

  it("defaults missing description and location to empty strings", () => {
    const data = parseCalendarEvent(calendarStartEvent({ content: { title: "Találkozó", start_ts: 5 } }));
    expect(data).toMatchObject({ description: "", location: "" });
  });

  it("keeps an end_ts of 0 (typeof-checked, not truthiness-checked)", () => {
    const data = parseCalendarEvent(calendarStartEvent({ content: { title: "T", start_ts: 5, end_ts: 0 } }));
    expect(data?.endTs).toBe(0);
  });

  it("maps a missing or non-numeric end_ts to null (open-ended event)", () => {
    const absent = parseCalendarEvent(calendarStartEvent({ content: { title: "T", start_ts: 5 } }));
    expect(absent?.endTs).toBeNull();
    const garbage = parseCalendarEvent(
      calendarStartEvent({ content: { title: "T", start_ts: 5, end_ts: "soon" } }),
    );
    expect(garbage?.endTs).toBeNull();
  });

  it("falls back to an empty senderId when the event has no sender", () => {
    const data = parseCalendarEvent(calendarStartEvent({ sender: undefined }));
    expect(data?.senderId).toBe("");
  });

  it("returns null without an event or room id", () => {
    expect(parseCalendarEvent(calendarStartEvent({ id: undefined }))).toBeNull();
    expect(parseCalendarEvent(calendarStartEvent({ roomId: null }))).toBeNull();
  });

  it("returns null without a title (absent or empty)", () => {
    expect(parseCalendarEvent(calendarStartEvent({ content: { start_ts: 5 } }))).toBeNull();
    expect(parseCalendarEvent(calendarStartEvent({ content: { title: "", start_ts: 5 } }))).toBeNull();
  });

  it("returns null without a numeric start_ts (absent or wrong type)", () => {
    expect(parseCalendarEvent(calendarStartEvent({ content: { title: "T" } }))).toBeNull();
    expect(
      parseCalendarEvent(calendarStartEvent({ content: { title: "T", start_ts: "tomorrow" } })),
    ).toBeNull();
  });

  it("accepts a start_ts of 0 (typeof-checked, not truthiness-checked)", () => {
    const data = parseCalendarEvent(calendarStartEvent({ content: { title: "T", start_ts: 0 } }));
    expect(data?.startTs).toBe(0);
  });
});

describe("tallyCalendarEventRsvps", () => {
  const ME = "@me:test";

  function roomWith(start: MatrixEvent, ...rsvps: MatrixEvent[]): FakeEventRoom {
    return new FakeEventRoom({ roomId: "!room:test" }).addEvent(start).addEvents(rsvps);
  }

  it("returns null when the start event is not in the room", () => {
    const room = new FakeEventRoom({ roomId: "!room:test" });
    expect(tallyCalendarEventRsvps(room as never, "$missing", ME)).toBeNull();
  });

  it("returns null when the start event is redacted (cancelled event)", () => {
    const room = roomWith(calendarStartEvent({ redacted: true }));
    expect(tallyCalendarEventRsvps(room as never, "$start1", ME)).toBeNull();
  });

  it("returns null when the start event cannot be parsed (e.g. no title)", () => {
    const room = roomWith(calendarStartEvent({ content: { start_ts: 5 } }));
    expect(tallyCalendarEventRsvps(room as never, "$start1", ME)).toBeNull();
  });

  it("counts one vote per user in each status bucket", () => {
    const room = roomWith(
      calendarStartEvent(),
      rsvpEvent("going", "$start1", { sender: "@a:test" }),
      rsvpEvent("maybe", "$start1", { sender: "@b:test" }),
      rsvpEvent("not_going", "$start1", { sender: "@c:test" }),
    );
    const tally = tallyCalendarEventRsvps(room as never, "$start1", ME);
    expect(tally?.countsByStatus).toEqual({ going: 1, maybe: 1, not_going: 1 });
    expect(tally?.goingUserIds).toEqual(["@a:test"]);
    expect(tally?.event).toMatchObject({ eventId: "$start1", title: "Összejövetel" });
  });

  it("only lists going users, in first-vote timeline order", () => {
    const room = roomWith(
      calendarStartEvent(),
      rsvpEvent("going", "$start1", { sender: "@b:test", ts: 100 }),
      rsvpEvent("going", "$start1", { sender: "@a:test", ts: 110 }),
      rsvpEvent("maybe", "$start1", { sender: "@c:test", ts: 120 }),
    );
    expect(tallyCalendarEventRsvps(room as never, "$start1", ME)?.goingUserIds).toEqual(["@b:test", "@a:test"]);
  });

  it("surfaces the own user's status alongside the raw counts", () => {
    const room = roomWith(
      calendarStartEvent(),
      rsvpEvent("going", "$start1", { sender: ME }),
      rsvpEvent("maybe", "$start1", { sender: "@a:test" }),
    );
    const tally = tallyCalendarEventRsvps(room as never, "$start1", ME);
    expect(tally?.myStatus).toBe("going");
    expect(tally?.countsByStatus).toEqual({ going: 1, maybe: 1, not_going: 0 });
  });

  it("myStatus is null when this account has not voted", () => {
    const room = roomWith(calendarStartEvent(), rsvpEvent("going", "$start1", { sender: "@a:test" }));
    expect(tallyCalendarEventRsvps(room as never, "$start1", ME)?.myStatus).toBeNull();
  });

  it("myStatus can be not_going - a vote is a vote", () => {
    const room = roomWith(calendarStartEvent(), rsvpEvent("not_going", "$start1", { sender: ME }));
    expect(tallyCalendarEventRsvps(room as never, "$start1", ME)?.myStatus).toBe("not_going");
  });

  it("a duplicate vote is a change of mind: the highest-ts vote per sender wins", () => {
    const flip = roomWith(
      calendarStartEvent(),
      rsvpEvent("going", "$start1", { sender: "@a:test", ts: 100 }),
      rsvpEvent("not_going", "$start1", { sender: "@a:test", ts: 200 }),
    );
    expect(tallyCalendarEventRsvps(flip as never, "$start1", ME)?.countsByStatus).toEqual({
      going: 0,
      maybe: 0,
      not_going: 1,
    });
    expect(tallyCalendarEventRsvps(flip as never, "$start1", ME)?.goingUserIds).toEqual([]);

    const flipBack = roomWith(
      calendarStartEvent(),
      rsvpEvent("not_going", "$start1", { sender: "@a:test", ts: 100 }),
      rsvpEvent("going", "$start1", { sender: "@a:test", ts: 200 }),
    );
    expect(tallyCalendarEventRsvps(flipBack as never, "$start1", ME)?.countsByStatus).toEqual({
      going: 1,
      maybe: 0,
      not_going: 0,
    });
  });

  it("breaks equal-ts duplicate votes by later timeline position (>= tie-break)", () => {
    // Characterization: on identical timestamps the vote later in the timeline wins.
    const room = roomWith(
      calendarStartEvent(),
      rsvpEvent("going", "$start1", { sender: "@a:test", ts: 100 }),
      rsvpEvent("not_going", "$start1", { sender: "@a:test", ts: 100 }),
    );
    expect(tallyCalendarEventRsvps(room as never, "$start1", ME)?.countsByStatus).toEqual({
      going: 0,
      maybe: 0,
      not_going: 1,
    });
  });

  it("compares by ts, not timeline position: an older-ts vote never overwrites a newer one", () => {
    const room = roomWith(
      calendarStartEvent(),
      rsvpEvent("going", "$start1", { sender: "@a:test", ts: 200 }),
      rsvpEvent("not_going", "$start1", { sender: "@a:test", ts: 100 }),
    );
    expect(tallyCalendarEventRsvps(room as never, "$start1", ME)?.countsByStatus).toEqual({
      going: 1,
      maybe: 0,
      not_going: 0,
    });
  });

  it("ignores RSVPs pointing at a different calendar event", () => {
    const room = roomWith(
      calendarStartEvent(),
      rsvpEvent("going", "$other", { sender: "@a:test" }),
    );
    const tally = tallyCalendarEventRsvps(room as never, "$start1", ME);
    expect(tally?.countsByStatus).toEqual({ going: 0, maybe: 0, not_going: 0 });
  });

  it("ignores events with a non-reference relation", () => {
    const room = roomWith(
      calendarStartEvent(),
      rsvpEvent("going", "$start1", {
        sender: "@a:test",
        content: { status: "going", "m.relates_to": { rel_type: "m.replace", event_id: "$start1" } },
      }),
      rsvpEvent("going", "$start1", {
        sender: "@b:test",
        content: { status: "going" }, // no relation at all
      }),
    );
    expect(tallyCalendarEventRsvps(room as never, "$start1", ME)?.countsByStatus).toEqual({
      going: 0,
      maybe: 0,
      not_going: 0,
    });
  });

  it("ignores votes with an unknown status or no sender", () => {
    const room = roomWith(
      calendarStartEvent(),
      rsvpEvent("maybe_later", "$start1", { sender: "@a:test" }),
      rsvpEvent("going", "$start1", { sender: undefined }),
    );
    expect(tallyCalendarEventRsvps(room as never, "$start1", ME)?.countsByStatus).toEqual({
      going: 0,
      maybe: 0,
      not_going: 0,
    });
  });

  it("ignores redacted votes (redaction empties the content, so no valid status remains)", () => {
    const room = roomWith(
      calendarStartEvent(),
      rsvpEvent("going", "$start1", { sender: "@a:test", redacted: true }),
    );
    expect(tallyCalendarEventRsvps(room as never, "$start1", ME)?.countsByStatus).toEqual({
      going: 0,
      maybe: 0,
      not_going: 0,
    });
  });
});

describe("getUpcomingCalendarEvents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns not-yet-ended events across rooms, soonest first", () => {
    const later = calendarStartEvent({
      id: "$later",
      roomId: "!b:test",
      content: calContent({ title: "Later", start_ts: NOW + 3 * MINUTE, end_ts: NOW + 30 * MINUTE }),
    });
    const sooner = calendarStartEvent({
      id: "$sooner",
      roomId: "!a:test",
      content: calContent({ title: "Sooner", start_ts: NOW + MINUTE }),
    });
    const client = new FakeClient({
      rooms: [
        new FakeEventRoom({ roomId: "!a:test" }).addEvent(sooner),
        new FakeEventRoom({ roomId: "!b:test" }).addEvent(later),
      ],
    });
    expect(getUpcomingCalendarEvents(client as never).map((e) => e.title)).toEqual(["Sooner", "Later"]);
  });

  it("excludes events that already ended (end_ts in the past)", () => {
    const room = new FakeEventRoom({ roomId: "!room:test" }).addEvent(
      calendarStartEvent({ content: calContent({ start_ts: NOW - 60 * MINUTE, end_ts: NOW - MINUTE }) }),
    );
    expect(getUpcomingCalendarEvents(new FakeClient({ rooms: [room] }) as never)).toEqual([]);
  });

  it("still lists an event whose end_ts is exactly now (strict < comparison)", () => {
    // Characterization of `endsAt < now` in getUpcomingCalendarEvents.
    const room = new FakeEventRoom({ roomId: "!room:test" }).addEvent(
      calendarStartEvent({ content: calContent({ start_ts: NOW - 60 * MINUTE, end_ts: NOW }) }),
    );
    expect(getUpcomingCalendarEvents(new FakeClient({ rooms: [room] }) as never)).toHaveLength(1);
  });

  it("treats an open-ended event (no end_ts) as ending at its start time", () => {
    const startingNow = calendarStartEvent({ id: "$now", content: calContent({ start_ts: NOW }) });
    const alreadyOver = calendarStartEvent({ id: "$past", content: calContent({ start_ts: NOW - 1 }) });
    const room = new FakeEventRoom({ roomId: "!room:test" }).addEvent(alreadyOver).addEvent(startingNow);
    const upcoming = getUpcomingCalendarEvents(new FakeClient({ rooms: [room] }) as never);
    expect(upcoming.map((e) => e.eventId)).toEqual(["$now"]);
  });

  it("skips redacted (cancelled) and unparseable start events", () => {
    const room = new FakeEventRoom({ roomId: "!room:test" })
      .addEvent(calendarStartEvent({ id: "$redacted", redacted: true }))
      .addEvent(makeEvent({ type: CALENDAR_EVENT_TYPE, id: "$nonsense", content: { body: "just text" } }))
      .addEvent(calendarStartEvent({ id: "$fine" }));
    const upcoming = getUpcomingCalendarEvents(new FakeClient({ rooms: [room] }) as never);
    expect(upcoming.map((e) => e.eventId)).toEqual(["$fine"]);
  });

  it("never surfaces events inside spaces", () => {
    const space = new FakeEventRoom({ roomId: "!space:test", isSpace: true }).addEvent(calendarStartEvent());
    expect(getUpcomingCalendarEvents(new FakeClient({ rooms: [space] }) as never)).toEqual([]);
  });
});

describe("getEventsNeedingReminder", () => {
  const ME = "@me:test";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** One room whose event starts at `startTs`; `status` is this account's RSVP. */
  function clientWith(opts: { startTs: number; status?: RsvpStatus }): FakeClient {
    const room = new FakeEventRoom({ roomId: "!room:test" }).addEvent(
      calendarStartEvent({ content: calContent({ start_ts: opts.startTs }) }),
    );
    if (opts.status) {
      room.addEvent(rsvpEvent(opts.status, "$start1", { sender: ME, ts: NOW - MINUTE }));
    }
    return new FakeClient({ userId: ME, rooms: [room] });
  }

  it("includes an event I am going to that starts within the lead window", () => {
    const client = clientWith({ startTs: NOW + 5 * MINUTE, status: "going" });
    expect(getEventsNeedingReminder(client as never, 10 * MINUTE).map((e) => e.eventId)).toEqual(["$start1"]);
  });

  it("includes an event I answered maybe to", () => {
    const client = clientWith({ startTs: NOW + 5 * MINUTE, status: "maybe" });
    expect(getEventsNeedingReminder(client as never, 10 * MINUTE)).toHaveLength(1);
  });

  it("excludes events starting beyond the lead window", () => {
    const client = clientWith({ startTs: NOW + 11 * MINUTE, status: "going" });
    expect(getEventsNeedingReminder(client as never, 10 * MINUTE)).toEqual([]);
  });

  it("includes an event starting exactly at the lead boundary (strict > comparison)", () => {
    const client = clientWith({ startTs: NOW + 10 * MINUTE, status: "going" });
    expect(getEventsNeedingReminder(client as never, 10 * MINUTE)).toHaveLength(1);
  });

  it("excludes events that already started or start exactly now", () => {
    const started = clientWith({ startTs: NOW - 1, status: "going" });
    const rightNow = clientWith({ startTs: NOW, status: "going" });
    expect(getEventsNeedingReminder(started as never, 10 * MINUTE)).toEqual([]);
    expect(getEventsNeedingReminder(rightNow as never, 10 * MINUTE)).toEqual([]);
  });

  it("excludes events I did not RSVP to or declined", () => {
    const silent = clientWith({ startTs: NOW + 5 * MINUTE });
    const declined = clientWith({ startTs: NOW + 5 * MINUTE, status: "not_going" });
    expect(getEventsNeedingReminder(silent as never, 10 * MINUTE)).toEqual([]);
    expect(getEventsNeedingReminder(declined as never, 10 * MINUTE)).toEqual([]);
  });

  it("checks my RSVP, not someone else's", () => {
    const room = new FakeEventRoom({ roomId: "!room:test" })
      .addEvent(calendarStartEvent({ content: calContent({ start_ts: NOW + 5 * MINUTE }) }))
      .addEvent(rsvpEvent("going", "$start1", { sender: "@someoneelse:test" }));
    const client = new FakeClient({ userId: ME, rooms: [room] });
    expect(getEventsNeedingReminder(client as never, 10 * MINUTE)).toEqual([]);
  });

  it("returns nothing when the client has no user id", () => {
    const anonymous = {
      getUserId: () => undefined,
      getRooms: () => [],
      getRoom: () => null,
    } as unknown as FakeClient;
    expect(getEventsNeedingReminder(anonymous as never, 10 * MINUTE)).toEqual([]);
  });

  it("skips an event whose room can no longer be looked up on the client", () => {
    class NoLookupClient extends FakeClient {
      override getRoom(): null {
        return null;
      }
    }
    const client = new NoLookupClient({
      userId: ME,
      rooms: [new FakeEventRoom({ roomId: "!room:test" }).addEvent(calendarStartEvent())],
    });
    expect(getEventsNeedingReminder(client as never, 60 * MINUTE)).toEqual([]);
  });
});
