// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageBody } from "../../../apps/web/src/components/MessageBody.js";

// MessageBody only ever touches client.mxcUrlToHttp for the emoticon path,
// which these cases don't exercise.
const client = { mxcUrlToHttp: () => null } as never;

function render(formattedBody: string, body = "fallback"): string {
  return renderToStaticMarkup(<MessageBody body={body} formattedBody={formattedBody} client={client} />);
}

describe("MessageBody renders untrusted formatted_body inertly", () => {
  it("drops a <script> tag, keeping only its text", () => {
    const html = render('safe <script>alert(1)</script> text');
    expect(html).not.toContain("<script");
    expect(html).toContain("alert(1)"); // as inert text
  });

  it("drops an <img onerror> payload entirely (img not on the allowlist)", () => {
    const html = render('<img src=x onerror="alert(1)">hi');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<img");
    expect(html).toContain("hi");
  });

  it("strips a javascript: link down to a plain span", () => {
    const html = render('<a href="javascript:alert(1)">click</a>');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
    expect(html).toContain("click");
  });

  it("keeps a normal https link with safe rel/target", () => {
    const html = render('<a href="https://example.com">ex</a>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it("keeps allowed formatting tags", () => {
    const html = render("<strong>bold</strong> <em>it</em> <code>c</code>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>it</em>");
    expect(html).toContain("<code");
  });

  it("does not pass an unknown-tag's attributes through", () => {
    const html = render('<div style="position:fixed" onclick="x()">z</div>');
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("position:fixed");
    expect(html).toContain("z");
  });

  it("caps recursion on pathologically deep nesting (no stack overflow)", () => {
    // The DEPTH cap means React only descends MAX_DEPTH levels regardless of
    // how deep the hostile markup nests; the plain text still comes through.
    const deep = "<s>".repeat(1000) + "deep-text" + "</s>".repeat(1000);
    let html = "";
    expect(() => {
      html = render(deep);
    }).not.toThrow();
    expect(html).toContain("deep-text");
  }, 20_000);

  it("linkifies a bare URL in a plain-text body", () => {
    const html = renderToStaticMarkup(
      <MessageBody body="see https://example.com now" client={client} />,
    );
    expect(html).toContain('href="https://example.com"');
  });
});
