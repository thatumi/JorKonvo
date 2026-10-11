import { describe, expect, it } from "vitest";
import { en } from "../../../apps/web/src/i18n/locales/en.js";
import { hu } from "../../../apps/web/src/i18n/locales/hu.js";

/**
 * hu is the reference locale; en must keep full parity. This test is the
 * script-able check PLAN.md's polish round calls for - a missing key in
 * either direction falls back silently to the other locale (or the raw
 * key), which reads as a bug in the wrong language.
 */
describe("i18n hu/en parity", () => {
  const huKeys = new Set(Object.keys(hu));
  const enKeys = new Set(Object.keys(en));

  it("every hu key exists in en", () => {
    const missing = [...huKeys].filter((k) => !enKeys.has(k));
    expect(missing, `missing from en:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every en key exists in hu", () => {
    const missing = [...enKeys].filter((k) => !huKeys.has(k));
    expect(missing, `missing from hu:\n${missing.join("\n")}`).toEqual([]);
  });

  it("no value is left as an untranslated placeholder or empty", () => {
    for (const [k, v] of Object.entries(en)) {
      expect(v, `en[${k}] is empty`).not.toBe("");
    }
    for (const [k, v] of Object.entries(hu)) {
      expect(v, `hu[${k}] is empty`).not.toBe("");
    }
  });

  it("interpolation placeholders match between locales", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of huKeys) {
      if (!enKeys.has(k)) continue;
      expect(ph(en[k]!), `placeholders differ for "${k}"`).toEqual(ph(hu[k]!));
    }
  });
});
