import { enUS, hu, type Locale } from "date-fns/locale";
import { useI18nStore } from "../i18n";

/** The date-fns locale matching the app's current UI language - for month/weekday names and relative-time phrasing. */
export function dfLocale(): Locale {
  return useI18nStore.getState().locale === "hu" ? hu : enUS;
}

/** The BCP-47 tag for `Intl` / `toLocaleString` calls. */
export function intlLocale(): string {
  return useI18nStore.getState().locale === "hu" ? "hu-HU" : "en-US";
}
