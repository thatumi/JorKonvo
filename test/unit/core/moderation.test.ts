import { describe, expect, it } from "vitest";
import {
  canBan,
  canInviteToRoom,
  canKick,
  canRedactOthers,
  canSetMemberPowerLevel,
  describePowerLevel,
  getMemberPowerLevel,
} from "../../../packages/matrix-core/src/moderation.js";
import { FakeRoom } from "../../helpers/fakes.js";

function room(users: Record<string, number>, thresholds: Record<string, unknown> = {}) {
  return new FakeRoom({
    members: Object.entries(users).map(([userId, powerLevel]) => ({ userId, membership: "join", powerLevel })),
    state: { "m.room.power_levels|": { users, ...thresholds } },
  });
}

describe("describePowerLevel", () => {
  it("names an exact preset", () => {
    expect(describePowerLevel(100)).toMatchObject({ labelKey: "power.owner", exact: true });
    expect(describePowerLevel(0)).toMatchObject({ labelKey: "power.member", exact: true });
  });
  it("labels an in-between level by the preset below it", () => {
    const d = describePowerLevel(30);
    expect(d.exact).toBe(false);
    expect(d.labelKey).toBe("power.moderator"); // 25 is the highest preset <= 30
  });
});

describe("getMemberPowerLevel", () => {
  it("is the member's level, or 0 when absent", () => {
    const r = room({ "@a:t": 50 });
    expect(getMemberPowerLevel(r, "@a:t")).toBe(50);
    expect(getMemberPowerLevel(r, "@ghost:t")).toBe(0);
  });
});

describe("canKick / canBan", () => {
  const r = room({ "@owner:t": 100, "@mod:t": 50, "@user:t": 0 }); // defaults: kick/ban = 50

  it("a mod can kick/ban a lower member", () => {
    expect(canKick(r, "@mod:t", "@user:t")).toBe(true);
    expect(canBan(r, "@mod:t", "@user:t")).toBe(true);
  });
  it("nobody can kick/ban themselves", () => {
    expect(canKick(r, "@mod:t", "@mod:t")).toBe(false);
    expect(canBan(r, "@owner:t", "@owner:t")).toBe(false);
  });
  it("cannot act on an EQUAL power level (strictly-greater rule)", () => {
    const eq = room({ "@a:t": 100, "@b:t": 100 });
    expect(canKick(eq, "@a:t", "@b:t")).toBe(false);
  });
  it("a plain user (below the kick threshold) cannot kick", () => {
    expect(canKick(r, "@user:t", "@user2:t")).toBe(false);
  });
  it("honours a raised kick threshold", () => {
    const strict = room({ "@mod:t": 50, "@user:t": 0 }, { kick: 90 });
    expect(canKick(strict, "@mod:t", "@user:t")).toBe(false);
  });
});

describe("canSetMemberPowerLevel", () => {
  // needs power to send m.room.power_levels (state_default 50 by default)
  const r = room({ "@owner:t": 100, "@mod:t": 50, "@user:t": 0 });

  it("owner may promote a user up to (not above) their own level", () => {
    expect(canSetMemberPowerLevel(r, "@owner:t", "@user:t", 50)).toBe(true);
    expect(canSetMemberPowerLevel(r, "@owner:t", "@user:t", 100)).toBe(true);
    expect(canSetMemberPowerLevel(r, "@owner:t", "@user:t", 101)).toBe(false);
  });
  it("cannot change your own level", () => {
    expect(canSetMemberPowerLevel(r, "@owner:t", "@owner:t", 0)).toBe(false);
  });
  it("cannot change someone at your own level", () => {
    const eq = room({ "@a:t": 100, "@b:t": 100 });
    expect(canSetMemberPowerLevel(eq, "@a:t", "@b:t", 0)).toBe(false);
  });
  it("a member who can't send power_levels state can't set anyone's level", () => {
    expect(canSetMemberPowerLevel(r, "@mod:t", "@user:t", 10)).toBe(true); // mod at 50 == state_default 50
    const strict = room({ "@mod:t": 50, "@user:t": 0 }, { events: { "m.room.power_levels": 90 } });
    expect(canSetMemberPowerLevel(strict, "@mod:t", "@user:t", 10)).toBe(false);
  });
});

describe("canRedactOthers / canInviteToRoom", () => {
  it("redact needs the redact threshold (default 50)", () => {
    const r = room({ "@mod:t": 50, "@user:t": 0 });
    expect(canRedactOthers(r, "@mod:t")).toBe(true);
    expect(canRedactOthers(r, "@user:t")).toBe(false);
  });
  it("invite defaults to 0 — everyone can", () => {
    const r = room({ "@user:t": 0 });
    expect(canInviteToRoom(r, "@user:t")).toBe(true);
  });
  it("a raised invite threshold locks it down", () => {
    const r = room({ "@user:t": 0, "@mod:t": 50 }, { invite: 50 });
    expect(canInviteToRoom(r, "@user:t")).toBe(false);
    expect(canInviteToRoom(r, "@mod:t")).toBe(true);
  });
});
