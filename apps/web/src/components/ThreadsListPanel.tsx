import { getRoomThreads, type Room, stripReplyFallback } from "@jorkonvo/matrix-core";
import { useTranslation } from "../i18n";
import { formatTimestamp } from "../lib/format";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";
import { Avatar } from "./Avatar";

/**
 * Side panel listing every thread in the room as a clickable row (root
 * message preview, last-activity time, participant avatars, reply count);
 * selecting a row opens that thread in the ThreadPanel.
 *
 * @param room - The room whose threads are listed.
 */
export function ThreadsListPanel({ room }: { room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const openThread = useUiStore((s) => s.openThread);
  const closeThreadsList = useUiStore((s) => s.closeThreadsList);

  const threads = getRoomThreads(room);

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-bg-primary">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 shadow-sm">
        <h2 className="text-[15px] font-semibold text-header">{t("threads.title")}</h2>
        <button
          type="button"
          onClick={closeThreadsList}
          title={t("common.close")}
          aria-label={t("common.close")}
          data-testid="threads-list-close"
          className="rounded p-1.5 text-muted hover:bg-bg-modifier-hover hover:text-normal"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {threads.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted">{t("threads.empty")}</p>
        )}
        {threads.map((thread) => {
          const rootSender = thread.root
            ? room.getMember(thread.root.getSender() ?? "")
            : null;
          const preview = thread.root
            ? stripReplyFallback((thread.root.getContent().body as string) ?? "")
            : t("msgMenu.loadingOriginal");
          return (
            <button
              key={thread.rootId}
              type="button"
              onClick={() => openThread(thread.rootId, { fromList: true })}
              className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-bg-modifier-hover"
            >
              <Avatar
                url={rootSender?.getAvatarUrl(client.baseUrl, 28, 28, "crop", false, false) ?? null}
                name={rootSender?.name ?? thread.root?.getSender() ?? "?"}
                size={28}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate text-xs font-medium text-header">
                    {rootSender?.name ?? thread.root?.getSender() ?? "?"}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted">
                    {formatTimestamp(thread.lastActivityTs)}
                  </span>
                </div>
                <p className="line-clamp-2 text-sm text-normal">{preview}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <div className="flex -space-x-1.5">
                    {thread.participants.slice(0, 3).map((userId) => {
                      const m = room.getMember(userId);
                      return (
                        <Avatar
                          key={userId}
                          url={m?.getAvatarUrl(client.baseUrl, 16, 16, "crop", false, false) ?? null}
                          name={m?.name ?? userId}
                          size={16}
                        />
                      );
                    })}
                  </div>
                  <span className="text-[11px] font-medium text-link">
                    {t("msgMenu.threadReplies", { count: thread.replyCount })}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
