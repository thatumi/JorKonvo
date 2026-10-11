import { describe, expect, it } from "vitest";
import {
  EMOJI_PICKER_GROUPS,
  emojiForShortcode,
  searchUnicodeEmoji,
  UNICODE_EMOJI,
} from "../../../apps/web/src/lib/unicodeEmoji.js";

describe("emojiForShortcode", () => {
  it("resolves a known shortcode with or without surrounding colons", () => {
    expect(emojiForShortcode("smile")).toBe("😄");
    expect(emojiForShortcode(":fire:")).toBe("🔥");
  });
  it("returns null for an unknown shortcode", () => {
    expect(emojiForShortcode("definitely_not_an_emoji")).toBeNull();
  });
});

describe("searchUnicodeEmoji", () => {
  it("returns [] for an empty query", () => {
    expect(searchUnicodeEmoji("  ")).toEqual([]);
  });
  it("ranks code-prefix matches ahead of keyword matches", () => {
    const results = searchUnicodeEmoji("fire");
    expect(results[0].code).toBe("fire");
  });
  it("matches on keywords too", () => {
    const codes = searchUnicodeEmoji("haha").map((e) => e.code);
    expect(codes).toContain("laughing");
  });
  it("honours the limit", () => {
    expect(searchUnicodeEmoji("a", 3)).toHaveLength(3);
  });
});

describe("dataset integrity", () => {
  it("every emoji belongs to one of the picker groups", () => {
    const groups = new Set<string>(EMOJI_PICKER_GROUPS);
    for (const e of UNICODE_EMOJI) expect(groups.has(e.group)).toBe(true);
  });
  it("has no empty shortcodes or chars", () => {
    for (const e of UNICODE_EMOJI) {
      expect(e.code.length).toBeGreaterThan(0);
      expect(e.char.length).toBeGreaterThan(0);
    }
  });
});
