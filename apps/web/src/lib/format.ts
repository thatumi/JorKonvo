import { format, isToday, isYesterday } from "date-fns";
import { t } from "../i18n";
import { dfLocale, intlLocale } from "./dateLocale";
import { prefers12Hour } from "./displayPrefs";

/**
 * The date-fns time pattern honouring the user's Time format preference
 * ("auto" falls back to whatever the active locale's own clock convention
 * is). Both outputs are cache-keyed on this via `clockKey()`.
 */
function timePattern(): string {
  const forced = prefers12Hour();
  const localeUses12h = new Intl.DateTimeFormat(intlLocale(), { hour: "numeric" }).resolvedOptions().hour12 ?? false;
  return (forced ?? localeUses12h) ? "h:mm a" : "HH:mm";
}

function clockKey(): string {
  const forced = prefers12Hour();
  return forced === null ? "auto" : forced ? "12h" : "24h";
}

// Timeline.tsx calls formatDayDivider() once per loaded event on every
// re-render (hundreds after scrollback), and formatTimestamp() once per
// message group - date-fns `format` with a locale isn't free at that volume.
// Both outputs only depend on a coarse time bucket + the UI language, so
// memoise on that. The size cap keeps the maps bounded in a long session.
const dayCache = new Map<string, string>();
const minuteCache = new Map<string, string>();

function capped(map: Map<string, string>, key: string, build: () => string): string {
  const hit = map.get(key);
  if (hit !== undefined) return hit;
  const value = build();
  if (map.size > 600) map.clear();
  map.set(key, value);
  return value;
}

export function formatTimestamp(ts: number): string {
  return capped(minuteCache, `${Math.floor(ts / 60000)}|${intlLocale()}|${clockKey()}`, () => {
    const date = new Date(ts);
    const time = timePattern();
    if (isToday(date)) return format(date, time);
    if (isYesterday(date)) return t("date.yesterdayAt", { time: format(date, time) });
    return format(date, `yyyy.MM.dd ${time}`);
  });
}

/** A bare "clock time" (hours:minutes) honouring the user's Time format preference. */
export function formatClockTime(ts: number): string {
  const forced = prefers12Hour();
  return new Date(ts).toLocaleTimeString(intlLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    ...(forced === null ? {} : { hour12: forced }),
  });
}

export function formatDayDivider(ts: number): string {
  return capped(dayCache, `${Math.floor(ts / 86400000)}|${intlLocale()}`, () => {
    const date = new Date(ts);
    if (isToday(date)) return t("date.today");
    if (isYesterday(date)) return t("date.yesterday");
    return format(date, "yyyy. MMMM d.", { locale: dfLocale() });
  });
}
