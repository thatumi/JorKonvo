import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
  clearTimedMute,
  clearTimedMuteEntry,
  getMutedUntil,
  setTimedMute,
  TIMED_MUTE_PRESETS,
  watchTimedMutes,
} from "../../../packages/matrix-core/src/timedMute.js";
import { FakeClient } from "../../helpers/fakes.js";

/**
 * The account-data type `io.jorkonvo.timed_mutes` is module-private in
 * timedMute.ts, so the wire format is spelled out here: content is
 * `{ mutedUntil: { "<roomId>": <epoch ms> } }`.
 */
const KEY = "io.jorkonvo.timed_mutes";
/** The watcher's internal tick interval (CHECK_INTERVAL_MS, unexported). */
const CHECK_INTERVAL_MS = 15_000;
const NOW = Date.parse("2026-09-09T12:00:00Z");

/**
 * FakeClient plus exactly the three account/push-rule methods timedMute.ts
 * touches. `setAccountData` writes through to a local store so a
 * setTimedMute -> getMutedUntil round trip works against the same fake.
 */
interface TimedMuteClient extends FakeClient {
  getAccountData: (eventType: string) => { getContent: () => Record<string, unknown> } | undefined;
  setAccountData: Mock;
  setRoomMutePushRule: Mock;
}

function mkClient(accountData: Record<string, Record<string, unknown>> = {}): TimedMuteClient {
  const store = new Map(Object.entries(accountData));
  return Object.assign(new FakeClient(), {
    getAccountData: (eventType: string) => {
      const content = store.get(eventType);
      return content === undefined ? undefined : { getContent: () => content };
    },
    setAccountData: vi.fn(async (eventType: string, content: unknown) => {
      store.set(eventType, content as Record<string, unknown>);
    }),
    setRoomMutePushRule: vi.fn().mockResolvedValue(undefined),
  }) as TimedMuteClient;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("getMutedUntil", () => {
  it("is null when the account-data event is missing entirely", () => {
    expect(getMutedUntil(mkClient() as never, "!r:test")).toBeNull();
  });
  it("is null when the content has no mutedUntil map", () => {
    const client = mkClient({ [KEY]: {} });
    expect(getMutedUntil(client as never, "!r:test")).toBeNull();
  });
  it("is null for a room the map does not mention", () => {
    const client = mkClient({ [KEY]: { mutedUntil: { "!other:test": NOW + 1000 } } });
    expect(getMutedUntil(client as never, "!r:test")).toBeNull();
  });
  it("reads the stored expiry timestamp for the room", () => {
    const client = mkClient({ [KEY]: { mutedUntil: { "!r:test": 1725883200000 } } });
    expect(getMutedUntil(client as never, "!r:test")).toBe(1725883200000);
  });
  it("reads each room's entry independently", () => {
    const client = mkClient({
      [KEY]: { mutedUntil: { "!a:test": NOW + 1000, "!b:test": NOW + 2000 } },
    });
    expect(getMutedUntil(client as never, "!a:test")).toBe(NOW + 1000);
    expect(getMutedUntil(client as never, "!b:test")).toBe(NOW + 2000);
  });

  // Expiry is the CALLER's decision (watchTimedMutes / the UI compare with
  // Date.now()) - getMutedUntil is a raw map lookup, so it keeps returning
  // the stored timestamp after it has lapsed. Characterization, by design.
  it("returns a still-future (active) timestamp as-is", () => {
    const client = mkClient({ [KEY]: { mutedUntil: { "!r:test": NOW + 15 * 60_000 } } });
    expect(getMutedUntil(client as never, "!r:test")).toBe(NOW + 15 * 60_000);
  });
  it("returns an expired timestamp too - it does not filter by now", () => {
    const client = mkClient({ [KEY]: { mutedUntil: { "!r:test": NOW - 1 } } });
    expect(getMutedUntil(client as never, "!r:test")).toBe(NOW - 1);
  });
});

describe("setTimedMute", () => {
  it("mutes the room's push rule and writes the computed muted-until into io.jorkonvo.timed_mutes", async () => {
    const client = mkClient();
    await setTimedMute(client as never, "!r:test", 15 * 60_000);
    expect(client.setRoomMutePushRule).toHaveBeenCalledWith("global", "!r:test", true);
    expect(client.setAccountData).toHaveBeenCalledWith(KEY, {
      mutedUntil: { "!r:test": NOW + 15 * 60_000 },
    });
    // The real mute must land before the timer is recorded.
    expect(client.setRoomMutePushRule.mock.invocationCallOrder[0]).toBeLessThan(
      client.setAccountData.mock.invocationCallOrder[0],
    );
  });
  it("computes muted-until as Date.now() + duration for every preset", async () => {
    for (const preset of TIMED_MUTE_PRESETS) {
      const client = mkClient();
      await setTimedMute(client as never, "!r:test", preset.ms);
      expect(getMutedUntil(client as never, "!r:test")).toBe(NOW + preset.ms);
    }
  });
  it("round-trips: the written map is readable back via getMutedUntil", async () => {
    const client = mkClient();
    await setTimedMute(client as never, "!r:test", 60 * 60_000);
    expect(getMutedUntil(client as never, "!r:test")).toBe(NOW + 60 * 60_000);
  });
  it("preserves other rooms' entries in the mutedUntil map", async () => {
    const client = mkClient({ [KEY]: { mutedUntil: { "!kept:test": 999 } } });
    await setTimedMute(client as never, "!r:test", 60_000);
    expect(client.setAccountData).toHaveBeenCalledWith(KEY, {
      mutedUntil: { "!kept:test": 999, "!r:test": NOW + 60_000 },
    });
  });
  it("overwrites a previous (e.g. expired) timer for the same room", async () => {
    const client = mkClient({ [KEY]: { mutedUntil: { "!r:test": NOW - 5000 } } });
    await setTimedMute(client as never, "!r:test", 8 * 60 * 60_000);
    expect(getMutedUntil(client as never, "!r:test")).toBe(NOW + 8 * 60 * 60_000);
  });
  it("does not write the timer when the push-rule mute fails", async () => {
    const client = mkClient();
    client.setRoomMutePushRule.mockRejectedValueOnce(new Error("M_FORBIDDEN"));
    await expect(setTimedMute(client as never, "!r:test", 60_000)).rejects.toThrow("M_FORBIDDEN");
    expect(client.setAccountData).not.toHaveBeenCalled();
  });
});

describe("clearTimedMuteEntry", () => {
  it("removes only this room's entry and does NOT touch the mute push rule (stays muted indefinitely)", async () => {
    const client = mkClient({ [KEY]: { mutedUntil: { "!r:test": NOW + 1000, "!kept:test": 999 } } });
    await clearTimedMuteEntry(client as never, "!r:test");
    expect(client.setAccountData).toHaveBeenCalledTimes(1);
    expect(client.setAccountData).toHaveBeenCalledWith(KEY, { mutedUntil: { "!kept:test": 999 } });
    expect(client.setRoomMutePushRule).not.toHaveBeenCalled();
  });
  it("is a no-op without a write when the room has no entry", async () => {
    const client = mkClient({ [KEY]: { mutedUntil: { "!other:test": 999 } } });
    await clearTimedMuteEntry(client as never, "!r:test");
    expect(client.setAccountData).not.toHaveBeenCalled();
  });
});

describe("clearTimedMute", () => {
  it("unmutes the room and clears its pending timer", async () => {
    const client = mkClient({ [KEY]: { mutedUntil: { "!r:test": NOW + 1000, "!kept:test": 999 } } });
    await clearTimedMute(client as never, "!r:test");
    expect(client.setRoomMutePushRule).toHaveBeenCalledWith("global", "!r:test", false);
    expect(client.setAccountData).toHaveBeenCalledWith(KEY, { mutedUntil: { "!kept:test": 999 } });
  });
  it("still unmutes when there was no timer entry, with no redundant account-data write", async () => {
    const client = mkClient();
    await clearTimedMute(client as never, "!r:test");
    expect(client.setRoomMutePushRule).toHaveBeenCalledWith("global", "!r:test", false);
    expect(client.setAccountData).not.toHaveBeenCalled();
  });
});

describe("TIMED_MUTE_PRESETS", () => {
  it("offers the Discord-style 15m / 1h / 8h / 24h choices", () => {
    expect(TIMED_MUTE_PRESETS.map((p) => p.ms)).toEqual([
      15 * 60_000,
      60 * 60_000,
      8 * 60 * 60_000,
      24 * 60 * 60_000,
    ]);
    expect(TIMED_MUTE_PRESETS.map((p) => p.label)).toEqual(["15 perc", "1 óra", "8 óra", "24 óra"]);
  });
});

describe("watchTimedMutes", () => {
  it("immediately unmutes rooms that expired while the app was closed and leaves live timers alone", async () => {
    const client = mkClient({
      [KEY]: { mutedUntil: { "!expired:test": NOW - 1, "!live:test": NOW + 60_000 } },
    });
    const stop = watchTimedMutes(client as never);
    await vi.advanceTimersByTimeAsync(0); // flush the initial best-effort tick
    stop();
    expect(client.setRoomMutePushRule).toHaveBeenCalledTimes(1);
    expect(client.setRoomMutePushRule).toHaveBeenCalledWith("global", "!expired:test", false);
    expect(client.setAccountData).toHaveBeenCalledTimes(1);
    expect(client.setAccountData).toHaveBeenCalledWith(KEY, {
      mutedUntil: { "!live:test": NOW + 60_000 },
    });
  });

  it("retries a transiently failed unmute on the next 15s tick", async () => {
    const client = mkClient({ [KEY]: { mutedUntil: { "!r:test": NOW - 1 } } });
    client.setRoomMutePushRule.mockRejectedValueOnce(new Error("hs hiccup"));
    const stop = watchTimedMutes(client as never);
    await vi.advanceTimersByTimeAsync(0);
    // First attempt failed before any bookkeeping could be written.
    expect(client.setRoomMutePushRule).toHaveBeenCalledTimes(1);
    expect(client.setAccountData).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    stop();
    expect(client.setRoomMutePushRule).toHaveBeenCalledTimes(2);
    expect(client.setRoomMutePushRule).toHaveBeenLastCalledWith("global", "!r:test", false);
    expect(client.setAccountData).toHaveBeenCalledTimes(1);
    expect(client.setAccountData).toHaveBeenCalledWith(KEY, { mutedUntil: {} });
  });

  it("stops ticking when the returned disposer is called", async () => {
    const client = mkClient({ [KEY]: { mutedUntil: { "!r:test": NOW - 1 } } });
    client.setRoomMutePushRule.mockRejectedValue(new Error("always fails")); // keeps the entry alive
    const stop = watchTimedMutes(client as never);
    await vi.advanceTimersByTimeAsync(0); // initial tick: 1 failed attempt
    stop();
    await vi.advanceTimersByTimeAsync(4 * CHECK_INTERVAL_MS); // would-be ticks
    expect(client.setRoomMutePushRule).toHaveBeenCalledTimes(1); // no retries after stop
  });
});
