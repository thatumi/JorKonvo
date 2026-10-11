import { type CalendarEventData, getOwningSpace, getUpcomingCalendarEvents } from "@jorkonvo/matrix-core";
import { intlLocale } from "../lib/dateLocale";
import { formatClockTime } from "../lib/format";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";

function formatDayLabel(ts: number): string {
  const date = new Date(ts);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Ma";
  if (sameDay(date, tomorrow)) return "Holnap";
  return date.toLocaleDateString(intlLocale(), { weekday: "long", month: "long", day: "numeric" });
}

function formatTime(ts: number): string {
  return formatClockTime(ts);
}

function groupByDay(events: CalendarEventData[]): { label: string; events: CalendarEventData[] }[] {
  const groups: { label: string; events: CalendarEventData[] }[] = [];
  for (const event of events) {
    const label = formatDayLabel(event.startTs);
    const last = groups.at(-1);
    if (last && last.label === label) last.events.push(event);
    else groups.push({ label, events: [event] });
  }
  return groups;
}

function CalendarIcon({ className = "h-5 w-5 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V10h14v10ZM5 8V6h14v2H5Z" />
    </svg>
  );
}

/**
 * Home-tab upcoming-events view: calendar events from joined rooms grouped by
 * day (today/tomorrow/weekday); picking an event jumps to it in its room.
 */
export function EventsPanel() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const selectRoom = useUiStore((s) => s.selectRoom);
  const selectSpace = useUiStore((s) => s.selectSpace);
  const jumpToEvent = useUiStore((s) => s.jumpToEvent);

  const groups = groupByDay(getUpcomingCalendarEvents(client));

  function openEvent(event: CalendarEventData) {
    const owningSpace = getOwningSpace(client, event.roomId);
    selectSpace(owningSpace ? owningSpace.roomId : null);
    selectRoom(event.roomId);
    jumpToEvent(event.eventId);
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 shadow-sm">
        <CalendarIcon className="h-5 w-5 shrink-0 text-header" />
        <h2 className="text-[15px] font-semibold text-header">{t("events.title")}</h2>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
        {groups.length === 0 ? (
          <p className="text-sm text-muted">
            {t("events.empty")}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.label}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{group.label}</h3>
              <div className="flex flex-col gap-0.5">
                {group.events.map((event) => {
                  const room = client.getRoom(event.roomId);
                  return (
                    <button
                      key={event.eventId}
                      type="button"
                      onClick={() => openEvent(event)}
                      className="flex items-start gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-bg-modifier-hover"
                    >
                      <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-brand/15 text-brand">
                        <CalendarIcon />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-header">{event.title}</div>
                        <div className="truncate text-xs text-muted">
                          {formatTime(event.startTs)}
                          {event.location ? ` · 📍 ${event.location}` : ""}
                          {room ? ` · #${room.name}` : ""}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
