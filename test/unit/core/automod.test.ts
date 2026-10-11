import { describe, expect, it } from "vitest";
import {
  AUTOMOD_EVENT,
  findAutoModMatch,
  findAutoModPatternMatch,
  findDisallowedLink,
  getAutoModConfig,
} from "../../../packages/matrix-core/src/automod.js";
import { FakeRoom } from "../../helpers/fakes.js";

describe("getAutoModConfig", () => {
  it("returns a disabled empty config when unset", () => {
    expect(getAutoModConfig(new FakeRoom())).toEqual({
      enabled: false,
      keywords: [],
      patterns: [],
      linkFilterEnabled: false,
      allowedDomains: [],
    });
  });

  it("filters out malformed keywords/patterns/domains", () => {
    const room = new FakeRoom({
      state: {
        [`${AUTOMOD_EVENT}|`]: {
          enabled: true,
          keywords: ["ok", 5, null],
          patterns: [{ value: "a*", kind: "wildcard" }, { value: "b", kind: "bogus" }, { kind: "regex" }],
          linkFilterEnabled: true,
          allowedDomains: ["good.example", 3],
        },
      },
    });
    const cfg = getAutoModConfig(room);
    expect(cfg.keywords).toEqual(["ok"]);
    expect(cfg.patterns).toEqual([{ value: "a*", kind: "wildcard" }]);
    expect(cfg.allowedDomains).toEqual(["good.example"]);
    expect(cfg.enabled).toBe(true);
  });
});

describe("findAutoModMatch (substring, case-insensitive, catches embedded)", () => {
  it("matches a banned term even inside a longer word", () => {
    expect(findAutoModMatch("that is unbelievablyBADword here", ["badword"])).toBe("badword");
  });
  it("returns null when nothing matches", () => {
    expect(findAutoModMatch("all clean here", ["spam", "scam"])).toBeNull();
  });
  it("ignores blank keywords", () => {
    expect(findAutoModMatch("hello", ["  "])).toBeNull();
  });
});

describe("findAutoModPatternMatch", () => {
  it("wildcard 'spam*' anchors to the start of the whole body", () => {
    expect(findAutoModPatternMatch("spammy message", [{ value: "spam*", kind: "wildcard" }])).toBe("spam*");
    expect(findAutoModPatternMatch("not spammy", [{ value: "spam*", kind: "wildcard" }])).toBeNull();
  });
  it("'*http*' wildcard behaves like a substring search", () => {
    expect(findAutoModPatternMatch("see http://x.test now", [{ value: "*http*", kind: "wildcard" }])).toBe("*http*");
  });
  it("regex matches case-insensitively", () => {
    expect(findAutoModPatternMatch("BUY NOW", [{ value: "buy now", kind: "regex" }])).toBe("buy now");
  });
  it("an invalid regex never throws, just never matches", () => {
    expect(findAutoModPatternMatch("anything", [{ value: "(", kind: "regex" }])).toBeNull();
  });
  it("rejects a catastrophic nested-quantifier pattern outright", () => {
    expect(findAutoModPatternMatch("aaaaaaaaaaaaaaaaaaaa!", [{ value: "(a+)+$", kind: "regex" }])).toBeNull();
  });
});

describe("findDisallowedLink", () => {
  it("returns null when there are no links", () => {
    expect(findDisallowedLink("no links here", ["example.com"])).toBeNull();
  });
  it("allows a link to an allowed domain and its subdomains", () => {
    expect(findDisallowedLink("https://cdn.example.com/x https://example.com", ["example.com"])).toBeNull();
  });
  it("catches the first link to a non-allowed domain", () => {
    expect(findDisallowedLink("ok https://example.com bad https://evil.test/x", ["example.com"])).toBe(
      "https://evil.test/x",
    );
  });
  it("with an empty allowlist, any link at all is disallowed", () => {
    expect(findDisallowedLink("https://example.com", [])).toBe("https://example.com");
  });
});
