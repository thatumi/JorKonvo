import {
  canManageRoles,
  editMessage,
  getAllUsableEmojis,
  getMemberRoles,
  getOwningSpace,
  getRoomMembersWithRole,
  getSlowmodeSeconds,
  getSpaceRoles,
  getSpaceUploadPolicy,
  hasClientPermission,
  isRoleMentionable,
  isSlowmodeExempt,
  type MentionEntry,
  type RoleMentionEntry,
  type RoomMember,
  runSlashCommand,
  sendFileMessage,
  sendReply,
  sendTextMessage,
  SLOWMODE_PRESETS,
  type SpaceRole,
} from "@jorkonvo/matrix-core";
import { type ChangeEvent, type DragEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { formatMb, getEffectiveUploadLimit, maybeCompressImage } from "../lib/imageCompression";
import { useTranslation } from "../i18n";
import { getLastSentAt, markSentNow } from "../lib/slowmodeTracking";
import { emojiForShortcode, searchUnicodeEmoji } from "../lib/unicodeEmoji";
import { convertTrailingEmoticon, isEmoticonToEmojiEnabled } from "../lib/emoticons";
import { useMatrixStore } from "../state/matrixStore";
import { useModalStore } from "../state/modalStore";
import { useUiStore } from "../state/uiStore";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { EmojiPicker } from "./EmojiPicker";
import { type MentionCandidate, MentionAutocomplete } from "./MentionAutocomplete";
import { VoiceRecorderBar } from "./VoiceRecorderBar";

/**
 * Finds an in-progress "@query" or ":query" run ending exactly at `cursor`,
 * if any - @ triggers the room/here/role/member picker, : triggers the
 * custom-emoji picker (see roomEmoji.ts). The : pattern requires at least 2
 * word-ish characters before showing anything, so a plain emoticon like
 * ":)" never opens a (useless, empty) dropdown.
 */
function findMentionQuery(
  text: string,
  cursor: number,
): { start: number; query: string; trigger: "@" | ":" } | null {
  const upToCursor = text.slice(0, cursor);
  const atMatch = /(?:^|\s)@([^\s@]*)$/.exec(upToCursor);
  if (atMatch) return { start: cursor - atMatch[1].length - 1, query: atMatch[1], trigger: "@" };
  const colonMatch = /(?:^|\s):([A-Za-z0-9_+-]{2,})$/.exec(upToCursor);
  if (colonMatch) return { start: cursor - colonMatch[1].length - 1, query: colonMatch[1], trigger: ":" };
  return null;
}

interface PendingUpload {
  id: string;
  name: string;
  loaded: number;
  total: number;
  error?: string;
}

/** Unsent composer text per room (see the draft effect below). */
const drafts = new Map<string, string>();

function ComposerBanner({
  icon,
  label,
  detail,
  onCancel,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-t-lg bg-bg-secondary/60 px-4 py-1.5 text-xs text-muted">
      {icon}
      <span className="font-medium text-header">{label}</span>
      <span className="min-w-0 flex-1 truncate">{detail}</span>
      <button type="button" onClick={onCancel} className="rounded px-1 hover:text-normal" title={t("common.cancel")} aria-label={t("common.cancel")}>
        ✕
      </button>
    </div>
  );
}

/**
 * The message composer: text area (with @mention / :emoji autocomplete,
 * slash commands, drafts, typing notifications), file upload with progress,
 * reply/edit banners, slowmode cooldown, emoji picker and voice recording.
 *
 * @param roomId - the room to send messages to.
 * @param roomName - display name used in the placeholder text.
 */
export function MessageComposer({ roomId, roomName }: { roomId: string; roomName: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client);
  const replyTarget = useUiStore((s) => s.replyTarget);
  const editTarget = useUiStore((s) => s.editTarget);
  const clearComposerTarget = useUiStore((s) => s.clearComposerTarget);
  const selectRoom = useUiStore((s) => s.selectRoom);
  const pendingMention = useUiStore((s) => s.pendingMention);
  const clearPendingMention = useUiStore((s) => s.clearPendingMention);
  const openModal = useModalStore((s) => s.open);

  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [mentions, setMentions] = useState<MentionEntry[]>([]);
  const [pickedRoles, setPickedRoles] = useState<SpaceRole[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionTrigger, setMentionTrigger] = useState<"@" | ":">("@");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [slowmodeTick, setSlowmodeTick] = useState(0);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const lastTypingSentRef = useRef(0);
  const { open: openMoreMenu, menu: moreMenu } = useContextMenu();

  const smallIcon = (path: string) => (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
      <path d={path} />
    </svg>
  );
  const moreMenuItems: MenuItem[] = [
    {
      label: t("composer.createPoll"),
      icon: smallIcon("M3 13h4v8H3v-8Zm7-9h4v17h-4V4Zm7 5h4v12h-4V9Z"),
      onClick: () => openModal({ type: "createPoll", roomId }),
    },
    {
      label: t("composer.createEvent"),
      icon: smallIcon(
        "M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V10h14v10ZM5 8V6h14v2H5Z",
      ),
      onClick: () => openModal({ type: "createCalendarEvent", roomId }),
    },
    {
      label: t("composer.sendSticker"),
      icon: smallIcon("M15.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.5L15.5 3Zm-.5 1.5L18.5 8H16a1 1 0 0 1-1-1V4.5Z"),
      onClick: () => openModal({ type: "sendSticker", roomId }),
    },
    {
      label: t("composer.sendGif"),
      icon: smallIcon(
        "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3.5 4.25a2.5 2.5 0 0 0-2.5 2.5v2.5a2.5 2.5 0 0 0 5 0v-1h-1.5v1a1 1 0 1 1-2 0v-2.5a1 1 0 0 1 2 0h1.5a2.5 2.5 0 0 0-2.5-2.5Zm4.75.25v6.5h1.5v-6.5h-1.5Zm3.75 0v6.5h1.5v-2.5h1.75v-1.5H17.5v-1h2v-1.5h-3.5Z",
      ),
      onClick: () => openModal({ type: "sendGif", roomId }),
    },
    {
      label: t("composer.shareLocation"),
      icon: smallIcon("M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"),
      onClick: () => openModal({ type: "shareLocation", roomId }),
    },
    {
      label: t("watchTogether.start"),
      icon: smallIcon("M8 5v14l11-7L8 5Z"),
      onClick: () => openModal({ type: "startWatchTogether", roomId }),
    },
  ];

  function insertAtCursor(text: string) {
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? value.length;
    setValue(value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = start + text.length;
      ta?.setSelectionRange(pos, pos);
    });
  }

  const room = client?.getRoom(roomId) ?? null;
  const roomMembers: RoomMember[] = room ? room.getMembersWithMembership("join") : [];
  const owningSpace = client && room ? getOwningSpace(client, roomId) : null;
  const ownUserId = client?.getUserId() ?? "";
  const mayManageRoles = owningSpace ? canManageRoles(owningSpace, ownUserId) : false;
  // Role managers can always @mention any role; everyone else only the ones flagged mentionable (Discord parity).
  const spaceRoles = owningSpace
    ? getSpaceRoles(owningSpace).filter((r) => mayManageRoles || isRoleMentionable(r))
    : [];
  const mayUseExternalEmoji = owningSpace
    ? hasClientPermission(getMemberRoles(owningSpace, ownUserId), "useExternalEmoji")
    : true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const roomEmoji = useMemo(() => (client ? getAllUsableEmojis(client, room, mayUseExternalEmoji) : []), [client, roomId, mayUseExternalEmoji]);

  const slowmodeSeconds = room ? getSlowmodeSeconds(room) : 0;
  const slowmodeExempt = room && client ? isSlowmodeExempt(room, client.getUserId() ?? "") : true;
  const slowmodeActive = slowmodeSeconds > 0 && !slowmodeExempt && !editTarget;
  // slowmodeTick has no reader of its own - it just forces a re-render every
  // second while a cooldown is running, so cooldownRemaining below is
  // recomputed against the current clock instead of staying frozen at
  // whatever it was when send() last ran.
  void slowmodeTick;
  const cooldownRemaining = slowmodeActive
    ? Math.max(0, slowmodeSeconds - Math.floor((Date.now() - getLastSentAt(roomId)) / 1000))
    : 0;

  useEffect(() => {
    if (!slowmodeActive || cooldownRemaining <= 0) return;
    const interval = setInterval(() => setSlowmodeTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [slowmodeActive, cooldownRemaining]);
  const mentionCandidates: MentionCandidate[] =
    mentionQuery === null
      ? []
      : mentionTrigger === ":"
        ? [
            ...roomEmoji
              .filter((e) => e.shortcode.toLowerCase().includes(mentionQuery.toLowerCase()))
              .map((emoji) => ({ kind: "customEmoji" as const, emoji })),
            ...searchUnicodeEmoji(mentionQuery, 8).map((e) => ({
              kind: "unicodeEmoji" as const,
              code: e.code,
              char: e.char,
            })),
          ].slice(0, 10)
        : [
            ...("room".startsWith(mentionQuery.toLowerCase()) ? [{ kind: "room" as const }] : []),
            ...("here".startsWith(mentionQuery.toLowerCase()) ? [{ kind: "here" as const }] : []),
            ...spaceRoles
              .filter((r) => r.name.toLowerCase().includes(mentionQuery.toLowerCase()))
              .map((role) => ({ kind: "spaceRole" as const, role })),
            ...roomMembers
              .filter(
                (m) =>
                  m.userId !== client?.getUserId() &&
                  (m.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
                    m.userId.toLowerCase().includes(mentionQuery.toLowerCase())),
              )
              .map((member) => ({ kind: "member" as const, member })),
          ].slice(0, 8);

  async function uploadFiles(files: FileList | File[]) {
    if (!client) return;
    const space = getOwningSpace(client, roomId);
    if (space && !hasClientPermission(getMemberRoles(space, client.getUserId() ?? ""), "attachFiles")) {
      for (const original of Array.from(files)) {
        setUploads((prev) => [
          ...prev,
          { id: `${original.name}-${Date.now()}-${Math.random()}`, name: original.name, loaded: 0, total: 0, error: t("composer.attachFilesDenied") },
        ]);
      }
      return;
    }
    const policy = getSpaceUploadPolicy(space);
    const limit = await getEffectiveUploadLimit(client, policy.maxUploadMb);

    for (const original of Array.from(files)) {
      const id = `${original.name}-${Date.now()}-${Math.random()}`;
      setUploads((prev) => [...prev, { id, name: original.name, loaded: 0, total: original.size }]);
      try {
        const file = await maybeCompressImage(original, {
          enabled: policy.compressImages,
          softMaxBytes: limit,
        });
        if (limit != null && file.size > limit) {
          throw new Error(
            t("composer.uploadTooLarge", { size: formatMb(file.size), limit: formatMb(limit), adminNote: policy.maxUploadMb != null ? t("composer.uploadAdminNote") : "" }),
          );
        }
        setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, total: file.size } : u)));
        await sendFileMessage(client, roomId, file, (progress) => {
          setUploads((prev) =>
            prev.map((u) => (u.id === id ? { ...u, loaded: progress.loaded, total: progress.total } : u)),
          );
        });
        setUploads((prev) => prev.filter((u) => u.id !== id));
      } catch (err) {
        setUploads((prev) =>
          prev.map((u) => (u.id === id ? { ...u, error: (err as Error).message } : u)),
        );
      }
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files);
  }

  useEffect(() => {
    if (editTarget) {
      setValue(editTarget.body);
      textareaRef.current?.focus();
    }
  }, [editTarget]);

  useEffect(() => {
    if (replyTarget) textareaRef.current?.focus();
  }, [replyTarget]);

  // Middle-click on a message author / member row inserts their @mention here.
  useEffect(() => {
    if (!pendingMention) return;
    const { userId, displayName } = pendingMention;
    clearPendingMention();
    setValue((v) => {
      const sep = v.length === 0 || v.endsWith(" ") || v.endsWith("\n") ? "" : " ";
      return `${v}${sep}@${displayName} `;
    });
    setMentions((prev) => [
      ...prev.filter((m) => m.displayName !== displayName),
      { displayName, userId },
    ]);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }, [pendingMention, clearPendingMention]);

  // Stop broadcasting "typing" when switching away from this room.
  useEffect(() => {
    return () => void client?.sendTyping(roomId, false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // A room switch invalidates any in-progress mention picking / tracked mentions.
  useEffect(() => {
    setMentionQuery(null);
    setMentions([]);
    setPickedRoles([]);
    setCommandFeedback(null);
    setRecording(false);
  }, [roomId]);

  // Per-room drafts: the typed-but-unsent text survives switching rooms.
  // Device-local by design (same semantics as Discord) - a module Map is all
  // it takes, and the component instance persists across room switches.
  const draftRoomRef = useRef(roomId);
  useEffect(() => {
    if (draftRoomRef.current === roomId) return;
    const prev = draftRoomRef.current;
    draftRoomRef.current = roomId;
    if (!editTarget) {
      // stash what's typed under the room we're leaving...
      if (value.trim()) drafts.set(prev, value);
      else drafts.delete(prev);
    }
    // ...and restore what was typed in the room we're entering (unless an
    // edit/reply just took over the composer).
    if (!editTarget && !replyTarget) {
      setValue(drafts.get(roomId) ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  function notifyTyping(nextValue: string) {
    if (!client) return;
    if (!nextValue) {
      void client.sendTyping(roomId, false, 0);
      lastTypingSentRef.current = 0;
      return;
    }
    const now = Date.now();
    if (now - lastTypingSentRef.current > 4000) {
      lastTypingSentRef.current = now;
      void client.sendTyping(roomId, true, 8000);
    }
  }

  async function send() {
    // Substitute any typed :shortcode: that maps to a Unicode emoji (custom
    // emoji shortcodes are handled separately, as <img>, in sendTextMessage,
    // and win when a custom emoji reuses a unicode name).
    const customCodes = new Set(roomEmoji.map((e) => e.shortcode.toLowerCase()));
    const body = value
      .trim()
      .replace(/:([a-z0-9_+-]{2,}):/gi, (m, code) =>
        customCodes.has(String(code).toLowerCase()) ? m : (emojiForShortcode(code) ?? m),
      );
    if (!body || !client || sending) return;

    if (!editTarget && !replyTarget) {
      const cmdResult = await runSlashCommand(client, roomId, body);
      if (cmdResult) {
        setValue("");
        void client.sendTyping(roomId, false, 0);
        lastTypingSentRef.current = 0;
        if (cmdResult.message) {
          setCommandFeedback(cmdResult.message);
        }
        if (cmdResult.leftRoom) selectRoom(null);
        return;
      }
    }

    // Edits and slash commands aren't rate-limited, only new messages -
    // cooldownRemaining above already excludes edits, but is recomputed here
    // rather than reused since a fair amount of async work (the slash-
    // command check) can happen between render and this point.
    if (!editTarget && slowmodeSeconds > 0 && !slowmodeExempt) {
      const remaining = slowmodeSeconds - Math.floor((Date.now() - getLastSentAt(roomId)) / 1000);
      if (remaining > 0) return;
    }

    setSending(true);
    setValue("");
    drafts.delete(roomId);
    setCommandFeedback(null);
    const activeMentions = mentions;
    const activeRoles = pickedRoles;
    setMentions([]);
    setPickedRoles([]);
    setMentionQuery(null);
    void client.sendTyping(roomId, false, 0);
    lastTypingSentRef.current = 0;
    // Resolved fresh at send time (not while typing) so it reflects who's
    // ACTUALLY online right now - Discord's @here semantics, snapshotted
    // once at send rather than re-evaluated later for each reader.
    const hereMentionUserIds = /(^|\s)@here\b/.test(body)
      ? roomMembers
          .filter((m) => m.userId !== client.getUserId())
          .filter((m) => {
            const presence = client.getUser(m.userId)?.presence;
            return presence === "online" || presence === "unavailable";
          })
          .map((m) => m.userId)
      : [];
    // Same "resolve fresh at send" principle as @here - who currently holds
    // this role in THIS room, not whoever held it when it was picked from
    // the autocomplete list.
    const roleMentions: RoleMentionEntry[] =
      owningSpace && room
        ? activeRoles.map((role) => ({
            roleId: role.id,
            name: role.name,
            color: role.color,
            userIds: getRoomMembersWithRole(owningSpace, room, role.id),
          }))
        : [];
    // Not "picked", unlike mentions/roles - ANY typed :shortcode: matching
    // a known room emoji is safe to substitute, so this is just the room's
    // current full pack, fresh at send time.
    const customEmoji = roomEmoji;
    try {
      if (editTarget) {
        await editMessage(
          client,
          roomId,
          editTarget.eventId,
          body,
          activeMentions,
          hereMentionUserIds,
          roleMentions,
          customEmoji,
        );
      } else if (replyTarget) {
        await sendReply(
          client,
          roomId,
          body,
          replyTarget.eventId,
          replyTarget.senderName,
          replyTarget.body,
          activeMentions,
          hereMentionUserIds,
          roleMentions,
          customEmoji,
        );
        markSentNow(roomId);
      } else {
        await sendTextMessage(client, roomId, body, activeMentions, hereMentionUserIds, roleMentions, customEmoji);
        markSentNow(roomId);
      }
    } catch (err) {
      // Don't restore the text into the composer: matrix-js-sdk already
      // created a local-echo message (visible in the timeline with its own
      // "Küldés sikertelen" / retry UI) before this rejected, so putting it
      // back here would just invite sending it twice.
      console.error("failed to send message", err);
    } finally {
      clearComposerTarget();
      setSending(false);
    }
  }

  function pickMention(candidate: MentionCandidate) {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? value.length;
    const found = findMentionQuery(value, cursor);
    if (!found) return;
    const before = value.slice(0, found.start);
    const after = value.slice(cursor);
    const insertion =
      candidate.kind === "room"
        ? "@room "
        : candidate.kind === "here"
          ? "@here "
          : candidate.kind === "spaceRole"
            ? `@${candidate.role.name} `
            : candidate.kind === "customEmoji"
              ? `:${candidate.emoji.shortcode}: `
              : candidate.kind === "unicodeEmoji"
                ? `${candidate.char} `
                : `@${candidate.member.name} `;
    setValue(`${before}${insertion}${after}`);
    if (candidate.kind === "member") {
      const { member } = candidate;
      setMentions((prev) => [
        ...prev.filter((m) => m.displayName !== member.name),
        { displayName: member.name, userId: member.userId },
      ]);
    } else if (candidate.kind === "spaceRole") {
      const { role } = candidate;
      setPickedRoles((prev) => [...prev.filter((r) => r.id !== role.id), role]);
    }
    setMentionQuery(null);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      const pos = before.length + insertion.length;
      textarea?.focus();
      textarea?.setSelectionRange(pos, pos);
    });
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    let next = e.target.value;
    if (isEmoticonToEmojiEnabled()) {
      const converted = convertTrailingEmoticon(next);
      if (converted !== next) {
        next = converted;
        // Keep the caret at the end of the just-inserted emoji.
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) el.selectionStart = el.selectionEnd = next.length;
        });
      }
    }
    setValue(next);
    notifyTyping(next);
    const found = findMentionQuery(next, e.target.selectionStart ?? next.length);
    setMentionQuery(found ? found.query : null);
    if (found) setMentionTrigger(found.trigger);
    setMentionIndex(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentionCandidates[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape" && (replyTarget || editTarget)) {
      clearComposerTarget();
      setValue("");
    }
  }

  const mentionOpen = mentionQuery !== null && mentionCandidates.length > 0 && !!client;

  return (
    // The compose bar is the app's one bottom-anchored interactive bar, so it
    // keeps a bottom safe-area inset at every size: without it the textarea
    // lands under the home indicator. Scrolling content above intentionally
    // has no inset. Phones keep only a thin extra margin above the inset -
    // 1.5rem + inset read as a wide dead band under the input there (sm+
    // keeps the original 1.5rem breathing room; the env() term is 0 wherever
    // the device has no safe area, so desktop is unchanged).
    <div className="relative px-4 pt-1 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] sm:pb-[calc(1.5rem_+_env(safe-area-inset-bottom))]">
      {mentionQuery !== null && mentionCandidates.length > 0 && client && (
        <MentionAutocomplete
          candidates={mentionCandidates}
          client={client}
          activeIndex={mentionIndex}
          onHover={setMentionIndex}
          onPick={pickMention}
        />
      )}
      {slowmodeActive && (
        <div className="mb-1 flex items-center gap-1.5 px-1 text-xs text-muted">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="currentColor">
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm.5 5v5.3l4.3 2.5-.75 1.3-5.05-3V7h1.5Z" />
          </svg>
          {cooldownRemaining > 0
            ? t("composer.slowmodeWait", { seconds: cooldownRemaining })
            : t("composer.slowmodeActive", {
                interval:
                  (() => { const pr = SLOWMODE_PRESETS.find((p) => p.seconds === slowmodeSeconds); return pr ? t(pr.labelKey) : `${slowmodeSeconds}s`; })(),
              })}
        </div>
      )}
      <div
        className={`rounded-lg bg-bg-secondary ${dragOver ? "ring-2 ring-brand" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {commandFeedback && (
          <div className="flex items-start gap-2 rounded-t-lg bg-bg-secondary/60 px-4 py-1.5 text-xs text-muted">
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{commandFeedback}</span>
            <button
              type="button"
              onClick={() => setCommandFeedback(null)}
              className="shrink-0 rounded px-1 hover:text-normal"
              title={t("common.close")}
              aria-label={t("common.close")}
            >
              ✕
            </button>
          </div>
        )}
        {uploads.length > 0 && (
          <div className="flex flex-col gap-1 px-4 pt-2">
            {uploads.map((u) => (
              <div key={u.id} className="text-xs text-muted">
                {u.error ? (
                  <span className="text-dnd">
                    {u.name}: {u.error}
                  </span>
                ) : (
                  <div>
                    <span>{u.name}</span>
                    <div className="mt-0.5 h-1 w-full overflow-hidden rounded bg-bg-darkest">
                      <div
                        className="h-full bg-brand transition-all"
                        style={{
                          width: u.total ? `${Math.min(100, (u.loaded / u.total) * 100)}%` : "10%",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {replyTarget && (
          <ComposerBanner
            icon={
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                <path d="M10 9V5l-8 7 8 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z" />
              </svg>
            }
            label={t("composer.replyingTo", { name: replyTarget.senderName })}
            detail={replyTarget.body}
            onCancel={clearComposerTarget}
          />
        )}
        {editTarget && (
          <ComposerBanner
            icon={
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                <path d="m3 17.25 11.06-11.06 3.75 3.75L6.75 21H3v-3.75Zm14.85-13.5 1.4-1.4a1 1 0 0 1 1.42 0l2.33 2.33a1 1 0 0 1 0 1.42l-1.4 1.4-3.75-3.75Z" />
              </svg>
            }
            label={t("composer.editingMessage")}
            detail=""
            onCancel={() => {
              clearComposerTarget();
              setValue("");
            }}
          />
        )}
        {recording && client ? (
          <VoiceRecorderBar client={client} roomId={roomId} onDone={() => setRecording(false)} />
        ) : (
          <div className="flex items-center gap-2 px-4 py-2.5">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) void uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded p-1.5 text-muted hover:text-normal"
              title={t("composer.attachFile")}
              aria-label={t("composer.attachFile")}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                <path d="M16.5 6.5v10a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V7H9v8.5a3 3 0 0 0 6 0V5a4.5 4.5 0 0 0-9 0v11.5a6 6 0 0 0 12 0v-10h-1.5Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={(e) => openMoreMenu(e, moreMenuItems)}
              className="rounded p-1.5 text-muted hover:text-normal"
              title={t("composer.more")}
              aria-label={t("composer.more")}
              aria-haspopup="menu"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                <path d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2h6Z" />
              </svg>
            </button>
            {moreMenu}
            <button
              ref={emojiButtonRef}
              type="button"
              onClick={() => setEmojiPickerOpen((v) => !v)}
              className="rounded p-1.5 text-muted hover:text-normal"
              title={t("composer.emoji")}
              aria-label={t("composer.emoji")}
              aria-haspopup="dialog"
              aria-expanded={emojiPickerOpen}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-3.5 7a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm-7.44 5h7.88a5.5 5.5 0 0 1-7.88 0Z" />
              </svg>
            </button>
            {emojiPickerOpen && emojiButtonRef.current && (
              <EmojiPicker
                anchorEl={emojiButtonRef.current}
                customEmoji={roomEmoji}
                onPick={(pick) => {
                  insertAtCursor("char" in pick ? pick.char : `:${pick.shortcode}: `);
                  setEmojiPickerOpen(false);
                }}
                onClose={() => setEmojiPickerOpen(false)}
              />
            )}
            <textarea
              ref={textareaRef}
              data-testid="composer-input"
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              rows={1}
              role="combobox"
              aria-label={t("composer.placeholder", { room: roomName })}
              aria-autocomplete="list"
              aria-expanded={mentionOpen}
              aria-controls={mentionOpen ? "jk-mention-listbox" : undefined}
              aria-activedescendant={mentionOpen ? `jk-mention-opt-${mentionIndex}` : undefined}
              placeholder={t("composer.placeholder", { room: roomName })}
              className="min-w-0 max-h-40 flex-1 resize-none bg-transparent py-1 text-[15px] text-normal placeholder:text-muted outline-none"
            />
            {value.trim() ? (
              <button
                type="button"
                onClick={() => void send()}
                disabled={!value.trim() || sending || cooldownRemaining > 0}
                className="rounded p-1.5 text-muted enabled:hover:text-brand disabled:opacity-40"
                title={cooldownRemaining > 0 ? t("composer.slowmodeLeft", { seconds: cooldownRemaining }) : t("composer.send")}
                aria-label={cooldownRemaining > 0 ? t("composer.slowmodeLeft", { seconds: cooldownRemaining }) : t("composer.send")}
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                  <path d="M2 21 23 12 2 3v7l15 2-15 2v7Z" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setRecording(true)}
                className="rounded p-1.5 text-muted hover:text-normal"
                title={t("composer.recordVoice")}
                aria-label={t("composer.recordVoice")}
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                  <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2Z" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
