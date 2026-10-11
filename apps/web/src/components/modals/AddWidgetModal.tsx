import { addWidget } from "@jorkonvo/matrix-core";
import { type FormEvent, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

/** Adds a widget (name + embed URL) to a room via `addWidget` - the room settings' "add widget" flow. */
export function AddWidgetModal({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addWidget(client, roomId, { name: name.trim(), url: url.trim() });
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("addWidget.title")} onClose={close}>
      <p className="mb-4 text-sm text-muted">{t("addWidget.summary")}</p>
      <form onSubmit={handleSubmit}>
        <ModalField label={t("addWidget.nameLabel")}>
          <input
            className={modalInputClass()}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("addWidget.namePlaceholder")}
            autoFocus
          />
        </ModalField>
        <ModalField label="URL">
          <input
            className={modalInputClass()}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </ModalField>
        {error && <p role="alert" className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" disabled={!name.trim() || !url.trim() || busy}>
          {busy ? t("addWidget.adding") : t("addWidget.add")}
        </ModalPrimaryButton>
      </form>
    </Modal>
  );
}
