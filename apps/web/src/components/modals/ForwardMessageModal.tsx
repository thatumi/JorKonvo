import { forwardMessage, getSortedJoinedRooms, isSpaceRoom, type Room } from "@jorkonvo/matrix-core";
import { useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { Avatar } from "../Avatar";
import { Modal } from "../Modal";

/** Forwards one message to another room (searchable room list, one-click send) via `forwardMessage`. */
export function ForwardMessageModal({ roomId, eventId }: { roomId: string; eventId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const [query, setQuery] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourceRoom = client.getRoom(roomId);
  const sourceEvent = sourceRoom?.findEventById(eventId);

  const rooms = getSortedJoinedRooms(client).filter((r) => r.roomId !== roomId && !isSpaceRoom(r));
  const q = query.trim().toLowerCase();
  const filtered = q ? rooms.filter((r) => (r.name || "").toLowerCase().includes(q)) : rooms;

  async function handleForward(target: Room) {
    if (!sourceEvent) return;
    setError(null);
    try {
      await forwardMessage(client, target.roomId, sourceEvent);
      setSentTo(target.roomId);
      setTimeout(() => setSentTo(null), 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={t("forward.title")} onClose={close}>
      {!sourceEvent && <p role="alert" className="text-sm text-dnd">{t("forward.notFound")}</p>}
      {sourceEvent && (
        <>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("forward.searchPlaceholder")}
            aria-label={t("forward.searchPlaceholder")}
            className="mb-3 w-full rounded bg-bg-darkest px-3 py-2 text-sm text-normal outline-none focus:ring-2 focus:ring-brand"
          />
          {error && <p role="alert" className="mb-2 text-sm text-dnd">{t("forward.error", { error })}</p>}
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {filtered.map((room) => (
              <button
                key={room.roomId}
                type="button"
                onClick={() => void handleForward(room)}
                className="flex items-center gap-2.5 rounded px-2 py-1.5 text-left hover:bg-bg-modifier-hover"
              >
                <Avatar
                  url={room.getAvatarUrl(client.baseUrl, 28, 28, "crop", false)}
                  name={room.name || "?"}
                  size={28}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-normal">{room.name || t("sidebar.unnamed")}</span>
                {sentTo === room.roomId && <span aria-live="polite" className="shrink-0 text-xs font-medium text-online">{t("forward.sent")}</span>}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-2 py-4 text-sm text-muted">{t("forward.noResults")}</p>}
          </div>
        </>
      )}
    </Modal>
  );
}
