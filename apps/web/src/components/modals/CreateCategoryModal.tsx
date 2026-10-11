import { createCategory } from "@jorkonvo/matrix-core";
import { type FormEvent, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

/**
 * Modal for adding a named category (channel grouping) to a space.
 * Closes on success; the sidebar shows the new category via sync.
 *
 * @param spaceId - Matrix room ID of the space to add the category to.
 */
export function CreateCategoryModal({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createCategory(client, spaceId, name.trim());
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("sidebar.newCategory")} onClose={close}>
      <form onSubmit={handleSubmit}>
        <ModalField label={t("createCategory.name")}>
          <input
            className={modalInputClass()}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("createCategory.namePlaceholder")}
            autoFocus
          />
        </ModalField>
        {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" disabled={!name.trim() || busy}>
          {busy ? t("common.creating") : t("common.create")}
        </ModalPrimaryButton>
      </form>
    </Modal>
  );
}
