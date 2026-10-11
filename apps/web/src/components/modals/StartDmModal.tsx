import { searchUsers, startDirectMessage, type UserSearchResult } from "@jorkonvo/matrix-core";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { useUiStore } from "../../state/uiStore";
import { Avatar } from "../Avatar";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

/**
 * Modal for starting a direct message: type a Matrix ID or search for users
 * (debounced directory lookup) and pick a result to open the DM with.
 */
export function StartDmModal() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const selectSpace = useUiStore((s) => s.selectSpace);
  const selectRoom = useUiStore((s) => s.selectRoom);

  const [userId, setUserId] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = userId.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      searchUsers(client, term)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [client, userId]);

  async function startWith(id: string) {
    setBusy(true);
    setError(null);
    try {
      const roomId = await startDirectMessage(client, id);
      selectSpace(null);
      selectRoom(roomId);
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = userId.trim();
    if (!trimmed || busy) return;
    await startWith(trimmed);
  }

  return (
    <Modal title={t("sidebar.startDm")} onClose={close}>
      <form onSubmit={handleSubmit}>
        <ModalField label={t("startDm.label")}>
          <input
            data-testid="start-dm-userid"
            className={modalInputClass()}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="@alice:matrix.org"
            autoFocus
          />
        </ModalField>

        {(results.length > 0 || searching) && (
          <div className="mb-3 max-h-48 overflow-y-auto rounded bg-bg-darkest">
            {searching && <p aria-live="polite" className="px-3 py-2 text-xs text-muted">{t("common.searching")}</p>}
            {results.map((r) => (
              <button
                key={r.userId}
                type="button"
                disabled={busy}
                onClick={() => void startWith(r.userId)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-bg-modifier-hover disabled:opacity-60"
              >
                <Avatar
                  url={r.avatarMxcUrl ? client.mxcUrlToHttp(r.avatarMxcUrl, 28, 28, "crop") : null}
                  name={r.displayName ?? r.userId}
                  size={28}
                />
                <div className="min-w-0">
                  <div className="truncate text-sm text-normal">{r.displayName ?? r.userId}</div>
                  {r.displayName && <div className="truncate text-xs text-muted">{r.userId}</div>}
                </div>
              </button>
            ))}
          </div>
        )}

        {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" data-testid="start-dm-submit" disabled={!userId.trim() || busy}>
          {busy ? t("common.starting") : t("startDm.submit")}
        </ModalPrimaryButton>
      </form>
    </Modal>
  );
}
