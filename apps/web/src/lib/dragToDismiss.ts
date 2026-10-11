import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The one shared "drag a surface, dismiss it on release" gesture behind every
 * swipe-to-go-back affordance in the app: the mobile full-screen panels
 * (thread / threads list / search), the settings sheet's left-edge swipe, the
 * modals' swipe-down-to-dismiss and the image lightbox.
 *
 * A drag is a real finger-following drag - the element's transform tracks the
 * touch 1:1 and is eased back to (or through) rest on release - not a
 * release-only toggle.
 *
 * The listeners are native (non-passive) on purpose: React's synthetic touch
 * handlers are passive by default, so preventDefault() inside them cannot stop
 * a WKWebView's own edge-swipe handling from firing alongside ours and
 * rubber-banding the page under the drag.
 *
 * The live offset lives in a closure (not React state) and the transform is
 * written straight to the DOM node, so a fast swipe can never outrun a render
 * cycle and drift. Pass an `onDismiss` that reads its store through
 * `useStore.getState()`: release state is then always fresh, however fast the
 * user follow-ups one gesture with another.
 *
 * Every surface shares the same thresholds: 8px dead zone, a 1.3 axis-lock
 * ratio, 15% of the element's own size on release.
 */

/** Dead zone before a touch starts being interpreted as a drag (px). */
const DEAD_ZONE_PX = 8;
/** The drag must be this much longer on its axis than on the other to lock. */
const AXIS_LOCK_RATIO = 1.3;
/** Fraction of the element's size the drag must cover on release to dismiss. */
const DEFAULT_THRESHOLD = 0.15;

export interface DragToDismissOptions {
  /** Axis the surface follows. `x` = swipe-back panels, `y` = swipe-down sheets. */
  axis: "x" | "y";
  /** Called when a drag is released past the threshold. Read your state fresh in here. */
  onDismiss: () => void;
  /** Reports whether a drag is live, so the consumer can suspend the CSS transition. */
  onDraggingChange?: (dragging: boolean) => void;
  /**
   * Gate the whole gesture per touch: return false to ignore that touchstart
   * (the settings sheet only drags while it is a full-screen sheet, the modals
   * only drag while their body is scrolled back to the top). Evaluated on
   * every touchstart, so it can close over live state.
   */
  shouldEngage?: () => boolean;
  /**
   * Restrict the gesture to touches starting within this many px of the
   * surface's leading (left/top) edge. Omit to take a drag anywhere - right
   * for a dedicated full-screen page, wrong for content dense with drags of
   * its own (appearance sliders, text carets).
   */
  edgeZonePx?: number;
  /** Release threshold as a fraction of the element's size. Default 0.15. */
  threshold?: number;
  /**
   * Stop the drag's events from bubbling to an ancestor running its own drag
   * listener - ChatArea's panel swipe sits inside MainLayout's list<->chat
   * swipe, which must not co-interpret the same gesture.
   */
  isolate?: boolean;
}

/**
 * Attach the gesture to `el`, return its detacher. Framework-free so the
 * mechanics can be unit-tested by dispatching TouchEvents in jsdom.
 */
export function attachDragToDismiss(el: HTMLElement, opts: DragToDismissOptions): () => void {
  const horizontal = opts.axis === "x";
  const thresholdPercent = (opts.threshold ?? DEFAULT_THRESHOLD) * 100;
  let start: { x: number; y: number; locked: "drag" | "other" | null } | null = null;
  let offset = 0;
  let raf = 0;
  let owns = false;
  let dragging = false;

  const setDragging = (next: boolean) => {
    if (dragging === next) return;
    dragging = next;
    opts.onDraggingChange?.(next);
  };

  const apply = () => {
    // Close-only travel, hard-clamped: however a gesture races the rest state,
    // the surface can never be pushed past its own size nor dragged the wrong
    // way off its rest pose.
    const clamped = Math.max(0, Math.min(100, offset));
    el.style.transform = horizontal ? `translateX(${clamped}%)` : `translateY(${clamped}%)`;
  };
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      apply();
    });
  };
  const settle = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    start = null;
    owns = false;
    setDragging(false);
    offset = 0;
    // Ease back to rest - after a successful dismiss the surface unmounts and
    // this write lands on a detached node, a harmless no-op.
    schedule();
  };

  const onStart = (e: TouchEvent) => {
    if (opts.shouldEngage && !opts.shouldEngage()) {
      start = null;
      return;
    }
    const t = e.touches[0];
    if (!t) {
      start = null;
      return;
    }
    if (
      opts.edgeZonePx !== undefined &&
      (horizontal ? t.clientX : t.clientY) > opts.edgeZonePx
    ) {
      start = null;
      return;
    }
    start = { x: t.clientX, y: t.clientY, locked: null };
    owns = false;
  };

  const onMove = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (start.locked === null) {
      if (Math.abs(dx) < DEAD_ZONE_PX && Math.abs(dy) < DEAD_ZONE_PX) return;
      const primary = Math.abs(horizontal ? dx : dy);
      const secondary = Math.abs(horizontal ? dy : dx);
      start.locked = primary > secondary * AXIS_LOCK_RATIO ? "drag" : "other";
    }
    if (start.locked !== "drag") return;
    // Percent of the element's own size, so the transform is
    // resolution-independent and 100% always means "fully off-screen".
    const size = horizontal ? el.clientWidth : el.clientHeight;
    if (!size) return; // never divide by a zero / unlaid-out size
    offset = ((horizontal ? dx : dy) / size) * 100;
    // Only claim the gesture - and only suppress the browser's own handling -
    // once the surface is actually moving. Claiming a drag that instantly
    // clamps back to zero would eat the touch for nothing: on a y-axis sheet
    // that would block scrolling down from the top, on an x-axis panel it
    // would kill an opposite-direction drag the browser handles better.
    if (offset > 0) {
      owns = true;
      e.preventDefault();
      if (opts.isolate) e.stopPropagation();
    }
    setDragging(true);
    schedule();
  };

  const onEnd = (e: TouchEvent) => {
    // Hide the release from an ancestor's own drag listener too, or it would
    // see a completed gesture of its own and act on it (MainLayout would close
    // the whole room on top of the panel closing).
    if (owns && opts.isolate) e.stopPropagation();
    const dismissed = start?.locked === "drag" && offset > thresholdPercent;
    settle();
    if (dismissed) opts.onDismiss();
  };

  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchmove", onMove, { passive: false });
  el.addEventListener("touchend", onEnd, { passive: true });
  el.addEventListener("touchcancel", onEnd, { passive: true });
  // Safety net on window: if the browser's own gesture handling "steals" a
  // touch mid-drag, the touchend on `el` can never fire and the surface would
  // stay stuck offset instead of settling. A touchend fires SOMEWHERE the
  // moment the finger lifts, so catching it on window guarantees the reset.
  window.addEventListener("touchend", onEnd, { passive: true });
  window.addEventListener("touchcancel", onEnd, { passive: true });

  return () => {
    if (raf) cancelAnimationFrame(raf);
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", onEnd);
    window.removeEventListener("touchend", onEnd);
    window.removeEventListener("touchcancel", onEnd);
  };
}

/**
 * React binding: returns a callback ref to spread on the element that should
 * follow the finger, plus whether a drag is live right now (suspend the
 * element's CSS `transition` while it is, so the finger tracking isn't fought
 * by the easing and the release snap can animate).
 *
 * A callback ref rather than a ref object deliberately: panels like the thread
 * view only mount when they open, and a ref object is still null on the very
 * render the effect would first run in - the gesture would never attach. The
 * callback form is invoked by React the moment the node exists.
 *
 * Options ride through a ref so a fresh closure - and the fresh store state it
 * reads - applies to every gesture without re-binding mid-drag.
 */
export function useDragToDismiss<T extends HTMLElement>(
  opts: DragToDismissOptions & { enabled?: boolean },
): { ref: (node: T | null) => void; dragging: boolean } {
  const { enabled = true, ...rest } = opts;
  const [dragging, setDragging] = useState(false);
  const optsRef = useRef(rest);
  optsRef.current = rest;
  const detachRef = useRef<(() => void) | null>(null);

  const ref = useCallback(
    (node: T | null) => {
      detachRef.current?.();
      detachRef.current = null;
      if (node && enabled) {
        detachRef.current = attachDragToDismiss(node, {
          ...optsRef.current,
          onDraggingChange: setDragging,
        });
      }
    },
    [enabled],
  );

  // React nulls the callback ref on unmount, which detaches; this only covers
  // `enabled` flipping false without a re-mount of the consumer.
  useEffect(
    () => () => {
      detachRef.current?.();
      detachRef.current = null;
    },
    [],
  );

  return { ref, dragging };
}
