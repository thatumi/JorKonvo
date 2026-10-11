import { describe, expect, it } from "vitest";
import {
  canUpgradeRoom,
  getAvailableRoomVersions,
  getRecommendedRoomVersion,
  getRoomTombstone,
  getRoomVersion,
  isRoomTombstoned,
  upgradeRoom,
} from "../../../packages/matrix-core/src/roomUpgrade.js";
import { FakeClient, FakeMember, FakeRoom } from "../../helpers/fakes.js";

/**
 * FakeClient plus recordings for the room-upgrade client surface: the
 * advertised capabilities (for version pickers), the SDK `upgradeRoom` call,
 * and the best-effort re-invite fan-out into the replacement room.
 */
class UpgradeClient extends FakeClient {
  /** `null` makes `getCapabilities()` reject, like an unreachable HS. */
  capabilities: Record<string, unknown> | undefined;
  getCapabilitiesCalls = 0;
  upgradeCalls: { roomId: string; newVersion: string }[] = [];
  inviteCalls: { roomId: string; userId: string }[] = [];
  /** UserIds whose invite should reject (to prove one failure doesn't abort the rest). */
  failingInvites = new Set<string>();

  constructor(
    opts: { userId?: string; rooms?: FakeRoom[] } = {},
    capabilities: Record<string, unknown> | null = {
      "m.room_versions": { default: "10", available: { "9": "stable", "10": "stable" } },
    },
  ) {
    super(opts);
    this.capabilities = capabilities ?? undefined;
  }

  async getCapabilities(): Promise<Record<string, unknown>> {
    this.getCapabilitiesCalls++;
    if (!this.capabilities) throw new Error("M_UNRECOGNIZED");
    return this.capabilities;
  }

  async upgradeRoom(roomId: string, newVersion: string): Promise<{ replacement_room: string }> {
    this.upgradeCalls.push({ roomId, newVersion });
    return { replacement_room: "!newer:test" };
  }

  async invite(roomId: string, userId: string): Promise<unknown> {
    this.inviteCalls.push({ roomId, userId });
    if (this.failingInvites.has(userId)) throw new Error("invite rejected");
    return {};
  }
}

function roomWithCreate(roomVersion: string | undefined): FakeRoom {
  return new FakeRoom({
    state: { "m.room.create|": roomVersion === undefined ? {} : { room_version: roomVersion } },
  });
}

function tombstonedRoom(content: Record<string, unknown>): FakeRoom {
  return new FakeRoom({ state: { "m.room.tombstone|": content } });
}

describe("getRoomVersion", () => {
  it("defaults to \"1\" when the room has no m.room.create state", () => {
    expect(getRoomVersion(new FakeRoom() as never)).toBe("1");
  });

  it("reads room_version from the m.room.create content", () => {
    expect(getRoomVersion(roomWithCreate("9") as never)).toBe("9");
  });

  it("reads an unstable version string verbatim", () => {
    expect(getRoomVersion(roomWithCreate("org.example.msc1234") as never)).toBe(
      "org.example.msc1234",
    );
  });

  it("falls back to \"1\" when the create event has no room_version (characterization)", () => {
    // Room v1 predates the room_version field, so a bare create event means v1
    // rather than an error.
    expect(getRoomVersion(roomWithCreate(undefined) as never)).toBe("1");
  });
});

describe("getRoomTombstone", () => {
  it("returns null when there is no m.room.tombstone state", () => {
    expect(getRoomTombstone(new FakeRoom() as never)).toBeNull();
  });

  it("parses replacement_room and body from the tombstone content", () => {
    expect(
      getRoomTombstone(
        tombstonedRoom({
          replacement_room: "!newer:test",
          body: "This room has been replaced",
        }) as never,
      ),
    ).toEqual({ replacementRoomId: "!newer:test", body: "This room has been replaced" });
  });

  it("defaults body to an empty string when the tombstone has none", () => {
    expect(getRoomTombstone(tombstonedRoom({ replacement_room: "!newer:test" }) as never)).toEqual({
      replacementRoomId: "!newer:test",
      body: "",
    });
  });

  it("returns null when the content has no replacement_room (e.g. redacted)", () => {
    expect(getRoomTombstone(tombstonedRoom({ body: "gone" }) as never)).toBeNull();
  });

  it("treats an empty-string replacement_room as no tombstone (characterization)", () => {
    // The presence check is a plain truthiness test, so a (never sent by
    // servers, but technically possible) empty replacement_room reads as
    // "not tombstoned".
    expect(getRoomTombstone(tombstonedRoom({ replacement_room: "" }) as never)).toBeNull();
  });
});

describe("isRoomTombstoned", () => {
  it("is false for a live room", () => {
    expect(isRoomTombstoned(new FakeRoom() as never)).toBe(false);
  });

  it("is true once a tombstone with a replacement_room exists", () => {
    expect(
      isRoomTombstoned(tombstonedRoom({ replacement_room: "!newer:test" }) as never),
    ).toBe(true);
  });

  it("is false for a tombstone-shaped event without a replacement_room", () => {
    expect(isRoomTombstoned(tombstonedRoom({}) as never)).toBe(false);
  });
});

describe("canUpgradeRoom", () => {
  it("denies a default-powered user (m.room.tombstone state defaults to PL 50)", () => {
    expect(canUpgradeRoom(new FakeRoom() as never, "@me:test")).toBe(false);
  });

  it("allows a user listed at the state_default threshold", () => {
    const room = new FakeRoom({
      state: { "m.room.power_levels|": { users: { "@me:test": 50 } } },
    });
    expect(canUpgradeRoom(room as never, "@me:test")).toBe(true);
  });

  it("allows anyone when state_default is lowered to 0", () => {
    const room = new FakeRoom({
      state: { "m.room.power_levels|": { state_default: 0 } },
    });
    expect(canUpgradeRoom(room as never, "@me:test")).toBe(true);
  });

  it("honours a per-event power level override for m.room.tombstone", () => {
    const room = new FakeRoom({
      state: { "m.room.power_levels|": { events: { "m.room.tombstone": 100 } } },
    });
    expect(canUpgradeRoom(room as never, "@me:test")).toBe(false);
  });

  it("denies even a high-powered admin once the room is tombstoned", () => {
    // Upgrading is irreversible; a tombstoned room is a read-only archive, so
    // the tombstone check wins over any amount of power.
    const room = new FakeRoom({
      state: {
        "m.room.power_levels|": { users: { "@me:test": 100 } },
        "m.room.tombstone|": { replacement_room: "!newer:test" },
      },
    });
    expect(canUpgradeRoom(room as never, "@me:test")).toBe(false);
  });
});

describe("getRecommendedRoomVersion", () => {
  it("reads m.room_versions.default from the server capabilities", async () => {
    const client = new UpgradeClient(undefined, {
      "m.room_versions": { default: "10", available: { "9": "stable" } },
    });
    await expect(getRecommendedRoomVersion(client as never)).resolves.toBe("10");
  });

  it("returns null when capabilities omit m.room_versions", async () => {
    const client = new UpgradeClient(undefined, { "m.change_password": { enabled: false } });
    await expect(getRecommendedRoomVersion(client as never)).resolves.toBeNull();
  });

  it("returns null when m.room_versions advertises available versions but no default", async () => {
    const client = new UpgradeClient(undefined, { "m.room_versions": { available: { "9": "stable" } } });
    await expect(getRecommendedRoomVersion(client as never)).resolves.toBeNull();
  });

  it("returns null when getCapabilities rejects", async () => {
    const client = new UpgradeClient(undefined, null);
    await expect(getRecommendedRoomVersion(client as never)).resolves.toBeNull();
  });
});

describe("getAvailableRoomVersions", () => {
  it("lists stable versions first, numeric-descending, then unstable ones", async () => {
    // "10" before "2" proves the sort is numeric, not lexicographic.
    const client = new UpgradeClient(undefined, {
      "m.room_versions": {
        available: { "1": "stable", "2": "stable", "10": "stable", "9": "unstable", "8": "unstable" },
      },
    });
    await expect(getAvailableRoomVersions(client as never)).resolves.toEqual([
      { version: "10", stable: true },
      { version: "2", stable: true },
      { version: "1", stable: true },
      { version: "9", stable: false },
      { version: "8", stable: false },
    ]);
  });

  it("sorts non-numeric unstable versions in descending lexicographic order", async () => {
    const client = new UpgradeClient(undefined, {
      "m.room_versions": {
        available: { "org.example.alpha": "unstable", "org.example.zeta": "unstable" },
      },
    });
    await expect(getAvailableRoomVersions(client as never)).resolves.toEqual([
      { version: "org.example.zeta", stable: false },
      { version: "org.example.alpha", stable: false },
    ]);
  });

  it.skip("orders a numeric against a non-numeric version within a group (flaky: locale-dependent)", async () => {
    // When only one side of the comparison parses as a number, the comparator
    // falls back to `b.version.localeCompare(a.version)`, whose ordering of
    // digits vs. letters depends on the runtime's default collation (full-icu
    // vs small-icu disagree), so no cross-environment-stable assertion exists.
    const client = new UpgradeClient(undefined, {
      "m.room_versions": { available: { "9": "unstable", "org.example.msc": "unstable" } },
    });
    const versions = await getAvailableRoomVersions(client as never);
    expect(versions).toHaveLength(2);
  });

  it("treats any stability string other than exactly \"stable\" as unstable (characterization)", async () => {
    const client = new UpgradeClient(undefined, {
      "m.room_versions": { available: { "4": "stable", "5": "Stable", "6": "unstable" } },
    });
    const versions = await getAvailableRoomVersions(client as never);
    expect(versions.map((v) => [v.version, v.stable])).toEqual([
      ["4", true],
      ["6", false],
      ["5", false],
    ]);
  });

  it("returns [] when capabilities omit m.room_versions", async () => {
    const client = new UpgradeClient(undefined, {});
    await expect(getAvailableRoomVersions(client as never)).resolves.toEqual([]);
  });

  it("returns [] when getCapabilities rejects", async () => {
    const client = new UpgradeClient(undefined, null);
    await expect(getAvailableRoomVersions(client as never)).resolves.toEqual([]);
  });
});

describe("upgradeRoom", () => {
  /** Client whose old room `!old:test` has the given members; caller is @admin:test. */
  function upgradedClient(members: FakeMember[]): UpgradeClient {
    const oldRoom = new FakeRoom({ roomId: "!old:test", members });
    return new UpgradeClient({ userId: "@admin:test", rooms: [oldRoom] });
  }

  it("calls the SDK upgrade with the requested version and returns the replacement room id", async () => {
    const client = upgradedClient([{ userId: "@admin:test", membership: "join" }]);
    await expect(upgradeRoom(client as never, "!old:test", "10")).resolves.toBe("!newer:test");
    expect(client.upgradeCalls).toEqual([{ roomId: "!old:test", newVersion: "10" }]);
  });

  it("re-invites every joined member except the caller, into the replacement room", async () => {
    const client = upgradedClient([
      { userId: "@admin:test", membership: "join" },
      { userId: "@alice:test", membership: "join" },
      { userId: "@bob:test", membership: "join" },
    ]);
    await upgradeRoom(client as never, "!old:test", "10");
    expect(client.inviteCalls).toEqual([
      { roomId: "!newer:test", userId: "@alice:test" },
      { roomId: "!newer:test", userId: "@bob:test" },
    ]);
  });

  it("does not invite members who are not currently joined", async () => {
    const client = upgradedClient([
      { userId: "@admin:test", membership: "join" },
      { userId: "@left:test", membership: "leave" },
      { userId: "@banned:test", membership: "ban" },
      { userId: "@knocking:test", membership: "knock" },
      { userId: "@invited:test", membership: "invite" },
    ]);
    await upgradeRoom(client as never, "!old:test", "10");
    expect(client.inviteCalls).toEqual([]);
  });

  it("swallows a failing invite and still invites the rest (best-effort fan-out)", async () => {
    const client = upgradedClient([
      { userId: "@admin:test", membership: "join" },
      { userId: "@alice:test", membership: "join" },
      { userId: "@bob:test", membership: "join" },
    ]);
    client.failingInvites.add("@alice:test");
    // The upgrade already happened, so a rejected invite must not propagate.
    await expect(upgradeRoom(client as never, "!old:test", "10")).resolves.toBe("!newer:test");
    expect(client.inviteCalls.map((c) => c.userId)).toEqual(["@alice:test", "@bob:test"]);
  });

  it("skips the invite step entirely when the old room is unknown to the client", async () => {
    const client = new UpgradeClient({ userId: "@admin:test" });
    await expect(upgradeRoom(client as never, "!gone:test", "10")).resolves.toBe("!newer:test");
    expect(client.upgradeCalls).toEqual([{ roomId: "!gone:test", newVersion: "10" }]);
    expect(client.inviteCalls).toEqual([]);
  });

  it("invites nobody when the caller is the only joined member", async () => {
    const client = upgradedClient([{ userId: "@admin:test", membership: "join" }]);
    await upgradeRoom(client as never, "!old:test", "10");
    expect(client.inviteCalls).toEqual([]);
  });
});
