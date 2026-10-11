import { create } from "zustand";

export type ThemePreference = "dark" | "light" | "system";

export const THEME_OPTIONS: { value: ThemePreference; labelKey: string }[] = [
  { value: "dark", labelKey: "settings.themeDark" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "system", labelKey: "settings.themeSystem" },
];

/** Accent (brand) colour - orthogonal to light/dark, only retints --color-brand/-hover/-link. */
export type Accent =
  | "violet"
  | "indigo"
  | "sky"
  | "emerald"
  | "amber"
  | "rose"
  | "crimson"
  | "steel";

/** Surface tone - retints the neutral background ramp; tuned per light/dark. */
export type Surface = "graphite" | "slate" | "obsidian" | "mocha";

/** Corner roundness of panels / cards / buttons (not avatars & pills). */
export type Corners = "sharp" | "default" | "round";

export const CORNERS: Corners[] = ["sharp", "default", "round"];

export const ACCENTS: { value: Accent; swatch: string }[] = [
  { value: "violet", swatch: "#8b5cf6" },
  { value: "indigo", swatch: "#6366f1" },
  { value: "sky", swatch: "#0ea5e9" },
  { value: "emerald", swatch: "#10b981" },
  { value: "amber", swatch: "#f59e0b" },
  { value: "rose", swatch: "#f43f5e" },
  { value: "crimson", swatch: "#dc2626" },
  { value: "steel", swatch: "#8a8f9c" },
];

export const SURFACES: { value: Surface; swatch: string }[] = [
  { value: "graphite", swatch: "#201e28" },
  { value: "slate", swatch: "#1c2530" },
  { value: "obsidian", swatch: "#0c0c0f" },
  { value: "mocha", swatch: "#251e17" },
];

/**
 * One-click bundles of theme + accent + surface, for people who just want a
 * "look" without tuning three dials. `id` is only used as a React key / i18n
 * suffix - nothing is persisted beyond the three values it applies.
 */
export interface ThemePreset {
  id: string;
  theme: "dark" | "light";
  accent: Accent;
  surface: Surface;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: "amethyst", theme: "dark", accent: "violet", surface: "graphite" },
  { id: "blurple", theme: "dark", accent: "indigo", surface: "slate" },
  { id: "midnight", theme: "dark", accent: "violet", surface: "obsidian" },
  { id: "forest", theme: "dark", accent: "emerald", surface: "mocha" },
  { id: "sunset", theme: "dark", accent: "rose", surface: "mocha" },
  { id: "ocean", theme: "dark", accent: "sky", surface: "slate" },
  { id: "daylight", theme: "light", accent: "violet", surface: "graphite" },
  { id: "sand", theme: "light", accent: "amber", surface: "mocha" },
];

const KEY_THEME = "jorkonvo-theme";
const KEY_ACCENT = "jorkonvo-accent";
const KEY_SURFACE = "jorkonvo-surface";
const KEY_CORNERS = "jorkonvo-corners";

function readStoredPreference(): ThemePreference {
  const stored = localStorage.getItem(KEY_THEME);
  return stored === "dark" || stored === "light" || stored === "system" ? stored : "system";
}

function readStoredAccent(): Accent {
  const stored = localStorage.getItem(KEY_ACCENT) as Accent | null;
  return ACCENTS.some((a) => a.value === stored) ? (stored as Accent) : "violet";
}

function readStoredSurface(): Surface {
  const stored = localStorage.getItem(KEY_SURFACE) as Surface | null;
  return SURFACES.some((s) => s.value === stored) ? (stored as Surface) : "graphite";
}

function readStoredCorners(): Corners {
  const stored = localStorage.getItem(KEY_CORNERS) as Corners | null;
  return CORNERS.includes(stored as Corners) ? (stored as Corners) : "default";
}

function systemPrefersLight(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
}

function resolveEffective(preference: ThemePreference): "dark" | "light" {
  if (preference === "system") return systemPrefersLight() ? "light" : "dark";
  return preference;
}

function applyToDom(effective: "dark" | "light", accent: Accent, surface: Surface, corners: Corners) {
  const root = document.documentElement;
  root.dataset.theme = effective;
  root.dataset.accent = accent;
  root.dataset.surface = surface;
  if (corners === "default") delete root.dataset.corners;
  else root.dataset.corners = corners;
}

interface ThemeState {
  preference: ThemePreference;
  effective: "dark" | "light";
  accent: Accent;
  surface: Surface;
  corners: Corners;
  setPreference: (preference: ThemePreference) => void;
  setAccent: (accent: Accent) => void;
  setSurface: (surface: Surface) => void;
  setCorners: (corners: Corners) => void;
  applyPreset: (preset: ThemePreset) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: readStoredPreference(),
  effective: resolveEffective(readStoredPreference()),
  accent: readStoredAccent(),
  surface: readStoredSurface(),
  corners: readStoredCorners(),
  setPreference: (preference) => {
    localStorage.setItem(KEY_THEME, preference);
    const effective = resolveEffective(preference);
    applyToDom(effective, get().accent, get().surface, get().corners);
    set({ preference, effective });
  },
  setAccent: (accent) => {
    try {
      localStorage.setItem(KEY_ACCENT, accent);
    } catch {
      /* ignore */
    }
    applyToDom(get().effective, accent, get().surface, get().corners);
    set({ accent });
  },
  setSurface: (surface) => {
    try {
      localStorage.setItem(KEY_SURFACE, surface);
    } catch {
      /* ignore */
    }
    applyToDom(get().effective, get().accent, surface, get().corners);
    set({ surface });
  },
  setCorners: (corners) => {
    try {
      localStorage.setItem(KEY_CORNERS, corners);
    } catch {
      /* ignore */
    }
    applyToDom(get().effective, get().accent, get().surface, corners);
    set({ corners });
  },
  applyPreset: ({ theme, accent, surface }) => {
    try {
      localStorage.setItem(KEY_THEME, theme);
      localStorage.setItem(KEY_ACCENT, accent);
      localStorage.setItem(KEY_SURFACE, surface);
    } catch {
      /* ignore */
    }
    applyToDom(theme, accent, surface, get().corners);
    set({ preference: theme, effective: theme, accent, surface });
  },
}));

/** Applies the stored/current theme to the DOM and wires up "system" live-updates. Call once at app start. */
export function initTheme(): () => void {
  const { effective, accent, surface, corners } = useThemeStore.getState();
  applyToDom(effective, accent, surface, corners);

  const media = window.matchMedia?.("(prefers-color-scheme: light)");
  const onChange = () => {
    const state = useThemeStore.getState();
    if (state.preference !== "system") return;
    const nextEffective = resolveEffective(state.preference);
    applyToDom(nextEffective, state.accent, state.surface, state.corners);
    useThemeStore.setState({ effective: nextEffective });
  };
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}
