import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * Real screen sharing for the iOS app.
 *
 * iOS's WKWebView has no navigator.mediaDevices.getDisplayMedia either, and
 * iOS gives an app no direct API to start or stop a system screen
 * recording. Apple only lets an app show RPSystemBroadcastPickerView, a
 * system-owned button whose tap opens the mandatory "Start Broadcasting"
 * sheet - ScreenSharePlugin.swift taps it invisibly on the user's behalf
 * (one tap on our own button, like Discord), falling back to showing it on
 * a dimmed backdrop if its internal button can't be found. Once the user
 * confirms the sheet, ReplayKit hands frames to a separate-process
 * broadcast extension (apps/web/ios/App/ScreenShareBroadcast/SampleHandler.swift),
 * never to this app directly. That extension downscales and JPEG-encodes
 * frames into a shared App Group container and wakes ScreenSharePlugin.swift
 * via a Darwin notification (the only cross-process signal available); the
 * plugin reads the frame back out and hands it to us as a "frame" event -
 * we decode it onto an offscreen canvas exactly like androidScreenShare.ts
 * does with its own frame source.
 *
 * Stopping: livekit-client's track.stop() (the call UI's own stop button)
 * reaches ScreenShare.stop(), which asks the extension to end the broadcast
 * itself - the app has no RPBroadcastController of its own to stop. The user
 * can also stop from iOS's red status-bar / Dynamic Island control; the
 * plugin's "state" event reports that as "finished", and we mirror it as
 * the track's 'ended' event, exactly like Android's own external-stop path,
 * so callers don't need to know the two platforms end a share differently.
 * There is no synchronous signal that the user *cancelled* the system sheet
 * instead of confirming it - a timeout waiting for the extension's
 * "started" state stands in for that missing callback.
 */

// Generous: the user has to confirm Apple's own "Start Broadcasting" sheet
// (and, on the visible-picker fallback, first tap the picker itself).
const START_TIMEOUT_MS = 30_000;

interface ScreenSharePluginInterface {
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener(eventName: "frame", listenerFunc: (data: { base64: string }) => void): Promise<PluginListenerHandle>;
  addListener(
    eventName: "state",
    listenerFunc: (data: { state: "started" | "paused" | "resumed" | "finished" | "unknown" }) => void,
  ): Promise<PluginListenerHandle>;
}

let bridgedGetDisplayMedia: ((constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>) | null = null;

/**
 * Installs the polyfill, and is safe to call again: GroupCallScreen calls it
 * right before every share start, not only main.tsx at boot.
 *
 * The first device build assigned `navigator.mediaDevices.getDisplayMedia`
 * once at startup and bailed if `navigator.mediaDevices` wasn't there yet -
 * on a real iPhone livekit-client then threw "DeviceUnsupportedError:
 * getDisplayMedia not supported" at share time, i.e. the function was
 * missing when it was needed (WKWebView hadn't exposed mediaDevices yet at
 * boot, or the object was swapped later). So it now goes on
 * MediaDevices.prototype - every instance sees it, whenever it's created -
 * as well as on the current instance, and is re-checked on demand.
 */
export function installIosScreenShareBridge(): void {
  if (Capacitor.getPlatform() !== "ios") return;

  if (!bridgedGetDisplayMedia) {
    // Registered lazily inside the install (not at module top level) so web
    // and Android builds never even create the plugin proxy.
    bridgedGetDisplayMedia = makeGetDisplayMedia(registerPlugin<ScreenSharePluginInterface>("ScreenShare"));
  }
  const impl = bridgedGetDisplayMedia;
  const define = (target: object) => {
    if ((target as { getDisplayMedia?: unknown }).getDisplayMedia === impl) return;
    Object.defineProperty(target, "getDisplayMedia", { value: impl, writable: true, configurable: true });
  };
  if (typeof MediaDevices !== "undefined") define(MediaDevices.prototype);
  if (navigator.mediaDevices) define(navigator.mediaDevices);
}

function makeGetDisplayMedia(ScreenShare: ScreenSharePluginInterface) {
  return async (_constraints?: DisplayMediaStreamOptions): Promise<MediaStream> => {
    const canvas = document.createElement("canvas");
    // Real size isn't known up front the way Android's start() call reports
    // it synchronously - broadcasting begins asynchronously, whenever the
    // user finishes the system sheet. The canvas resizes to the first frame.
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      throw new DOMException("Cannot acquire 2D context for the screen share canvas", "NotReadableError");
    }

    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    track.contentHint = "detail"; // screen content: favour sharpness over smoothness

    const image = new Image();
    let closed = false;
    let decoding = false;
    let pendingFrame: string | null = null;
    let frameListener: PluginListenerHandle | null = null;
    let stateListener: PluginListenerHandle | null = null;
    let resolveStarted: (() => void) | null = null;
    let rejectStarted: ((err: Error) => void) | null = null;

    const paint = (): void => {
      if (closed || decoding || pendingFrame === null) return;
      const frame = pendingFrame;
      pendingFrame = null;
      decoding = true;
      image.onload = () => {
        decoding = false;
        if (closed) return;
        if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
        }
        try {
          ctx.drawImage(image, 0, 0);
          track.requestFrame();
        } catch {
          /* drawImage raced teardown - just drop the frame */
        }
        if (pendingFrame !== null) paint();
      };
      image.onerror = () => {
        decoding = false;
      };
      image.src = `data:image/jpeg;base64,${frame}`;
    };

    const detach = (): void => {
      if (closed) return;
      closed = true;
      void frameListener?.remove().catch(() => {});
      void stateListener?.remove().catch(() => {});
      frameListener = null;
      stateListener = null;
      void ScreenShare.stop().catch(() => {});
    };

    const originalStop = track.stop.bind(track);
    // livekit-client ends the share by calling MediaStreamTrack.stop() on the
    // very track it got from this stream - chain that to the native teardown.
    track.stop = () => {
      detach();
      originalStop();
    };

    // Also bounded in time: a native call that never settles would otherwise
    // look exactly like the original "button does nothing" bug.
    const listen = async <T,>(what: string, p: Promise<T>): Promise<T> => {
      try {
        return await Promise.race([
          p,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no reply in 5s")), 5000)),
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new DOMException(`ScreenShare.addListener(${what}): ${message}`, "NotReadableError");
      }
    };

    frameListener = await listen("frame", ScreenShare.addListener("frame", ({ base64 }) => {
      if (!closed) {
        pendingFrame = base64;
        paint();
      }
    }));

    stateListener = await listen("state", ScreenShare.addListener("state", ({ state }) => {
      if (state === "started") {
        resolveStarted?.();
        resolveStarted = null;
        rejectStarted = null;
        return;
      }
      if (state !== "finished") return;
      if (rejectStarted) {
        // The extension never really got going before finishing - the user
        // backed out of the system sheet rather than confirming it.
        rejectStarted(new Error("cancelled"));
        resolveStarted = null;
        rejectStarted = null;
        return;
      }
      // The user stopped broadcasting from iOS's own system control.
      // livekit-client unpublishes on the track's 'ended' event, so fire it
      // ourselves - calling stop() alone does not, by spec.
      detach();
      originalStop();
      track.dispatchEvent(new Event("ended"));
    }));

    // Each native step is tagged so a failure shown to the user (see
    // GroupCallScreen's startScreenShare) says *where* it broke - there is
    // no device console access in this project's iOS test loop.
    let stage = "ScreenShare.start";
    try {
      await Promise.race([
        ScreenShare.start(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no reply in 5s")), 5000)),
      ]);
      stage = "waiting for the broadcast to start";
      await new Promise<void>((resolve, reject) => {
        resolveStarted = resolve;
        rejectStarted = reject;
        setTimeout(() => reject(new Error("timed out")), START_TIMEOUT_MS);
      });
    } catch (err) {
      detach();
      originalStop();
      const message = err instanceof Error ? err.message : String(err);
      throw new DOMException(`${stage}: ${message}`, "NotAllowedError");
    }

    return stream;
  };
}
