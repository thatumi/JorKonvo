import { getRoomAuditLog } from "@jorkonvo/matrix-core";
import { useTranslation } from "../../i18n";
import { formatTimestamp } from "../../lib/format";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { Modal } from "../Modal";

/** Read-only list of a room's moderation/audit entries (`getRoomAuditLog`), newest activity with timestamps. */
export function AuditLogModal({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const close = useModalStore((s) => s.close);

  const room = client.getRoom(roomId);
  if (!room) return null;

  const entries = getRoomAuditLog(room);

  return (
    <Modal title={t("auditLog.title")} onClose={close}>
      <p className="mb-3 text-xs text-muted">{t("auditLog.summary")}</p>
      <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
        {entries.length === 0 && <p className="text-sm text-muted">{t("auditLog.empty")}</p>}
        {entries.map((entry) => (
          <div key={entry.id} className="rounded px-2 py-1.5 text-sm odd:bg-bg-secondary/50">
            <span className="text-normal">{entry.description}</span>
            <span className="ml-2 text-xs text-muted">{formatTimestamp(entry.ts)}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
