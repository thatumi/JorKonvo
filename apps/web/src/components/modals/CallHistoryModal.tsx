import { useState } from "react";
import { useTranslation } from "../../i18n";
import { type CallHistoryEntry, clearCallHistory, getCallHistory } from "../../lib/callHistory";
import { uiConfirm } from "../../lib/dialogs";
import { formatTimestamp } from "../../lib/format";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { Modal } from "../Modal";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function CallHistoryRow({ entry }: { entry: CallHistoryEntry }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const room = client.getRoom(entry.roomId);
  const roomName = room?.name ?? entry.roomId;
  const missed = !entry.everConnected;

  const statusLabel = missed
    ? entry.direction === "incoming"
      ? t("callHistory.missedIncoming")
      : t("callHistory.missedOutgoing")
    : entry.isGroupCall
      ? t("call.groupCall")
      : entry.direction === "incoming"
        ? t("callHistory.incoming")
        : t("callHistory.outgoing");

  return (
    <div className="flex items-center gap-3 rounded px-2 py-2 hover:bg-bg-modifier-hover">
      <span className={`shrink-0 ${missed ? "text-dnd" : "text-online"}`}>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
          {entry.direction === "incoming" ? (
            <path d="M20 15.5c-1.25 0-2.45-.2-3.57-.57a1 1 0 0 0-1.02.24l-2.2 2.2a15.05 15.05 0 0 1-6.59-6.59l2.2-2.2a1 1 0 0 0 .25-1.02A11.36 11.36 0 0 1 8.5 4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1c0 9.39 7.61 17 17 17a1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1Z" />
          ) : (
            <path d="M20 15.5c-1.25 0-2.45-.2-3.57-.57a1 1 0 0 0-1.02.24l-2.2 2.2a15.05 15.05 0 0 1-6.59-6.59l2.2-2.2a1 1 0 0 0 .25-1.02A11.36 11.36 0 0 1 8.5 4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1c0 9.39 7.61 17 17 17a1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1ZM17.71 6.29 15 9V4h5l-2.29 2.29Z" />
          )}
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-normal">{roomName}</div>
        <div className="truncate text-xs text-muted">
          {statusLabel} · {formatTimestamp(entry.startedAt)}
          {entry.everConnected && ` · ${formatDuration(entry.endedAt - entry.startedAt)}`}
        </div>
      </div>
    </div>
  );
}

/** A local (this-device-only) log of past calls - see callHistory.ts for why it isn't account data. */
export function CallHistoryModal() {
  const { t } = useTranslation();
  const close = useModalStore((s) => s.close);
  const [entries, setEntries] = useState(getCallHistory);

  async function handleClear() {
    if (!(await uiConfirm(t("callHistory.clearConfirm"), { danger: true }))) return;
    clearCallHistory();
    setEntries([]);
  }

  return (
    <Modal title={t("callHistory.title")} onClose={close}>
      <p className="mb-3 text-xs text-muted">{t("callHistory.deviceOnly")}</p>
      {entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t("callHistory.empty")}</p>
      ) : (
        <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
          {entries.map((entry) => (
            <CallHistoryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <button
          type="button"
          onClick={handleClear}
          className="mt-3 w-full rounded border border-border py-1.5 text-xs font-medium text-muted hover:bg-bg-modifier-hover hover:text-dnd"
        >
          {t("callHistory.clear")}
        </button>
      )}
    </Modal>
  );
}
