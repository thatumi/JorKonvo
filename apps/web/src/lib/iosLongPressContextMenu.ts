import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

/**
 * iOS long-press → contextmenu polyfill.
 *
 * Every row wired to useContextMenu's onContextMenu (see index.css's
 * `.jk-ctx-target` comment) assumes a long-press touch turns into a native
 * `contextmenu` DOM event, the way desktop right-click and Android's
 * Chromium WebView both do - confirmed live on a physical Android device,
 * the custom menu opens correctly there. It was never confirmed on iOS.
 * WKWebView (the engine behind the Capacitor iOS app) does not synthesize
 * a `contextmenu` event from a long-press touch at all - a long-press there
 * just starts (or would start, if `.jk-ctx-target`'s
 * `-webkit-touch-callout: none` didn't already suppress it) native text
 * selection, and no context menu ever opens.
 *
 * This times touches by hand and, once one has been held without moving
 * past a small tolerance, dispatches a synthetic `contextmenu` MouseEvent
 * at the touch point - indistinguishable to every existing onContextMenu
 * handler from a real one, so nothing downstream needs to change.
 * useContextMenu's `open()` (ContextMenu.tsx) calls preventDefault() the
 * same way a real right-click handler would, so `event.defaultPrevented`
 * afterwards tells us whether a menu actually opened - only then do we fire
 * a light haptic tap (mirroring the vibration a real OS long-press gesture
 * usually gives) and swallow the single ghost `click` WebKit still fires
 * once the finger lifts, so a long-press never also triggers the row's own
 * onClick (e.g. opening the DM you meant to long-press for its menu). A
 * long-press over plain empty space - no handler, nothing prevented - stays
 * a normal tap: no haptic, no swallowed click. Android and desktop already
 * get a real `contextmenu` event and never load this.
 */

const HOLD_MS = 500;
const MOVE_TOLERANCE_PX = 10;

export function installIosLongPressContextMenu(): void {
  if (Capacitor.getPlatform() !== "ios") return;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  let target: EventTarget | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const swallowNextClick = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    document.removeEventListener("click", swallowNextClick, true);
  };

  document.addEventListener(
    "touchstart",
    (e) => {
      clearTimer();
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const el = touch.target as Element | null;
      // Real text-entry targets: a long-press there should place a cursor /
      // select text natively, not pop the app's own context menu.
      if (el?.closest('input, textarea, [contenteditable="true"]')) return;

      startX = touch.clientX;
      startY = touch.clientY;
      target = touch.target;
      timer = setTimeout(() => {
        timer = null;
        const event = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: startX,
          clientY: startY,
          view: window,
        });
        target?.dispatchEvent(event);
        if (event.defaultPrevented) {
          void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
          document.addEventListener("click", swallowNextClick, true);
        }
      }, HOLD_MS);
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (timer === null) return;
      const touch = e.touches[0];
      if (!touch) return;
      if (
        Math.abs(touch.clientX - startX) > MOVE_TOLERANCE_PX ||
        Math.abs(touch.clientY - startY) > MOVE_TOLERANCE_PX
      ) {
        clearTimer();
      }
    },
    { passive: true },
  );

  document.addEventListener("touchend", clearTimer, { passive: true });
  document.addEventListener("touchcancel", clearTimer, { passive: true });
}
