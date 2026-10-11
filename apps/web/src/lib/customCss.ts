import { create } from "zustand";

/**
 * User-supplied custom CSS - full theme-hacking power, à la Discord's
 * client-mods / Stylus. Device-local (localStorage): it's a personal tweak,
 * and syncing arbitrary CSS between clients via account data would be a footgun
 * (and a small injection surface). Applied by keeping one <style> element in
 * <head> in sync with the stored text.
 */

const STORAGE_KEY = "jorkonvo-custom-css";
const STYLE_ID = "jorkonvo-custom-css";

function read(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function apply(css: string): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!css.trim()) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

interface CustomCssState {
  css: string;
  setCss: (css: string) => void;
}

export const useCustomCssStore = create<CustomCssState>((set) => ({
  css: read(),
  setCss: (css) => {
    try {
      if (css.trim()) localStorage.setItem(STORAGE_KEY, css);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* private mode */
    }
    apply(css);
    set({ css });
  },
}));

/** Call once on boot to apply any previously-saved CSS. */
export function initCustomCss(): void {
  apply(read());
}
