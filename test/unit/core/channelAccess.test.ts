import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchChannelAccess } from "../../../packages/matrix-core/src/channelAccess.js";
import { FakeClient, FakeRoom } from "../../helpers/fakes.js";

/** Fake state/member event: only the getters channelAccess.ts's onState/onMembership actually read. */
function fakeStateEvent(type: string, roomId: string, content: Record<string, unknown>) {
  return { getType: () => type, getRoomId: () => roomId, getContent: () => content } as never;
}

/**
 * FakeClient plus a minimal synchronous EventEmitter (on/removeListener/emit)
 * and a scriptable getRoomHierarchy - the two pieces watchChannelAccess needs
 * beyond the base fake: it listens for RoomStateEvent.Events/RoomMemberEvent.Membership,
 * and its new reconciliation path (2026-09-16 fix) calls getSpaceHierarchy -> getRoomHierarchy.
 */
class WatchingClient extends FakeClient {
  private listeners = new Map<string, Set<(...args: never[]) => void>>();
  joinCalls: string[] = [];
  hierarchyRooms: {
    room_id: string;
    room_type?: string;
    num_joined_members: number;
    children_state: { state_key?: string; content?: { via?: string[] } }[];
  }[] = [];

  on(event: string, listener: (...args: never[]) => void): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  removeListener(event: string, listener: (...args: never[]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: never[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  joinRoom(target: string): Promise<unknown> {
    this.joinCalls.push(target);
    return Promise.resolve({ roomId: target });
  }

  getRoomHierarchy(): Promise<{ rooms: typeof this.hierarchyRooms; next_batch?: string }> {
    return Promise.resolve({ rooms: this.hierarchyRooms });
  }
}

describe("watchChannelAccess - courtesy auto-join of new space channels (2026-09-16 fix)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("joins a channel added to an already-joined space via a fresh m.space.child event", async () => {
    const space = new FakeRoom({ roomId: "!space:test", isSpace: true });
    const client = new WatchingClient({ rooms: [space] });
    client.hierarchyRooms = [
      { room_id: "!space:test", room_type: "m.space", num_joined_members: 2, children_state: [] },
      { room_id: "!newchan:test", num_joined_members: 2, children_state: [] },
    ];

    const stop = watchChannelAccess(client as never);
    await vi.advanceTimersByTimeAsync(2000); // the boot-time reconcile sweep - nothing new yet
    client.joinCalls = [];

    client.emit(
      "RoomState.events",
      fakeStateEvent("m.space.child", "!space:test", { via: ["test"] }),
    );
    await vi.advanceTimersByTimeAsync(2000);

    expect(client.joinCalls).toContain("!newchan:test");
    stop();
  });

  it("does not react to a space the client has not joined", async () => {
    const space = new FakeRoom({ roomId: "!other:test", isSpace: true });
    // getMyMembership() on FakeRoom always returns "join" - simulate "not joined" via no room in the client at all.
    const client = new WatchingClient({ rooms: [] });
    client.hierarchyRooms = [{ room_id: "!leak:test", num_joined_members: 1, children_state: [] }];

    const stop = watchChannelAccess(client as never);
    await vi.advanceTimersByTimeAsync(2000);
    client.joinCalls = [];

    client.emit("RoomState.events", fakeStateEvent("m.space.child", "!other:test", { via: ["test"] }));
    await vi.advanceTimersByTimeAsync(2000);

    expect(client.joinCalls).not.toContain("!leak:test");
    void space;
    stop();
  });

  it("ignores an m.space.child removal (empty content)", async () => {
    const space = new FakeRoom({ roomId: "!space:test", isSpace: true });
    const client = new WatchingClient({ rooms: [space] });
    client.hierarchyRooms = [{ room_id: "!gone:test", num_joined_members: 1, children_state: [] }];

    const stop = watchChannelAccess(client as never);
    await vi.advanceTimersByTimeAsync(2000);
    client.joinCalls = [];

    client.emit("RoomState.events", fakeStateEvent("m.space.child", "!space:test", {}));
    await vi.advanceTimersByTimeAsync(2000);

    expect(client.joinCalls).toEqual([]);
    stop();
  });

  it("reconciles every already-joined space once at startup, to heal a channel created while offline", async () => {
    const space = new FakeRoom({ roomId: "!space:test", isSpace: true });
    const client = new WatchingClient({ rooms: [space] });
    client.hierarchyRooms = [{ room_id: "!missed:test", num_joined_members: 3, children_state: [] }];

    const stop = watchChannelAccess(client as never);
    await vi.advanceTimersByTimeAsync(2000);

    expect(client.joinCalls).toContain("!missed:test");
    stop();
  });

  it("skips a hierarchy room the client has already joined", async () => {
    const space = new FakeRoom({ roomId: "!space:test", isSpace: true });
    const already = new FakeRoom({ roomId: "!already:test" });
    const client = new WatchingClient({ rooms: [space, already] });
    client.hierarchyRooms = [{ room_id: "!already:test", num_joined_members: 2, children_state: [] }];

    const stop = watchChannelAccess(client as never);
    await vi.advanceTimersByTimeAsync(2000);

    expect(client.joinCalls).not.toContain("!already:test");
    stop();
  });
});
