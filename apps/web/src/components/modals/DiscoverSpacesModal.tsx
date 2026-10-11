import {
  getSortedJoinedRooms,
  joinHierarchyRoom,
  type PublicRoomResult,
  searchPublicSpaces,
} from "@jorkonvo/matrix-core";
import { useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { useUiStore } from "../../state/uiStore";
import { AuthedImg } from "../AuthedImg";
import { Modal } from "../Modal";

/**
 * Server discovery: browse/search public spaces from the homeserver's room
 * directory and join them (entering a space joins the space room only; the
 * channels then load through the space hierarchy, like an invite would).
 */
export function DiscoverSpacesModal() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const selectSpace = useUiStore((s) => s.selectSpace);

  const [query, setQuery] = useState("");
  const [spaces, setSpaces] = useState<PublicRoomResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Seed "already joined" so listed spaces the user is in show as openable.
    setJoinedIds(new Set(getSortedJoinedRooms(client).filter((r) => r.isSpaceRoom()).map((r) => r.roomId)));
  }, [client]);

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(() => {
      searchPublicSpaces(client, query)
        .then((results) => {
          setSpaces(results);
          setError(null);
        })
        .catch((err) => setError((err as Error).message))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [client, query]);

  async function openSpace(roomId: string, viaServers: string[]) {
    setJoiningId(roomId);
    try {
      if (!joinedIds.has(roomId)) {
        const room = await joinHierarchyRoom(client, roomId, viaServers);
        setJoinedIds((prev) => new Set(prev).add(roomId));
        selectSpace(room.roomId);
        close();
        return;
      }
      selectSpace(roomId);
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <Modal title={t("discover.title")} onClose={close}>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("discover.searchPlaceholder")}
        aria-label={t("discover.searchPlaceholder")}
        className="mb-3 w-full rounded bg-bg-darkest px-3 py-2 text-sm text-normal outline-none focus:ring-2 focus:ring-brand"
      />
      {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
      {loading ? (
        <p aria-live="polite" className="py-6 text-center text-sm text-muted">{t("common.searching")}</p>
      ) : spaces.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t("discover.empty")}</p>
      ) : (
        <div className="grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {spaces.map((s) => (
            <div
              key={s.roomId}
              className="flex items-center gap-3 rounded-lg border border-border bg-bg-secondary p-3"
            >
              <AuthedImg
                mxc={s.avatarMxcUrl}
                alt={s.name}
                width={48}
                height={48}
                className="h-12 w-12 shrink-0 rounded-full bg-bg-darkest object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-header">{s.name}</div>
                {s.topic && <p className="line-clamp-2 text-xs text-muted">{s.topic}</p>}
                <div className="mt-0.5 text-[11px] text-muted">
                  {t("discover.memberCount", { count: s.memberCount })}
                </div>
              </div>
              <button
                type="button"
                disabled={joiningId === s.roomId}
                onClick={() => void openSpace(s.roomId, [])}
                className="shrink-0 rounded bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-hover disabled:opacity-60"
              >
                {joinedIds.has(s.roomId)
                  ? t("discover.open")
                  : joiningId === s.roomId
                    ? t("common.loading")
                    : t("discover.join")}
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{t("discover.hint")}</p>
    </Modal>
  );
}
