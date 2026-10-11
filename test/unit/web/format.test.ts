// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatClockTime, formatDayDivider, formatTimestamp } from "../../../apps/web/src/lib/format.js";
import { useDisplayPrefsStore } from "../../../apps/web/src/lib/displayPrefs.js";
import { useI18nStore } from "../../../apps/web/src/i18n/index.js";

/**
 * format.ts memoises its output in module-level maps keyed on
 * (minute/day bucket | UI locale | clock preference). Two consequences for
 * these tests:
 *  - every test gets its OWN span of calendar days (`dayOffset` grows by 5
 *    per test) so cache buckets never collide across tests;
 *  - "now" is pinned with fake timers, and all timestamps are built with
 *    local-calendar arithmetic, so the suite is timezone-independent.
 *
 * Locale/prefs are seeded through the zustand stores exactly like
 * customCss.test.ts does (the stores read localStorage at module init, which
 * already happened by the time beforeEach runs).
 */

let dayOffset = 0;

beforeEach(() => {
  dayOffset += 5;
  localStorage.clear();
  useDisplayPrefsStore.setState({ timeFormat: "auto" });
  useI18nStore.setState({ locale: "en" });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Pin "now" at hour:minute on this test's own calendar day, optionally shifted `dayShift` days. */
function setNow(hour: number, minute: number, dayShift = 0): void {
  vi.setSystemTime(new Date(2026, 8, 10 + dayOffset + dayShift, hour, minute, 0, 0));
}

/** Epoch ms for hour:minute on the calendar day `dayBack` days before the pinned "now". */
function tsAt(dayBack: number, hour: number, minute: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayBack, hour, minute, 0, 0).getTime();
}

/** "2026.09.15" style numeric day for `dayBack` days before "now" (used in older-than-yesterday labels). */
function numericDay(dayBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dayBack);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}.${mm}.${dd}`;
}

/** Day-of-month number and long month name via Intl (matches date-fns enUS/hu month names). */
function dayOfMonth(dayBack: number): number {
  const d = new Date();
  d.setDate(d.getDate() - dayBack);
  return d.getDate();
}
function longMonth(dayBack: number, tag: "en-US" | "hu-HU"): string {
  const d = new Date();
  d.setDate(d.getDate() - dayBack);
  return d.toLocaleString(tag, { month: "long" });
}

describe("formatTimestamp", () => {
  it("renders today's messages with a 24-hour clock when the preference forces 24h", () => {
    setNow(15, 30);
    useDisplayPrefsStore.getState().setTimeFormat("24h");
    expect(formatTimestamp(tsAt(0, 15, 30))).toBe("15:30");
    expect(formatTimestamp(tsAt(0, 9, 5))).toBe("09:05");
  });

  it("renders today's messages with a 12-hour clock when the preference forces 12h", () => {
    setNow(15, 30);
    useDisplayPrefsStore.getState().setTimeFormat("12h");
    expect(formatTimestamp(tsAt(0, 15, 30))).toBe("3:30 PM");
    // date-fns' "h:mm a" spells noon and just-after-midnight with 12
    expect(formatTimestamp(tsAt(0, 12, 0))).toBe("12:00 PM");
    expect(formatTimestamp(tsAt(0, 0, 5))).toBe("12:05 AM");
  });

  it('"auto" follows the active locale\'s own clock convention', () => {
    setNow(15, 30);
    // en-US is a 12-hour locale per Intl (guard against ICU drift)
    expect(new Intl.DateTimeFormat("en-US", { hour: "numeric" }).resolvedOptions().hour12).toBe(true);
    expect(formatTimestamp(tsAt(0, 15, 30))).toBe("3:30 PM");

    useI18nStore.getState().setLocale("hu");
    // hu-HU is a 24-hour locale per Intl
    expect(new Intl.DateTimeFormat("hu-HU", { hour: "numeric" }).resolvedOptions().hour12).toBe(false);
    expect(formatTimestamp(tsAt(0, 15, 30))).toBe("15:30");
  });

  it("an explicit preference overrides the locale's convention", () => {
    setNow(15, 30);
    useI18nStore.getState().setLocale("hu");
    useDisplayPrefsStore.getState().setTimeFormat("24h");
    expect(formatTimestamp(tsAt(0, 15, 30))).toBe("15:30");

    useI18nStore.getState().setLocale("en");
    useDisplayPrefsStore.getState().setTimeFormat("12h");
    expect(formatTimestamp(tsAt(0, 15, 30))).toBe("3:30 PM");
  });

  it("prefixes yesterday's messages with a localized Yesterday", () => {
    setNow(15, 30);
    useDisplayPrefsStore.getState().setTimeFormat("24h");
    expect(formatTimestamp(tsAt(1, 22, 45))).toBe("Yesterday 22:45");

    useI18nStore.getState().setLocale("hu");
    expect(formatTimestamp(tsAt(1, 22, 45))).toBe("Tegnap 22:45");
  });

  it("keeps an English AM/PM marker in Hungarian for forced 12h (characterization: format() gets no date-fns locale)", () => {
    setNow(15, 30);
    useI18nStore.getState().setLocale("hu");
    useDisplayPrefsStore.getState().setTimeFormat("12h");
    // Current behavior: the "a" pattern falls back to date-fns' default
    // (en-US) marker because formatTimestamp() never passes a locale, unlike
    // formatClockTime() which does localize it ("du. 03:30").
    expect(formatTimestamp(tsAt(0, 15, 30))).toBe("3:30 PM");
    expect(formatTimestamp(tsAt(1, 22, 45))).toBe("Tegnap 10:45 PM");
  });

  it("prefixes older messages with the full numeric date in both clock modes", () => {
    setNow(15, 30);
    useDisplayPrefsStore.getState().setTimeFormat("24h");
    expect(formatTimestamp(tsAt(3, 9, 15))).toBe(`${numericDay(3)} 09:15`);

    useDisplayPrefsStore.getState().setTimeFormat("12h");
    expect(formatTimestamp(tsAt(3, 9, 15))).toBe(`${numericDay(3)} 9:15 AM`);
  });

  it("memoises per clock preference: flipping 24h -> 12h re-keys the same timestamp", () => {
    setNow(15, 30);
    const ts = tsAt(0, 22, 45);

    useDisplayPrefsStore.getState().setTimeFormat("24h");
    expect(formatTimestamp(ts)).toBe("22:45");

    useDisplayPrefsStore.getState().setTimeFormat("12h");
    expect(formatTimestamp(ts)).toBe("10:45 PM");

    // flipping back hits the original cache entry again
    useDisplayPrefsStore.getState().setTimeFormat("24h");
    expect(formatTimestamp(ts)).toBe("22:45");
  });

  it("serves the same minute from the cache, but the cached label goes stale across local midnight (BUG characterization)", () => {
    setNow(23, 58);
    useDisplayPrefsStore.getState().setTimeFormat("24h");
    const ts = tsAt(0, 23, 58);
    expect(formatTimestamp(ts)).toBe("23:58"); // today -> time only

    // Cross local midnight: the correct label is now "Yesterday 23:58", but
    // the minuteCache key at format.ts:40 is `${minute}|${locale}|${clock}`
    // and does not capture the day of "now", so the stale "today" rendering
    // keeps being served until the entry is evicted. Current behavior kept
    // on purpose - do not "fix" this test without fixing the cache key.
    setNow(0, 0, 1);
    expect(formatTimestamp(ts)).toBe("23:58");
  });

  it("clears the whole minute cache once it exceeds its 600-entry cap, after which labels recompute correctly", () => {
    setNow(15, 30);
    useDisplayPrefsStore.getState().setTimeFormat("24h");
    const ts = tsAt(0, 14, 0);
    expect(formatTimestamp(ts)).toBe("14:00"); // cached while "today"

    // Next local morning the stale entry is still served (same cache key)...
    setNow(0, 30, 1);
    expect(formatTimestamp(ts)).toBe("14:00");

    // ...until 700 further distinct minutes push the map past the cap in
    // capped() (format.ts:34) and everything is evicted.
    const filler = tsAt(400, 0, 0); // 400 days back: always "older"
    for (let k = 1; k <= 700; k++) formatTimestamp(filler + k * 60_000);

    expect(formatTimestamp(ts)).toBe("Yesterday 14:00");
  });
});

describe("formatDayDivider", () => {
  it("renders Today for today's messages, re-keyed per UI locale", () => {
    setNow(15, 30);
    const ts = tsAt(0, 9, 0);
    expect(formatDayDivider(ts)).toBe("Today");

    useI18nStore.getState().setLocale("hu");
    expect(formatDayDivider(ts)).toBe("Ma"); // locale is part of the cache key

    useI18nStore.getState().setLocale("en");
    expect(formatDayDivider(ts)).toBe("Today");
  });

  it("renders Yesterday for the previous calendar day in both locales", () => {
    setNow(15, 30);
    const ts = tsAt(1, 12, 0);
    expect(formatDayDivider(ts)).toBe("Yesterday");

    useI18nStore.getState().setLocale("hu");
    expect(formatDayDivider(ts)).toBe("Tegnap");
  });

  it("falls back to a localized absolute date for older messages", () => {
    setNow(15, 30);
    const ts = tsAt(3, 12, 0);
    expect(formatDayDivider(ts)).toBe(`2026. ${longMonth(3, "en-US")} ${dayOfMonth(3)}.`);

    useI18nStore.getState().setLocale("hu");
    expect(formatDayDivider(ts)).toBe(`2026. ${longMonth(3, "hu-HU")} ${dayOfMonth(3)}.`);
  });

  it("buckets by calendar day, not elapsed hours: minutes-before-midnight is Yesterday right after midnight", () => {
    setNow(0, 5, 1); // 00:05 on the day after the message was sent
    useDisplayPrefsStore.getState().setTimeFormat("24h");
    expect(formatDayDivider(tsAt(1, 23, 58))).toBe("Yesterday"); // only 7 minutes old
    expect(formatTimestamp(tsAt(1, 23, 58))).toBe("Yesterday 23:58");
  });

  it("buckets by calendar day: early morning is still Today late the same evening", () => {
    setNow(23, 59);
    useDisplayPrefsStore.getState().setTimeFormat("24h");
    expect(formatDayDivider(tsAt(0, 0, 5))).toBe("Today"); // nearly 24 hours old
    expect(formatTimestamp(tsAt(0, 0, 5))).toBe("00:05");
  });

  it("serves a stale Today divider after local midnight (BUG characterization)", () => {
    setNow(23, 59);
    const ts = tsAt(0, 22, 0);
    expect(formatDayDivider(ts)).toBe("Today");

    // After midnight this divider should read "Yesterday"; the dayCache key
    // at format.ts:60 is `${utc-day bucket}|${locale}` and does not capture
    // that "now" moved to a new local day, so the cached value is returned.
    setNow(0, 1, 1);
    expect(formatDayDivider(ts)).toBe("Today");
  });
});

describe("formatClockTime", () => {
  it("honours a forced 24-hour preference regardless of locale", () => {
    setNow(15, 30);
    useDisplayPrefsStore.getState().setTimeFormat("24h");
    expect(formatClockTime(tsAt(0, 15, 30))).toBe("15:30");
    useI18nStore.getState().setLocale("hu");
    expect(formatClockTime(tsAt(0, 15, 30))).toBe("15:30");
  });

  it("honours a forced 12-hour preference and localizes the AM/PM marker", () => {
    setNow(15, 30);
    useDisplayPrefsStore.getState().setTimeFormat("12h");
    expect(formatClockTime(tsAt(0, 15, 30))).toBe("03:30 PM"); // en-US: 2-digit hour
    useI18nStore.getState().setLocale("hu");
    expect(formatClockTime(tsAt(0, 15, 30))).toBe("du. 03:30"); // hu marker, suffix order
  });

  it("follows the locale's convention in auto mode", () => {
    setNow(15, 30);
    expect(formatClockTime(tsAt(0, 15, 30))).toBe("03:30 PM"); // en-US is 12h
    useI18nStore.getState().setLocale("hu");
    expect(formatClockTime(tsAt(0, 15, 30))).toBe("15:30"); // hu-HU is 24h
  });
});
