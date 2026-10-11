// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetPresence } from "@jorkonvo/matrix-core";
import { setAutoAwayEnabled, wireIdlePresence } from "../../../apps/web/src/lib/idlePresence.js";

/** Toggles jsdom's document.hidden and fires the real event the app listens for. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

function fakeClient() {
  return { setSyncPresence: vi.fn().mockResolvedValue(undefined) };
}

beforeEach(() => {
  localStorage.clear();
  setAutoAwayEnabled(true);
  setHidden(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wireIdlePresence - background/foreground (2026-09-16, 'not in the app but not logged out')", () => {
  it("flips to Unavailable immediately when the app is backgrounded, without waiting for the idle timer", async () => {
    const client = fakeClient();
    const stop = wireIdlePresence(client as never);

    setHidden(true);
    await Promise.resolve();

    expect(client.setSyncPresence).toHaveBeenCalledWith(SetPresence.Unavailable);
    stop();
  });

  it("flips back to Online as soon as the app returns to the foreground", async () => {
    const client = fakeClient();
    const stop = wireIdlePresence(client as never);

    setHidden(true);
    await Promise.resolve();
    client.setSyncPresence.mockClear();

    setHidden(false);
    await Promise.resolve();

    expect(client.setSyncPresence).toHaveBeenCalledWith(SetPresence.Online);
    stop();
  });

  it("does nothing on backgrounding when auto-away is disabled", async () => {
    setAutoAwayEnabled(false);
    const client = fakeClient();
    const stop = wireIdlePresence(client as never);

    setHidden(true);
    await Promise.resolve();

    expect(client.setSyncPresence).not.toHaveBeenCalled();
    stop();
  });

  it("does not send a redundant Unavailable if already idle from the input timer", async () => {
    const client = fakeClient();
    const stop = wireIdlePresence(client as never);

    setHidden(true);
    await Promise.resolve();
    client.setSyncPresence.mockClear();

    // A second hide event (e.g. a stray visibilitychange) while already idle.
    setHidden(true);
    await Promise.resolve();

    expect(client.setSyncPresence).not.toHaveBeenCalled();
    stop();
  });
});
