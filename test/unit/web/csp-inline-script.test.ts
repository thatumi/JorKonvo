import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * apps/web/index.html carries one inline <script> (the pre-paint theme
 * init, kept inline so it runs before first paint). The production CSP
 * forbids 'unsafe-inline' in script-src, so that script only runs if its
 * sha256 is allow-listed - in THREE independently-enforced places:
 *   - apps/web/vite.config.ts  (the <meta> CSP, computed dynamically)
 *   - apps/desktop/src-tauri/tauri.conf.json  (the Tauri shell)
 *   - deploy/caddy/Caddyfile   (the deployed HTTP header)
 * Round 18 shipped the CSP without the hash and silently broke the script
 * in prod + Tauri. This test fails the moment the script changes without
 * every consumer's hash being updated to match.
 */
const root = resolve(__dirname, "../../..");

function read(p: string): string {
  return readFileSync(resolve(root, p), "utf8");
}

function inlineScriptHash(html: string): string {
  const m = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) throw new Error("no inline <script> in index.html");
  return `sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}`;
}

describe("CSP inline-script hash stays in sync", () => {
  const hash = inlineScriptHash(read("apps/web/index.html"));

  it("the Tauri desktop CSP allow-lists the current hash", () => {
    expect(read("apps/desktop/src-tauri/tauri.conf.json")).toContain(hash);
  });

  it("the deployed Caddy CSP header allow-lists the current hash", () => {
    expect(read("deploy/caddy/Caddyfile")).toContain(hash);
  });

  it("index.html has exactly one inline script (add coverage before adding a second)", () => {
    const count = [...read("apps/web/index.html").matchAll(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi)].length;
    expect(count).toBe(1);
  });
});
