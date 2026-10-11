import { type ChannelAccess, createRoom, getSpaceRoles, setChannelAccess, setChannelType } from "@jorkonvo/matrix-core";
import { type FormEvent, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { useUiStore } from "../../state/uiStore";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

/**
 * Modal for creating a new text or voice channel, optionally nested under a
 * parent space, with an encryption toggle. Selects the new room on success.
 *
 * @param parentSpaceId - Space to create the room in, or null for a standalone room.
 */
export function CreateRoomModal({ parentSpaceId }: { parentSpaceId: string | null }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const selectRoom = useUiStore((s) => s.selectRoom);
  const space = parentSpaceId ? client.getRoom(parentSpaceId) : null;
  const spaceRoles = space ? getSpaceRoles(space) : [];

  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isEncrypted, setIsEncrypted] = useState(true);
  const [isVoice, setIsVoice] = useState(false);
  // Discord-style default: everyone on the server sees a new channel - a
  // space member's client auto-joins it (see channelAccess.ts's reactive
  // watcher), no invite needed. Restricting to roles is opt-in, same as
  // knocking for space creation (see CreateSpaceModal).
  const [access, setAccess] = useState<ChannelAccess>({ mode: "open", roleIds: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const roomId = await createRoom(client, {
        name: name.trim(),
        topic: topic.trim() || undefined,
        isEncrypted,
        parentSpaceId: parentSpaceId ?? undefined,
      });
      if (isVoice) await setChannelType(client, roomId, "voice");
      if (parentSpaceId && access.mode === "restricted" && access.roleIds.length > 0) {
        await setChannelAccess(client, roomId, access);
      }
      selectRoom(roomId);
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("createRoom.title")} onClose={close}>
      <form onSubmit={handleSubmit}>
        <ModalField label={t("createRoom.name")}>
          <input
            data-testid="create-room-name"
            className={modalInputClass()}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("createRoom.namePlaceholder")}
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
        <div className="mb-4">
          <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("createRoom.channelType")}</span>
          <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={!isVoice}
              onClick={() => setIsVoice(false)}
              className={`flex-1 rounded border py-2 text-sm font-medium transition ${
                !isVoice ? "border-brand bg-brand/10 text-header" : "border-border text-muted hover:text-normal"
              }`}
            >
              # {t("createRoom.text")}
            </button>
            <button
              type="button"
              aria-pressed={isVoice}
              onClick={() => setIsVoice(true)}
              className={`flex-1 rounded border py-2 text-sm font-medium transition ${
                isVoice ? "border-brand bg-brand/10 text-header" : "border-border text-muted hover:text-normal"
              }`}
            >
              🔊 {t("createRoom.voice")}
            </button>
          </div>
        </div>
        <label className="mb-1.5 flex items-center gap-2 text-sm text-normal">
          <input
            type="checkbox"
            checked={isEncrypted}
            onChange={(e) => setIsEncrypted(e.target.checked)}
            className="h-4 w-4"
          />
          {t("createRoom.e2ee")}
        </label>
        <p className="mb-4 pl-6 text-xs text-muted">{t("createRoom.e2eeHint")}</p>
        {parentSpaceId && (
          <div className="mb-4">
            <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("channelAccess.title")}</span>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center gap-2 text-sm text-normal">
                <input
                  type="radio"
                  name="createRoomAccess"
                  checked={access.mode === "open"}
                  onChange={() => setAccess({ mode: "open", roleIds: [] })}
                  className="h-4 w-4"
                />
                {t("channelAccess.open")}
              </label>
              <label className="flex items-center gap-2 text-sm text-normal">
                <input
                  type="radio"
                  name="createRoomAccess"
                  checked={access.mode === "restricted"}
                  onChange={() => setAccess({ mode: "restricted", roleIds: access.roleIds })}
                  className="h-4 w-4"
                />
                {t("channelAccess.restricted")}
              </label>
            </div>
            {access.mode === "restricted" && (
              <div className="mt-2">
                {spaceRoles.length === 0 ? (
                  <p className="text-xs text-muted">{t("channelAccess.needRoles")}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {spaceRoles.map((r) => {
                      const on = access.roleIds.includes(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setAccess({
                              mode: "restricted",
                              roleIds: on ? access.roleIds.filter((id) => id !== r.id) : [...access.roleIds, r.id],
                            })
                          }
                          className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition"
                          style={{
                            borderColor: r.color,
                            color: on ? "#fff" : r.color,
                            backgroundColor: on ? r.color : "transparent",
                          }}
                        >
                          {r.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="mt-1.5 text-xs text-muted">{t("channelAccess.roleHint")}</p>
              </div>
            )}
          </div>
        )}
        {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" data-testid="create-room-submit" disabled={!name.trim() || busy}>
          {busy ? t("common.creating") : t("common.create")}
        </ModalPrimaryButton>
      </form>
    </Modal>
  );
}
