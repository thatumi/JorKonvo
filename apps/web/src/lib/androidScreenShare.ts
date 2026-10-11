import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * Real screen sharing for the Android app.
 *
 * The Android WebView does not implement navigator.mediaDevices.getDisplayMedia
 * - verified live on the project's P30 Pro (WebView 151 / Chromium 151: getUserMedia
 * present, getDisplayMedia undefined; camera/mic work only because Capacitor's
 * BridgeWebChromeClient translates their permission prompts to native ones, and
 * screen capture has no such built-in bridge).
 *
 * This module replaces getDisplayMedia on Android with a native MediaProjection
 * pipeline: the ScreenCapturePlugin (apps/web/android/.../ScreenCapturePlugin.java)
 * raises the system consent dialog, then ScreenCaptureService mirrors the screen
 * into an ImageReader, downscales, JPEG-compresses and pushes each frame into the
 * page via WebView.evaluateJavascript as window.__jorkonvoScreenShareFrame(base64).
 * We decode frames onto an offscreen <canvas> and hand out
 * canvas.captureStream(0)'s video track as the getDisplayMedia() result, so
 * livekit-client's setScreenShareEnabled() works unmodified: it publishes that
 * track, stops the share through MediaStreamTrack.stop(), and expects external
 * stops to surface as a MediaStreamTrack 'ended' event - all three are wired
 * below. Everything here is Android-only; web and iOS keep the browser's own
 * getDisplayMedia.
 */

interface ScreenCapturePluginInterface {
  start(options: { maxLongSide: number; frameRate: number }): Promise<{
    width: number;
    height: number;
    frameRate: number;
  }>;
  stop(): Promise<void>;
  addListener(eventName: "stopped", listenerFunc: () => void): Promise<PluginListenerHandle>;
}

declare global {
  interface Window {
    /** Called from native (WebView.evaluateJavascript) for every captured frame. */
    __jorkonvoScreenShareFrame?: (base64Jpeg: string) => void;
  }
}

/** Constraint values arrive as bare numbers or as {ideal}/{max} dictionaries. */
function constraintNumber(
  value: number | { ideal?: number; max?: number; min?: number } | undefined,
  fallback: number,
): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    if (typeof value.ideal === "number") return value.ideal;
    if (typeof value.max === "number") return value.max;
  }
  return fallback;
}

export function installAndroidScreenShareBridge(): void {
  if (Capacitor.getPlatform() !== "android" || !navigator.mediaDevices) return;

  // Registered lazily inside the install (not at module top level) so web
  // builds never even create the plugin proxy.
  const ScreenCapture = registerPlugin<ScreenCapturePluginInterface>("ScreenCapture");

  navigator.mediaDevices.getDisplayMedia = async (
    constraints?: DisplayMediaStreamOptions,
  ): Promise<MediaStream> => {
    // livekit-client calls this as { audio: false, video: { width: {ideal},
    // height: {ideal}, frameRate } } derived from its ScreenSharePresets, with
    // video: true for the "original" preset. MediaProjection cannot capture
    // device audio, so an audio request is silently dropped (the caller
    // treats a video-only stream as screen share without audio).
    const video = constraints?.video;
    const hasVideoConstraints = !!video && typeof video === "object";
    const width = hasVideoConstraints ? constraintNumber(video.width, 1920) : 1920;
    const height = hasVideoConstraints ? constraintNumber(video.height, 1080) : 1080;
    const frameRate = hasVideoConstraints ? constraintNumber(video.frameRate, 15) : 15;
    const maxLongSide = Math.max(640, Math.round(Math.max(width, height)));

    let started: Awaited<ReturnType<ScreenCapturePluginInterface["start"]>>;
    try {
      started = await ScreenCapture.start({
        maxLongSide,
        frameRate: Math.min(30, Math.max(1, Math.round(frameRate))),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string } | null)?.code ?? "";
      // Rejections must look like real getDisplayMedia errors so callers
      // (livekit-client and the call UI) treat them the same as on the web.
      if (message.includes("PERMISSION_DENIED") || code === "PERMISSION_DENIED") {
        throw new DOMException("User denied screen capture permission", "NotAllowedError");
      }
      throw new DOMException(message, "NotReadableError");
    }

    const canvas = document.createElement("canvas");
    canvas.width = started.width;
    canvas.height = started.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      void ScreenCapture.stop().catch(() => {});
      throw new DOMException("Cannot acquire 2D context for the screen share canvas", "NotReadableError");
    }

    // captureStream(0) + requestFrame() per painted frame: the track only
    // produces when real new pixels arrived, instead of re-capturing a stale
    // canvas at a fixed rate.
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    track.contentHint = "detail"; // screen content: favour sharpness over smoothness

    const image = new Image();
    let closed = false;
    let decoding = false;
    let pendingFrame: string | null = null;
    let listener: PluginListenerHandle | null = null;

    const paint = (): void => {
      if (closed || decoding || pendingFrame === null) return;
      const frame = pendingFrame;
      pendingFrame = null;
      decoding = true;
      image.onload = () => {
        decoding = false;
        if (closed) return;
        try {
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
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

    window.__jorkonvoScreenShareFrame = (frame: string): void => {
      // If decode can't keep up, keep only the newest frame (drop-oldest).
      if (!closed) {
        pendingFrame = frame;
        paint();
      }
    };

    const detach = (): void => {
      if (closed) return;
      closed = true;
      delete window.__jorkonvoScreenShareFrame;
      void listener?.remove().catch(() => {});
      listener = null;
      void ScreenCapture.stop().catch(() => {});
    };

    const originalStop = track.stop.bind(track);
    // livekit-client ends the share by calling MediaStreamTrack.stop() on the
    // very track it got from this stream - chain that to the native teardown.
    track.stop = () => {
      detach();
      originalStop();
    };

    void ScreenCapture.addListener("stopped", () => {
      // The projection ended natively (system stop control, another app took
      // it over, OS killed it). livekit-client unpublishes on the track's
      // 'ended' event, so stop the track and dispatch it ourselves - calling
      // stop() alone does not fire 'ended' by spec.
      detach();
      originalStop();
      track.dispatchEvent(new Event("ended"));
    }).then((handle) => {
      if (closed) void handle.remove().catch(() => {});
      else listener = handle;
    }).catch(() => {});

    return stream;
  };
}
