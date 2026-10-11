import { getEditHistory, type MessageEditVersion } from "@jorkonvo/matrix-core";
import { useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { formatTimestamp } from "../../lib/format";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { Modal } from "../Modal";

/** Full edit history for one message, via the server's relations endpoint (see editHistory.ts) - oldest version first, newest last. */
export function EditHistoryModal({ roomId, eventId }: { roomId: string; eventId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const [versions, setVersions] = useState<MessageEditVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const room = client.getRoom(roomId);
    const original = room?.findEventById(eventId);
    if (!original) {
      setError(t("editHistory.notFound"));
      return;
    }
    let cancelled = false;
    getEditHistory(client, roomId, original)
      .then((result) => {
        if (!cancelled) setVersions(result);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, roomId, eventId]);

  return (
    <Modal title={t("editHistory.title")} onClose={close}>
      {error && <p role="alert" className="rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
      {versions === null && !error && <p className="py-6 text-center text-sm text-muted">{t("common.loading")}</p>}
      {versions && (
        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
          {versions.map((v, i) => (
            <div key={v.eventId + i} className="rounded border border-border p-2.5">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                <span className="font-medium">{v.isOriginal ? t("editHistory.original") : t("editHistory.nthEdit", { n: i })}</span>
                <span>·</span>
                <span>{formatTimestamp(v.ts)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-normal">{v.body}</p>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
