import { describe, expect, it } from "vitest";
import {
  JOIN_RULE_OPTIONS,
  approveKnock,
  canApproveKnocks,
  canSetJoinRule,
  getJoinRule,
  getKnockReason,
  getMyPendingKnocks,
  getPendingKnocks,
  knockRoomByIdOrAlias,
  setJoinRule,
  withdrawKnock,
} from "../../../packages/matrix-core/src/joinRules.js";
import { FakeClient, FakeRoom } from "../../helpers/fakes.js";

/** FakeClient plus recordings for the knock-approval client surface. */
class KnockingClient extends FakeClient {
  knockCalls: { target: string; opts: { reason?: string } }[] = [];
  inviteCalls: { roomId: string; userId: string }[] = [];
  leaveCalls: string[] = [];

  knockRoom(target: string, opts: { reason?: string }): Promise<unknown> {
    this.knockCalls.push({ target, opts });
    return Promise.resolve({});
  }

  invite(roomId: string, userId: string): Promise<unknown> {
    this.inviteCalls.push({ roomId, userId });
    return Promise.resolve({});
  }

  leave(roomId: string): Promise<unknown> {
    this.leaveCalls.push(roomId);
    return Promise.resolve({});
  }
}

function roomWithJoinRule(content: Record<string, unknown>): FakeRoom {
  return new FakeRoom({ state: { "m.room.join_rules|": content } });
}

describe("getJoinRule", () => {
  it("defaults to invite when the room has no m.room.join_rules state", () => {
    expect(getJoinRule(new FakeRoom() as never)).toBe("invite");
  });

  it.each([
    ["public", "public"],
    ["knock", "knock"],
    ["restricted", "restricted"],
    ["knock_restricted", "knock_restricted"],
    ["invite", "invite"],
  ])("reads join_rule %s from state", (raw, expected) => {
    expect(getJoinRule(roomWithJoinRule({ join_rule: raw }) as never)).toBe(expected);
  });

  it("reports restricted (not knock_restricted) even when an allow list is present", () => {
    const room = roomWithJoinRule({
      join_rule: "restricted",
      allow: [{ type: "m.room_membership", room_id: "!space:test" }],
    });
    expect(getJoinRule(room as never)).toBe("restricted");
  });

  it("falls back to invite for an unknown join_rule value", () => {
    expect(getJoinRule(roomWithJoinRule({ join_rule: "totally_made_up" }) as never)).toBe("invite");
  });

  it("offers an option entry for each supported rule value", () => {
    expect(JOIN_RULE_OPTIONS.map((o) => o.value)).toEqual([
      "invite",
      "public",
      "knock",
      "restricted",
      "knock_restricted",
    ]);
  });
});

describe("setJoinRule", () => {
  it.each(["invite", "public", "knock"] as const)(
    "writes a plain join_rule content for %s (no allow key)",
    async (rule) => {
      const client = new FakeClient();
      await setJoinRule(client as never, "!room:test", rule);
      expect(client.sentStateEvents).toEqual([
        { roomId: "!room:test", type: "m.room.join_rules", content: { join_rule: rule }, stateKey: "" },
      ]);
      expect("allow" in client.sentStateEvents[0]!.content).toBe(false);
    },
  );

  it("adds an m.room_membership allow entry for restricted with a space", async () => {
    const client = new FakeClient();
    await setJoinRule(client as never, "!room:test", "restricted", "!space:test");
    expect(client.sentStateEvents).toEqual([
      {
        roomId: "!room:test",
        type: "m.room.join_rules",
        content: {
          join_rule: "restricted",
          allow: [{ type: "m.room_membership", room_id: "!space:test" }],
        },
        stateKey: "",
      },
    ]);
  });

  it("adds the allow entry for knock_restricted too", async () => {
    const client = new FakeClient();
    await setJoinRule(client as never, "!room:test", "knock_restricted", "!space:test");
    expect(client.sentStateEvents[0]!.content).toEqual({
      join_rule: "knock_restricted",
      allow: [{ type: "m.room_membership", room_id: "!space:test" }],
    });
  });

  it("silently omits allow when restricted is set without a space id (characterization)", async () => {
    // The doc comment says allowSpaceId "must" be given for restricted rules,
    // but the current implementation just writes the rule with no allow list
    // rather than throwing.
    const client = new FakeClient();
    await setJoinRule(client as never, "!room:test", "restricted");
    expect(client.sentStateEvents[0]!.content).toEqual({ join_rule: "restricted" });
  });
});

describe("canSetJoinRule", () => {
  it("denies a default-powered user (join_rules state defaults to PL 50)", () => {
    expect(canSetJoinRule(new FakeRoom() as never, "@me:test")).toBe(false);
  });

  it("allows a user listed at the state_default threshold", () => {
    const room = new FakeRoom({
      state: { "m.room.power_levels|": { users: { "@me:test": 50 } } },
    });
    expect(canSetJoinRule(room as never, "@me:test")).toBe(true);
  });

  it("allows anyone when state_default is lowered to 0", () => {
    const room = new FakeRoom({
      state: { "m.room.power_levels|": { state_default: 0 } },
    });
    expect(canSetJoinRule(room as never, "@me:test")).toBe(true);
  });
});

describe("knockRoomByIdOrAlias", () => {
  it("knocks the decoded alias target from a matrix.to link, passing the reason", async () => {
    const client = new KnockingClient();
    await knockRoomByIdOrAlias(client as never, "https://matrix.to/#/%23gated%3Ahs", "pls let me in");
    expect(client.knockCalls).toEqual([
      { target: "#gated:hs", opts: { reason: "pls let me in", viaServers: [] } },
    ]);
  });

  it("forwards via servers from a room-id link (fixed 2026-09-16 - was silently dropped, breaking federation routing for a knock started from a pasted room-id link)", async () => {
    const client = new KnockingClient();
    await knockRoomByIdOrAlias(client as never, "https://matrix.to/#/!abc%3Aother?via=test&via=creator");
    expect(client.knockCalls).toEqual([
      { target: "!abc:other", opts: { reason: undefined, viaServers: ["test", "creator"] } },
    ]);
  });

  it("also recognizes JorKonvo's own jorkonvo.szabotar.dev/join invite links, not just matrix.to (real bug hit live 2026-09-16 - the knock path had its own inline matrix.to-only parser, never updated when the JorKonvo-domain link format was added)", async () => {
    const client = new KnockingClient();
    await knockRoomByIdOrAlias(
      client as never,
      "https://jorkonvo.szabotar.dev/join#/!oqpgEpEHbTzNRBCvss%3Amatrix.szabotar.dev?via=matrix.szabotar.dev",
    );
    expect(client.knockCalls).toEqual([
      { target: "!oqpgEpEHbTzNRBCvss:matrix.szabotar.dev", opts: { reason: undefined, viaServers: ["matrix.szabotar.dev"] } },
    ]);
  });

  it("passes a non-link id/alias straight through, trimmed", async () => {
    const client = new KnockingClient();
    await knockRoomByIdOrAlias(client as never, "  #gated:hs  ", "hi");
    expect(client.knockCalls).toEqual([{ target: "#gated:hs", opts: { reason: "hi" } }]);
  });

  it("sends an undefined reason when none is given", async () => {
    const client = new KnockingClient();
    await knockRoomByIdOrAlias(client as never, "#gated:hs");
    expect(client.knockCalls).toEqual([{ target: "#gated:hs", opts: { reason: undefined } }]);
  });
});

describe("withdrawKnock", () => {
  it("leaves the room to withdraw the knock", async () => {
    const client = new KnockingClient();
    await withdrawKnock(client as never, "!room:test");
    expect(client.leaveCalls).toEqual(["!room:test"]);
  });
});

describe("getMyPendingKnocks", () => {
  it("returns only rooms where my membership is knock", () => {
    const knocking = new FakeRoom({ roomId: "!knocking:test" });
    knocking.getMyMembership = () => "knock";
    const joined = new FakeRoom({ roomId: "!joined:test" });
    const client = new FakeClient({ rooms: [knocking, joined] });
    expect(getMyPendingKnocks(client as never).map((r) => r.roomId)).toEqual(["!knocking:test"]);
  });
});

describe("getPendingKnocks", () => {
  it("lists members whose membership is knock", () => {
    const room = new FakeRoom({
      members: [
        { userId: "@knocker:test", membership: "knock" },
        { userId: "@member:test", membership: "join" },
      ],
    });
    expect(getPendingKnocks(room as never).map((m) => m.userId)).toEqual(["@knocker:test"]);
  });
});

describe("getKnockReason", () => {
  function fakeMember(content: Record<string, unknown> | undefined): never {
    return {
      events: { member: content === undefined ? undefined : { getContent: () => content } },
    } as never;
  }

  it("reads the reason from the member event content", () => {
    expect(getKnockReason(fakeMember({ reason: "friend of the space" }))).toBe("friend of the space");
  });

  it("returns null when the member event has no reason", () => {
    expect(getKnockReason(fakeMember({}))).toBeNull();
  });

  it("returns null when there is no member event at all", () => {
    expect(getKnockReason(fakeMember(undefined))).toBeNull();
  });
});

describe("canApproveKnocks", () => {
  it("allows a default-powered member (invite action defaults to PL 0)", () => {
    const room = new FakeRoom({ members: [{ userId: "@me:test", membership: "join" }] });
    expect(canApproveKnocks(room as never, "@me:test")).toBe(true);
  });

  it("denies a member below a raised invite power level", () => {
    const room = new FakeRoom({
      members: [{ userId: "@me:test", membership: "join", powerLevel: 0 }],
      state: { "m.room.power_levels|": { invite: 50 } },
    });
    expect(canApproveKnocks(room as never, "@me:test")).toBe(false);
  });

  it("allows a member at the raised invite power level", () => {
    const room = new FakeRoom({
      members: [{ userId: "@me:test", membership: "join", powerLevel: 50 }],
      state: { "m.room.power_levels|": { invite: 50 } },
    });
    expect(canApproveKnocks(room as never, "@me:test")).toBe(true);
  });

  it("treats a non-member as PL 0 (characterization: can approve under default PLs)", () => {
    const room = new FakeRoom();
    expect(canApproveKnocks(room as never, "@stranger:test")).toBe(true);
  });
});

describe("approveKnock", () => {
  it("invites the knocking user into the room", async () => {
    const client = new KnockingClient();
    await approveKnock(client as never, "!room:test", "@knocker:test");
    expect(client.inviteCalls).toEqual([{ roomId: "!room:test", userId: "@knocker:test" }]);
  });
});
