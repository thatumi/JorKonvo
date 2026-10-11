import {
  clearLocalUnread,
  isRoomMarkedUnread,
  setRoomMarkedUnread,
  Direction,
  getMemberRoleColor,
  getOwningSpace,
  isCalendarEventStart,
  isLiveLocationStartEvent,
  isPollStartEvent,
  isStickerEvent,
  isWatchTogetherInviteEvent,
  type MatrixEvent,
  RelationType,
  type Room,
} from "@jorkonvo/matrix-core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { scrollBehavior } from "../lib/displayPrefs";
import { formatDayDivider, formatTimestamp } from "../lib/format";
import { isPrivateReadReceiptsEnabled } from "../lib/readReceiptPrivacy";
import { useProfileFlair } from "../lib/profileFlair";
import { getRoomScrollMemory, registerScrollMemoryCapture, setRoomScrollMemory } from "../lib/roomScrollMemory";
import { useMatrixStore } from "../state/matrixStore";
import { useTranslation } from "../i18n";
import { useUiStore } from "../state/uiStore";
import { Avatar } from "./Avatar";
import { useContextMenu } from "./ContextMenu";
import { MessageLine } from "./MessageLine";
import { RoleBadges } from "./RoleBadges";
import { useMemberMenu } from "./memberMenu";
import { UserProfilePopover } from "./UserProfilePopover";

function isDisplayableMessage(ev: MatrixEvent): boolean {
  if (ev.isRedacted()) return false;
  // Only the beacon_info revision that STARTS a live share gets a card - it
  // reads current live/ended state itself, so later revisions (the "stop"
  // transition) don't need their own separate, redundant card.
  if (
    isPollStartEvent(ev) ||
    isCalendarEventStart(ev) ||
    isStickerEvent(ev) ||
    isLiveLocationStartEvent(ev) ||
    isWatchTogetherInviteEvent(ev)
  )
    return true;
  if (ev.getType() !== "m.room.message") return false;
  const content = ev.getContent();
  if (typeof content.body !== "string") return false;
  // Thread replies live in the thread panel, not the main channel view.
  if (content["m.relates_to"]?.rel_type === RelationType.Thread) return false;
  // An edit is its own m.room.message event, separate from the original -
  // matrix-js-sdk transparently substitutes the ORIGINAL event's own
  // getContent() with the latest edit's text (see event.js's makeReplaced),
  // so the edit event itself must NOT also render as a second, redundant
  // line (with the spec's own "* new text" fallback body, which is exactly
  // what showed up literally doubled in testing before this filter existed).
  if (content["m.relates_to"]?.rel_type === RelationType.Replace) return false;
  return true;
}

export function MessageGroup({
  senderId,
  senderName,
  avatarUrl,
  events,
  room,
}: {
  senderId: string;
  senderName: string;
  avatarUrl: string | null;
  events: MatrixEvent[];
  room: Room;
}) {
  const client = useMatrixStore((s) => s.client)!;
  const flair = useProfileFlair(senderId);
  const first = events[0]!;
  const avatarRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLButtonElement>(null);
  const [profileAnchor, setProfileAnchor] = useState<HTMLElement | null>(null);
  const owningSpace = getOwningSpace(client, room.roomId);
  const nameColor = owningSpace ? getMemberRoleColor(owningSpace, senderId) : null;
  const { open: openCtx, menu: ctxMenu } = useContextMenu();
  const memberMenu = useMemberMenu(room);
  const requestMention = useUiStore((s) => s.requestMention);
  const onAuthorContextMenu = (e: React.MouseEvent) => openCtx(e, memberMenu(senderId));
  // Middle-click an author → drop their @mention into the composer.
  const onAuthorMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    requestMention(senderId, senderName);
  };

  return (
    <div className="jk-msg-group flex items-start gap-4 px-4 py-1">
      <button
        ref={avatarRef}
        type="button"
        onClick={() => setProfileAnchor(avatarRef.current)}
        onContextMenu={onAuthorContextMenu}
        onMouseDown={onAuthorMouseDown}
        className="jk-msg-avatar jk-ctx-target w-10 shrink-0 pt-0.5"
      >
        <Avatar url={avatarUrl} name={senderName} size={40} decorationMxc={flair.decorationMxc} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button
            ref={nameRef}
            type="button"
            onClick={() => setProfileAnchor(nameRef.current)}
            onContextMenu={onAuthorContextMenu}
            onMouseDown={onAuthorMouseDown}
            style={nameColor ? { color: nameColor } : undefined}
            className="jk-ctx-target font-medium text-header hover:underline"
          >
            {senderName}
          </button>
          <RoleBadges space={owningSpace} userId={senderId} />
          <span className="text-xs text-muted">{formatTimestamp(first.getTs())}</span>
        </div>
        {events.map((ev) => (
          <MessageLine key={ev.getId()} ev={ev} room={room} />
        ))}
      </div>
      {profileAnchor && (
        <UserProfilePopover
          userId={senderId}
          client={client}
          room={room}
          anchorEl={profileAnchor}
          onClose={() => setProfileAnchor(null)}
        />
      )}
      {ctxMenu}
    </div>
  );
}

// A long-lived room can accumulate thousands of loaded events once scrollback
// has paged through its history - rendering every one of them as real DOM
// nodes gets visibly janky well before that. Rather than pulling in a full
// height-measuring virtualizer (chat message heights vary wildly - images,
// polls, threads, embeds - and every scroll-anchoring/jump-to-event/unread-
// divider interaction already depends on plain DOM queries), only the most
// recent RENDER_WINDOW_SIZE groups are mounted; scrolling near the top reveals
// another RENDER_WINDOW_STEP of already-loaded groups instantly (no network
// round-trip), and only once the window has caught up to everything loaded
// does scrolling further trigger the real network pagination below.
const RENDER_WINDOW_SIZE = 60;
const RENDER_WINDOW_STEP = 60;
// Below this many locally-cached events, a freshly opened room reads as
// empty even though there's more history to fetch - worth one automatic
// backfill on open (see the room-switch effect below).
const MIN_INITIAL_EVENTS = 10;

/**
 * Scrollable message log for a room: groups consecutive events per sender,
 * renders day dividers and the "new messages" marker, and handles scroll
 * anchoring, infinite scrollback and jump-to-event.
 *
 * @param room - the room whose live timeline is displayed.
 */

/**
 * Vertically centre `el` inside the timeline's own scroller - and nothing
 * else. `el.scrollIntoView()` scrolls *every* scrollable ancestor, sideways
 * too (inline: "nearest" still moves when the target is off screen), and on
 * mobile the timeline sits in MainLayout's swipe row: jumping to the unread
 * divider during the 240ms slide-in (the chat pane still off screen to the
 * right) scrolled that overflow-hidden row horizontally, and nothing ever
 * reset it - the "whole picture slides until I force-quit" bug seen on iOS
 * when going from Home/a DM into a server.
 */
function centerInTimeline(container: HTMLElement, el: HTMLElement, behavior: ScrollBehavior = "auto") {
  const delta =
    el.getBoundingClientRect().top - container.getBoundingClientRect().top - (container.clientHeight - el.offsetHeight) / 2;
  container.scrollTo({ top: container.scrollTop + delta, behavior });
}

export function Timeline({ room }: { room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const jumpToEventId = useUiStore((s) => s.jumpToEventId);
  const jumpToEvent = useUiStore((s) => s.jumpToEvent);
  const clearJumpToEvent = useUiStore((s) => s.clearJumpToEvent);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [canPaginate, setCanPaginate] = useState(true);
  const [unreadAbove, setUnreadAbove] = useState(false);
  const [farFromBottom, setFarFromBottom] = useState(false);
  const jumpingRef = useRef(false);
  const [renderWindow, setRenderWindow] = useState(RENDER_WINDOW_SIZE);

  const events = room
    .getLiveTimeline()
    .getEvents()
    .filter(isDisplayableMessage)
    .filter((ev) => !client.isUserIgnored(ev.getSender() ?? ""));

  // Where the "new messages" divider goes. Captured during RENDER on room
  // switch, before any effect runs: the receipt effect below records the local
  // read receipt synchronously (room.addLocalEchoReceipt), and React
  // StrictMode runs every effect twice - an effect-based capture would find
  // "everything read" on the second pass and the divider would never appear.
  const dividerEventId = useMemo(() => {
    const myId = client.getUserId() ?? "";
    const firstUnread = events.find((ev) => {
      const id = ev.getId();
      return id !== undefined && !room.hasUserReadEvent(myId, id);
    });
    return firstUnread?.getId() ?? null;
    // Deliberately keyed on room only: the divider freezes at "what was unread
    // when the room was opened" and must not jump as new events arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.roomId]);

  // useLayoutEffect (not useEffect) so this runs before the browser paints -
  // with a full render window's worth of history already mounted, a plain
  // useEffect leaves a visible frame (or several, on a slow layout) where the
  // room is scrolled to wherever the fresh DOM naturally starts, before
  // snapping down - looking like the room "starts higher up" than it should.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    // Resuming a remembered scroll position takes priority over the unread
    // divider - it reflects where THIS client actually left off looking,
    // which can differ from the read receipt (e.g. you scrolled up into
    // history without that advancing your read marker at all).
    const memory = getRoomScrollMemory(room.roomId);
    if (memory) {
      jumpToEvent(memory.eventId);
    } else if (dividerEventId) {
      // Same mechanism as jumping to a search result: paginate backward
      // until it's loaded, then scroll it into view.
      jumpToEvent(dividerEventId);
    } else if (el) {
      el.scrollTop = el.scrollHeight;
    }
    setUnreadAbove(dividerEventId !== null);
    setFarFromBottom(false);
    setRenderWindow(RENDER_WINDOW_SIZE);
    // Don't offer an "older messages" button when there's nothing older: no
    // backward pagination token, or the room's own m.room.create event is
    // already the first thing in the live timeline (a fresh room keeps a
    // token that only resolves to null after one no-op paginate).
    const tl = room.getLiveTimeline();
    const atStart =
      tl.getPaginationToken(Direction.Backward) === null ||
      tl.getEvents()[0]?.getType() === "m.room.create";
    setCanPaginate(!atStart);
    // A room opened for the first time in a while (or never actively synced)
    // can have only a handful of events cached locally - too few to look like
    // a real conversation, sometimes literally none. Nothing else pulls more
    // history until the user scrolls or clicks "older messages"; do it
    // automatically once up front so a room never opens looking empty when
    // there's actually history to show.
    if (!atStart && events.length < MIN_INITIAL_EVENTS) void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.roomId]);

  // Registers the function uiStore's selectRoom/selectSpace call, synchronously,
  // the instant a switch away from this room is initiated - see
  // roomScrollMemory.ts for why this can't be done reactively (a scroll
  // listener, an unmount cleanup) without racing the DOM mutation that
  // swaps in the next room's messages.
  useEffect(() => {
    registerScrollMemoryCapture(() => {
      const el = scrollRef.current;
      if (!el) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight;
      if (nearBottom) {
        // Per the user's own request: being at/near the bottom isn't a
        // position worth pinning - forget any stale memory so next time
        // defaults fresh to unread-or-bottom instead of freezing here.
        setRoomScrollMemory(room.roomId, null);
        return;
      }
      const containerTop = el.getBoundingClientRect().top;
      for (const candidate of el.querySelectorAll<HTMLElement>("[data-event-id]")) {
        if (candidate.getBoundingClientRect().bottom <= containerTop + 4) continue;
        const id = candidate.getAttribute("data-event-id");
        if (id) setRoomScrollMemory(room.roomId, { eventId: id });
        break;
      }
    });
    return () => registerScrollMemoryCapture(null);
  }, [room.roomId]);

  function scrollToUnread() {
    const el = scrollRef.current;
    const target = el?.querySelector<HTMLElement>("[data-unread-divider]");
    if (el && target) {
      centerInTimeline(el, target, scrollBehavior());
      setUnreadAbove(false);
    } else if (dividerEventId) {
      jumpToEvent(dividerEventId);
    }
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setFarFromBottom(false);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  // Mark the newest fully-sent message as read whenever it changes while the
  // room is open. Local-echo events (still sending, no server event ID yet)
  // must be skipped - the server rejects receipts for them with a 400.
  //
  // setRoomReadMarkers (rather than the plain sendReadReceipt used before)
  // also advances m.fully_read in the same request - a THIRD read-state
  // concept distinct from the receipt: it's private account data, never
  // shown to other room members regardless of the public/private receipt
  // preference below, and exists purely so this account's OTHER clients
  // (Element X, Sable, etc. on the real thatumi account) know where this
  // device left off reading, for their own "jump to first unread" -
  // without it, every other client of the same account stays oblivious to
  // what got read here.
  useEffect(() => {
    const markRoomRead = () => {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]!;
        if (!ev.isSending()) {
          const rmEventId = ev.getId();
          if (rmEventId) {
            void client.setRoomReadMarkers(
              room.roomId,
              rmEventId,
              isPrivateReadReceiptsEnabled() ? undefined : ev,
              isPrivateReadReceiptsEnabled() ? ev : undefined,
            );
          }
          break;
        }
      }
      clearLocalUnread(room.roomId);
      if (isRoomMarkedUnread(room)) void setRoomMarkedUnread(client, room.roomId, false).catch(() => undefined);
    };

    // Only mark read what the user could actually have seen: a backgrounded
    // tab still syncs and re-renders, and without this check every message
    // that arrived while the app sat unfocused would silently lose its
    // unread state (and its "new messages" divider) before it was ever
    // looked at. The listener re-runs it the moment the tab is foregrounded.
    if (document.visibilityState !== "visible") {
      const onVisible = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", onVisible);
        markRoomRead();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => document.removeEventListener("visibilitychange", onVisible);
    }
    markRoomRead();
    // isSending() only turns false once a local echo round-trips back
    // through /sync and gets reconciled - its event id doesn't change at
    // that point (the send response already gave it the real id), only its
    // internal status does, so that status has to be its OWN dependency or
    // this effect would never re-run for that transition. Without it, a
    // room where nobody else sends anything after your own last message
    // (only tested live via the OTHER, far more common case - reading a
    // message someone else sent, which has no such delay at all) would
    // permanently leave m.fully_read one message behind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.at(-1)?.getId(), events.at(-1)?.status, events.length, room.roomId]);

  // Jump to a message picked from search results: paginate backward (reusing
  // the same scrollback mechanism as "Korábbi üzenetek") until the target
  // event shows up in the live timeline, then scroll it into view and flash
  // a highlight. Bounded so a stale/foreign event id can't loop forever.
  useEffect(() => {
    if (!jumpToEventId || jumpingRef.current) return;
    let cancelled = false;
    jumpingRef.current = true;

    async function run() {
      let found = room.findEventById(jumpToEventId!);
      let attempts = 0;
      while (!found && attempts < 25 && !cancelled) {
        const timeline = await client.scrollback(room, 50);
        found = room.findEventById(jumpToEventId!);
        attempts++;
        if (timeline.getLiveTimeline().getPaginationToken(Direction.Backward) === null) break;
      }
      if (!cancelled && found) {
        // The jump target may be well above the current render window -
        // render everything loaded so far so it's actually in the DOM to
        // scroll to. Shrinks back to a normal window on the next room switch.
        setRenderWindow(Infinity);
        requestAnimationFrame(() => {
          const container = scrollRef.current;
          const el = container?.querySelector<HTMLElement>(`[data-event-id="${jumpToEventId}"]`);
          if (!container || !el) return;
          centerInTimeline(container, el);
          el.classList.add("bg-brand/20");
          setTimeout(() => el.classList.remove("bg-brand/20"), 2200);
        });
      }
      if (!cancelled) clearJumpToEvent();
      jumpingRef.current = false;
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToEventId]);

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const before = room.getLiveTimeline().getEvents().length;
      const more = await client.scrollback(room, 30);
      const tl = more.getLiveTimeline();
      setCanPaginate(
        tl.getPaginationToken(Direction.Backward) !== null &&
          tl.getEvents()[0]?.getType() !== "m.room.create" &&
          room.getLiveTimeline().getEvents().length > before,
      );
      setRenderWindow((w) => w + 30);
    } finally {
      setLoadingMore(false);
    }
  }

  // Discord-style infinite scroll: nearing the top loads older history
  // automatically, keeping the viewport anchored to the messages the user was
  // reading instead of jumping.
  const scrollAdjustRef = useRef<{ prevHeight: number; prevTop: number } | null>(null);
  useLayoutEffect(() => {
    const adjust = scrollAdjustRef.current;
    if (!adjust) return;
    scrollAdjustRef.current = null;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight - adjust.prevHeight + adjust.prevTop;
  }, [events.length, renderWindow]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    // "At least a page" scrolled up from the bottom - matches the threshold
    // a reader would actually notice, rather than firing on every tiny nudge.
    setFarFromBottom(el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight);
    if (unreadAbove) {
      const divider = el.querySelector<HTMLElement>("[data-unread-divider]");
      if (divider) {
        const top = divider.getBoundingClientRect().top;
        const containerTop = el.getBoundingClientRect().top;
        if (top >= containerTop - 4) setUnreadAbove(false);
      }
    }
    if (jumpingRef.current) return;
    if (el.scrollTop > 120) return;
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;

    if (renderWindow < groups.length) {
      // More history is already loaded but not yet mounted - reveal another
      // window of it instantly, no network round-trip needed.
      setRenderWindow((w) => Math.min(groups.length, w + RENDER_WINDOW_STEP));
      scrollAdjustRef.current = { prevHeight, prevTop };
      return;
    }

    if (loadingMore || !canPaginate) return;
    const before = room.getLiveTimeline().getEvents().length;
    void loadMore().then(() => {
      // Only anchor when history actually grew - otherwise the stale offset
      // would misfire on the next unrelated render.
      if (room.getLiveTimeline().getEvents().length > before) {
        scrollAdjustRef.current = { prevHeight, prevTop };
      }
    });
  }

  let lastSender: string | null = null;
  let lastTs = 0;
  // Tracked separately from the groups: a group only *stores* its day label
  // when the day actually changed, so we can't read "the previous day" back
  // off `groups.at(-1)` - doing so made every group after the first re-emit a
  // "Today" divider.
  let lastDayLabel: string | null = null;
  const groups: { key: string; senderId: string; events: MatrixEvent[]; dayLabel?: string; hasDivider: boolean }[] = [];

  for (const ev of events) {
    const senderId = ev.getSender() ?? "";
    const dayLabel = formatDayDivider(ev.getTs());
    const dayChanged = lastDayLabel !== null && dayLabel !== lastDayLabel;
    const sameGroup =
      senderId === lastSender && ev.getTs() - lastTs < 5 * 60 * 1000 && !dayChanged;
    const startsUnread = !!dividerEventId && ev.getId() === dividerEventId;

    if (sameGroup && groups.length > 0 && !startsUnread) {
      groups.at(-1)!.events.push(ev);
    } else {
      groups.push({
        key: ev.getId() ?? String(ev.getTs()),
        senderId,
        events: [ev],
        dayLabel: lastDayLabel === null || dayChanged ? dayLabel : undefined,
        hasDivider: startsUnread,
      });
    }
    lastSender = senderId;
    lastTs = ev.getTs();
    lastDayLabel = dayLabel;
  }

  const visibleGroups = groups.length > renderWindow ? groups.slice(groups.length - renderWindow) : groups;
  const hasMoreLocalHistory = renderWindow < groups.length;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {unreadAbove && (
        <button
          type="button"
          onClick={scrollToUnread}
          className="animate-slide-in-up absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-xs font-medium text-white shadow-lg hover:bg-brand-hover"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            <path d="M12 4l-8 8h5v8h6v-8h5z" />
          </svg>
          {t("chat.jumpToUnread")}
        </button>
      )}
      <div ref={scrollRef} role="log" aria-live="polite" className="flex-1 overflow-y-auto py-3" onScroll={onScroll}>
      {hasMoreLocalHistory ? (
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={() => setRenderWindow((w) => Math.min(groups.length, w + RENDER_WINDOW_STEP))}
            className="rounded bg-bg-secondary px-3 py-1 text-xs text-muted hover:text-normal"
          >
            {t("chat.olderMessages")}
          </button>
        </div>
      ) : (
        canPaginate && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="rounded bg-bg-secondary px-3 py-1 text-xs text-muted hover:text-normal disabled:opacity-50"
            >
              {loadingMore ? t("chat.loadingOlder") : t("chat.olderMessages")}
            </button>
          </div>
        )
      )}

      {visibleGroups.map((group) => {
        const member = room.getMember(group.senderId);
        const senderName = member?.name || group.senderId;
        const avatarUrl = member?.getAvatarUrl(client.baseUrl, 40, 40, "crop", false, false) ?? null;

        return (
          <div key={group.key}>
            {group.hasDivider && (
              <div className="my-3 flex items-center gap-3 px-4" data-unread-divider>
                <div className="h-px flex-1 bg-dnd" />
                <span className="rounded-sm bg-dnd px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-white">
                  {t("chat.newMessages")}
                </span>
                <div className="h-px flex-1 bg-dnd" />
              </div>
            )}
            {group.dayLabel && (
              <div className="my-3 flex items-center gap-3 px-4">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-medium text-muted">{group.dayLabel}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}
            <MessageGroup
              senderId={group.senderId}
              senderName={senderName}
              avatarUrl={avatarUrl}
              events={group.events}
              room={room}
            />
          </div>
        );
      })}

      {events.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-muted">
          <svg viewBox="0 0 24 24" className="h-12 w-12 text-brand/40" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 10h8M8 14h5M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="text-sm">{t("chat.timelineStart")}</p>
        </div>
      )}
      </div>
      {farFromBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          title={t("chat.jumpToLatest")}
          aria-label={t("chat.jumpToLatest")}
          className="animate-slide-in-up absolute bottom-3 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-bg-secondary text-normal shadow-lg ring-1 ring-white/5 hover:bg-bg-modifier-hover"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M12 20l-8-8h5V4h6v8h5z" />
          </svg>
        </button>
      )}
    </div>
  );
}
