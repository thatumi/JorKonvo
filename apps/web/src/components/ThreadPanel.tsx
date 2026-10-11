import { getMemberRoles, getOwningSpace, getThreadReplies, hasClientPermission, type MatrixEvent, type Room, sendThreadReply } from "@jorkonvo/matrix-core";
import { type KeyboardEvent, useState } from "react";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";
import { MessageGroup } from "./Timeline";

/**
 * Side panel for the currently open thread: shows the root message and its
 * replies, plus a composer (Enter sends, Shift+Enter adds a newline). Renders
 * nothing when no thread is active; the reply composer is replaced by a notice
 * when the user may not start new threads.
 *
 * @param room - The room the active thread belongs to.
 */
/**
 * Consecutive replies by the same sender share one author header, like the
 * main timeline. (The panel used to render bare message lines with no author
 * at all, so a thread with three different repliers read as one person.)
 */
function groupBySender(events: MatrixEvent[]): MatrixEvent[][] {
  const groups: MatrixEvent[][] = [];
  for (const ev of events) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.getSender() === ev.getSender()) last.push(ev);
    else groups.push([ev]);
  }
  return groups;
}

export function ThreadPanel({ room }: { room: Room }) {
  const renderGroup = (events: MatrixEvent[]) => {
    const senderId = events[0]!.getSender() ?? "";
    const member = room.getMember(senderId);
    const avatarUrl = member?.getAvatarUrl(client.baseUrl, 40, 40, "crop", false, false) ?? null;
    return (
      <MessageGroup
        key={events[0]!.getId()}
        senderId={senderId}
        senderName={member?.name || senderId}
        avatarUrl={avatarUrl}
        events={events}
        room={room}
      />
    );
  };
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const rootEventId = useUiStore((s) => s.activeThreadRootId);
  const closeThread = useUiStore((s) => s.closeThread);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  if (!rootEventId) return null;

  const rootEvent = room.findEventById(rootEventId);
  const replies = getThreadReplies(room, rootEventId);
  // Matrix threads have no explicit "create" event - the first reply to a
  // root IS what starts one, so that's the only point "Create Threads"
  // (permissions.ts) can actually gate; once a thread already has replies,
  // adding another is just participating in it, same as any other message.
  const owningSpace = getOwningSpace(client, room.roomId);
  const mayReply =
    replies.length > 0 ||
    !owningSpace ||
    hasClientPermission(getMemberRoles(owningSpace, client.getUserId() ?? ""), "createThreads");

  async function send() {
    const body = value.trim();
    if (!body || sending) return;
    setSending(true);
    setValue("");
    try {
      await sendThreadReply(client, room.roomId, rootEventId!, body);
    } catch (err) {
      setValue(body);
      console.error("thread reply send failed", err);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-bg-primary">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-1.5">
          {/* A back chevron, not a close ✕: closing a thread entered from the
              threads list returns there, so this is a "back one level" and is
              drawn as one. On a phone the panel is a full-screen page and this
              is its only visible exit apart from the rightward swipe. */}
          <button
            type="button"
            onClick={closeThread}
            title={t("common.back")}
            aria-label={t("common.back")}
            data-testid="thread-back"
            className="-ml-1.5 shrink-0 rounded p-1 text-muted hover:bg-bg-modifier-hover hover:text-normal"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z" />
            </svg>
          </button>
          <h2 className="truncate text-[15px] font-semibold text-header">{t("thread.title")}</h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {rootEvent && (
          <div className="mb-2 border-b border-border pb-3">
            {renderGroup([rootEvent])}
          </div>
        )}
        <div className="flex flex-col gap-1">
          {groupBySender(replies).map((group) => renderGroup(group))}
          {replies.length === 0 && (
            <p className="px-2 py-4 text-sm text-muted">{t("thread.empty")}</p>
          )}
        </div>
      </div>

      <div className="p-3">
        {mayReply ? (
          <div className="flex items-end gap-2 rounded-lg bg-bg-secondary px-3 py-2">
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={t("thread.replyPlaceholder")}
              aria-label={t("thread.replyPlaceholder")}
              className="max-h-32 flex-1 resize-none bg-transparent py-1 text-sm text-normal placeholder:text-muted outline-none"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!value.trim() || sending}
              className="mb-0.5 rounded p-1 text-muted enabled:hover:text-brand disabled:opacity-40"
              title={t("common.send")}
              aria-label={t("common.send")}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M2 21 23 12 2 3v7l15 2-15 2v7Z" />
              </svg>
            </button>
          </div>
        ) : (
          <p className="rounded-lg bg-bg-secondary px-3 py-2 text-xs text-muted">{t("thread.createDenied")}</p>
        )}
      </div>
    </div>
  );
}
