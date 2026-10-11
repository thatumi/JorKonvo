import { describe, expect, it } from "vitest";
import { type MatrixClient, type MatrixEvent, RelationType } from "matrix-js-sdk";
import { getEditHistory } from "../../../packages/matrix-core/src/editHistory.js";

/**
 * Hand-rolled fakes, same spirit as test/helpers/fakes.ts: getEditHistory
 * only touches a tiny slice of the SDK surface - `client.relations(...)` on
 * the client, and getId/getTs/getSender/getContent/getOriginalContent on the
 * events - so a literal fake keeps each test's server response readable
 * without any SDK construction or network.
 */

interface FakeEventOpts {
  id?: string;
  sender?: string;
  ts?: number;
  /** What getContent() returns; undefined means a malformed/absent payload. */
  content?: Record<string, unknown>;
  /** What getOriginalContent() returns; defaults to `content` (an unedited event). */
  originalContent?: Record<string, unknown>;
}

function makeEvent(opts: FakeEventOpts = {}): MatrixEvent {
  return {
    getId: () => opts.id,
    getTs: () => opts.ts ?? 0,
    getSender: () => opts.sender,
    getContent: () => opts.content,
    getOriginalContent: () => opts.originalContent ?? opts.content,
  } as unknown as MatrixEvent;
}

interface RelationsCall {
  roomId: string;
  eventId: string;
  relationType: RelationType;
  eventType: string;
}

function makeClient(edits: MatrixEvent[]) {
  const calls: RelationsCall[] = [];
  const client = {
    relations: async (roomId: string, eventId: string, relationType: RelationType, eventType: string) => {
      calls.push({ roomId, eventId, relationType, eventType });
      return { events: edits };
    },
  };
  return { client: client as unknown as MatrixClient, calls };
}

const ROOM = "!room:test";

function makeOriginal(opts: FakeEventOpts = {}): MatrixEvent {
  return makeEvent({ id: "$orig", sender: "@alice:test", ts: 1_000, content: { body: "original" }, ...opts });
}

describe("getEditHistory", () => {
  describe("server query", () => {
    it("asks the server's relations endpoint once for m.replace edits of the original event", async () => {
      const { client, calls } = makeClient([]);
      await getEditHistory(client, ROOM, makeOriginal());
      expect(calls).toEqual([
        { roomId: ROOM, eventId: "$orig", relationType: RelationType.Replace, eventType: "m.room.message" },
      ]);
    });

    it("passes the eventId the original event reports, falling back to \"\" when it has none", async () => {
      const { client, calls } = makeClient([]);
      await getEditHistory(client, ROOM, makeOriginal({ id: undefined }));
      expect(calls).toHaveLength(1);
      expect(calls[0]!.eventId).toBe("");
    });

    it("uses the roomId argument as given, not anything derived from the event", async () => {
      const { client, calls } = makeClient([]);
      await getEditHistory(client, "!other:test", makeOriginal());
      expect(calls[0]!.roomId).toBe("!other:test");
    });
  });

  describe("shaping MessageEditVersion[]", () => {
    it("returns just the original version when the server reports no edits", async () => {
      const { client } = makeClient([]);
      const history = await getEditHistory(client, ROOM, makeOriginal());
      expect(history).toEqual([
        { eventId: "$orig", body: "original", ts: 1_000, senderId: "@alice:test", isOriginal: true },
      ]);
    });

    it("marks every server-returned edit isOriginal: false and keeps its own eventId/ts/sender", async () => {
      const { client } = makeClient([
        makeEvent({ id: "$edit1", sender: "@alice:test", ts: 2_000, content: { body: "x", "m.new_content": { body: "v2" } } }),
      ]);
      const history = await getEditHistory(client, ROOM, makeOriginal());
      expect(history).toHaveLength(2);
      expect(history[1]).toEqual({
        eventId: "$edit1",
        body: "v2",
        ts: 2_000,
        senderId: "@alice:test",
        isOriginal: false,
      });
    });

    it("takes the original's body from getOriginalContent(), not getContent() (which the SDK substitutes with the latest edit)", async () => {
      // MessageLine hands us a MatrixEvent whose getContent() has been
      // transparently swapped for the newest edit's content; only
      // getOriginalContent() still knows the pre-edit text.
      const original = makeEvent({
        id: "$orig",
        sender: "@alice:test",
        ts: 1_000,
        content: { body: "* v3", "m.new_content": { body: "v3" }, "m.relates_to": { rel_type: "m.replace", event_id: "$orig" } },
        originalContent: { body: "v1" },
      });
      const { client } = makeClient([]);
      const history = await getEditHistory(client, ROOM, original);
      expect(history[0]!.body).toBe("v1");
    });
  });

  describe("edit content extraction", () => {
    it("prefers m.new_content.body over the outer body", async () => {
      const { client } = makeClient([
        makeEvent({ id: "$e1", ts: 2_000, content: { body: "* v2", "m.new_content": { body: "v2" } } }),
      ]);
      const history = await getEditHistory(client, ROOM, makeOriginal());
      expect(history[1]!.body).toBe("v2");
    });

    it("falls back to the outer body when m.new_content is absent", async () => {
      // e.g. a homeserver or client that only sent a plain replacement body.
      const { client } = makeClient([makeEvent({ id: "$e1", ts: 2_000, content: { body: "v2 (plain)" } })]);
      const history = await getEditHistory(client, ROOM, makeOriginal());
      expect(history[1]!.body).toBe("v2 (plain)");
    });

    it("falls back to the outer body when m.new_content exists but has no body", async () => {
      const { client } = makeClient([
        makeEvent({ id: "$e1", ts: 2_000, content: { body: "* fallback", "m.new_content": { formatted_body: "rich" } } }),
      ]);
      const history = await getEditHistory(client, ROOM, makeOriginal());
      expect(history[1]!.body).toBe("* fallback");
    });

    it("yields an empty body when there is neither m.new_content.body nor a body", async () => {
      const { client } = makeClient([makeEvent({ id: "$e1", ts: 2_000, content: { "m.new_content": {} } })]);
      const history = await getEditHistory(client, ROOM, makeOriginal());
      expect(history[1]!.body).toBe("");
    });
  });

  describe("ordering", () => {
    it("sorts edits oldest-first even when the server returns them out of order, with the original unconditionally first", async () => {
      const { client } = makeClient([
        makeEvent({ id: "$e3", ts: 3_000, content: { "m.new_content": { body: "v3" } } }),
        makeEvent({ id: "$e2", ts: 2_000, content: { "m.new_content": { body: "v2" } } }),
      ]);
      const history = await getEditHistory(client, ROOM, makeOriginal({ ts: 1_000 }));
      expect(history.map((v) => v.eventId)).toEqual(["$orig", "$e2", "$e3"]);
    });

    it("still puts the original first when its ts is NEWER than an edit (clock skew)", async () => {
      // The sort only touches the edits array; the original is prepended
      // afterwards, so a skewed original timestamp does not reorder it.
      const { client } = makeClient([
        makeEvent({ id: "$e1", ts: 500, content: { "m.new_content": { body: "v2" } } }),
      ]);
      const history = await getEditHistory(client, ROOM, makeOriginal({ ts: 1_000 }));
      expect(history.map((v) => v.eventId)).toEqual(["$orig", "$e1"]);
    });

    it("keeps server order for edits sharing a timestamp (stable sort)", async () => {
      const { client } = makeClient([
        makeEvent({ id: "$e-first", ts: 2_000, content: { "m.new_content": { body: "first" } } }),
        makeEvent({ id: "$e-second", ts: 2_000, content: { "m.new_content": { body: "second" } } }),
      ]);
      const history = await getEditHistory(client, ROOM, makeOriginal());
      expect(history.map((v) => v.eventId)).toEqual(["$orig", "$e-first", "$e-second"]);
    });
  });

  describe("missing / malformed events", () => {
    it("survives an edit whose getContent() is undefined (malformed payload) with an empty body", async () => {
      const { client } = makeClient([makeEvent({ id: "$e1", sender: "@alice:test", ts: 2_000, content: undefined })]);
      const history = await getEditHistory(client, ROOM, makeOriginal());
      expect(history[1]).toEqual({ eventId: "$e1", body: "", ts: 2_000, senderId: "@alice:test", isOriginal: false });
    });

    it("uses \"\" for an edit that has no event id", async () => {
      const { client } = makeClient([makeEvent({ ts: 2_000, content: { "m.new_content": { body: "v2" } } })]);
      const history = await getEditHistory(client, ROOM, makeOriginal());
      expect(history[1]!.eventId).toBe("");
    });

    it("uses \"\" for a missing sender on an edit", async () => {
      const { client } = makeClient([makeEvent({ id: "$e1", ts: 2_000, content: { "m.new_content": { body: "v2" } } })]);
      const history = await getEditHistory(client, ROOM, makeOriginal());
      expect(history[1]!.senderId).toBe("");
    });

    it("uses \"\" for the original's id/body/sender when those getters come up empty", async () => {
      const original = makeEvent({ id: undefined, sender: undefined, ts: 1_000, content: {} });
      const { client } = makeClient([]);
      const history = await getEditHistory(client, ROOM, original);
      expect(history).toEqual([{ eventId: "", body: "", ts: 1_000, senderId: "", isOriginal: true }]);
    });

    it("does not filter or reorder anything on its own: every event the server returns becomes a version", async () => {
      // No local rel_type validation - an entry without m.relates_to is kept
      // as-is (the server is trusted to return only real edits).
      const { client } = makeClient([
        makeEvent({ id: "$no-rel", ts: 2_000, content: { "m.new_content": { body: "no relation here" } } }),
      ]);
      const history = await getEditHistory(client, ROOM, makeOriginal());
      expect(history).toHaveLength(2);
      expect(history[1]!.eventId).toBe("$no-rel");
    });
  });

  describe("redactions", () => {
    it("keeps a redacted edit as an empty-body placeholder version at its original position", async () => {
      // After redaction the server prunes an event's content to {}; the
      // history still shows that a version existed at that ts, with no text.
      const { client } = makeClient([makeEvent({ id: "$e1", sender: "@alice:test", ts: 2_000, content: {} })]);
      const history = await getEditHistory(client, ROOM, makeOriginal());
      expect(history[1]).toEqual({ eventId: "$e1", body: "", ts: 2_000, senderId: "@alice:test", isOriginal: false });
    });

    it("keeps a redacted original with an empty body rather than dropping the entry", async () => {
      const original = makeEvent({ id: "$orig", sender: "@alice:test", ts: 1_000, content: {}, originalContent: {} });
      const { client } = makeClient([
        makeEvent({ id: "$e1", sender: "@alice:test", ts: 2_000, content: { "m.new_content": { body: "v2" } } }),
      ]);
      const history = await getEditHistory(client, ROOM, original);
      expect(history).toEqual([
        { eventId: "$orig", body: "", ts: 1_000, senderId: "@alice:test", isOriginal: true },
        { eventId: "$e1", body: "v2", ts: 2_000, senderId: "@alice:test", isOriginal: false },
      ]);
    });
  });
});
