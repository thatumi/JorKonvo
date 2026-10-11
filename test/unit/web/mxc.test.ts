import { describe, expect, it } from "vitest";
import { initials, mxcToThumbnail } from "../../../apps/web/src/lib/mxc.js";
import { FakeClient } from "../../helpers/fakes.js";

describe("initials", () => {
  it("returns ? for an empty name", () => {
    expect(initials("   ")).toBe("?");
  });
  it("takes the first two letters of a single-word name", () => {
    expect(initials("jordan")).toBe("JO");
  });
  it("takes one letter from each of the first two words", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
  });
  it("strips a leading sigil (#, !, @)", () => {
    expect(initials("#general:test")).toBe("GE");
    expect(initials("@ada:test")).toBe("AD");
  });
  it("splits on hyphens and underscores too", () => {
    expect(initials("cool-cats")).toBe("CC");
  });
});

describe("mxcToThumbnail", () => {
  const client = new FakeClient({ baseUrl: "https://hs.test" });
  it("returns null for an undefined url", () => {
    expect(mxcToThumbnail(client as never, undefined)).toBeNull();
  });
  it("returns null for a non-mxc url", () => {
    expect(mxcToThumbnail(client as never, "https://evil.test/x.png")).toBeNull();
  });
  it("builds an http thumbnail url with the requested size", () => {
    expect(mxcToThumbnail(client as never, "mxc://hs.test/abc", 64)).toBe(
      "https://hs.test/_matrix/media/v3/thumbnail/hs.test/abc?width=64&height=64&method=crop",
    );
  });
});
