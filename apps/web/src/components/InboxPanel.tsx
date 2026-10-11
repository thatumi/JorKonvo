import { getRecentActivity, stripReplyFallback } from "@jorkonvo/matrix-core";
import { useTranslation } from "../i18n";
import { formatTimestamp } from "../lib/format";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";
import { Avatar } from "./Avatar";

/**
 * The Home-tab "Inbox": every recent mention of you and direct reply to one
 * of your messages, across all rooms, newest first. Clicking an entry jumps
 * to the room and highlights the message.
 */
export function InboxPanel() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const selectRoom = useUiStore((s) => s.selectRoom);
  const selectSpace = useUiStore((s) => s.selectSpace);
  const jumpToEvent = useUiStore((s) => s.jumpToEvent);
  const ownUserId = client.getUserId() ?? "";

  const items = getRecentActivity(client, ownUserId);

  function open(item: (typeof items)[number]) {
    selectSpace(spaceOf(client, item.roomId));
    selectRoom(item.roomId);
    jumpToEvent(item.event.getId() ?? "");
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4 shadow-sm">
        <h1 className="text-base font-semibold text-header">{t("inbox.title")}</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {items.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">{t("inbox.empty")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {items.map((item) => {
              const room = client.getRoom(item.roomId);
              const sender = room?.getMember(item.event.getSender() ?? "");
              const preview = stripReplyFallback((item.event.getContent().body as string) ?? "");
              return (
                <button
                  key={item.event.getId()}
                  type="button"
                  onClick={() => open(item)}
                  className="flex items-start gap-3 rounded-lg border border-transparent p-2 text-left transition hover:border-border hover:bg-bg-modifier-hover"
                >
                  <Avatar
                    url={sender?.getAvatarUrl(client.baseUrl, 32, 32, "crop", false, false) ?? null}
                    name={sender?.name ?? item.event.getSender() ?? "?"}
                    size={32}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-header">
                        {sender?.name ?? item.event.getSender()}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted">
                        {formatTimestamp(item.ts)}
                      </span>
                      <span className="shrink-0 rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-link">
                        {item.kind === "mention" ? t("inbox.mention") : t("inbox.reply")}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm text-normal">{preview}</p>
                    {room && <p className="truncate text-[11px] text-link">#{room.name}</p>}
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

function spaceOf(client: Parameters<typeof getRecentActivity>[0], roomId: string): string | null {
  for (const candidate of client.getRooms()) {
    if (!candidate.isSpaceRoom() || candidate.getMyMembership() !== "join") continue;
    const children = candidate.currentState.getStateEvents("m.space.child");
    if (children.some((c) => c.getStateKey() === roomId && Object.keys(c.getContent()).length > 0)) {
      return candidate.roomId;
    }
  }
  return null;
}
