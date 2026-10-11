import { describe, expect, it, vi } from "vitest";
import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import {
  cancelFailedMessage,
  editMessage,
  forwardMessage,
  getReactionsForEvent,
  getTimelineEvents,
  retryMessage,
  sendReply,
  sendTextMessage,
  stripReplyFallback,
  toggleReaction,
} from "../../../packages/matrix-core/src/messages.js";

/**
 * Hand-rolled fakes, same spirit as test/helpers/fakes.ts: messages.ts only
 * touches a tiny slice of MatrixClient (sendMessage / sendEvent / redactEvent /
 * resendEvent / cancelPendingEvent) and, for the timeline helpers, just
 * `room.getLiveTimeline().getEvents()` plus a few event getters - so a real
 * fake stays readable and the assertions can inspect exactly what got sent.
 */

function fakeClient() {
  const raw = {
    sendMessage: vi.fn().mockResolvedValue({ event_id: "$new" }),
    sendEvent: vi.fn().mockResolvedValue({ event_id: "$rx" }),
    redactEvent: vi.fn().mockResolvedValue({ event_id: "$redacted" }),
    resendEvent: vi.fn().mockResolvedValue(undefined),
    cancelPendingEvent: vi.fn(),
  };
  return raw as typeof raw & MatrixClient;
}

interface EvOpts {
  type: string;
  sender?: string;
  id?: string;
  content?: Record<string, unknown>;
  redacted?: boolean;
}

function makeEvent(opts: EvOpts): MatrixEvent {
  return {
    getType: () => opts.type,
    getSender: () => opts.sender,
    getId: () => opts.id,
    getContent: () => opts.content ?? {},
    isRedacted: () => opts.redacted ?? false,
  } as unknown as MatrixEvent;
}

function timelineRoom(events: MatrixEvent[]): Room {
  return {
    getLiveTimeline: () => ({ getEvents: () => events }),
  } as unknown as Room;
}

function reaction(id: string, sender: string, targetEventId: string, key: string, redacted = false): MatrixEvent {
  return makeEvent({
    type: "m.reaction",
    id,
    sender,
    redacted,
    content: { "m.relates_to": { rel_type: "m.annotation", event_id: targetEventId, key } },
  });
}

describe("stripReplyFallback", () => {
  it("strips a one-line fallback plus the blank separator line", () => {
    expect(stripReplyFallback("> <@alice:test> hi\n\nmy reply")).toBe("my reply");
  });

  it("strips a multi-line fallback (the quoted original contained newlines)", () => {
    expect(stripReplyFallback("> <@alice:test> line1\n> line2\n\nanswer")).toBe("answer");
  });

  it("leaves a body with no fallback untouched", () => {
    expect(stripReplyFallback("just a normal message")).toBe("just a normal message");
    expect(stripReplyFallback("")).toBe("");
  });

  it("only strips a LEADING block - mid-body '> ' quoting survives", () => {
    expect(stripReplyFallback("before\n> quoted\nafter")).toBe("before\n> quoted\nafter");
  });

  it("reduces a fallback-only body (trailing newline) to the empty string", () => {
    expect(stripReplyFallback("> <@alice:test> hi\n")).toBe("");
  });

  it("keeps the last line of a fallback block that has no trailing newline (characterization)", () => {
    // The regex requires every stripped line to end with \n, so a final
    // fallback line without one survives. Real wire-format fallbacks always
    // end with \n before the blank separator, so this is a harmless edge.
    expect(stripReplyFallback("> line1\n> line2")).toBe("> line2");
  });
});

describe("getTimelineEvents", () => {
  it("keeps messages, membership events and reactions, in timeline order", () => {
    const msg = makeEvent({ type: "m.room.message" });
    const member = makeEvent({ type: "m.room.member" });
    const rx = makeEvent({ type: "m.reaction" });
    const room = timelineRoom([msg, member, rx]);
    expect(getTimelineEvents(room)).toEqual([msg, member, rx]);
  });

  it("drops everything else (state like m.room.name, redactions, typing)", () => {
    const room = timelineRoom([
      makeEvent({ type: "m.room.name" }),
      makeEvent({ type: "m.room.message" }),
      makeEvent({ type: "m.room.redaction" }),
      makeEvent({ type: "m.room.tombstone" }),
    ]);
    expect(getTimelineEvents(room)).toHaveLength(1);
    expect(getTimelineEvents(room)[0]?.getType()).toBe("m.room.message");
  });

  it("returns an empty array for an empty timeline", () => {
    expect(getTimelineEvents(timelineRoom([]))).toEqual([]);
  });
});

describe("getReactionsForEvent", () => {
  it("aggregates counts per key for the target event only, first occurrence order", () => {
    const room = timelineRoom([
      reaction("$r1", "@a:test", "$t", "👍"),
      reaction("$r2", "@b:test", "$t", "🎉"),
      reaction("$r3", "@c:test", "$t", "👍"),
      // another event's 👍 must not be counted
      reaction("$r4", "@d:test", "$other", "👍"),
    ]);
    expect(getReactionsForEvent(room, "$t", null)).toEqual([
      { key: "👍", count: 2, reactedByMe: false, ownReactionEventId: null },
      { key: "🎉", count: 1, reactedByMe: false, ownReactionEventId: null },
    ]);
  });

  it("ignores non-annotation relations (e.g. an m.replace edit targeting the event)", () => {
    const edit = makeEvent({
      type: "m.room.message",
      content: { "m.relates_to": { rel_type: "m.replace", event_id: "$t" } },
    });
    const room = timelineRoom([edit]);
    expect(getReactionsForEvent(room, "$t", null)).toEqual([]);
  });

  it("ignores redacted reaction events", () => {
    const room = timelineRoom([reaction("$r1", "@a:test", "$t", "👍", true)]);
    expect(getReactionsForEvent(room, "$t", null)).toEqual([]);
  });

  it("flags my own reaction and records its event id for un-reacting", () => {
    const room = timelineRoom([
      reaction("$r1", "@a:test", "$t", "👍"),
      reaction("$r2", "@me:test", "$t", "👍"),
    ]);
    expect(getReactionsForEvent(room, "$t", "@me:test")).toEqual([
      { key: "👍", count: 2, reactedByMe: true, ownReactionEventId: "$r2" },
    ]);
  });

  it("with ownUserId null, never claims reactedByMe", () => {
    const room = timelineRoom([reaction("$r1", "@a:test", "$t", "👍")]);
    expect(getReactionsForEvent(room, "$t", null)).toEqual([
      { key: "👍", count: 1, reactedByMe: false, ownReactionEventId: null },
    ]);
  });

  it("when I reacted twice with the same key, the latest reaction's event id wins", () => {
    const room = timelineRoom([
      reaction("$r1", "@me:test", "$t", "👍"),
      reaction("$r2", "@me:test", "$t", "👍"),
    ]);
    const summary = getReactionsForEvent(room, "$t", "@me:test");
    expect(summary[0]?.ownReactionEventId).toBe("$r2");
  });

  it("only marks my own reactions - other users' reactions keep ownReactionEventId null", () => {
    const room = timelineRoom([reaction("$r1", "@a:test", "$t", "👍")]);
    const summary = getReactionsForEvent(room, "$t", "@me:test");
    expect(summary[0]).toEqual({ key: "👍", count: 1, reactedByMe: false, ownReactionEventId: null });
  });
});

describe("sendTextMessage", () => {
  it("sends a plain m.text with no formatted_body and no m.mentions when nothing needs formatting", () => {
    const client = fakeClient();
    // mention entries passed, but the name never appears in the body
    void sendTextMessage(client, "!r:test", "hello", [{ displayName: "Alice", userId: "@alice:test" }]);
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    expect(client.sendMessage.mock.calls[0]?.[0]).toBe("!r:test");
    expect(client.sendMessage.mock.calls[0]?.[1]).toEqual({ msgtype: "m.text", body: "hello" });
  });

  it("turns an @mention into a matrix.to pill and m.mentions.user_ids", async () => {
    const client = fakeClient();
    await sendTextMessage(client, "!r:test", "hey @Alice", [{ displayName: "Alice", userId: "@alice:test" }]);
    expect(client.sendMessage.mock.calls[0]?.[1]).toEqual({
      msgtype: "m.text",
      body: "hey @Alice",
      formatted_body: 'hey <a href="https://matrix.to/#/@alice:test">@Alice</a>',
      format: "org.matrix.custom.html",
      "m.mentions": { user_ids: ["@alice:test"] },
    });
  });

  it("resolves @here to the caller-supplied user id snapshot in m.mentions, keeping the @here pill", async () => {
    const client = fakeClient();
    await sendTextMessage(client, "!r:test", "@here standup", [], ["@a:test", "@b:test"]);
    expect(client.sendMessage.mock.calls[0]?.[1]).toEqual({
      msgtype: "m.text",
      body: "@here standup",
      formatted_body: '<span data-mx-pill="here">@here</span> standup',
      format: "org.matrix.custom.html",
      "m.mentions": { user_ids: ["@a:test", "@b:test"] },
    });
  });

  it("marks @room as a mass mention (m.mentions.room), not a user id", async () => {
    const client = fakeClient();
    await sendTextMessage(client, "!r:test", "@room heads up");
    const content = client.sendMessage.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(content["m.mentions"]).toEqual({ room: true });
    expect(content.formatted_body).toContain('<span data-mx-pill="room">@room</span>');
  });
});

describe("sendReply", () => {
  it("builds the plain-text fallback, the blank separator, and m.in_reply_to", async () => {
    const client = fakeClient();
    await sendReply(client, "!r:test", "my answer", "$orig", "@alice:test", "hello there");
    expect(client.sendMessage.mock.calls[0]?.[1]).toEqual({
      msgtype: "m.text",
      body: "> <@alice:test> hello there\n\nmy answer",
      "m.relates_to": { "m.in_reply_to": { event_id: "$orig" } },
    });
  });

  it("prefixes every line of a multi-line original with '>'", async () => {
    const client = fakeClient();
    await sendReply(client, "!r:test", "answer", "$orig", "@alice:test", "line1\nline2");
    const content = client.sendMessage.mock.calls[0]?.[1] as { body: string };
    expect(content.body).toBe("> <@alice:test> line1\n> line2\n\nanswer");
  });

  it("a reply with no formatting stays a plain message (no formatted_body / format)", async () => {
    const client = fakeClient();
    await sendReply(client, "!r:test", "answer", "$orig", "@alice:test", "hi");
    const content = client.sendMessage.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(content).not.toHaveProperty("formatted_body");
    expect(content).not.toHaveProperty("format");
    expect(content).not.toHaveProperty("m.mentions");
  });

  it("wraps the HTML-escaped fallback in mx-reply and appends the formatted answer", async () => {
    const client = fakeClient();
    await sendReply(
      client,
      "!r:test",
      "**answer** @Bob",
      "$orig",
      "@alice:test",
      "hi & <b>bold</b>",
      [{ displayName: "Bob", userId: "@bob:test" }],
    );
    const content = client.sendMessage.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(content.body).toBe("> <@alice:test> hi & <b>bold</b>\n\n**answer** @Bob");
    expect(content.format).toBe("org.matrix.custom.html");
    expect(content.formatted_body).toBe(
      "<mx-reply><blockquote>&gt; &lt;@alice:test&gt; hi &amp; &lt;b&gt;bold&lt;/b&gt;</blockquote></mx-reply>" +
        '<strong>answer</strong> <a href="https://matrix.to/#/@bob:test">@Bob</a>',
    );
    expect(content["m.mentions"]).toEqual({ user_ids: ["@bob:test"] });
  });

  it("keeps the raw (unescaped) fallback in the plain body while escaping it in formatted_body", async () => {
    const client = fakeClient();
    // The reply body itself must need formatting for a formatted_body to exist
    // at all (a fully plain reply stays a plain message, mx-reply and all).
    await sendReply(client, "!r:test", "**ok**", "$orig", "@alice:test", "<script>");
    const content = client.sendMessage.mock.calls[0]?.[1] as { body: string; formatted_body?: string };
    expect(content.body).toContain("> <@alice:test> <script>\n\n**ok**");
    expect(content.formatted_body).toContain("&lt;script&gt;");
    expect(content.formatted_body).not.toContain("<script>");
  });
});

describe("editMessage", () => {
  it("sends an m.replace replacement with '* '-prefixed fallback and clean m.new_content", async () => {
    const client = fakeClient();
    await editMessage(client, "!r:test", "$target", "fixed typo");
    expect(client.sendMessage.mock.calls[0]?.[1]).toEqual({
      msgtype: "m.text",
      body: "* fixed typo",
      "m.new_content": { msgtype: "m.text", body: "fixed typo" },
      "m.relates_to": { rel_type: "m.replace", event_id: "$target" },
    });
  });

  it("a plain edit emits no formatted_body anywhere", async () => {
    const client = fakeClient();
    await editMessage(client, "!r:test", "$target", "fixed");
    const content = client.sendMessage.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(content).not.toHaveProperty("formatted_body");
    expect((content["m.new_content"] as Record<string, unknown>)).not.toHaveProperty("formatted_body");
  });

  it("puts formatted_body on both the fallback event (star-prefixed) and m.new_content", async () => {
    const client = fakeClient();
    await editMessage(client, "!r:test", "$target", "**fixed**");
    const content = client.sendMessage.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(content.body).toBe("* **fixed**");
    expect(content.formatted_body).toBe("* <strong>fixed</strong>");
    expect(content.format).toBe("org.matrix.custom.html");
    expect(content["m.new_content"]).toEqual({
      msgtype: "m.text",
      body: "**fixed**",
      formatted_body: "<strong>fixed</strong>",
      format: "org.matrix.custom.html",
    });
  });

  it("lands m.mentions in m.new_content only, never on the legacy fallback event (characterization)", async () => {
    const client = fakeClient();
    await editMessage(client, "!r:test", "$target", "hey @Bob", [{ displayName: "Bob", userId: "@bob:test" }]);
    const content = client.sendMessage.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(content).not.toHaveProperty("m.mentions");
    expect((content["m.new_content"] as Record<string, unknown>)["m.mentions"]).toEqual({
      user_ids: ["@bob:test"],
    });
  });
});

describe("forwardMessage", () => {
  it("copies the content but strips reply/edit relations", async () => {
    const client = fakeClient();
    const source = makeEvent({
      type: "m.room.message",
      content: {
        msgtype: "m.text",
        body: "hello",
        "m.relates_to": { "m.in_reply_to": { event_id: "$orig" } },
        "m.new_content": { msgtype: "m.text", body: "hello" },
      },
    });
    await forwardMessage(client, "!target:test", source);
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    expect(client.sendMessage.mock.calls[0]?.[0]).toBe("!target:test");
    expect(client.sendMessage.mock.calls[0]?.[1]).toEqual({ msgtype: "m.text", body: "hello" });
  });

  it("forwards media content (incl. file/encrypted keys) untouched apart from relations", async () => {
    const client = fakeClient();
    const source = makeEvent({
      type: "m.room.message",
      content: {
        msgtype: "m.image",
        body: "pic.png",
        url: "mxc://test/pic",
        info: { mimetype: "image/png" },
      },
    });
    await forwardMessage(client, "!target:test", source);
    expect(client.sendMessage.mock.calls[0]?.[1]).toEqual({
      msgtype: "m.image",
      body: "pic.png",
      url: "mxc://test/pic",
      info: { mimetype: "image/png" },
    });
  });
});

describe("toggleReaction", () => {
  it("with no existing reaction, sends an m.annotation reaction", async () => {
    const client = fakeClient();
    await toggleReaction(client, "!r:test", "$t", "👍", undefined);
    expect(client.sendEvent).toHaveBeenCalledTimes(1);
    expect(client.sendEvent).toHaveBeenCalledWith("!r:test", "m.reaction", {
      "m.relates_to": { rel_type: "m.annotation", event_id: "$t", key: "👍" },
    });
    expect(client.redactEvent).not.toHaveBeenCalled();
  });

  it("when I already reacted, redacts my own reaction event instead of sending another", async () => {
    const client = fakeClient();
    await toggleReaction(client, "!r:test", "$t", "👍", {
      key: "👍",
      count: 1,
      reactedByMe: true,
      ownReactionEventId: "$rx1",
    });
    expect(client.redactEvent).toHaveBeenCalledTimes(1);
    expect(client.redactEvent).toHaveBeenCalledWith("!r:test", "$rx1", undefined, undefined);
    expect(client.sendEvent).not.toHaveBeenCalled();
  });

  it("reactedByMe with a null ownReactionEventId falls back to sending a new reaction (characterization)", async () => {
    // Can only happen if the SDK gave the reaction event no id; the guard
    // requires BOTH reactedByMe and a concrete event id before redacting.
    const client = fakeClient();
    await toggleReaction(client, "!r:test", "$t", "👍", {
      key: "👍",
      count: 1,
      reactedByMe: true,
      ownReactionEventId: null,
    });
    expect(client.sendEvent).toHaveBeenCalledTimes(1);
    expect(client.redactEvent).not.toHaveBeenCalled();
  });
});

describe("retryMessage / cancelFailedMessage", () => {
  it("retryMessage delegates to client.resendEvent with the original event and room", async () => {
    const client = fakeClient();
    const room = timelineRoom([]);
    const ev = makeEvent({ type: "m.room.message" });
    await retryMessage(client, room, ev);
    expect(client.resendEvent).toHaveBeenCalledTimes(1);
    expect(client.resendEvent).toHaveBeenCalledWith(ev, room);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it("cancelFailedMessage delegates to client.cancelPendingEvent", () => {
    const client = fakeClient();
    const ev = makeEvent({ type: "m.room.message" });
    cancelFailedMessage(client, ev);
    expect(client.cancelPendingEvent).toHaveBeenCalledTimes(1);
    expect(client.cancelPendingEvent).toHaveBeenCalledWith(ev);
  });
});
