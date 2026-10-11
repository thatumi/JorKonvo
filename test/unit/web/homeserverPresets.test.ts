import { describe, expect, it } from "vitest";
import {
  CUSTOM_HOMESERVER_VALUE,
  HOMESERVER_PRESETS,
  presetValueFor,
} from "../../../apps/web/src/lib/homeserverPresets";

describe("homeserverPresets", () => {
  it("defaults to a public, open-registration server, not this project's own", () => {
    expect(HOMESERVER_PRESETS[0].url).toBe("https://matrix.org");
  });

  it("matches a known preset's URL exactly", () => {
    for (const preset of HOMESERVER_PRESETS) {
      expect(presetValueFor(preset.url)).toBe(preset.url);
    }
  });

  it("falls back to the custom sentinel for anything else", () => {
    expect(presetValueFor("https://example.org")).toBe(CUSTOM_HOMESERVER_VALUE);
    expect(presetValueFor("")).toBe(CUSTOM_HOMESERVER_VALUE);
  });

  it("trims whitespace before matching", () => {
    expect(presetValueFor(`  ${HOMESERVER_PRESETS[0].url}  `)).toBe(HOMESERVER_PRESETS[0].url);
  });
});
