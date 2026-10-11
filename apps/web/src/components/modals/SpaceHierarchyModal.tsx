import { getSpaceHierarchy, joinHierarchyRoom, type SpaceHierarchyRoom } from "@jorkonvo/matrix-core";
import { useEffect, useState } from "react";
import { useMatrixStore } from "../../state/matrixStore";
import { useTranslation } from "../../i18n";
import { useModalStore } from "../../state/modalStore";
import { useUiStore } from "../../state/uiStore";
import { Avatar } from "../Avatar";
import { Modal } from "../Modal";

/**
 * Browses a space's FULL contents via the spec's /hierarchy endpoint
 * (MSC2946, long stable) - including rooms this account hasn't joined yet,
 * unlike the sidebar's own room list (which can only ever show rooms
 * already in the synced room list). Exists specifically because joining a
 * space doesn't retroactively add you to rooms created in it afterward -
 * a real gap hit repeatedly while testing other features this session.
 */
export function SpaceHierarchyModal({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const close = useModalStore((s) => s.close);
  const selectRoom = useUiStore((s) => s.selectRoom);

  const [rooms, setRooms] = useState<SpaceHierarchyRoom[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRooms(null);
    setError(null);
    getSpaceHierarchy(client, spaceId)
      .then((result) => {
        if (!cancelled) setRooms(result);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [client, spaceId]);

  async function handleJoin(room: SpaceHierarchyRoom) {
    setJoiningId(room.roomId);
    try {
      await joinHierarchyRoom(client, room.roomId, room.viaServers);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoiningId(null);
    }
  }

  function handleOpen(roomId: string) {
    selectRoom(roomId);
    close();
  }

  return (
    <Modal title={t("spaceHierarchy.title")} onClose={close}>
      <p className="mb-3 text-sm text-muted">
        {t("spaceHierarchy.hint")}
      </p>
      {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
      {rooms === null && !error && <p className="py-6 text-center text-sm text-muted">{t("common.loading")}</p>}
      {rooms !== null && rooms.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">{t("spaceHierarchy.empty")}</p>
      )}
      {rooms && rooms.length > 0 && (
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {rooms.map((room) => {
            const joined = client.getRoom(room.roomId)?.getMyMembership() === "join";
            return (
              <div
                key={room.roomId}
                data-testid="hierarchy-room"
                data-room-name={room.name}
                className="flex items-center gap-2.5 rounded px-1 py-1.5"
              >
                <Avatar
                  url={room.avatarMxcUrl ? client.mxcUrlToHttp(room.avatarMxcUrl, 32, 32, "crop") : null}
                  name={room.name}
                  size={32}
                  rounded={room.isSpace ? "lg" : "full"}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-normal">
                    {room.isSpace ? "🗀 " : "# "}
                    {room.name}
                  </div>
                  {room.topic && <div className="truncate text-xs text-muted">{room.topic}</div>}
                </div>
                <span className="shrink-0 text-xs text-muted">{room.memberCount} tag</span>
                {joined ? (
                  <button
                    type="button"
                    data-testid="hierarchy-open"
                    onClick={() => handleOpen(room.roomId)}
                    className="shrink-0 rounded border border-border px-2.5 py-1 text-xs font-medium text-normal hover:bg-bg-modifier-hover"
                  >
                    {t("spaceHierarchy.open")}
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="hierarchy-join"
                    disabled={joiningId === room.roomId}
                    onClick={() => void handleJoin(room)}
                    className="shrink-0 rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-hover disabled:opacity-50"
                  >
                    {joiningId === room.roomId ? t("spaceHierarchy.joining") : t("spaceHierarchy.join")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
