import { describe, expect, it } from "vitest";
import { buildFormattedContent, escapeHtml } from "../../../packages/matrix-core/src/formatting.js";

describe("escapeHtml", () => {
  it("escapes the five dangerous characters", () => {
    expect(escapeHtml(`<img src="x" onerror='y'>&`)).toBe(
      `&lt;img src=&quot;x&quot; onerror='y'&gt;&amp;`,
    );
  });
});

describe("buildFormattedContent", () => {
  it("leaves a plain message plain - no formatted_body", () => {
    expect(buildFormattedContent("hello world")).toEqual({ body: "hello world" });
  });

  it("builds spec HTML for bold / italic / code / strike / spoiler", () => {
    const r = buildFormattedContent("a **b** c *i* d `k` e ~~s~~ f ||sp||");
    expect(r.format).toBe("org.matrix.custom.html");
    expect(r.formatted_body).toContain("<strong>b</strong>");
    expect(r.formatted_body).toContain("<em>i</em>");
    expect(r.formatted_body).toContain("<code>k</code>");
    expect(r.formatted_body).toContain("<del>s</del>");
    expect(r.formatted_body).toContain("<span data-mx-spoiler>sp</span>");
    // body stays the raw text
    expect(r.body).toBe("a **b** c *i* d `k` e ~~s~~ f ||sp||");
  });

  it("does not treat ** as italic (bold wins, no stray <em>)", () => {
    const r = buildFormattedContent("**strong only**");
    expect(r.formatted_body).toBe("<strong>strong only</strong>");
  });

  it("escapes user text before formatting (no HTML injection)", () => {
    const r = buildFormattedContent("**<script>alert(1)</script>**");
    expect(r.formatted_body).toContain("&lt;script&gt;");
    expect(r.formatted_body).not.toContain("<script>");
  });

  it("emits m.mentions.user_ids for an @mention picked from autocomplete", () => {
    const r = buildFormattedContent("hey @Alice", [{ displayName: "Alice", userId: "@alice:test" }]);
    expect(r["m.mentions"]).toEqual({ user_ids: ["@alice:test"] });
    expect(r.formatted_body).toContain(`<a href="https://matrix.to/#/@alice:test">@Alice</a>`);
  });

  it("longest display name wins when one is a strict prefix of another - no double-match, no phantom mention", () => {
    const r = buildFormattedContent("ping @Jordan", [
      { displayName: "Jo", userId: "@jo:test" },
      { displayName: "Jordan", userId: "@jordan:test" },
    ]);
    // FIXED (was the KNOWN ISSUE noted here): all mentions are now matched
    // in a single combined pass over the original text, so "Jo" is never
    // tried again inside the anchor tag "Jordan"'s match just produced -
    // that used to create a broken nested <a> AND silently add @jo to
    // m.mentions even though Jo was never actually mentioned.
    expect(r.formatted_body).toBe('ping <a href="https://matrix.to/#/@jordan:test">@Jordan</a>');
    expect(r["m.mentions"]?.user_ids).toEqual(["@jordan:test"]);
  });

  it("marks @room as a mass mention (m.mentions.room), not a user id", () => {
    const r = buildFormattedContent("@room heads up");
    expect(r["m.mentions"]).toEqual({ room: true });
    expect(r.formatted_body).toContain('<span data-mx-pill="room">@room</span>');
  });

  it("keeps ``` fenced code verbatim and never formats inside it", () => {
    const r = buildFormattedContent("before\n```js\nconst x = **not bold**;\n```\nafter");
    expect(r.formatted_body).toContain(`<pre><code class="language-js">const x = **not bold**;</code></pre>`);
    expect(r.formatted_body).not.toContain("<strong>");
  });

  it("strips a dangerous fence language to a safe class token", () => {
    const r = buildFormattedContent('```js"><script>\ncode\n```');
    expect(r.formatted_body).not.toContain("<script>");
    expect(r.formatted_body).toMatch(/language-[A-Za-z0-9_+#.-]*/);
  });

  it("resolves a custom :shortcode: to an im.ponies <img> emoticon", () => {
    const r = buildFormattedContent("nice :party:", [], [], [], [
      { shortcode: "party", mxcUrl: "mxc://test/party" },
    ]);
    expect(r.formatted_body).toContain('<img data-mx-emoticon src="mxc://test/party"');
  });
});
