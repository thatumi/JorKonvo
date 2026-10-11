import { type MatrixClient, getEventsNeedingReminder } from "@jorkonvo/matrix-core";
import { playNotificationSoundForRoom } from "./notificationSound";

/**
 * Discord/Google-Calendar-style "starting soon" reminder for events this
 * account RSVP'd going/maybe to - a browser Notification, best-effort like
 * everything else client-side in this app (only fires while a JorKonvo tab
 * is open and polling; there's no server-side scheduling mechanism for a
 * fully custom event type like this).
 *
 * "Already reminded" is tracked in localStorage (not account data) - it's
 * purely about not re-notifying the SAME device twice for the same event,
 * not something meaningful to sync across the account's other clients.
 */

const REMINDED_KEY = "jorkonvo-calendar-reminded";
const LEAD_MS_KEY = "jorkonvo-calendar-reminder-lead-ms";
const DEFAULT_LEAD_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 30_000;

export const REMINDER_LEAD_PRESETS = [
  { labelKey: "reminderLead.off", ms: 0 },
  { labelKey: "reminderLead.5m", ms: 5 * 60 * 1000 },
  { labelKey: "reminderLead.10m", ms: 10 * 60 * 1000 },
  { labelKey: "reminderLead.30m", ms: 30 * 60 * 1000 },
  { labelKey: "reminderLead.1h", ms: 60 * 60 * 1000 },
] as const;

export function getReminderLeadMs(): number {
  const stored = localStorage.getItem(LEAD_MS_KEY);
  // `Number(null)` is 0, not NaN - and 0 is also the "off" preset's value,
  // so a never-set lead time would otherwise match it and silently disable
  // reminders instead of falling back to the default.
  if (stored === null) return DEFAULT_LEAD_MS;
  const raw = Number(stored);
  return REMINDER_LEAD_PRESETS.some((p) => p.ms === raw) ? raw : DEFAULT_LEAD_MS;
}

export function setReminderLeadMs(ms: number): void {
  localStorage.setItem(LEAD_MS_KEY, String(ms));
}

function getRemindedIds(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(REMINDED_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function markReminded(eventId: string): void {
  const ids = getRemindedIds();
  ids.add(eventId);
  // Bounded growth - keep only the most recent 200 (a plain Set has no
  // insertion-order-trimming primitive, but Array.from preserves it).
  const trimmed = Array.from(ids).slice(-200);
  localStorage.setItem(REMINDED_KEY, JSON.stringify(trimmed));
}

export function wireCalendarReminders(client: MatrixClient): () => void {
  function tick() {
    const leadMs = getReminderLeadMs();
    if (leadMs <= 0) return; // reminders turned off
    const reminded = getRemindedIds();
    const due = getEventsNeedingReminder(client, leadMs).filter((ev) => !reminded.has(ev.eventId));
    for (const ev of due) {
      markReminded(ev.eventId);
      const room = client.getRoom(ev.roomId);
      const minutesLeft = Math.max(1, Math.round((ev.startTs - Date.now()) / 60000));
      playNotificationSoundForRoom(ev.roomId);
      if (typeof Notification === "undefined" || Notification.permission !== "granted") continue;
      const notification = new Notification(`📅 ${ev.title} — ${minutesLeft} perc múlva`, {
        body: room ? `#${room.name}${ev.location ? ` · ${ev.location}` : ""}` : ev.location,
        tag: `calendar-reminder-${ev.eventId}`,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    }
  }
  const interval = setInterval(tick, POLL_INTERVAL_MS);
  tick(); // catch anything already due right when this account comes online
  return () => clearInterval(interval);
}
