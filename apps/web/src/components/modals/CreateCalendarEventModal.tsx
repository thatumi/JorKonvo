import { createCalendarEvent } from "@jorkonvo/matrix-core";
import { type FormEvent, useState } from "react";
import { useMatrixStore } from "../../state/matrixStore";
import { useTranslation } from "../../i18n";
import { useModalStore } from "../../state/modalStore";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

// Defaults to "in one hour, rounded to the next quarter" - a sensible
// starting point rather than an empty/past date.
function defaultDateTime(): { date: string; time: string } {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/**
 * Modal for scheduling a calendar event in a room: title, optional
 * description/location, and a date+time pair (defaults to roughly one hour
 * ahead). Posts the event state on submit.
 *
 * @param roomId - Matrix room ID of the room the event is created in.
 */
export function CreateCalendarEventModal({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const initial = defaultDateTime();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startTs = date && time ? new Date(`${date}T${time}`).getTime() : NaN;
  const isValid = title.trim().length > 0 && !Number.isNaN(startTs);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createCalendarEvent(client, roomId, {
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        startTs,
      });
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("createCal.title")} onClose={close}>
      <form onSubmit={handleSubmit}>
        <ModalField label={t("createCal.nameLabel")}>
          <input
            className={modalInputClass()}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("createCal.namePlaceholder")}
            autoFocus
          />
        </ModalField>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <ModalField label={t("createCal.dateLabel")}>
            <input
              type="date"
              className={modalInputClass()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </ModalField>
          <ModalField label={t("createCal.timeLabel")}>
            <input
              type="time"
              className={modalInputClass()}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </ModalField>
        </div>

        <ModalField label={t("createCal.locationLabel")}>
          <input
            className={modalInputClass()}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t("createCal.locationPlaceholder")}
          />
        </ModalField>

        <ModalField label={t("createCal.descLabel")}>
          <textarea
            className={`${modalInputClass()} min-h-20 resize-y`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("createCal.descPlaceholder")}
          />
        </ModalField>

        {!Number.isNaN(startTs) && startTs < Date.now() && (
          <p className="mb-3 text-xs text-dnd">{t("createCal.pastWarning")}</p>
        )}
        {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" disabled={!isValid || busy}>
          {busy ? t("createCal.creating") : t("createCal.create")}
        </ModalPrimaryButton>
      </form>
    </Modal>
  );
}
