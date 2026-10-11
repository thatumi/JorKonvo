import { describe, expect, it } from "vitest";
import type { MatrixEvent } from "matrix-js-sdk";
import { eventHighlightsUser } from "../../../packages/matrix-core/src/unread.js";

function makeEvent(sender: string, content: Record<string, unknown>): MatrixEvent {
  return {
    getSender: () => sender,
    getContent: () => content,
  } as unknown as MatrixEvent;
}

describe("eventHighlightsUser", () => {
  it("never highlights the sender's own message, even if it name-drops them", () => {
    const ev = makeEvent("@me:example.org", { body: "@me talking to myself" });
    expect(eventHighlightsUser(ev, "@me:example.org", "me", [])).toBe(false);
  });

  it("highlights on an explicit m.mentions user_ids entry", () => {
    const ev = makeEvent("@other:example.org", { body: "hey", "m.mentions": { user_ids: ["@me:example.org"] } });
    expect(eventHighlightsUser(ev, "@me:example.org", null, [])).toBe(true);
  });

  it("does not highlight from m.mentions when this user isn't listed", () => {
    const ev = makeEvent("@other:example.org", { body: "hey", "m.mentions": { user_ids: ["@someoneelse:example.org"] } });
    expect(eventHighlightsUser(ev, "@me:example.org", null, [])).toBe(false);
  });

  it("highlights on m.mentions.room (an @room mass-mention)", () => {
    const ev = makeEvent("@other:example.org", { body: "hey", "m.mentions": { room: true } });
    expect(eventHighlightsUser(ev, "@me:example.org", null, [])).toBe(true);
  });

  it("highlights when the room-local display name appears as a whole word", () => {
    const ev = makeEvent("@other:example.org", { body: "hey Alice, look at this" });
    expect(eventHighlightsUser(ev, "@me:example.org", "Alice", [])).toBe(true);
  });

  it("does not highlight on a display name that's only a SUBSTRING of a longer word (word-boundary aware)", () => {
    const ev = makeEvent("@other:example.org", { body: "Alicetta said hello" });
    expect(eventHighlightsUser(ev, "@me:example.org", "Alice", [])).toBe(false);
  });

  it("matches a display name regardless of case", () => {
    const ev = makeEvent("@other:example.org", { body: "hey ALICE" });
    expect(eventHighlightsUser(ev, "@me:example.org", "Alice", [])).toBe(true);
  });

  it("matches accented/non-ASCII display names as whole words too", () => {
    const ev = makeEvent("@other:example.org", { body: "szia Tamás, hogy vagy?" });
    expect(eventHighlightsUser(ev, "@me:example.org", "Tamás", [])).toBe(true);
  });

  it("highlights on any configured notification keyword, as a whole word", () => {
    const ev = makeEvent("@other:example.org", { body: "the deploy just broke" });
    expect(eventHighlightsUser(ev, "@me:example.org", null, ["deploy"])).toBe(true);
    expect(eventHighlightsUser(ev, "@me:example.org", null, ["redeploy"])).toBe(false);
  });

  it("does not highlight a message with no body (e.g. non-text content)", () => {
    const ev = makeEvent("@other:example.org", {});
    expect(eventHighlightsUser(ev, "@me:example.org", "Alice", ["deploy"])).toBe(false);
  });
});
