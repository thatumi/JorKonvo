import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real-device regression (2026-09-27, iPhone, build 70): livekit-client threw
// "DeviceUnsupportedError: getDisplayMedia not supported" at share time - the
// polyfill wasn't on navigator.mediaDevices when it was needed. These pin the
// install down against the two ways that can happen.

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "ios" },
  registerPlugin: () => ({}),
}));

class FakeMediaDevices {}

let savedNavigator: PropertyDescriptor | undefined;

function setMediaDevices(value: unknown) {
  Object.defineProperty(globalThis, "navigator", {
    value: { mediaDevices: value },
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  vi.resetModules();
  savedNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  (globalThis as { MediaDevices?: unknown }).MediaDevices = FakeMediaDevices;
  delete (FakeMediaDevices.prototype as { getDisplayMedia?: unknown }).getDisplayMedia;
});

afterEach(() => {
  if (savedNavigator) Object.defineProperty(globalThis, "navigator", savedNavigator);
  delete (globalThis as { MediaDevices?: unknown }).MediaDevices;
});

describe("installIosScreenShareBridge", () => {
  it("covers a mediaDevices object that doesn't exist yet at boot", async () => {
    setMediaDevices(undefined);
    const { installIosScreenShareBridge } = await import("../../../apps/web/src/lib/iosScreenShare");
    installIosScreenShareBridge(); // boot: nothing to attach to on the instance
    setMediaDevices(new FakeMediaDevices()); // WKWebView exposes it later
    expect(typeof (navigator.mediaDevices as MediaDevices).getDisplayMedia).toBe("function");
  });

  it("covers the mediaDevices object being swapped after install", async () => {
    setMediaDevices(new FakeMediaDevices());
    const { installIosScreenShareBridge } = await import("../../../apps/web/src/lib/iosScreenShare");
    installIosScreenShareBridge();
    const first = navigator.mediaDevices.getDisplayMedia;
    setMediaDevices(new FakeMediaDevices());
    expect(navigator.mediaDevices.getDisplayMedia).toBe(first);
  });

  it("is idempotent: repeat calls keep the same implementation", async () => {
    setMediaDevices(new FakeMediaDevices());
    const { installIosScreenShareBridge } = await import("../../../apps/web/src/lib/iosScreenShare");
    installIosScreenShareBridge();
    const first = navigator.mediaDevices.getDisplayMedia;
    installIosScreenShareBridge();
    expect(navigator.mediaDevices.getDisplayMedia).toBe(first);
  });
});
