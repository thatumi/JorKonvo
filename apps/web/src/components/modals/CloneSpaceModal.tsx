import { cloneSpaceAsTemplate, getRoomsInSpace, getSpaceCategories, getSpaceRoles } from "@jorkonvo/matrix-core";
import { type FormEvent, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { useUiStore } from "../../state/uiStore";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

/** Clones a space's structure (categories/channels/roles - not content or members) into a brand new space. See spaceTemplate.ts for exactly what does and doesn't get copied. */
export function CloneSpaceModal({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const selectSpace = useUiStore((s) => s.selectSpace);
  const space = client.getRoom(spaceId);

  const [name, setName] = useState(space ? t("cloneSpace.nameSuffix", { name: space.name }) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!space) return null;

  const channelCount = getRoomsInSpace(client, spaceId).length;
  const categoryCount = getSpaceCategories(space).length;
  const roleCount = getSpaceRoles(space).length;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const newSpaceId = await cloneSpaceAsTemplate(client, spaceId, name.trim());
      selectSpace(newSpaceId);
      close();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={t("cloneSpace.title")} onClose={close}>
      <form onSubmit={handleSubmit}>
        <p className="mb-3 text-xs text-muted">
          {t("cloneSpace.summary", { categories: categoryCount, channels: channelCount, roles: roleCount })}
        </p>
        <ModalField label={t("cloneSpace.nameLabel")}>
          <input className={modalInputClass()} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </ModalField>
        {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" disabled={!name.trim() || busy}>
          {busy ? t("cloneSpace.cloning") : t("cloneSpace.clone")}
        </ModalPrimaryButton>
      </form>
    </Modal>
  );
}
