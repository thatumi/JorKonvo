import {
  addReactionRoleBinding,
  getOwningSpace,
  getReactionRoleBindings,
  getSpaceRoles,
  type ReactionRoleBinding,
  removeReactionRoleBinding,
} from "@jorkonvo/matrix-core";
import { useRef, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { EmojiPicker } from "../EmojiPicker";
import { Modal } from "../Modal";

/** Set up (or manage) "react with an emoji to get a role" bindings on one message - see reactionRoles.ts for the enforcement side. */
export function ReactionRoleModal({ roomId, eventId }: { roomId: string; eventId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const close = useModalStore((s) => s.close);
  const room = client.getRoom(roomId);
  const owningSpace = room ? getOwningSpace(client, roomId) : null;
  const spaceRoles = owningSpace ? getSpaceRoles(owningSpace) : [];

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedEmoji, setPickedEmoji] = useState<string | null>(null);
  const [pickedRoleId, setPickedRoleId] = useState<string>(spaceRoles[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  // sendStateEvent has no local echo - optimistic override, same pattern already used repeatedly (AutoMod, forum tags, policy lists).
  const [bindingsOverride, setBindingsOverride] = useState<ReactionRoleBinding[] | null>(null);
  const allBindings = bindingsOverride ?? (room ? getReactionRoleBindings(room) : []);
  const bindingsForThisMessage = allBindings.filter((b) => b.eventId === eventId);

  if (!room || !owningSpace) {
    return (
      <Modal title={t("reactionRole.notAvailable")} onClose={close}>
        <p className="text-sm text-muted">
          {t("reactionRole.notAvailableHint")}
        </p>
      </Modal>
    );
  }

  async function handleAdd() {
    if (!pickedEmoji || !pickedRoleId) return;
    setBusy(true);
    setError(null);
    try {
      await addReactionRoleBinding(client, roomId, eventId, pickedEmoji, pickedRoleId);
      setBindingsOverride([
        ...allBindings.filter((b) => !(b.eventId === eventId && b.emoji === pickedEmoji)),
        { eventId, emoji: pickedEmoji, roleId: pickedRoleId },
      ]);
      setPickedEmoji(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(binding: ReactionRoleBinding) {
    setBusy(true);
    setError(null);
    try {
      await removeReactionRoleBinding(client, roomId, binding.eventId, binding.emoji);
      setBindingsOverride(allBindings.filter((b) => !(b.eventId === binding.eventId && b.emoji === binding.emoji)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("reactionRole.title")} onClose={close}>
      <p className="mb-3 text-xs text-muted">
        {t("reactionRole.hint")}
      </p>

      {bindingsForThisMessage.length > 0 && (
        <div className="mb-3 flex flex-col gap-1.5">
          {bindingsForThisMessage.map((b) => {
            const role = spaceRoles.find((r) => r.id === b.roleId);
            return (
              <div key={b.emoji} className="flex items-center gap-2 rounded bg-bg-darkest px-2.5 py-1.5 text-sm">
                <span className="text-base">{b.emoji}</span>
                <span className="flex-1" style={{ color: role?.color }}>
                  {role?.name ?? t("reactionRole.deletedRole")}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRemove(b)}
                  className="text-xs text-muted hover:text-dnd disabled:opacity-50"
                >
                  {t("reactionRole.remove")}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {spaceRoles.length === 0 ? (
        <p className="text-sm text-muted">{t("reactionRole.noRoles")}</p>
      ) : (
        <div className="flex items-center gap-2">
          <button
            ref={emojiButtonRef}
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border text-lg hover:bg-bg-modifier-hover"
            title={t("reactionRole.pickEmoji")}
            aria-label={pickedEmoji ?? t("reactionRole.pickEmoji")}
          >
            {pickedEmoji ?? "➕"}
          </button>
          {pickerOpen && emojiButtonRef.current && (
            <EmojiPicker
              anchorEl={emojiButtonRef.current}
              onPick={(pick) => {
                if ("char" in pick) setPickedEmoji(pick.char);
                setPickerOpen(false);
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}
          <select
            value={pickedRoleId}
            onChange={(e) => setPickedRoleId(e.target.value)}
            aria-label={t("reactionRole.roleSelectLabel")}
            className="min-w-0 flex-1 rounded bg-bg-darkest px-3 py-2 text-sm text-normal outline-none"
          >
            {spaceRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !pickedEmoji || !pickedRoleId}
            onClick={() => void handleAdd()}
            className="shrink-0 rounded bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {t("reactionRole.add")}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
    </Modal>
  );
}
