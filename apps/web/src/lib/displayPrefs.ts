import { create } from "zustand";

/**
 * Device-local display preferences (Discord's "Appearance" + "Accessibility"
 * tabs equivalent):
 *  - density: message spacing - "compact" | "cozy" (default) | "roomy"
 *  - developerMode: surfaces "Copy ID" actions in context menus
 *  - fontScale: 0.8–1.4 multiplier on the root font size
 *  - lineHeightScale: 1–1.6 multiplier on message text line-height
 *  - highContrast: stronger borders/muted-text contrast + visible focus rings
 *  - underlineLinks: always-on link underlines (not just on hover) - WCAG
 *    1.4.1 "use of color": colour alone shouldn't be the only way a link is
 *    distinguishable from surrounding text, for low-vision/colour-blind users.
 *  - announceMessages: mirrors new incoming messages into a visually-hidden
 *    aria-live region (lib/srAnnouncer.ts) for screen readers, off by default
 *    since it's a device the sighted majority never needs.
 */

export type Density = "compact" | "cozy" | "roomy";
/** Discord's Language & Time "Time format": follow the locale, or force 12h / 24h clocks. */
export type TimeFormat = "auto" | "12h" | "24h";

const KEY_DENSITY = "jorkonvo-density";
const KEY_COMPACT_LEGACY = "jorkonvo-compact-mode";
const KEY_DEV = "jorkonvo-developer-mode";
const KEY_FONT = "jorkonvo-font-scale";
const KEY_LINE_HEIGHT = "jorkonvo-line-height-scale";
const KEY_REDUCED_MOTION = "jorkonvo-reduced-motion";
const KEY_TIME_FORMAT = "jorkonvo-time-format";
const KEY_HIGH_CONTRAST = "jorkonvo-high-contrast";
const KEY_UNDERLINE_LINKS = "jorkonvo-underline-links";
const KEY_FOCUS_OUTLINES = "jorkonvo-focus-outlines";
const KEY_ANNOUNCE_MESSAGES = "jorkonvo-announce-messages";

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function readDensity(): Density {
  try {
    const stored = localStorage.getItem(KEY_DENSITY);
    if (stored === "compact" || stored === "cozy" || stored === "roomy") return stored;
    // migrate the old boolean
    if (localStorage.getItem(KEY_COMPACT_LEGACY) === "1") return "compact";
  } catch {
    /* ignore */
  }
  return "cozy";
}
function readTimeFormat(): TimeFormat {
  try {
    const stored = localStorage.getItem(KEY_TIME_FORMAT);
    if (stored === "auto" || stored === "12h" || stored === "24h") return stored;
  } catch {
    /* ignore */
  }
  return "auto";
}
function readFontScale(): number {
  try {
    const n = Number(localStorage.getItem(KEY_FONT));
    return n >= 0.8 && n <= 1.4 ? n : 1;
  } catch {
    return 1;
  }
}
function readLineHeightScale(): number {
  try {
    const n = Number(localStorage.getItem(KEY_LINE_HEIGHT));
    return n >= 1 && n <= 1.6 ? n : 1;
  } catch {
    return 1;
  }
}

interface DomPrefs {
  density: Density;
  fontScale: number;
  lineHeightScale: number;
  reducedMotion: boolean;
  highContrast: boolean;
  underlineLinks: boolean;
  focusOutlines: boolean;
}

function applyDom(p: DomPrefs): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.density = p.density;
  root.style.fontSize = p.fontScale === 1 ? "" : `${16 * p.fontScale}px`;
  root.style.setProperty("--jk-message-line-height", `${1.375 * p.lineHeightScale}rem`);
  if (p.reducedMotion) root.dataset.reducedMotion = "1";
  else delete root.dataset.reducedMotion;
  if (p.highContrast) root.dataset.highContrast = "1";
  else delete root.dataset.highContrast;
  if (p.underlineLinks) root.dataset.underlineLinks = "1";
  else delete root.dataset.underlineLinks;
  if (p.focusOutlines) root.dataset.focusOutlines = "1";
  else delete root.dataset.focusOutlines;
}

interface DisplayPrefsState {
  density: Density;
  developerMode: boolean;
  fontScale: number;
  lineHeightScale: number;
  reducedMotion: boolean;
  timeFormat: TimeFormat;
  highContrast: boolean;
  underlineLinks: boolean;
  focusOutlines: boolean;
  announceMessages: boolean;
  setDensity: (v: Density) => void;
  setDeveloperMode: (v: boolean) => void;
  setFontScale: (v: number) => void;
  setLineHeightScale: (v: number) => void;
  setReducedMotion: (v: boolean) => void;
  setTimeFormat: (v: TimeFormat) => void;
  setHighContrast: (v: boolean) => void;
  setUnderlineLinks: (v: boolean) => void;
  setFocusOutlines: (v: boolean) => void;
  setAnnounceMessages: (v: boolean) => void;
}

function persistBool(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export const useDisplayPrefsStore = create<DisplayPrefsState>((set, get) => ({
  density: readDensity(),
  developerMode: readBool(KEY_DEV),
  fontScale: readFontScale(),
  lineHeightScale: readLineHeightScale(),
  reducedMotion: readBool(KEY_REDUCED_MOTION),
  timeFormat: readTimeFormat(),
  highContrast: readBool(KEY_HIGH_CONTRAST),
  underlineLinks: readBool(KEY_UNDERLINE_LINKS),
  focusOutlines: readBool(KEY_FOCUS_OUTLINES),
  announceMessages: readBool(KEY_ANNOUNCE_MESSAGES),
  setTimeFormat: (v) => {
    try {
      localStorage.setItem(KEY_TIME_FORMAT, v);
    } catch {
      /* ignore */
    }
    set({ timeFormat: v });
  },
  setReducedMotion: (v) => {
    persistBool(KEY_REDUCED_MOTION, v);
    applyDom({ ...get(), reducedMotion: v });
    set({ reducedMotion: v });
  },
  setDensity: (v) => {
    try {
      localStorage.setItem(KEY_DENSITY, v);
    } catch {
      /* ignore */
    }
    applyDom({ ...get(), density: v });
    set({ density: v });
  },
  setDeveloperMode: (v) => {
    persistBool(KEY_DEV, v);
    set({ developerMode: v });
  },
  setFontScale: (v) => {
    const clamped = Math.min(1.4, Math.max(0.8, v));
    try {
      localStorage.setItem(KEY_FONT, String(clamped));
    } catch {
      /* ignore */
    }
    applyDom({ ...get(), fontScale: clamped });
    set({ fontScale: clamped });
  },
  setLineHeightScale: (v) => {
    const clamped = Math.min(1.6, Math.max(1, v));
    try {
      localStorage.setItem(KEY_LINE_HEIGHT, String(clamped));
    } catch {
      /* ignore */
    }
    applyDom({ ...get(), lineHeightScale: clamped });
    set({ lineHeightScale: clamped });
  },
  setHighContrast: (v) => {
    persistBool(KEY_HIGH_CONTRAST, v);
    applyDom({ ...get(), highContrast: v });
    set({ highContrast: v });
  },
  setUnderlineLinks: (v) => {
    persistBool(KEY_UNDERLINE_LINKS, v);
    applyDom({ ...get(), underlineLinks: v });
    set({ underlineLinks: v });
  },
  setFocusOutlines: (v) => {
    persistBool(KEY_FOCUS_OUTLINES, v);
    applyDom({ ...get(), focusOutlines: v });
    set({ focusOutlines: v });
  },
  setAnnounceMessages: (v) => {
    persistBool(KEY_ANNOUNCE_MESSAGES, v);
    set({ announceMessages: v });
  },
}));

/** Non-reactive read for use outside React (e.g. context-menu builders). */
export function isDeveloperMode(): boolean {
  return useDisplayPrefsStore.getState().developerMode;
}

/**
 * Whether motion should be minimised - either the in-app Accessibility
 * toggle OR the OS `prefers-reduced-motion` setting. The CSS `@media`
 * query in index.css already covers CSS animations/transitions for the OS
 * case; this is for JS-driven motion CSS can't reach - notably an explicit
 * `behavior: "smooth"` in a scrollIntoView/scrollTo call, which overrides
 * the CSS `scroll-behavior: auto !important` those reduced-motion blocks set.
 */
export function prefersReducedMotion(): boolean {
  if (useDisplayPrefsStore.getState().reducedMotion) return true;
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

/** `"smooth"` normally, `"auto"` (instant) when motion should be reduced. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/** Non-reactive read for NotificationManager - whether new messages should also be announced to screen readers. */
export function shouldAnnounceMessages(): boolean {
  return useDisplayPrefsStore.getState().announceMessages;
}

/** Non-reactive read for date formatting helpers. Returns `true` for 12-hour clocks, `false` for 24-hour, `null` to follow the locale. */
export function prefers12Hour(): boolean | null {
  const fmt = useDisplayPrefsStore.getState().timeFormat;
  return fmt === "auto" ? null : fmt === "12h";
}

/** Call once on boot. */
export function initDisplayPrefs(): void {
  applyDom(useDisplayPrefsStore.getState());
}
