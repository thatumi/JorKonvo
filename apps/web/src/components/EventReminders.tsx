import { getOwningSpace, getUpcomingCalendarEvents, tallyCalendarEventRsvps } from "@jorkonvo/matrix-core";
import { t } from "../i18n";
import { useEffect, useRef } from "react";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";

const REMINDER_WINDOW_MS = 10 * 60 * 1000; // "starting in ~10 minutes", like Discord's event reminder
const POLL_INTERVAL_MS = 60 * 1000;

/**
 * Invisible component: fires a local desktop notification ~10 minutes before
 * a scheduled event the user RSVP'd "going" to starts - the same nudge
 * Discord sends for events you marked yourself interested in. This only
 * works while the app is open (same limitation as NotificationManager - a
 * true background reminder would need a service worker or server-side push,
 * out of scope for now), so it polls rather than scheduling exact timers.
 */
export function EventReminders() {
  const client = useMatrixStore((s) => s.client);
  const remindedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!client) return;
    const activeClient = client;
    if (typeof Notification === "undefined") return;

    function checkReminders() {
      if (Notification.permission !== "granted") return;
      const myId = activeClient.getUserId() ?? "";
      const now = Date.now();

      for (const event of getUpcomingCalendarEvents(activeClient)) {
        if (remindedRef.current.has(event.eventId)) continue;
        const minutesAway = event.startTs - now;
        if (minutesAway <= 0 || minutesAway > REMINDER_WINDOW_MS) continue;

        const room = activeClient.getRoom(event.roomId);
        if (!room) continue;
        const tally = tallyCalendarEventRsvps(room, event.eventId, myId);
        if (tally?.myStatus !== "going") continue;

        remindedRef.current.add(event.eventId);
        const minutes = Math.max(1, Math.round(minutesAway / 60000));
        const notification = new Notification(t("eventReminder.title", { title: event.title }), {
          body: t("eventReminder.body", {
            minutes,
            location: event.location ? t("eventReminder.bodyLocation", { location: event.location }) : "",
            room: room.name,
          }),
          tag: `event-reminder-${event.eventId}`,
        });
        notification.onclick = () => {
          window.focus();
          const owningSpace = getOwningSpace(activeClient, event.roomId);
          const { selectSpace, selectRoom, jumpToEvent } = useUiStore.getState();
          selectSpace(owningSpace ? owningSpace.roomId : null);
          selectRoom(event.roomId);
          jumpToEvent(event.eventId);
          notification.close();
        };
      }
    }

    checkReminders();
    const interval = setInterval(checkReminders, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [client]);

  return null;
}
