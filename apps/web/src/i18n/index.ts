import { create } from "zustand";
import { en } from "./locales/en";
import { hu } from "./locales/hu";

/**
 * Tiny dependency-free i18n. `hu` is the reference locale (it's what the app
 * was originally written in); keys are English so they read well in code.
 *
 * - `t("some.key")` - flat dot-namespaced lookup
 * - `t("room.members", { count: 3 })` - `{count}` interpolation, and if a
 *   `some.key_one` / `some.key_other` pair exists, the count picks between them
 * - a missing key falls back to `hu`, then to the key itself (visible in dev)
 */

export type Locale = "hu" | "en";
export type Messages = Record<string, string>;

const LOCALES: Record<Locale, Messages> = { hu, en };

export const LOCALE_NAMES: Record<Locale, string> = {
  hu: "Magyar",
  en: "English",
};

const STORAGE_KEY = "jorkonvo-locale";

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "hu" || stored === "en") return stored;
  } catch {
    /* private mode */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "";
  return nav.startsWith("hu") ? "hu" : "en";
}

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = locale;
    set({ locale });
  },
}));

if (typeof document !== "undefined") {
  document.documentElement.lang = useI18nStore.getState().locale;
}

const warned = new Set<string>();

function lookup(locale: Locale, key: string): string | undefined {
  return LOCALES[locale][key] ?? (locale !== "hu" ? LOCALES.hu[key] : undefined);
}

export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let template: string | undefined;

  if (params && typeof params.count === "number") {
    const plural = params.count === 1 ? `${key}_one` : `${key}_other`;
    template = lookup(locale, plural);
  }
  template ??= lookup(locale, key);

  if (template === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
    }
    return key;
  }

  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in params ? String(params[name]) : `{${name}}`,
  );
}

export type TFunction = (key: string, params?: Record<string, string | number>) => string;

// One bound `t` per locale, reused across every render and every component -
// useTranslation is called in ~150 places, several of them once per message
// row, so a fresh closure per render there is real allocation churn (and it
// busts downstream memoisation). Rebuilt only when the language actually changes.
const boundT = new Map<Locale, TFunction>();
function getBoundT(locale: Locale): TFunction {
  let fn = boundT.get(locale);
  if (!fn) {
    fn = (key, params) => translate(locale, key, params);
    boundT.set(locale, fn);
  }
  return fn;
}

/** Hook for components - re-renders on locale change. */
export function useTranslation(): { t: TFunction; locale: Locale; setLocale: (l: Locale) => void } {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);
  return { t: getBoundT(locale), locale, setLocale };
}

/** Non-reactive `t` for use outside React (stores, lib helpers). */
export function t(key: string, params?: Record<string, string | number>): string {
  return translate(useI18nStore.getState().locale, key, params);
}
