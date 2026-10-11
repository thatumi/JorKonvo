import {
  cancelFailedMessage,
  canManageRoles,
  canPinInRoom,
  EventStatus,
  getMemberRoleColor,
  getOwningSpace,
  getReactionsForEvent,
  getRoomEmojis,
  getThreadParticipants,
  getThreadReplyCount,
  isCalendarEventStart,
  isLiveLocationStartEvent,
  isLocationMessage,
  isPinned,
  isPollStartEvent,
  isStickerEvent,
  isWatchTogetherInviteEvent,
  type MatrixClient,
  type MatrixEvent,
  MsgType,
  parseInviteLink,
  pinMessage,
  redactEvent,
  ReceiptType,
  reportMessage,
  retryMessage,
  type Room,
  stripReplyFallback,
  toggleReaction,
  unpinMessage,
} from "@jorkonvo/matrix-core";
import clsx from "clsx";
import { useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { isDeveloperMode } from "../lib/displayPrefs";
import { uiConfirm, uiPrompt } from "../lib/dialogs";
import { useMatrixStore } from "../state/matrixStore";
import { useModalStore } from "../state/modalStore";
import { useUiStore } from "../state/uiStore";
import { Avatar } from "./Avatar";
import { CalendarEventCard } from "./CalendarEventCard";
import { AuthedImg } from "./AuthedImg";
import { type MenuItem, useContextMenu } from "./ContextMenu";
import { EmojiPicker } from "./EmojiPicker";
import { InviteLinkCard } from "./InviteLinkCard";
import { extractFirstUrl, LinkPreview } from "./LinkPreview";
import { shouldShowLinkPreview } from "../lib/linkPreviewPrefs";
import { LiveLocationCard } from "./LiveLocationCard";
import { LocationMessage } from "./LocationMessage";
import { MediaAttachment } from "./MediaAttachment";
import { MessageBody } from "./MessageBody";
import { PollMessage } from "./PollMessage";
import { parseEmbeddableUrl, RichEmbed } from "./RichEmbed";
import { StickerMessage } from "./StickerMessage";
import { WatchTogetherInviteCard } from "./WatchTogetherInviteCard";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-bg-modifier-hover hover:text-normal"
    >
      {children}
    </button>
  );
}

function Toolbar({ ev, room, client, isOwn }: { ev: MatrixEvent; room: Room; client: MatrixClient; isOwn: boolean }) {
  const { t } = useTranslation();
  const startReply = useUiStore((s) => s.startReply);
  const startEdit = useUiStore((s) => s.startEdit);
  const openThread = useUiStore((s) => s.openThread);
  const openModal = useModalStore((s) => s.open);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const eventId = ev.getId();
  if (!eventId) return null;

  function react(emoji: string) {
    const existing = getReactionsForEvent(room, eventId!, client.getUserId()).find(
      (r) => r.key === emoji,
    );
    void toggleReaction(client, room.roomId, eventId!, emoji, existing);
  }

  async function handleReport() {
    // Sent straight to the HOMESERVER's own admins (spec's /report endpoint) -
    // there's no room-visible effect and nothing this client can undo, so a
    // reason prompt + a brief "reported" confirmation on the button itself is
    // all the feedback there is to give.
    const reason = await uiPrompt(t("msgMenu.reportPrompt"));
    if (reason === null) return;
    try {
      await reportMessage(client, room.roomId, eventId!, reason);
      setReported(true);
      setTimeout(() => setReported(false), 3000);
    } catch (err) {
      console.error("failed to report message", err);
    }
  }

  return (
    <div className="absolute -top-4 right-4 z-10 hidden items-center rounded-md border border-border bg-bg-secondary shadow-md group-hover/msg:flex">
      {QUICK_REACTIONS.slice(0, 3).map((emoji) => (
        <ToolbarButton key={emoji} title={t("msgMenu.reactWith", { emoji })} onClick={() => react(emoji)}>
          <span className="text-[15px]">{emoji}</span>
        </ToolbarButton>
      ))}
      <button
        ref={moreButtonRef}
        type="button"
        title={t("msgMenu.moreReactions")}
        aria-label={t("msgMenu.moreReactions")}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        onClick={() => setPickerOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded text-muted hover:bg-bg-modifier-hover hover:text-normal"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm-3.5-9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm7 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm-7.44 3a5.5 5.5 0 0 0 7.88 0h-7.88Z" />
        </svg>
      </button>
      {pickerOpen && moreButtonRef.current && (
        <EmojiPicker
          anchorEl={moreButtonRef.current}
          customEmoji={getRoomEmojis(room)}
          onPick={(pick) => {
            react("char" in pick ? pick.char : `:${pick.shortcode}:`);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <ToolbarButton
        title={t("msgMenu.reply")}
        onClick={() =>
          startReply({
            eventId,
            senderName: room.getMember(ev.getSender() ?? "")?.name ?? ev.getSender() ?? "",
            body: (ev.getContent().body as string) ?? "",
          })
        }
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M10 9V5l-8 7 8 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z" />
        </svg>
      </ToolbarButton>
      <ToolbarButton title={t("msgMenu.replyThread")} onClick={() => openThread(eventId)}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M4 4h16v10H7l-3 3V4Zm2 2v7.17L6.83 12H18V6H6Zm2 9h12v6l-3-3H8v-3Z" />
        </svg>
      </ToolbarButton>
      {canPinInRoom(room, client.getUserId() ?? "") && (
        <ToolbarButton
          title={isPinned(room, eventId) ? t("msgMenu.unpin") : t("msgMenu.pin")}
          onClick={() =>
            void (isPinned(room, eventId)
              ? unpinMessage(client, room.roomId, eventId)
              : pinMessage(client, room.roomId, eventId))
          }
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M16 3v6l2 3v2h-6v6l-1 1-1-1v-6H4v-2l2-3V3h1V2h6v1h1Z" />
          </svg>
        </ToolbarButton>
      )}
      <ToolbarButton
        title={t("msgMenu.forward")}
        onClick={() => openModal({ type: "forwardMessage", roomId: room.roomId, eventId })}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M14 9V5l8 7-8 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11Z" />
        </svg>
      </ToolbarButton>
      {(() => {
        const owningSpace = getOwningSpace(client, room.roomId);
        if (!owningSpace || !canManageRoles(owningSpace, client.getUserId() ?? "")) return null;
        return (
          <ToolbarButton
            title={t("msgMenu.reactionRoles")}
            onClick={() => openModal({ type: "reactionRoles", roomId: room.roomId, eventId })}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8Z" />
            </svg>
          </ToolbarButton>
        );
      })()}
      {!isOwn && (
        <ToolbarButton title={reported ? t("msgMenu.reported") : t("msgMenu.report")} onClick={() => void handleReport()}>
          {reported ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-online" fill="currentColor">
              <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6Z" />
            </svg>
          )}
        </ToolbarButton>
      )}
      {isOwn && ev.getContent().msgtype === MsgType.Text && (
        <ToolbarButton
          title={t("msgMenu.edit")}
          onClick={() => startEdit({ eventId, body: (ev.getContent().body as string) ?? "" })}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="m3 17.25 11.06-11.06 3.75 3.75L6.75 21H3v-3.75Zm14.85-13.5 1.4-1.4a1 1 0 0 1 1.42 0l2.33 2.33a1 1 0 0 1 0 1.42l-1.4 1.4-3.75-3.75Z" />
          </svg>
        </ToolbarButton>
      )}
      {isOwn && (
        <ToolbarButton
          title={t("msgMenu.delete")}
          onClick={() =>
            void (async () => {
              if (await uiConfirm(t("msgMenu.deleteConfirm"), { danger: true })) {
                await redactEvent(client, room.roomId, eventId);
              }
            })()
          }
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-dnd" fill="currentColor">
            <path d="M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H4V5h4l1-2Z" />
          </svg>
        </ToolbarButton>
      )}
      {isDeveloperMode() && (
        <ToolbarButton
          title={t("profile.copyId")}
          onClick={() => void navigator.clipboard.writeText(eventId)}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Zm0 16H8V7h11v14Z" />
          </svg>
        </ToolbarButton>
      )}
    </div>
  );
}

const menuIcon = (path: string) => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
    <path d={path} />
  </svg>
);

/**
 * Right-click menu for a message row - the same actions as the hover toolbar
 * plus the clipboard actions (copy text / copy matrix.to link / copy id) that a
 * toolbar full of icon buttons has no room for. Kept as a hook so every
 * MessageLine shares one portal instead of mounting a menu per row.
 */
function useMessageMenu(room: Room, client: MatrixClient) {
  const { t } = useTranslation();
  const startReply = useUiStore((s) => s.startReply);
  const startEdit = useUiStore((s) => s.startEdit);
  const openThread = useUiStore((s) => s.openThread);
  const openModal = useModalStore((s) => s.open);

  return (ev: MatrixEvent, isOwn: boolean): MenuItem[] => {
    const eventId = ev.getId();
    if (!eventId) return [];
    const content = ev.getContent();
    const body = stripReplyFallback((content.body as string) ?? "");
    const isText = content.msgtype === MsgType.Text;
    const canPin = canPinInRoom(room, client.getUserId() ?? "");
    const pinned = isPinned(room, eventId);

    const react = (emoji: string) => {
      const existing = getReactionsForEvent(room, eventId, client.getUserId()).find(
        (r) => r.key === emoji,
      );
      void toggleReaction(client, room.roomId, eventId, emoji, existing);
    };

    const items: MenuItem[] = [
      {
        label: t("msgMenu.react"),
        icon: menuIcon(
          "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-3.5 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm-7.44 5h7.88a5.5 5.5 0 0 1-7.88 0Z",
        ),
        submenu: QUICK_REACTIONS.map((emoji) => ({
          label: emoji,
          onClick: () => react(emoji),
        })),
      },
      {
        label: t("msgMenu.reply"),
        icon: menuIcon("M10 9V5l-8 7 8 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z"),
        onClick: () =>
          startReply({
            eventId,
            senderName: room.getMember(ev.getSender() ?? "")?.name ?? ev.getSender() ?? "",
            body: (content.body as string) ?? "",
          }),
      },
      {
        label: t("msgMenu.replyThread"),
        icon: menuIcon("M4 4h16v10H7l-3 3V4Zm4 11h12v6l-3-3H8v-3Z"),
        onClick: () => openThread(eventId),
      },
      {
        label: t("msgMenu.forward"),
        icon: menuIcon("M14 9V5l8 7-8 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11Z"),
        onClick: () => openModal({ type: "forwardMessage", roomId: room.roomId, eventId }),
      },
    ];

    if (canPin) {
      items.push({
        label: pinned ? t("msgMenu.unpin") : t("msgMenu.pin"),
        icon: menuIcon("M16 3v6l2 3v2h-6v6l-1 1-1-1v-6H4v-2l2-3V3h1V2h6v1h1Z"),
        onClick: () =>
          void (pinned
            ? unpinMessage(client, room.roomId, eventId)
            : pinMessage(client, room.roomId, eventId)),
      });
    }

    if (body) {
      items.push({
        label: t("msgMenu.copyText"),
        separator: true,
        icon: menuIcon(
          "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Z",
        ),
        onClick: () => void navigator.clipboard.writeText(body),
      });
    }
    items.push({
      label: t("msgMenu.copyLink"),
      separator: !body,
      icon: menuIcon(
        "M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7h-4a5 5 0 0 0 0 10h4v-1.9h-4A3.1 3.1 0 0 1 3.9 12Zm4.1 1h8v-2H8v2Zm5-6v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10h-4Z",
      ),
      onClick: () =>
        void navigator.clipboard.writeText(
          `https://matrix.to/#/${room.roomId}/${eventId}`,
        ),
    });

    if (isOwn && isText) {
      items.push({
        label: t("msgMenu.edit"),
        separator: true,
        icon: menuIcon(
          "m3 17.25 11.06-11.06 3.75 3.75L6.75 21H3v-3.75Zm14.85-13.5 1.4-1.4a1 1 0 0 1 1.42 0l2.33 2.33a1 1 0 0 1 0 1.42l-1.4 1.4-3.75-3.75Z",
        ),
        onClick: () => startEdit({ eventId, body: (content.body as string) ?? "" }),
      });
    }

    if (!isOwn) {
      items.push({
        label: t("msgMenu.report"),
        separator: true,
        icon: menuIcon("M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6Z"),
        danger: true,
        onClick: () =>
          void (async () => {
            const reason = await uiPrompt(t("msgMenu.reportPrompt"));
            if (reason === null) return;
            await reportMessage(client, room.roomId, eventId, reason);
          })(),
      });
    }

    if (isOwn) {
      items.push({
        label: t("msgMenu.delete"),
        separator: true,
        icon: menuIcon("M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H4V5h4l1-2Z"),
        danger: true,
        onClick: () =>
          void (async () => {
            if (await uiConfirm(t("msgMenu.deleteConfirm"), { danger: true })) {
              await redactEvent(client, room.roomId, eventId);
            }
          })(),
      });
    }

    if (isDeveloperMode()) {
      items.push({
        label: t("profile.copyId"),
        separator: true,
        icon: menuIcon(
          "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8v16h11V5Z",
        ),
        onClick: () => void navigator.clipboard.writeText(eventId),
      });
    }

    return items;
  };
}

function ReactionPills({ ev, room, client }: { ev: MatrixEvent; room: Room; client: MatrixClient }) {
  const eventId = ev.getId();
  if (!eventId) return null;
  const reactions = getReactionsForEvent(room, eventId, client.getUserId());
  if (reactions.length === 0) return null;

  const emojiByCode = new Map(getRoomEmojis(room).map((e) => [`:${e.shortcode}:`, e.mxcUrl]));

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {reactions.map((r) => {
        const customMxc = emojiByCode.get(r.key);
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => void toggleReaction(client, room.roomId, eventId, r.key, r)}
            className={clsx(
              "animate-pop flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors hover:-translate-y-px",
              r.reactedByMe
                ? "border-brand bg-brand/20 text-header"
                : "border-border bg-bg-secondary text-muted hover:border-muted",
            )}
          >
            {customMxc ? (
              <AuthedImg mxc={customMxc} alt={r.key} width={20} height={20} className="h-4 w-4" />
            ) : (
              <span>{r.key}</span>
            )}
            <span>{r.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function RepliedToPreview({ ev, room }: { ev: MatrixEvent; room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const jumpToEvent = useUiStore((s) => s.jumpToEvent);
  const relatesTo = ev.getContent()?.["m.relates_to"];
  const replyToId = relatesTo?.["m.in_reply_to"]?.event_id as string | undefined;
  if (!replyToId) return null;
  // A thread reply carries m.in_reply_to only as a fallback for clients
  // without thread support (is_falling_back: true, per the spec - Element
  // sends every thread message this way). It is not a real reply: rendering
  // it quoted the thread root above every single reply.
  if (relatesTo?.rel_type === "m.thread" && relatesTo?.is_falling_back === true) return null;

  const target = room.findEventById(replyToId);
  const senderId = target?.getSender() ?? "";
  const senderName = room.getMember(senderId)?.name ?? senderId;
  const owningSpace = getOwningSpace(client, room.roomId);
  const nameColor = owningSpace && senderId ? getMemberRoleColor(owningSpace, senderId) : null;
  const body = stripReplyFallback((target?.getContent().body as string) ?? "");

  return (
    <button
      type="button"
      onClick={() => jumpToEvent(replyToId)}
      title={t("msgMenu.reply")}
      className="mb-0.5 flex max-w-full items-center gap-1.5 rounded-r border-l-2 py-0.5 pl-2 pr-1 text-left text-xs text-muted transition hover:bg-bg-modifier-hover/50 hover:text-normal"
      style={{ borderColor: nameColor ?? "var(--color-border)" }}
    >
      <span
        className="shrink-0 font-medium"
        style={nameColor ? { color: nameColor } : { color: "var(--color-header)" }}
      >
        {target ? senderName : t("msgMenu.loadingOriginal")}
      </span>
      <span className="truncate opacity-80">{body}</span>
    </button>
  );
}

function ReadReceiptAvatars({ ev, room, client }: { ev: MatrixEvent; room: Room; client: MatrixClient }) {
  const ownUserId = client.getUserId();
  const readers = room
    .getReceiptsForEvent(ev)
    .filter((r) => r.type === ReceiptType.Read && r.userId !== ownUserId)
    .map((r) => room.getMember(r.userId))
    .filter((m): m is NonNullable<typeof m> => m !== null);

  if (readers.length === 0) return null;

  return (
    <div className="mt-1 flex items-center gap-0.5" title={readers.map((m) => m.name).join(", ")}>
      {readers.slice(0, 5).map((member) => (
        <Avatar
          key={member.userId}
          url={member.getAvatarUrl(client.baseUrl, 16, 16, "crop", false, false)}
          name={member.name}
          size={16}
        />
      ))}
    </div>
  );
}

function ThreadSummaryPill({ ev, room, client }: { ev: MatrixEvent; room: Room; client: MatrixClient }) {
  const { t } = useTranslation();
  const eventId = ev.getId();
  const openThread = useUiStore((s) => s.openThread);
  if (!eventId) return null;

  const count = getThreadReplyCount(room, eventId);
  if (count === 0) return null;

  const participants = getThreadParticipants(room, eventId).slice(0, 3);

  return (
    <button
      type="button"
      onClick={() => openThread(eventId)}
      className="mt-1 flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-link hover:bg-bg-modifier-hover"
    >
      <div className="flex -space-x-1.5">
        {participants.map((userId) => {
          const member = room.getMember(userId);
          return (
            <Avatar
              key={userId}
              url={member?.getAvatarUrl(client.baseUrl, 16, 16, "crop", false, false) ?? null}
              name={member?.name ?? userId}
              size={16}
            />
          );
        })}
      </div>
      <span className="font-medium">{t("msgMenu.threadReplies", { count })}</span>
    </button>
  );
}

function FailedMessageNotice({ ev, room, client }: { ev: MatrixEvent; room: Room; client: MatrixClient }) {
  const { t } = useTranslation();
  return (
    <div className="mt-1 flex items-center gap-2 text-xs text-dnd">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="currentColor">
        <path d="M12 2 1 21h22L12 2Zm0 4.5 7.6 13H4.4L12 6.5ZM11 10v5h2v-5h-2Zm0 6.5v2h2v-2h-2Z" />
      </svg>
      <span>{t("msgMenu.sendFailed")}</span>
      <button
        type="button"
        onClick={() => void retryMessage(client, room, ev)}
        className="font-medium text-link hover:underline"
      >
        {t("msgMenu.resend")}
      </button>
      <button
        type="button"
        onClick={() => cancelFailedMessage(client, ev)}
        className="font-medium text-muted hover:underline"
      >
        {t("msgMenu.delete")}
      </button>
    </div>
  );
}

const MEDIA_MSGTYPES: string[] = [MsgType.Image, MsgType.Video, MsgType.Audio, MsgType.File];

/**
 * A single timeline row: body/media/poll/sticker variants, hover action
 * toolbar, right-click menu, reply preview, reactions, thread pill and
 * read receipts. Rendered once per event - keep additions cheap.
 *
 * @param ev - the Matrix event to render.
 * @param room - the room the event belongs to.
 */
export function MessageLine({ ev, room }: { ev: MatrixEvent; room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const openModal = useModalStore((s) => s.open);
  const { open: openCtx, menu: ctxMenu } = useContextMenu();
  const messageMenu = useMessageMenu(room, client);
  const isOwn = ev.getSender() === client.getUserId();
  const content = ev.getContent();
  // NOT content["m.relates_to"] - once an event has been edited, getContent()
  // transparently returns the LATEST edit's m.new_content, which has no
  // m.relates_to of its own (only the raw edit event does, and that event is
  // filtered out of the timeline entirely - see Timeline.tsx's
  // isDisplayableMessage). replacingEvent() is the correct "has this event
  // been edited" check.
  const isEdited = ev.replacingEvent() != null;
  const isEmote = content.msgtype === MsgType.Emote;
  const isMedia = MEDIA_MSGTYPES.includes(content.msgtype as string);
  const isPoll = isPollStartEvent(ev);
  const isCalendarEvent = isCalendarEventStart(ev);
  const isSticker = isStickerEvent(ev);
  const isLocation = isLocationMessage(ev);
  const isLiveLocation = isLiveLocationStartEvent(ev);
  const isWatchTogetherInvite = isWatchTogetherInviteEvent(ev);
  const isDecryptionFailure = ev.isDecryptionFailure();
  const messageUrl =
    !isMedia && !isPoll && !isCalendarEvent && !isSticker && !isLocation && !isWatchTogetherInvite && !isDecryptionFailure
      ? extractFirstUrl((content.body as string) ?? "")
      : null;
  // An invite link's card is a request to the user's OWN homeserver (room
  // hierarchy/local room data), not a server-side fetch of a random
  // third-party URL or an iframe - none of the privacy concerns the
  // link-preview toggle below exists for apply to it, so it always renders
  // regardless of that setting (including in encrypted rooms).
  const inviteLinkTarget = messageUrl ? parseInviteLink(messageUrl) : null;
  // Previews/embeds are a privacy leak (server-side fetch, third-party iframe) -
  // gated by a per-device setting that defaults to "not in encrypted rooms".
  const showPreview = messageUrl != null && shouldShowLinkPreview(room.hasEncryptionStateEvent());
  const isFailed = ev.status === EventStatus.NOT_SENT;

  return (
    <div
      data-event-id={ev.getId()}
      onContextMenu={isFailed ? undefined : (e) => openCtx(e, messageMenu(ev, isOwn))}
      className="jk-ctx-target group/msg relative rounded px-0 py-0.5 transition-colors duration-700 hover:bg-bg-modifier-hover/40"
    >
      {!isFailed && <Toolbar ev={ev} room={room} client={client} isOwn={isOwn} />}
      {ctxMenu}
      <RepliedToPreview ev={ev} room={room} />
      {isPoll ? (
        <PollMessage ev={ev} room={room} />
      ) : isCalendarEvent ? (
        <CalendarEventCard ev={ev} room={room} />
      ) : isSticker ? (
        <StickerMessage ev={ev} />
      ) : isLocation ? (
        <LocationMessage ev={ev} />
      ) : isLiveLocation ? (
        <LiveLocationCard ev={ev} room={room} />
      ) : isWatchTogetherInvite ? (
        <WatchTogetherInviteCard ev={ev} room={room} />
      ) : isDecryptionFailure ? (
        <p
          className="flex items-center gap-1.5 text-sm italic text-muted"
          title={ev.decryptionFailureReason ?? undefined}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="currentColor">
            <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3Z" />
          </svg>
          {t("chat.decryptionFailed")}
        </p>
      ) : isMedia ? (
        <MediaAttachment ev={ev} />
      ) : (
        <>
          <p
            className={clsx(
              // 0.9375rem (= 15px at the default root size), not text-[15px]: a
              // fixed px is immune to the Accessibility "font size" setting
              // (useDisplayPrefsStore.setFontScale, applyDom() in
              // lib/displayPrefs.ts scales the ROOT font-size) - confirmed
              // live, every other rem-based text size in the app grew with
              // it while message bodies alone stayed pinned at 15px.
              "jk-message-text whitespace-pre-wrap break-words text-[0.9375rem] text-normal",
              isEmote && "italic text-muted",
            )}
          >
            {isEmote && (
              <span className="mr-1 font-medium text-header">
                * {room.getMember(ev.getSender() ?? "")?.name ?? ev.getSender()}
              </span>
            )}
            <MessageBody
              body={stripReplyFallback((content.body as string) ?? "")}
              formattedBody={
                content.format === "org.matrix.custom.html" ? (content.formatted_body as string) : null
              }
              client={client}
            />
            {isEdited && (
              <button
                type="button"
                onClick={() => openModal({ type: "editHistory", roomId: room.roomId, eventId: ev.getId() ?? "" })}
                title={t("msgMenu.editHistory")}
                className="ml-1 text-[10px] text-muted hover:underline"
              >
                {t("msgMenu.edited")}
              </button>
            )}
          </p>
          {!isEdited && messageUrl && inviteLinkTarget ? (
            <InviteLinkCard url={messageUrl} />
          ) : (
            !isEdited &&
            showPreview &&
            messageUrl && (parseEmbeddableUrl(messageUrl) ? <RichEmbed url={messageUrl} /> : <LinkPreview url={messageUrl} />)
          )}
        </>
      )}
      {isFailed ? (
        <FailedMessageNotice ev={ev} room={room} client={client} />
      ) : (
        <>
          <ReactionPills ev={ev} room={room} client={client} />
          <ThreadSummaryPill ev={ev} room={room} client={client} />
          <ReadReceiptAvatars ev={ev} room={room} client={client} />
        </>
      )}
    </div>
  );
}
