import { describe, expect, it, vi } from "vitest";
import { buildDataExport } from "../../../packages/matrix-core/src/dataExport.js";

function fakeClient() {
  const rooms = [
    {
      roomId: "!a:test",
      name: "General",
      getMyMembership: () => "join",
      isSpaceRoom: () => false,
      getDMInviter: () => undefined,
      getMember: () => null,
    },
    {
      roomId: "!s:test",
      name: "My Space",
      getMyMembership: () => "join",
      isSpaceRoom: () => true,
      getDMInviter: () => undefined,
      getMember: () => null,
    },
  ];
  return {
    getUserId: () => "@me:test",
    baseUrl: "https://hs.test",
    getProfileInfo: vi.fn().mockResolvedValue({ displayname: "Me", avatar_url: "mxc://x/y" }),
    getDevices: vi.fn().mockResolvedValue({
      devices: [{ device_id: "D1", display_name: "Firefox", last_seen_ts: 123, last_seen_ip: "1.2.3.4" }],
    }),
    getRooms: () => rooms,
    getAccountData: () => undefined,
    store: {
      accountData: new Map([
        ["m.direct", { getContent: () => ({ "@bob:test": ["!a:test"] }) }],
        ["io.jorkonvo.friends", { getContent: () => ({ ids: ["@bob:test"] }) }],
      ]),
    },
  } as never;
}

describe("buildDataExport", () => {
  it("collects profile, devices, rooms and every synced account-data type", async () => {
    const exp = await buildDataExport(fakeClient());
    expect(exp.userId).toBe("@me:test");
    expect(exp.homeserverUrl).toBe("https://hs.test");
    expect(exp.profile).toEqual({ displayName: "Me", avatarUrl: "mxc://x/y" });
    expect(exp.devices).toEqual([
      { deviceId: "D1", displayName: "Firefox", lastSeenTs: 123, lastSeenIp: "1.2.3.4" },
    ]);
    expect(exp.rooms.map((r) => ({ id: r.roomId, space: r.isSpace }))).toEqual([
      { id: "!a:test", space: false },
      { id: "!s:test", space: true },
    ]);
    expect(Object.keys(exp.accountData).sort()).toEqual(["io.jorkonvo.friends", "m.direct"]);
    expect(exp.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("degrades gracefully when profile / devices calls reject", async () => {
    const client = fakeClient() as unknown as {
      getProfileInfo: ReturnType<typeof vi.fn>;
      getDevices: ReturnType<typeof vi.fn>;
    };
    client.getProfileInfo.mockRejectedValueOnce(new Error("network"));
    client.getDevices.mockRejectedValueOnce(new Error("network"));
    const exp = await buildDataExport(client as never);
    expect(exp.profile).toEqual({ displayName: undefined, avatarUrl: undefined });
    expect(exp.devices).toEqual([]);
  });
});
