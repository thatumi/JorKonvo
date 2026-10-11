import { describe, expect, it } from "vitest";
import type { MatrixEvent } from "matrix-js-sdk";
import { hitMatchesQuery, parseSearchQuery } from "../../../packages/matrix-core/src/searchFilters.js";

/** Hand-rolled minimal MatrixEvent: just the three getters hitMatchesQuery touches. */
function makeEvent(opts: { sender?: string; ts?: number; content?: Record<string, unknown> } = {}): MatrixEvent {
  return {
    getContent: () => opts.content ?? {},
    getSender: () => opts.sender,
    getTs: () => opts.ts ?? 0,
  } as unknown as MatrixEvent;
}

/** A ParsedQuery with every filter off - hand-tune individual fields per test. */
function baseQuery() {
  return parseSearchQuery("");
}

describe("parseSearchQuery", () => {
  it("returns an all-off query for an empty string", () => {
    expect(parseSearchQuery("")).toEqual({
      term: "",
      from: null,
      hasLink: false,
      hasImage: false,
      hasFile: false,
      inRoomName: null,
      beforeTs: null,
      afterTs: null,
      duringDay: null,
    });
  });

  it("keeps free terms and collapses whitespace", () => {
    expect(parseSearchQuery("  hello    weird   spacing  ").term).toBe("hello weird spacing");
  });

  it("leaves a totally operator-free query untouched apart from whitespace", () => {
    const q = parseSearchQuery("just some words");
    expect(q.term).toBe("just some words");
    expect(q.from).toBeNull();
    expect(q.hasLink).toBe(false);
    expect(q.hasImage).toBe(false);
    expect(q.hasFile).toBe(false);
    expect(q.inRoomName).toBeNull();
  });

  it("parses from:, stripping the leading @ and lowercasing", () => {
    expect(parseSearchQuery("from:@Alice:Example.COM").from).toBe("alice:example.com");
    expect(parseSearchQuery("from:Alice").from).toBe("alice");
  });

  it("parses a quoted from: value containing spaces", () => {
    const q = parseSearchQuery('from:"Bob Smith" hi');
    expect(q.from).toBe("bob smith");
    expect(q.term).toBe("hi");
  });

  it("parses has:link / has:image / has:file plus their synonyms, case-insensitively", () => {
    expect(parseSearchQuery("has:link").hasLink).toBe(true);
    expect(parseSearchQuery("HAS:LINK").hasLink).toBe(true);
    expect(parseSearchQuery("has:image").hasImage).toBe(true);
    expect(parseSearchQuery("has:images").hasImage).toBe(true);
    expect(parseSearchQuery("has:img").hasImage).toBe(true);
    expect(parseSearchQuery("Has:IMG").hasImage).toBe(true);
    expect(parseSearchQuery("has:file").hasFile).toBe(true);
    expect(parseSearchQuery("has:files").hasFile).toBe(true);
  });

  it("keeps an unknown has: value as free text instead of consuming it", () => {
    const q = parseSearchQuery("hello has:sticker world");
    expect(q.hasLink).toBe(false);
    expect(q.hasImage).toBe(false);
    expect(q.hasFile).toBe(false);
    expect(q.term).toBe("hello has:sticker world");
  });

  it("parses in: by stripping # and lowercasing the room-name fragment", () => {
    expect(parseSearchQuery("in:#General").inRoomName).toBe("general");
  });

  it("maps before: to the END of that local day and after: to its START", () => {
    const beforeDayStart = new Date("2026-01-31T00:00:00").getTime();
    const afterDayStart = new Date("2026-01-01T00:00:00").getTime();
    const q = parseSearchQuery("before:2026-01-31 after:2026-01-01");
    expect(q.beforeTs).toBe(beforeDayStart + 24 * 60 * 60 * 1000);
    expect(q.afterTs).toBe(afterDayStart);
  });

  it("stores during: verbatim", () => {
    expect(parseSearchQuery("during:2026-05-04").duringDay).toBe("2026-05-04");
  });

  it("removes recognized operators from the free term while preserving the rest", () => {
    const q = parseSearchQuery("cat from:alice has:link dog in:#lounge");
    expect(q.term).toBe("cat dog");
    expect(q.from).toBe("alice");
    expect(q.hasLink).toBe(true);
    expect(q.inRoomName).toBe("lounge");
  });

  it("is case-insensitive in operator keys (FROM:, In:, During:)", () => {
    const q = parseSearchQuery("FROM:@alice In:#Lounge During:2026-05-04");
    expect(q.from).toBe("alice");
    expect(q.inRoomName).toBe("lounge");
    expect(q.duringDay).toBe("2026-05-04");
    expect(q.term).toBe("");
  });

  it("keeps an unknown operator and its value as free text", () => {
    const q = parseSearchQuery("foo:bar baz");
    expect(q.term).toBe("foo:bar baz");
    expect(q.from).toBeNull();
  });

  it("does NOT support is: - it stays in the free term (no boolean flag flips)", () => {
    // Characterization: unlike Discord, `is:` is not an operator here; it falls
    // through to the default branch and survives into the server/local term.
    const q = parseSearchQuery("is:unread hello");
    expect(q.term).toBe("is:unread hello");
    expect(q.hasLink).toBe(false);
    expect(q.hasImage).toBe(false);
    expect(q.hasFile).toBe(false);
  });

  it("keeps quotes around free-text phrases verbatim (no phrase extraction)", () => {
    // Characterization: quoting only matters for operator values; free-text
    // "quoted phrases" go to the server with their quote characters intact.
    const q = parseSearchQuery('"deploy checklist" notes');
    expect(q.term).toBe('"deploy checklist" notes');
  });

  it("treats a bare operator with no value as free text", () => {
    const q = parseSearchQuery("from: hello");
    expect(q.from).toBeNull();
    expect(q.term).toBe("from: hello");
  });

  it("does not mistake a URL in the query for an operator", () => {
    const q = parseSearchQuery("see https://example.com/x now");
    expect(q.term).toBe("see https://example.com/x now");
    expect(q.hasLink).toBe(false);
  });

  it("an unknown operator greedily swallows a later valid one in the same token", () => {
    // Characterization: `a:` matches first with value `from:x`, is rejected as
    // unknown, and the regex never re-scans inside the consumed token.
    const q = parseSearchQuery("a:from:x");
    expect(q.from).toBeNull();
    expect(q.term).toBe("a:from:x");
  });

  it("on duplicate operators the last occurrence wins and every copy leaves the term", () => {
    const q = parseSearchQuery("from:alice from:bob hi");
    expect(q.from).toBe("bob");
    expect(q.term).toBe("hi");
  });

  it("duplicate has: flags are idempotent", () => {
    const q = parseSearchQuery("has:link has:image has:link");
    expect(q.hasLink).toBe(true);
    expect(q.hasImage).toBe(true);
    expect(q.term).toBe("");
  });

  it("from:\"\" is consumed but disables the sender filter (empty string is falsy)", () => {
    // Characterization: the token disappears from the term, yet q.from === ""
    // so hitMatchesQuery will not apply any from-filter.
    const q = parseSearchQuery('from:"" hi');
    expect(q.from).toBe("");
    expect(q.term).toBe("hi");
    const ev = makeEvent({ sender: "@anyone:test", ts: 0, content: { body: "hi" } });
    expect(hitMatchesQuery(ev, q, null)).toBe(true);
  });

  it("an unparseable before:/after: date degrades to timestamp 0 (dayStartEnd fallback)", () => {
    // Characterization of dayStartEnd's NaN -> [0, 0] path.
    expect(parseSearchQuery("before:notadate").beforeTs).toBe(0);
    expect(parseSearchQuery("after:notadate").afterTs).toBe(0);
  });

  it("does not leak lastIndex of the shared global regex between calls", () => {
    expect(parseSearchQuery("from:alice hi").term).toBe("hi");
    expect(parseSearchQuery("from:alice hi")).toEqual(parseSearchQuery("from:alice hi"));
    expect(parseSearchQuery("hello").term).toBe("hello");
  });
});

describe("hitMatchesQuery", () => {
  it("accepts any plain message when no filters are set", () => {
    const ev = makeEvent({ sender: "@a:test", ts: 1000, content: { body: "hello", msgtype: "m.text" } });
    expect(hitMatchesQuery(ev, baseQuery(), null)).toBe(true);
  });

  describe("from: sender filter", () => {
    const q = parseSearchQuery("from:@alice:example.org");

    it("matches a sender whose userId contains the value, case-insensitively", () => {
      const ev = makeEvent({ sender: "@ALICE:example.org", content: { body: "hi" } });
      expect(hitMatchesQuery(ev, q, null)).toBe(true);
    });

    it("matches the room-local display name when the userId does not contain it", () => {
      // A short from: value (a bare name) can be satisfied via the display name.
      const byName = parseSearchQuery("from:alice");
      const ev = makeEvent({ sender: "@bob123:example.org", content: { body: "hi" } });
      expect(hitMatchesQuery(ev, byName, "Alice")).toBe(true);
    });

    it("matches a partial (substring) sender fragment like from:alice", () => {
      const loose = parseSearchQuery("from:alice");
      expect(hitMatchesQuery(makeEvent({ sender: "@malice:x", content: {} }), loose, null)).toBe(true);
    });

    it("rejects when neither sender nor display name contains the value", () => {
      const ev = makeEvent({ sender: "@bob:example.org", content: { body: "hi" } });
      expect(hitMatchesQuery(ev, q, "Robert")).toBe(false);
    });

    it("rejects when the event has no sender at all", () => {
      expect(hitMatchesQuery(makeEvent({ content: { body: "hi" } }), q, "Alice")).toBe(false);
    });
  });

  describe("has:image", () => {
    const q = parseSearchQuery("has:image");

    it("accepts an m.image event", () => {
      const ev = makeEvent({ sender: "@a:t", content: { msgtype: "m.image", body: "pic.png", url: "mxc://t/x" } });
      expect(hitMatchesQuery(ev, q, null)).toBe(true);
    });

    it("rejects other msgtypes and events with no msgtype", () => {
      expect(hitMatchesQuery(makeEvent({ content: { msgtype: "m.file", body: "f" } }), q, null)).toBe(false);
      expect(hitMatchesQuery(makeEvent({ content: { msgtype: "m.text", body: "f" } }), q, null)).toBe(false);
      expect(hitMatchesQuery(makeEvent({ content: { body: "no msgtype" } }), q, null)).toBe(false);
    });
  });

  describe("has:file", () => {
    const q = parseSearchQuery("has:file");

    it("accepts m.file, m.audio and m.video as file-ish", () => {
      for (const msgtype of ["m.file", "m.audio", "m.video"]) {
        expect(hitMatchesQuery(makeEvent({ content: { msgtype, body: "x" } }), q, null)).toBe(true);
      }
    });

    it("rejects m.image, m.text and events without a msgtype", () => {
      expect(hitMatchesQuery(makeEvent({ content: { msgtype: "m.image", body: "x" } }), q, null)).toBe(false);
      expect(hitMatchesQuery(makeEvent({ content: { msgtype: "m.text", body: "x" } }), q, null)).toBe(false);
      expect(hitMatchesQuery(makeEvent({ content: {} }), q, null)).toBe(false);
    });
  });

  describe("has:link", () => {
    const q = parseSearchQuery("has:link");

    it("accepts a body containing an https URL anywhere in the text", () => {
      const ev = makeEvent({ sender: "@a:t", content: { msgtype: "m.text", body: "see https://example.com/x, thanks" } });
      expect(hitMatchesQuery(ev, q, null)).toBe(true);
    });

    it("accepts http:// and is case-insensitive on the scheme", () => {
      expect(hitMatchesQuery(makeEvent({ content: { body: "HTTP://A.B/C" } }), q, null)).toBe(true);
    });

    it("rejects non-http schemes and link-free bodies", () => {
      expect(hitMatchesQuery(makeEvent({ content: { body: "ftp://files.example.com/x" } }), q, null)).toBe(false);
      expect(hitMatchesQuery(makeEvent({ content: { body: "no links here" } }), q, null)).toBe(false);
    });

    it("treats a non-string body as no body (no link)", () => {
      expect(hitMatchesQuery(makeEvent({ content: { body: 42 } }), q, null)).toBe(false);
      expect(hitMatchesQuery(makeEvent({ content: { msgtype: "m.image", url: "mxc://t/x" } }), q, null)).toBe(false);
    });
  });

  it("requires every requested has: predicate to hold simultaneously", () => {
    const q = parseSearchQuery("has:link has:image");
    const good = makeEvent({ content: { msgtype: "m.image", body: "https://x/y preview" } });
    const noLink = makeEvent({ content: { msgtype: "m.image", body: "no url" } });
    const noImage = makeEvent({ content: { msgtype: "m.text", body: "https://x/y" } });
    expect(hitMatchesQuery(good, q, null)).toBe(true);
    expect(hitMatchesQuery(noLink, q, null)).toBe(false);
    expect(hitMatchesQuery(noImage, q, null)).toBe(false);
  });

  describe("time filters", () => {
    it("before: excludes events at or after the boundary (equality excluded)", () => {
      const q = parseSearchQuery("before:2026-01-31");
      const end = new Date("2026-01-31T00:00:00").getTime() + 24 * 60 * 60 * 1000;
      expect(hitMatchesQuery(makeEvent({ ts: end - 1, content: {} }), q, null)).toBe(true);
      expect(hitMatchesQuery(makeEvent({ ts: end, content: {} }), q, null)).toBe(false);
    });

    it("after: includes events at the boundary and excludes earlier ones", () => {
      const q = parseSearchQuery("after:2026-01-01");
      const start = new Date("2026-01-01T00:00:00").getTime();
      expect(hitMatchesQuery(makeEvent({ ts: start, content: {} }), q, null)).toBe(true);
      expect(hitMatchesQuery(makeEvent({ ts: start - 1, content: {} }), q, null)).toBe(false);
    });

    it("during: keeps only timestamps within [local midnight, +24h)", () => {
      const q = parseSearchQuery("during:2026-05-04");
      const start = new Date("2026-05-04T00:00:00").getTime();
      const day = 24 * 60 * 60 * 1000;
      expect(hitMatchesQuery(makeEvent({ ts: start, content: {} }), q, null)).toBe(true);
      expect(hitMatchesQuery(makeEvent({ ts: start + day - 1, content: {} }), q, null)).toBe(true);
      expect(hitMatchesQuery(makeEvent({ ts: start - 1, content: {} }), q, null)).toBe(false);
      expect(hitMatchesQuery(makeEvent({ ts: start + day, content: {} }), q, null)).toBe(false);
    });

    it("combined before:/after: keep only the events inside the window", () => {
      const q = parseSearchQuery("after:2026-01-01 before:2026-01-31");
      const t = (s: string) => new Date(s).getTime();
      expect(hitMatchesQuery(makeEvent({ ts: t("2026-01-15T12:00:00"), content: {} }), q, null)).toBe(true);
      expect(hitMatchesQuery(makeEvent({ ts: t("2025-12-31T12:00:00"), content: {} }), q, null)).toBe(false);
      expect(hitMatchesQuery(makeEvent({ ts: t("2026-02-01T12:00:00"), content: {} }), q, null)).toBe(false);
    });

    it("a malformed before: date degrades to 0 and filters out EVERY event (characterization)", () => {
      // dayStartEnd returns [0, 0] for NaN input, so beforeTs becomes 0 and
      // `ts >= 0` holds for all real timestamps - the search silently returns
      // nothing instead of ignoring the bad operator (searchFilters.ts:33,71,113).
      const q = parseSearchQuery("before:notadate");
      expect(hitMatchesQuery(makeEvent({ ts: 1234567890, content: { body: "hi" } }), q, null)).toBe(false);
    });

    it("a malformed after: date degrades to 0 and filters out nothing (characterization)", () => {
      // Asymmetric with before: afterTs=0 means `ts < 0` never fires.
      const q = parseSearchQuery("after:notadate");
      expect(hitMatchesQuery(makeEvent({ ts: 1234567890, content: { body: "hi" } }), q, null)).toBe(true);
    });

    it("a malformed during: date filters out every event too (characterization)", () => {
      const q = parseSearchQuery("during:notadate");
      expect(hitMatchesQuery(makeEvent({ ts: 1234567890, content: {} }), q, null)).toBe(false);
    });
  });

  it("never consults the free term - text matching happens upstream/downstream", () => {
    // Characterization: hitMatchesQuery applies only the operator filters;
    // the parsed `term` is intentionally ignored here.
    const q = baseQuery();
    q.term = "xyzzy";
    expect(hitMatchesQuery(makeEvent({ sender: "@a:t", ts: 0, content: { body: "completely different" } }), q, null)).toBe(
      true,
    );
  });

  it("ignores unrelated content fields such as m.mentions", () => {
    const ev = makeEvent({
      sender: "@a:t",
      content: { body: "hello", "m.mentions": { user_ids: ["@me:t"], room: true } },
    });
    expect(hitMatchesQuery(ev, baseQuery(), null)).toBe(true);
  });
});
