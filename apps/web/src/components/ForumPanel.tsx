import { canManageForumTags, getForumPosts, getForumTags, type Room } from "@jorkonvo/matrix-core";
import { formatDistanceToNow } from "date-fns";
import { dfLocale } from "../lib/dateLocale";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";
import { useModalStore } from "../state/modalStore";
import { useUiStore } from "../state/uiStore";
import { Avatar } from "./Avatar";

/** Discord-style forum channel: a list of "posts" (thread roots with a title/tags) instead of a flowing timeline - see forum.ts for how a post is identified. */
export function ForumPanel({ room }: { room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const openModal = useModalStore((s) => s.open);
  const openThread = useUiStore((s) => s.openThread);
  const activeThreadRootId = useUiStore((s) => s.activeThreadRootId);

  const posts = getForumPosts(room);
  const tags = getForumTags(room);
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const mayManageTags = canManageForumTags(room, client.getUserId() ?? "");

  return (
    <div className="flex h-full flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-header">{room.name}</h2>
          <p className="text-xs text-muted">{posts.length} poszt</p>
        </div>
        <div className="flex items-center gap-2">
          {mayManageTags && (
            <button
              type="button"
              onClick={() => openModal({ type: "roomSettings", roomId: room.roomId })}
              className="rounded border border-border px-3 py-1.5 text-xs font-medium text-normal hover:bg-bg-modifier-hover"
            >
              {t("forum.manageTags")}
            </button>
          )}
          <button
            type="button"
            onClick={() => openModal({ type: "createForumPost", roomId: room.roomId })}
            className="rounded bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
          >
            + Új poszt
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {posts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
            <p>{t("forum.empty")}</p>
            <button
              type="button"
              onClick={() => openModal({ type: "createForumPost", roomId: room.roomId })}
              className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            >
              {t("forum.firstPost")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {posts.map((post) => {
              const author = room.getMember(post.authorId);
              return (
                <button
                  key={post.eventId}
                  type="button"
                  onClick={() => openThread(post.eventId)}
                  className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                    activeThreadRootId === post.eventId
                      ? "border-brand bg-brand/10"
                      : "border-border hover:bg-bg-modifier-hover"
                  }`}
                >
                  <Avatar
                    url={author?.getAvatarUrl(client.baseUrl, 32, 32, "crop", false, false) ?? null}
                    name={author?.name ?? post.authorId}
                    size={32}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-header">{post.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span>{author?.name ?? post.authorId}</span>
                      <span>·</span>
                      <span>{formatDistanceToNow(post.lastActivityTs, { addSuffix: true, locale: dfLocale() })}</span>
                      {post.replyCount > 0 && (
                        <>
                          <span>·</span>
                          <span>{t("forum.replyCount", { count: post.replyCount })}</span>
                        </>
                      )}
                    </div>
                    {post.tagIds.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {post.tagIds.map((tagId) => {
                          const tag = tagById.get(tagId);
                          if (!tag) return null;
                          return (
                            <span
                              key={tagId}
                              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                              style={{ backgroundColor: `${tag.color}33`, color: tag.color }}
                            >
                              {tag.name}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
