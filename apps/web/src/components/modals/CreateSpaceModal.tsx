import { createSpace } from "@jorkonvo/matrix-core";
import { type FormEvent, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { useUiStore } from "../../state/uiStore";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

/**
 * Modal for creating a new space (server) with a name and optional topic.
 * Selects the new space on success.
 */
export function CreateSpaceModal() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const selectSpace = useUiStore((s) => s.selectSpace);

  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  // Discord-style default: an invite link (or the bare id) gets someone
  // straight in, no approval step - off by default. Turning this ON is the
  // deliberate opt-in for a screened server (every join needs an admin's
  // yes/no) - not something a space creator would expect just from picking
  // a name. Changeable later in Space Settings > Invites.
  const [requireApprovalToJoin, setRequireApprovalToJoin] = useState(false);
  // Discord-style default: members auto-join every channel created here,
  // no invite needed - off by default because "let anyone outside the
  // space ask to join a channel too" is an active choice, not something a
  // space creator would expect just from picking a name. Changeable later
  // in Space Settings > Invites (spaceSettings.ts allow_room_knocking).
  const [allowRoomKnocking, setAllowRoomKnocking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const spaceId = await createSpace(client, {
        name: name.trim(),
        topic: topic.trim() || undefined,
        requireApprovalToJoin,
        allowRoomKnocking,
      });
      selectSpace(spaceId);
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("createSpace.title")} onClose={close}>
      <form onSubmit={handleSubmit}>
        <ModalField label={t("createSpace.name")}>
          <input
            data-testid="create-space-name"
            className={modalInputClass()}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("createSpace.namePlaceholder")}
            autoFocus
          />
        </ModalField>
        <ModalField label={t("createRoom.topic")}>
          <input
            className={modalInputClass()}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </ModalField>
        <label className="mb-3 flex items-center justify-between gap-3 text-sm text-normal">
          <span>
            {t("createSpace.requireApproval")}
            <span className="block text-xs font-normal text-muted">{t("createSpace.requireApprovalHint")}</span>
          </span>
          <input
            type="checkbox"
            data-testid="create-space-require-approval"
            checked={requireApprovalToJoin}
            onChange={(e) => setRequireApprovalToJoin(e.target.checked)}
            className="h-4 w-4 shrink-0"
          />
        </label>
        <label className="mb-3 flex items-center justify-between gap-3 text-sm text-normal">
          <span>
            {t("createSpace.allowKnocking")}
            <span className="block text-xs font-normal text-muted">{t("createSpace.allowKnockingHint")}</span>
          </span>
          <input
            type="checkbox"
            data-testid="create-space-allow-knocking"
            checked={allowRoomKnocking}
            onChange={(e) => setAllowRoomKnocking(e.target.checked)}
            className="h-4 w-4 shrink-0"
          />
        </label>
        {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" data-testid="create-space-submit" disabled={!name.trim() || busy}>
          {busy ? t("common.creating") : t("common.create")}
        </ModalPrimaryButton>
      </form>
    </Modal>
  );
}
