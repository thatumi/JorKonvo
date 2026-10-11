import { describe, expect, it } from "vitest";
import {
  canSetSlowmode,
  getSlowmodeSeconds,
  isSlowmodeExempt,
  setSlowmodeSeconds,
  SLOWMODE_EVENT,
} from "../../../packages/matrix-core/src/slowmode.js";
import { FakeClient, FakeRoom } from "../../helpers/fakes.js";

describe("getSlowmodeSeconds", () => {
  it("is 0 when unset", () => {
    expect(getSlowmodeSeconds(new FakeRoom())).toBe(0);
  });
  it("reads a positive configured interval", () => {
    const room = new FakeRoom({ state: { [`${SLOWMODE_EVENT}|`]: { seconds: 30 } } });
    expect(getSlowmodeSeconds(room)).toBe(30);
  });
  it("treats a non-number or non-positive value as off", () => {
    expect(getSlowmodeSeconds(new FakeRoom({ state: { [`${SLOWMODE_EVENT}|`]: { seconds: 0 } } }))).toBe(0);
    expect(getSlowmodeSeconds(new FakeRoom({ state: { [`${SLOWMODE_EVENT}|`]: { seconds: "x" } } }))).toBe(0);
    expect(getSlowmodeSeconds(new FakeRoom({ state: { [`${SLOWMODE_EVENT}|`]: { seconds: -5 } } }))).toBe(0);
  });
});

describe("slowmode permission / exemption", () => {
  const state = { "m.room.power_levels|": { users: { "@mod:test": 50, "@user:test": 0 }, state_default: 50 } };

  it("only a member who can set state can configure or is exempt from slowmode", () => {
    const room = new FakeRoom({ state });
    expect(canSetSlowmode(room, "@mod:test")).toBe(true);
    expect(canSetSlowmode(room, "@user:test")).toBe(false);
    expect(isSlowmodeExempt(room, "@mod:test")).toBe(true);
    expect(isSlowmodeExempt(room, "@user:test")).toBe(false);
  });
});

describe("setSlowmodeSeconds", () => {
  it("writes the io.jorkonvo.slowmode state event", async () => {
    const client = new FakeClient();
    await setSlowmodeSeconds(client as never, "!r:test", 10);
    expect(client.sentStateEvents[0]).toEqual({
      roomId: "!r:test",
      type: SLOWMODE_EVENT,
      content: { seconds: 10 },
      stateKey: "",
    });
  });
});
