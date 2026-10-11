import {
  parseCalendarEvent,
  redactEvent,
  type Room,
  type RsvpStatus,
  rsvpToCalendarEvent,
  tallyCalendarEventRsvps,
} from "@jorkonvo/matrix-core";
import clsx from "clsx";
import { type MatrixEvent } from "matrix-js-sdk";
import { useState } from "react";
import { useTranslation } from "../i18n";
import { intlLocale } from "../lib/dateLocale";
import { uiConfirm } from "../lib/dialogs";
import { formatClockTime } from "../lib/format";
import { useMatrixStore } from "../state/matrixStore";
import { Avatar } from "./Avatar";

const RSVP_OPTIONS: { value: RsvpStatus; labelKey: string; tone: string }[] = [
  { value: "going", labelKey: "calEvent.going", tone: "border-online text-online" },
  { value: "maybe", labelKey: "calEvent.maybe", tone: "border-idle text-idle" },
  { value: "not_going", labelKey: "calEvent.notGoing", tone: "border-dnd text-dnd" },
];

function formatWhen(startTs: number, endTs: number | null): string {
  const start = new Date(startTs);
  const dateLabel = start.toLocaleDateString(intlLocale(), { weekday: "long", month: "long", day: "numeric" });
  const startTime = formatClockTime(startTs);
  if (!endTs) return `${dateLabel} · ${startTime}`;
  const endTime = formatClockTime(endTs);
  return `${dateLabel} · ${startTime}–${endTime}`;
}

const CalendarIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor" aria-hidden="true">
    <path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V10h14v10ZM5 8V6h14v2H5Z" />
  </svg>
);

/**
 * Timeline card for a calendar event: title, time range, location and
 * description, RSVP buttons (going / maybe / not going — picking the current
 * status again clears it) with a going tally and attendee avatars, plus a
 * delete action for the event's organizer. Past events render read-only.
 *
 * @param ev - The calendar event message/state event to render.
 * @param room - The room the event belongs to (RSVPs are tallied from it).
 */
export function CalendarEventCard({ ev, room }: { ev: MatrixEvent; room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const [busy, setBusy] = useState(false);

  const eventId = ev.getId();
  if (!eventId) return null;

  const event = parseCalendarEvent(ev);
  const tally = tallyCalendarEventRsvps(room, eventId, client.getUserId() ?? "");
  if (!event || !tally) return null;

  const isOwner = event.senderId === client.getUserId();
  const isPast = (event.endTs ?? event.startTs) < Date.now();

  async function handleRsvp(status: RsvpStatus) {
    if (busy) return;
    setBusy(true);
    try {
      // Toggling the same status again clears the RSVP back to "no answer" -
      // sending the current status once more is a harmless no-op there.
      await rsvpToCalendarEvent(client, room.roomId, eventId!, status);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!(await uiConfirm(t("calEvent.deleteConfirm", { title: event!.title }), { danger: true }))) return;
    setBusy(true);
    try {
      await redactEvent(client, room.roomId, eventId!);
    } finally {
      setBusy(false);
    }
  }

  const attendeePreview = tally.goingUserIds.slice(0, 5);
  const attendeeOverflow = tally.goingUserIds.length - attendeePreview.length;

  return (
    <div className={clsx("mt-1 max-w-md rounded-lg border border-border bg-bg-secondary p-3", isPast && "opacity-70")}>
      <div className="mb-1 flex items-start gap-2 text-brand">
        {CalendarIcon}
        <span className="font-medium text-header">{event.title}</span>
      </div>
      <p className="mb-1 text-sm text-normal">{formatWhen(event.startTs, event.endTs)}</p>
      {event.location && <p className="mb-1 text-xs text-muted">📍 {event.location}</p>}
      {event.description && <p className="mb-2 whitespace-pre-wrap text-sm text-normal">{event.description}</p>}

      {isPast ? (
        <p className="text-xs text-muted">{t("calEvent.past")}</p>
      ) : (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {RSVP_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={busy}
              aria-pressed={tally.myStatus === opt.value}
              onClick={() => void handleRsvp(opt.value)}
              className={clsx(
                "rounded border px-2.5 py-1 text-xs font-medium transition disabled:cursor-default disabled:opacity-60",
                tally.myStatus === opt.value ? opt.tone : "border-border text-muted hover:text-normal",
              )}
            >
              {tally.myStatus === opt.value && "✓ "}
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted">
        <div className="flex items-center gap-1.5">
          {attendeePreview.length > 0 && (
            <div className="flex -space-x-1.5">
              {attendeePreview.map((userId) => {
                const member = room.getMember(userId);
                return (
                  <div key={userId} className="rounded-full ring-2 ring-bg-secondary" title={member?.name ?? userId}>
                    <Avatar
                      url={member?.getAvatarUrl(client.baseUrl, 20, 20, "crop", false, false) ?? null}
                      name={member?.name ?? userId}
                      size={20}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <span>
            {t("calEvent.goingCount", { count: tally.countsByStatus.going })}
            {tally.countsByStatus.maybe > 0 ? ` · ${t("calEvent.maybeSuffix", { count: tally.countsByStatus.maybe })}` : ""}
            {attendeeOverflow > 0 ? ` (+${attendeeOverflow})` : ""}
          </span>
        </div>
        {isOwner && (
          <button type="button" onClick={() => void handleCancel()} disabled={busy} className="font-medium text-link hover:underline">
            {t("calEvent.delete")}
          </button>
        )}
      </div>
    </div>
  );
}
