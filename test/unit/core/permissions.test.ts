import { describe, expect, it } from "vitest";
import {
  getPermissionDef,
  hasClientPermission,
  PERMISSION_CATALOG,
  permissionsImpliedByPowerLevel,
} from "../../../packages/matrix-core/src/permissions.js";
import { FakeRoom } from "../../helpers/fakes.js";

describe("getPermissionDef", () => {
  it("returns the catalog entry for a known id", () => {
    expect(getPermissionDef("banMembers").tier).toBe("power-level");
    expect(getPermissionDef("attachFiles").tier).toBe("client");
  });
  it("throws for an unknown id", () => {
    // @ts-expect-error - deliberately invalid
    expect(() => getPermissionDef("nope")).toThrow(/Unknown permission/);
  });
});

describe("hasClientPermission", () => {
  it("allows a member with no roles at all", () => {
    expect(hasClientPermission([], "attachFiles")).toBe(true);
  });

  it("allows when every assigned role predates the feature (permissions undefined)", () => {
    expect(hasClientPermission([{}, {}], "createThreads")).toBe(true);
  });

  it("denies once at least one role has an explicit list that omits the permission", () => {
    expect(hasClientPermission([{ permissions: ["sendMessages"] }], "attachFiles")).toBe(false);
  });

  it("grants when a configured role includes the permission", () => {
    expect(hasClientPermission([{ permissions: ["attachFiles"] }, {}], "attachFiles")).toBe(true);
  });

  it("administrator on any role grants every client permission", () => {
    expect(hasClientPermission([{ permissions: ["administrator"] }], "useExternalEmoji")).toBe(true);
  });
});

describe("permissionsImpliedByPowerLevel", () => {
  it("a level-0 member in a default room can send messages and add reactions only", () => {
    const room = new FakeRoom({ state: { "m.room.power_levels|": {} } });
    const implied = permissionsImpliedByPowerLevel(room, 0);
    expect(implied).toContain("sendMessages");
    expect(implied).toContain("addReactions");
    expect(implied).not.toContain("banMembers");
  });

  it("level 50 in a default room implies the moderation permissions", () => {
    const room = new FakeRoom({ state: { "m.room.power_levels|": {} } });
    const implied = permissionsImpliedByPowerLevel(room, 50);
    expect(implied).toEqual(expect.arrayContaining(["kickMembers", "banMembers", "manageMessages"]));
  });

  it("never reports client-tier permissions, even at level 100", () => {
    const room = new FakeRoom({ state: { "m.room.power_levels|": {} } });
    const implied = permissionsImpliedByPowerLevel(room, 100);
    for (const p of PERMISSION_CATALOG.filter((d) => d.tier === "client")) {
      expect(implied).not.toContain(p.id);
    }
  });

  it("honours a custom raised threshold (redact: 90 means level 50 no longer implies manageMessages)", () => {
    const room = new FakeRoom({ state: { "m.room.power_levels|": { redact: 90 } } });
    expect(permissionsImpliedByPowerLevel(room, 50)).not.toContain("manageMessages");
    expect(permissionsImpliedByPowerLevel(room, 90)).toContain("manageMessages");
  });
});
