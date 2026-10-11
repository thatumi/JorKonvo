import {
  joinRoomByIdOrAlias,
  joinRoomFromInviteLink,
  knockRoomByIdOrAlias,
  parseInviteLink,
  type PublicRoomResult,
  searchPublicRooms,
} from "@jorkonvo/matrix-core";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { useUiStore } from "../../state/uiStore";
import { Avatar } from "../Avatar";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

/**
 * Modal for joining a room by ID/alias (falling back to a knock request when
 * joining is forbidden) plus a live, debounced list of public rooms from the
 * homeserver directory.
 *
 * `initialTarget` comes from an invite link that was already resolved before
 * this modal opened (a pasted matrix.to/JorKonvo link, or a native App
 * Link/Universal Link caught by lib/inviteLinkHandler.ts) - it pre-fills the
 * field AND auto-attempts the join immediately, matching Discord's "click a
 * link, you're in" flow instead of making the user press Join again on
 * something they already expressed clear intent to join.
 */
export function JoinRoomModal({ initialTarget }: { initialTarget?: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const selectRoom = useUiStore((s) => s.selectRoom);

  const [idOrAlias, setIdOrAlias] = useState(initialTarget ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicRooms, setPublicRooms] = useState<PublicRoomResult[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  // Set when a direct join is rejected for a permission reason - offers
  // knocking instead (Discord-style "request to join") rather than just
  // failing. Holds the target so the knock button knows what to knock on.
  const [knockTarget, setKnockTarget] = useState<string | null>(null);
  const [knockReason, setKnockReason] = useState("");
  const [knockSent, setKnockSent] = useState(false);

  useEffect(() => {
    if (initialTarget) void joinRoom(initialTarget);
    // Auto-join only on the initial open of a link-triggered modal, not on
    // every idOrAlias/client change - joinRoom is stable enough across
    // re-renders for this one-shot purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoadingDirectory(true);
    const handle = setTimeout(() => {
      searchPublicRooms(client, idOrAlias)
        .then((rooms) => {
          setPublicRooms(rooms);
          setDirectoryError(null);
        })
        .catch((err) => setDirectoryError((err as Error).message))
        .finally(() => setLoadingDirectory(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [client, idOrAlias]);

  async function joinRoom(target: string) {
    setBusy(true);
    setError(null);
    setKnockTarget(null);
    try {
      // A link minted for a channel inside a space carries a `space` hint
      // (see inviteLinks.ts) - if joining the room directly isn't possible
      // (this app's rooms default to a restricted join_rule keyed on space
      // membership), join the space first and retry, plus best-effort
      // auto-join every other room the space now exposes - "click a link,
      // you're in", not "click a link, hit a permissions wall" (real bug
      // hit live 2026-09-16).
      const parsed = parseInviteLink(target);
      const room = parsed?.spaceId
        ? (await joinRoomFromInviteLink(client, parsed)).room
        : await joinRoomByIdOrAlias(client, target);
      selectRoom(room.roomId);
      close();
    } catch (err) {
      const errcode = (err as { errcode?: string }).errcode;
      // M_FORBIDDEN here almost always means "this room requires an
      // invite/knock, and you have neither" - offer knocking as a fallback
      // instead of just reporting failure (a knock-only room isn't
      // peekable in advance, so this is the practical way to discover it).
      if (errcode === "M_FORBIDDEN") {
        setKnockTarget(target);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleKnock() {
    if (!knockTarget || busy) return;
    setBusy(true);
    setError(null);
    try {
      await knockRoomByIdOrAlias(client, knockTarget, knockReason.trim() || undefined);
      setKnockSent(true);
    } catch (err) {
      const errcode = (err as { errcode?: string }).errcode;
      // Knocking is only valid when the room's join_rule is actually
      // knock/knock_restricted - most rooms are plain invite-only, so this
      // is the common case, not a corner case. Showing the raw server
      // M_FORBIDDEN text here ("you don't have permission to knock") reads
      // as a permissions bug even to a room/server admin, when it's really
      // just "this room doesn't support knocking - ask for an invite".
      if (errcode === "M_FORBIDDEN") {
        setKnockTarget(null);
        setError(t("joinRoom.knockForbidden"));
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!idOrAlias.trim() || busy) return;
    await joinRoom(idOrAlias);
  }

  return (
    <Modal title={t("joinRoom.title")} onClose={close}>
      <form onSubmit={handleSubmit}>
        <ModalField label={t("joinRoom.label")}>
          <input
            className={modalInputClass()}
            value={idOrAlias}
            onChange={(e) => setIdOrAlias(e.target.value)}
            placeholder={t("joinRoom.placeholder")}
            autoFocus
          />
        </ModalField>
        {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        {knockTarget && !knockSent && (
          <div className="mb-3 rounded bg-bg-secondary p-3">
            <p className="mb-2 text-sm text-normal">
              {t("joinRoom.knockExplain")}
            </p>
            <input
              className={modalInputClass()}
              value={knockReason}
              onChange={(e) => setKnockReason(e.target.value)}
              placeholder={t("joinRoom.reason")}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleKnock()}
              className="mt-2 w-full rounded bg-brand py-2 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-60"
            >
              {busy ? t("joinRoom.knocking") : t("joinRoom.knock")}
            </button>
          </div>
        )}
        {knockSent && (
          <p aria-live="polite" className="mb-3 rounded bg-online/10 px-3 py-2 text-sm text-online">
            {t("joinRoom.knockSent")}
          </p>
        )}
        {!knockSent && (
          <ModalPrimaryButton type="submit" disabled={!idOrAlias.trim() || busy}>
            {busy ? t("joinRoom.joining") : t("joinRoom.joinExact")}
          </ModalPrimaryButton>
        )}
      </form>

      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-2 text-xs font-bold uppercase text-muted">{t("joinRoom.publicRooms")}</div>
        {loadingDirectory && <p aria-live="polite" className="px-1 py-2 text-xs text-muted">{t("common.searching")}</p>}
        {directoryError && (
          <p className="px-1 py-2 text-xs text-muted">
            {t("joinRoom.directoryError", { error: directoryError })}
          </p>
        )}
        {!loadingDirectory && !directoryError && publicRooms.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted">{t("sidebar.noResults")}</p>
        )}
        <div className="max-h-56 overflow-y-auto">
          {publicRooms.map((room) => (
            <button
              key={room.roomId}
              type="button"
              disabled={busy}
              onClick={() => void joinRoom(room.canonicalAlias ?? room.roomId)}
              className="flex w-full items-center gap-2.5 rounded px-2 py-2 text-left hover:bg-bg-modifier-hover disabled:opacity-60"
            >
              <Avatar
                url={room.avatarMxcUrl ? client.mxcUrlToHttp(room.avatarMxcUrl, 32, 32, "crop") : null}
                name={room.name}
                size={32}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-normal">{room.name}</div>
                <div className="truncate text-xs text-muted">
                  {t("joinRoom.memberCount", { count: room.memberCount })}{room.topic ? ` · ${room.topic}` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
