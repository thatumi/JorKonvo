import { useEffect, useState } from "react";

/** Matches Tailwind's default `md` breakpoint - below it the three-column layout can't fit, so MainLayout switches to one pane at a time. */
const NARROW_QUERY = "(max-width: 767px)";
// iOS Safari's per-site "Request Desktop Website" toggle reports a wide,
// fixed (~980-1024px) viewport regardless of the phone's actual screen size
// - the narrow-width query alone then never matches, and the three-column
// desktop layout gets squeezed onto a physical phone screen it was never
// designed to fit. That toggle only spoofs the viewport size and UA string;
// it can't fake the underlying input hardware, so a real phone still
// reports a coarse pointer with no hover capability even in that mode -
// unlike an actual desktop/laptop (mouse: fine pointer, real hover), which
// this must NOT misidentify as mobile.
const TOUCH_ONLY_QUERY = "(pointer: coarse) and (hover: none)";

/**
 * Confirmed live: a link opened from inside another app's in-app browser
 * (Discord's, in this case - the "< Discord" back-to-app affordance in the
 * status bar is the tell) rendered the desktop layout on a real phone even
 * WITH the two matchMedia checks above, on first load, before any user
 * interaction. Some embedded WKWebView-based browsers don't reliably set up
 * the mobile-style viewport/pointer/hover media features actual Mobile
 * Safari does - but `window.screen` is tied to the real display hardware,
 * not the page's own (in this case, misreported) rendering environment, so
 * it stays a reliable phone/not-phone signal even there. Taking the
 * narrower of width/height keeps this stable across device rotation
 * (a phone is narrow in its short dimension either way; a tablet/laptop
 * isn't, even in portrait).
 */
function hasPhoneSizedScreen(): boolean {
  const w = window.screen?.width;
  const h = window.screen?.height;
  if (!w || !h) return false;
  return Math.min(w, h) <= 480 && "ontouchstart" in window;
}

/** Embedded in-app browsers normally inherit the OS browser's own UA string unless the host app deliberately overrides it - one more independent signal alongside the viewport/pointer/screen checks above. */
function hasMobileUserAgent(): boolean {
  return /Mobi|Android|iPhone|iPod/i.test(navigator.userAgent);
}

/** Non-hook form of the same check, for call sites outside React (e.g. the native back-button handler in lib/nativeBackButton.ts), which need the current answer once rather than a subscription. */
export function isMobileNow(): boolean {
  return (
    window.matchMedia(NARROW_QUERY).matches ||
    window.matchMedia(TOUCH_ONLY_QUERY).matches ||
    hasPhoneSizedScreen() ||
    hasMobileUserAgent()
  );
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(isMobileNow);

  useEffect(() => {
    const narrow = window.matchMedia(NARROW_QUERY);
    const touchOnly = window.matchMedia(TOUCH_ONLY_QUERY);
    const onChange = () => setIsMobile(isMobileNow());
    narrow.addEventListener("change", onChange);
    touchOnly.addEventListener("change", onChange);
    window.addEventListener("orientationchange", onChange);
    return () => {
      narrow.removeEventListener("change", onChange);
      touchOnly.removeEventListener("change", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, []);

  return isMobile;
}

/**
 * "tablet" = the touch/mobile interaction model (everything useIsMobile
 * gates stays on) but on a screen wide enough (>= md) that the list and
 * member panes don't need the whole screen: they slide in as partial-width
 * drawers next to a still-visible chat (MainLayout / ChatArea) instead of
 * full-screen pages. An iPad in either orientation lands here; a phone
 * never does (narrow viewport or phone-sized screen). A split-view iPad
 * narrower than md falls back to "phone" live.
 */
export type LayoutMode = "phone" | "tablet" | "desktop";

export function layoutModeNow(): LayoutMode {
  if (!isMobileNow()) return "desktop";
  return window.matchMedia(NARROW_QUERY).matches || hasPhoneSizedScreen() ? "phone" : "tablet";
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState(layoutModeNow);

  useEffect(() => {
    const narrow = window.matchMedia(NARROW_QUERY);
    const touchOnly = window.matchMedia(TOUCH_ONLY_QUERY);
    const onChange = () => setMode(layoutModeNow());
    narrow.addEventListener("change", onChange);
    touchOnly.addEventListener("change", onChange);
    window.addEventListener("orientationchange", onChange);
    return () => {
      narrow.removeEventListener("change", onChange);
      touchOnly.removeEventListener("change", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, []);

  return mode;
}
