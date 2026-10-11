// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachDragToDismiss } from "../../../apps/web/src/lib/dragToDismiss.js";

/**
 * Tests for the shared swipe-to-dismiss gesture controller that backs every
 * mobile back affordance (panels, settings sheet, modals, lightbox).
 *
 * jsdom has no TouchEvent, so each gesture is synthesised as a plain Event
 * carrying a `touches` list - exactly the shape the controller reads. The
 * element's clientWidth/clientHeight are stubbed since jsdom does no layout.
 */

type Touch = { clientX: number; clientY: number };

function touchEvent(type: string, touch: Touch): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: [touch] });
  return e;
}

function makeEl(size: { width: number; height: number }): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { value: size.width });
  Object.defineProperty(el, "clientHeight", { value: size.height });
  document.body.appendChild(el);
  return el;
}

/** Drive one drag from touchstart through touchend. */
function drag(
  el: HTMLElement,
  points: Touch[],
): void {
  for (const [i, p] of points.entries()) {
    el.dispatchEvent(touchEvent(i === 0 ? "touchstart" : "touchmove", p));
  }
  el.dispatchEvent(touchEvent("touchend", points[points.length - 1]!));
}

describe("attachDragToDismiss", () => {
  beforeEach(() => {
    // jsdom does no layout; give rAF a synchronous stub so transforms land
    // immediately and assertions don't need to wait a frame.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("dismisses a rightward x-axis drag past the threshold", () => {
    const el = makeEl({ width: 400, height: 300 });
    const onDismiss = vi.fn();
    const detach = attachDragToDismiss(el, { axis: "x", onDismiss });

    drag(el, [
      { clientX: 10, clientY: 100 },
      { clientX: 10 + 32, clientY: 100 }, // 8px dead zone + 24px more
      { clientX: 10 + 80, clientY: 100 }, // 80/400 = 20% > 15%
    ]);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    detach();
  });

  it("does not dismiss a short drag and eases the transform back to rest", () => {
    const el = makeEl({ width: 400, height: 300 });
    const onDismiss = vi.fn();
    const detach = attachDragToDismiss(el, { axis: "x", onDismiss });

    drag(el, [
      { clientX: 10, clientY: 100 },
      { clientX: 40, clientY: 100 }, // 30px = 7.5% < 15%
    ]);

    expect(onDismiss).not.toHaveBeenCalled();
    expect(el.style.transform).toBe("translateX(0%)");
    detach();
  });

  it("tracks the finger 1:1 while the drag is live", () => {
    const el = makeEl({ width: 400, height: 300 });
    const detach = attachDragToDismiss(el, { axis: "x", onDismiss: () => {} });

    el.dispatchEvent(touchEvent("touchstart", { clientX: 0, clientY: 0 }));
    el.dispatchEvent(touchEvent("touchmove", { clientX: 120, clientY: 0 }));

    expect(el.style.transform).toBe("translateX(30%)");
    detach();
  });

  it("ignores a vertical drag on an x-axis surface", () => {
    const el = makeEl({ width: 400, height: 300 });
    const onDismiss = vi.fn();
    const detach = attachDragToDismiss(el, { axis: "x", onDismiss });

    drag(el, [
      { clientX: 10, clientY: 100 },
      { clientX: 10, clientY: 300 },
    ]);

    expect(onDismiss).not.toHaveBeenCalled();
    expect(el.style.transform).toBe("translateX(0%)");
    detach();
  });

  it("ignores a drag in the closing direction's opposite (leftward)", () => {
    const el = makeEl({ width: 400, height: 300 });
    const onDismiss = vi.fn();
    const detach = attachDragToDismiss(el, { axis: "x", onDismiss });

    drag(el, [
      { clientX: 300, clientY: 100 },
      { clientX: 120, clientY: 100 },
      { clientX: 20, clientY: 100 },
    ]);

    expect(onDismiss).not.toHaveBeenCalled();
    // Clamped hard to the rest pose - never dragged off the wrong edge.
    expect(el.style.transform).toBe("translateX(0%)");
    detach();
  });

  it("dismisses a downward y-axis drag (swipe-down-to-dismiss sheets)", () => {
    const el = makeEl({ width: 400, height: 300 });
    const onDismiss = vi.fn();
    const detach = attachDragToDismiss(el, { axis: "y", onDismiss });

    drag(el, [
      { clientX: 200, clientY: 50 },
      { clientX: 200, clientY: 110 },
      { clientX: 200, clientY: 150 }, // 100/300 = 33% > 15%
    ]);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    detach();
  });

  it("does not claim an upward y-axis drag, leaving scrolling alive", () => {
    const el = makeEl({ width: 400, height: 300 });
    const onDismiss = vi.fn();
    const detach = attachDragToDismiss(el, { axis: "y", onDismiss });
    const move = touchEvent("touchmove", { clientX: 200, clientY: 20 });
    const preventDefault = vi.spyOn(move, "preventDefault");
    const stopPropagation = vi.spyOn(move, "stopPropagation");

    el.dispatchEvent(touchEvent("touchstart", { clientX: 200, clientY: 50 }));
    el.dispatchEvent(move);
    el.dispatchEvent(touchEvent("touchend", { clientX: 200, clientY: 20 }));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    detach();
  });

  it("ignores touches that start outside the edge zone", () => {
    const el = makeEl({ width: 400, height: 300 });
    const onDismiss = vi.fn();
    const detach = attachDragToDismiss(el, { axis: "x", onDismiss, edgeZonePx: 40 });

    drag(el, [
      { clientX: 200, clientY: 100 },
      { clientX: 380, clientY: 100 },
    ]);

    expect(onDismiss).not.toHaveBeenCalled();
    expect(el.style.transform).toBe("translateX(0%)");
    detach();
  });

  it("honours the edge zone on the y axis (top edge)", () => {
    const el = makeEl({ width: 400, height: 300 });
    const onDismiss = vi.fn();
    const detach = attachDragToDismiss(el, { axis: "y", onDismiss, edgeZonePx: 60 });

    drag(el, [
      { clientX: 200, clientY: 200 },
      { clientX: 200, clientY: 300 },
    ]);

    expect(onDismiss).not.toHaveBeenCalled();
    detach();
  });

  it("skips the whole gesture when shouldEngage returns false", () => {
    const el = makeEl({ width: 400, height: 300 });
    const onDismiss = vi.fn();
    let engaged = false;
    const detach = attachDragToDismiss(el, {
      axis: "x",
      onDismiss,
      shouldEngage: () => engaged,
    });

    drag(el, [
      { clientX: 10, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ]);
    expect(onDismiss).not.toHaveBeenCalled();

    engaged = true;
    drag(el, [
      { clientX: 10, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    detach();
  });

  it("isolate stops the drag's events from reaching ancestor listeners", () => {
    const el = makeEl({ width: 400, height: 300 });
    const detach = attachDragToDismiss(el, { axis: "x", onDismiss: () => {}, isolate: true });
    const start = touchEvent("touchstart", { clientX: 0, clientY: 0 });
    const move = touchEvent("touchmove", { clientX: 120, clientY: 0 });
    const preventDefault = vi.spyOn(move, "preventDefault");
    const stopPropagation = vi.spyOn(move, "stopPropagation");

    el.dispatchEvent(start);
    el.dispatchEvent(move);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    detach();
  });

  it("reports dragging state transitions", () => {
    const el = makeEl({ width: 400, height: 300 });
    const states: boolean[] = [];
    const detach = attachDragToDismiss(el, {
      axis: "x",
      onDismiss: () => {},
      onDraggingChange: (d) => states.push(d),
    });

    drag(el, [
      { clientX: 0, clientY: 0 },
      { clientX: 120, clientY: 0 },
    ]);

    expect(states).toEqual([true, false]);
    detach();
  });

  it("completes a committed drag when the touch is cancelled, exactly once", () => {
    // A past-threshold drag is committed even if the system takes the touch
    // away (iOS fires touchcancel when one of its own gestures claims it) -
    // and the window-level safety net must not fire the dismissal a second
    // time when the cancelled event bubbles up to it.
    const el = makeEl({ width: 400, height: 300 });
    const onDismiss = vi.fn();
    const detach = attachDragToDismiss(el, { axis: "x", onDismiss });

    el.dispatchEvent(touchEvent("touchstart", { clientX: 0, clientY: 0 }));
    el.dispatchEvent(touchEvent("touchmove", { clientX: 200, clientY: 0 }));
    el.dispatchEvent(touchEvent("touchcancel", { clientX: 200, clientY: 0 }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(el.style.transform).toBe("translateX(0%)");
    detach();
  });

  it("resets cleanly when an uncommitted drag is cancelled", () => {
    const el = makeEl({ width: 400, height: 300 });
    const onDismiss = vi.fn();
    const detach = attachDragToDismiss(el, { axis: "x", onDismiss });

    el.dispatchEvent(touchEvent("touchstart", { clientX: 0, clientY: 0 }));
    el.dispatchEvent(touchEvent("touchmove", { clientX: 20, clientY: 0 }));
    el.dispatchEvent(touchEvent("touchcancel", { clientX: 20, clientY: 0 }));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(el.style.transform).toBe("translateX(0%)");
    detach();
  });

  it("stops listening after detach", () => {
    const el = makeEl({ width: 400, height: 300 });
    const onDismiss = vi.fn();
    const detach = attachDragToDismiss(el, { axis: "x", onDismiss });
    detach();

    drag(el, [
      { clientX: 0, clientY: 0 },
      { clientX: 200, clientY: 0 },
    ]);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("uses a custom threshold when given", () => {
    const el = makeEl({ width: 400, height: 300 });
    const onDismiss = vi.fn();
    const detach = attachDragToDismiss(el, { axis: "x", onDismiss, threshold: 0.5 });

    drag(el, [
      { clientX: 0, clientY: 0 },
      { clientX: 160, clientY: 0 }, // 40% < 50%
    ]);
    expect(onDismiss).not.toHaveBeenCalled();

    drag(el, [
      { clientX: 0, clientY: 0 },
      { clientX: 240, clientY: 0 }, // 60% > 50%
    ]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    detach();
  });
});
