import { describe, expect, it } from "vitest";
import {
  canSetRoomAlias,
  createSpace,
  getInvitedRooms,
  joinEligibleSpaceHierarchyRooms,
  joinHierarchyRoom,
  joinRoomByIdOrAlias,
  joinRoomFromInviteLink,
} from "../../../packages/matrix-core/src/room-admin.js";
import { FakeClient, FakeRoom } from "../../helpers/fakes.js";

/** Records createRoom calls - the base fake has no write path for room creation. */
class CreatingClient extends FakeClient {
  createRoomCalls: { opts: Record<string, unknown> }[] = [];

  createRoom(opts: Record<string, unknown>): Promise<{ room_id: string }> {
    this.createRoomCalls.push({ opts });
    return Promise.resolve({ room_id: "!new:test" });
  }
}

/**
 * FakeClient plus a recording `joinRoom` - the permalink helpers are the one
 * place room-admin writes through a method the base fake doesn't have.
 * `parseMatrixToLink` itself is module-private, so it is exercised through
 * joinRoomByIdOrAlias's client calls.
 */
class JoiningClient extends FakeClient {
  joinCalls: { target: string; opts?: unknown }[] = [];

  joinRoom(target: string, opts?: unknown): Promise<unknown> {
    this.joinCalls.push({ target, opts });
    return Promise.resolve({ roomId: target }) as never;
  }
}

describe("joinRoomByIdOrAlias (pasted matrix.to link parsing)", () => {
  it("parses an alias link into the decoded alias and an empty via list", async () => {
    const client = new JoiningClient();
    await joinRoomByIdOrAlias(client as never, "https://matrix.to/#/%23general%3Atest");
    expect(client.joinCalls).toEqual([{ target: "#general:test", opts: { viaServers: [] } }]);
  });

  it("parses a room-id link and forwards its via servers", async () => {
    const client = new JoiningClient();
    await joinRoomByIdOrAlias(client as never, "https://matrix.to/#/!abc%3Aother?via=test&via=creator");
    expect(client.joinCalls).toEqual([
      { target: "!abc:other", opts: { viaServers: ["test", "creator"] } },
    ]);
  });

  it("collects multiple via params in order and ignores other query keys", async () => {
    const client = new JoiningClient();
    await joinRoomByIdOrAlias(client as never, "https://matrix.to/#/!abc%3Aother?via=a&foo=bar&via=b");
    expect(client.joinCalls[0]!.opts).toEqual({ viaServers: ["a", "b"] });
  });

  it("decodes percent-encoded characters in the target", async () => {
    const client = new JoiningClient();
    await joinRoomByIdOrAlias(client as never, "https://matrix.to/#/%23foo%20bar%3At");
    expect(client.joinCalls[0]!.target).toBe("#foo bar:t");
  });

  it("trims surrounding whitespace before matching", async () => {
    const client = new JoiningClient();
    await joinRoomByIdOrAlias(client as never, "  https://matrix.to/#/%23g%3At?via=t  ");
    expect(client.joinCalls).toEqual([{ target: "#g:t", opts: { viaServers: ["t"] } }]);
  });

  it("passes a bare alias/id through unmodified and without via servers", async () => {
    const client = new JoiningClient();
    await joinRoomByIdOrAlias(client as never, "#general:test");
    expect(client.joinCalls).toEqual([{ target: "#general:test", opts: undefined }]);
  });

  it("trims a bare id too (input is pasted, so stray spaces happen)", async () => {
    const client = new JoiningClient();
    await joinRoomByIdOrAlias(client as never, "  !abc:test  ");
    expect(client.joinCalls).toEqual([{ target: "!abc:test", opts: undefined }]);
  });

  it("does not parse the matrix: URI scheme - it falls through verbatim", async () => {
    // Characterization: only http(s) matrix.to links are recognized, so a
    // matrix: URI is handed to joinRoom untouched, query string included.
    const client = new JoiningClient();
    await joinRoomByIdOrAlias(client as never, "matrix:roomid/abc%3Ahs?via=hs");
    expect(client.joinCalls).toEqual([{ target: "matrix:roomid/abc%3Ahs?via=hs", opts: undefined }]);
  });

  it("treats a matrix.to link with an empty target as a non-link", async () => {
    const client = new JoiningClient();
    await joinRoomByIdOrAlias(client as never, "https://matrix.to/#/");
    expect(client.joinCalls).toEqual([{ target: "https://matrix.to/#/", opts: undefined }]);
  });
});

describe("joinHierarchyRoom", () => {
  it("joins the room id with the hierarchy's via servers", async () => {
    const client = new JoiningClient();
    await joinHierarchyRoom(client as never, "!abc:other", ["hs1", "hs2"]);
    expect(client.joinCalls).toEqual([{ target: "!abc:other", opts: { viaServers: ["hs1", "hs2"] } }]);
  });
});

/**
 * Simulates the exact failure this app's `restricted` join_rule causes for
 * a non-space-member (real bug hit live 2026-09-16): the FIRST join
 * attempt on a given target fails M_FORBIDDEN, as if that target requires
 * space membership the caller doesn't have yet; every subsequent attempt
 * (the retry after joining the space) succeeds.
 */
class LinkJoiningClient extends JoiningClient {
  private forbiddenOnce: Set<string>;
  hierarchyRooms: {
    room_id: string;
    room_type?: string;
    num_joined_members: number;
    children_state: { state_key?: string; content?: { via?: string[] } }[];
  }[] = [];

  constructor(forbiddenOnce: string[] = [], rooms: FakeRoom[] = []) {
    super({ rooms });
    this.forbiddenOnce = new Set(forbiddenOnce);
  }

  joinRoom(target: string, opts?: unknown): Promise<unknown> {
    this.joinCalls.push({ target, opts });
    if (this.forbiddenOnce.has(target)) {
      this.forbiddenOnce.delete(target);
      const err = new Error("Forbidden") as Error & { errcode?: string };
      err.errcode = "M_FORBIDDEN";
      return Promise.reject(err);
    }
    return Promise.resolve({ roomId: target }) as never;
  }

  getRoomHierarchy(): Promise<{ rooms: typeof this.hierarchyRooms; next_batch?: string }> {
    return Promise.resolve({ rooms: this.hierarchyRooms });
  }
}

describe("joinRoomFromInviteLink (2026-09-16 fix - restricted-room links need the space joined first)", () => {
  it("joins the target room directly when that already works (already a space member, or an open room)", async () => {
    const client = new LinkJoiningClient();
    const result = await joinRoomFromInviteLink(client as never, { target: "!chan:test", viaServers: ["test"] });
    expect(client.joinCalls).toEqual([{ target: "!chan:test", opts: { viaServers: ["test"] } }]);
    expect(result).toEqual({ room: { roomId: "!chan:test" }, joinedSpace: false, autoJoinedRoomIds: [] });
  });

  it("joins the owning space first and retries the room when the direct join is forbidden", async () => {
    const client = new LinkJoiningClient(["!chan:test"]);
    const result = await joinRoomFromInviteLink(client as never, {
      target: "!chan:test",
      viaServers: ["test"],
      spaceId: "!space:test",
    });
    expect(client.joinCalls.map((c) => c.target)).toEqual(["!chan:test", "!space:test", "!chan:test"]);
    expect(result.joinedSpace).toBe(true);
    expect(result.room).toEqual({ roomId: "!chan:test" });
  });

  it("auto-joins other rooms the space's hierarchy exposes as a courtesy, skipping ones already joined or still ineligible", async () => {
    const client = new LinkJoiningClient(["!chan:test", "!sibling-a:test"]);
    // !sibling-a fails once too (simulating "still ineligible", e.g.
    // knock-only) - joinRoomFromInviteLink only retries the ORIGINAL
    // target after the space join, so this sibling's single failure is
    // final for this call, and it should be silently skipped rather than
    // failing the overall result.
    client.hierarchyRooms = [
      { room_id: "!chan:test", num_joined_members: 2, children_state: [] }, // the target itself - excluded
      { room_id: "!sibling-a:test", num_joined_members: 1, children_state: [] },
      { room_id: "!sibling-b:test", num_joined_members: 1, children_state: [] },
      { room_id: "!space:test", room_type: "m.space", num_joined_members: 3, children_state: [] }, // a nested space - excluded
    ];
    const result = await joinRoomFromInviteLink(client as never, {
      target: "!chan:test",
      viaServers: [],
      spaceId: "!space:test",
    });
    expect(result.joinedSpace).toBe(true);
    expect(result.autoJoinedRoomIds).toEqual(["!sibling-b:test"]);
  });

  it("does not attempt a space join/hierarchy scan when there's no space hint - the original M_FORBIDDEN propagates", async () => {
    const client = new LinkJoiningClient(["!chan:test"]);
    await expect(
      joinRoomFromInviteLink(client as never, { target: "!chan:test", viaServers: [] }),
    ).rejects.toMatchObject({ errcode: "M_FORBIDDEN" });
    expect(client.joinCalls).toEqual([{ target: "!chan:test", opts: { viaServers: [] } }]);
  });

  it("skips re-joining the space if already a member (checked via client.getRoom)", async () => {
    const space = new FakeRoom({ roomId: "!space:test" });
    const client = new LinkJoiningClient(["!chan:test"], [space]);
    const result = await joinRoomFromInviteLink(client as never, {
      target: "!chan:test",
      viaServers: [],
      spaceId: "!space:test",
    });
    // Only the room target appears in joinRoom calls - the space itself was never (re-)joined.
    expect(client.joinCalls.map((c) => c.target)).toEqual(["!chan:test", "!chan:test"]);
    expect(result.joinedSpace).toBe(true);
  });
});

describe("joinEligibleSpaceHierarchyRooms (2026-09-16 fix - extracted for the reactive space-child watcher)", () => {
  it("joins every hierarchy room not already joined, excluding the space itself and any excluded room", async () => {
    const client = new LinkJoiningClient();
    client.hierarchyRooms = [
      { room_id: "!space:test", room_type: "m.space", num_joined_members: 3, children_state: [] },
      { room_id: "!a:test", num_joined_members: 1, children_state: [] },
      { room_id: "!b:test", num_joined_members: 1, children_state: [] },
    ];
    const joined = await joinEligibleSpaceHierarchyRooms(client as never, "!space:test", "!b:test");
    expect(joined.sort()).toEqual(["!a:test"]);
    expect(client.joinCalls.map((c) => c.target).sort()).toEqual(["!a:test"]);
  });

  it("returns an empty list (not throw) when every candidate is ineligible", async () => {
    const client = new LinkJoiningClient(["!a:test"]);
    client.hierarchyRooms = [{ room_id: "!a:test", num_joined_members: 1, children_state: [] }];
    const joined = await joinEligibleSpaceHierarchyRooms(client as never, "!space:test");
    expect(joined).toEqual([]);
  });

  it("returns an empty list (not throw) when the hierarchy fetch itself fails", async () => {
    class ThrowingHierarchyClient extends LinkJoiningClient {
      getRoomHierarchy(): Promise<never> {
        return Promise.reject(new Error("M_FORBIDDEN"));
      }
    }
    const client = new ThrowingHierarchyClient();
    await expect(joinEligibleSpaceHierarchyRooms(client as never, "!space:test")).resolves.toEqual([]);
  });

  it("skips a room already joined locally without attempting to re-join it", async () => {
    const already = new FakeRoom({ roomId: "!already:test" });
    const client = new LinkJoiningClient([], [already]);
    client.hierarchyRooms = [{ room_id: "!already:test", num_joined_members: 2, children_state: [] }];
    const joined = await joinEligibleSpaceHierarchyRooms(client as never, "!space:test");
    expect(joined).toEqual([]);
    expect(client.joinCalls).toEqual([]);
  });
});

describe("createSpace (2026-09-16 fix - a space must be joinable by link by default, or every invite link is a dead end)", () => {
  it("defaults to an open (public) join_rule - no approval needed to join via link/id", async () => {
    const client = new CreatingClient();
    await createSpace(client as never, { name: "My Server" });
    const initialState = client.createRoomCalls[0]!.opts.initial_state as { type: string; content: unknown }[];
    expect(initialState).toContainEqual({
      type: "m.room.join_rules",
      state_key: "",
      content: { join_rule: "public" },
    });
  });

  it("uses a knock (approval-required) join_rule when requireApprovalToJoin is set", async () => {
    const client = new CreatingClient();
    await createSpace(client as never, { name: "Screened Server", requireApprovalToJoin: true });
    const initialState = client.createRoomCalls[0]!.opts.initial_state as { type: string; content: unknown }[];
    expect(initialState).toContainEqual({
      type: "m.room.join_rules",
      state_key: "",
      content: { join_rule: "knock" },
    });
  });

  it("still carries the allow_room_knocking channel-level setting alongside the space's own open join_rule", async () => {
    const client = new CreatingClient();
    await createSpace(client as never, { name: "S", allowRoomKnocking: true });
    const initialState = client.createRoomCalls[0]!.opts.initial_state as { type: string; content: unknown }[];
    expect(initialState).toContainEqual({
      type: "m.room.join_rules",
      state_key: "",
      content: { join_rule: "public" },
    });
    expect(initialState).toContainEqual({
      type: "io.jorkonvo.space_settings",
      state_key: "",
      content: { allow_room_knocking: true },
    });
  });
});

describe("canSetRoomAlias", () => {
  it("denies a default-powered user (canonical alias state defaults to PL 50)", () => {
    const room = new FakeRoom();
    expect(canSetRoomAlias(room as never, "@me:test")).toBe(false);
  });

  it("allows a user at the state_default threshold", () => {
    const room = new FakeRoom({
      state: { "m.room.power_levels|": { users: { "@me:test": 50 } } },
    });
    expect(canSetRoomAlias(room as never, "@me:test")).toBe(true);
  });

  it("honours a per-event power level override", () => {
    const room = new FakeRoom({
      state: {
        "m.room.power_levels|": { events: { "m.room.canonical_alias": 0 } },
      },
    });
    expect(canSetRoomAlias(room as never, "@me:test")).toBe(true);
  });
});

describe("getInvitedRooms", () => {
  it("returns only rooms where my membership is invite", () => {
    const invited = new FakeRoom({ roomId: "!invited:test" });
    invited.getMyMembership = () => "invite";
    const joined = new FakeRoom({ roomId: "!joined:test" });
    const client = new FakeClient({ rooms: [invited, joined] });
    expect(getInvitedRooms(client as never).map((r) => r.roomId)).toEqual(["!invited:test"]);
  });

  it("returns nothing when every room is joined", () => {
    const client = new FakeClient({ rooms: [new FakeRoom()] });
    expect(getInvitedRooms(client as never)).toEqual([]);
  });
});
