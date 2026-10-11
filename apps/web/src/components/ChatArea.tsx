import { createPortal } from "react-dom";
import {
  clearTimedMute,
  clearTimedMuteEntry,
  getActiveVoiceMemberIds,
  getMutedUntil,
  getPinnedEventIds,
  getRoomNotificationMode,
  getRoomTombstone,
  isDirectRoom,
  isForumChannel,
  isVoiceChannel,
  setRoomNotificationMode,
  setTimedMute,
  TIMED_MUTE_PRESETS,
  type Room,
  type RoomNotificationMode,
} from "@jorkonvo/matrix-core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getRoomNotificationSound,
  NOTIFICATION_SOUNDS,
  type NotificationSoundId,
  setRoomNotificationSound,
} from "../lib/notificationSound";
import { useCallUiStore } from "../lib/callUi";
import { useDragToDismiss } from "../lib/dragToDismiss";
import { useLayoutMode } from "../lib/useIsMobile";
import { useTranslation } from "../i18n";
import { formatClockTime } from "../lib/format";
import { placeAndTrackCall, useCallStore } from "../state/callStore";
import { useGroupCallStore } from "../state/groupCallStore";
import { useMatrixStore } from "../state/matrixStore";
import { Avatar } from "./Avatar";
import { ChannelContentGate } from "./ChannelContentGate";
import { useModalStore } from "../state/modalStore";
import { useUiStore } from "../state/uiStore";
import { useContextMenu, type MenuItem } from "./ContextMenu";
import { EventsPanel } from "./EventsPanel";
import { InboxPanel } from "./InboxPanel";
import { ForumPanel } from "./ForumPanel";
import { FriendsPanel } from "./FriendsPanel";
import { MemberList } from "./MemberList";
import { MessageComposer } from "./MessageComposer";
import { ReactionEffects } from "./ReactionEffects";
import { SearchPanel } from "./SearchPanel";
import { ThreadPanel } from "./ThreadPanel";
import { ThreadsListPanel } from "./ThreadsListPanel";
import { Timeline } from "./Timeline";
import { WatchTogetherBar } from "./WatchTogetherBar";
import { TypingIndicator } from "./TypingIndicator";
import { WidgetsPanel } from "./WidgetsPanel";
import { resetSwipeScroll } from "../lib/swipeScroll";

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-muted" fill="currentColor">
      <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3Z" />
    </svg>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 text-muted">
      <svg viewBox="0 0 24 24" className="h-16 w-16 text-brand/40" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-sm">{t("chat.pickRoom")}</p>
    </div>
  );
}

/** A voice channel has no text timeline - it's a call. This is the "lobby":
 *  who's connected, and a button to join / return to the call. */
function VoiceChannelLanding({ room }: { room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  useGroupCallStore((s) => s.tick);
  const groupCallMatrixRoomId = useGroupCallStore((s) => s.matrixRoomId);
  const groupCallRoom = useGroupCallStore((s) => s.room);
  const leaveGroupCall = useGroupCallStore((s) => s.leave);
  const joinGroupCall = useGroupCallStore((s) => s.join);
  const activeCall = useCallStore((s) => s.call);
  const setCallMinimized = useCallUiStore((s) => s.setMinimized);

  const connectedHere = groupCallMatrixRoomId === room.roomId;
  const memberIds = getActiveVoiceMemberIds(room);

  async function join() {
    if (connectedHere) {
      setCallMinimized(false);
      return;
    }
    if (activeCall) return;
    if (groupCallRoom) await leaveGroupCall();
    await joinGroupCall(client, room.roomId, { startWithVideo: false });
  }

  return (
    <div className="animate-fade-up flex h-full flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
      <svg viewBox="0 0 24 24" className="h-12 w-12 text-muted" fill="currentColor">
        <path d="M12 3 7 7H3v10h4l5 4V3Zm4.5 9a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12ZM14 2.23v2.06A7 7 0 0 1 19 12a7 7 0 0 1-5 6.71v2.06A9 9 0 0 0 21 12a9 9 0 0 0-7-9.77Z" />
      </svg>
      <div>
        <h2 className="text-xl font-semibold text-header">{room.name}</h2>
        <p className="text-sm text-muted">{t("chat.voiceChannel")}</p>
      </div>
      {memberIds.length > 0 ? (
        <div className="flex max-w-md flex-wrap justify-center gap-4">
          {memberIds.map((id) => {
            const m = room.getMember(id);
            return (
              <div key={id} className="flex w-20 flex-col items-center gap-1">
                <Avatar
                  url={m?.getAvatarUrl(client.baseUrl, 48, 48, "crop", false, false) ?? null}
                  name={m?.name ?? id}
                  size={48}
                />
                <span className="w-full truncate text-xs text-muted">{m?.name ?? id}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted">{t("chat.voiceEmpty")}</p>
      )}
      <button
        type="button"
        onClick={() => void join()}
        disabled={!!activeCall && !connectedHere}
        className="rounded-full bg-online px-6 py-2.5 font-medium text-white transition hover:brightness-110 disabled:opacity-50"
      >
        {connectedHere ? t("chat.voiceReturn") : t("chat.voiceJoin")}
      </button>
    </div>
  );
}

const NOTIFICATION_MODE_OPTIONS: { value: RoomNotificationMode; labelKey: string; hintKey: string }[] = [
  { value: "all", labelKey: "chat.notifyAll", hintKey: "chat.notifyAllHint" },
  { value: "mentions", labelKey: "chat.notifyMentions", hintKey: "chat.notifyMentionsHint" },
  { value: "muted", labelKey: "chat.notifyMuted", hintKey: "chat.notifyMutedHint" },
];

/**
 * Main chat column for the selected room: header (back, notification mode,
 * search, more menu, member-list toggle), tombstone banner, and the
 * timeline + composer (or the voice-channel lobby / forum / widgets panels).
 * On mobile it also hosts the swipe gesture that slides between chat and
 * the member list.
 */
/**
 * Phone only: render a full-screen `position: fixed` page into <body>
 * instead of in place. ChatArea lives inside MainLayout's (and its own)
 * swipe row, which moves with `transform` - and a transformed ancestor
 * becomes the containing block for `fixed` descendants, so `inset-0` there
 * meant "the whole double-wide row", not the screen: on a real iPhone the
 * thread panel slid in showing only its empty right half (measured in
 * emulation: left -393px, width 786px on a 393px screen). Tablet/desktop
 * render these panels in place as static columns, so no portal there.
 */
function PhonePortal({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return enabled ? createPortal(children, document.body) : <>{children}</>;
}

/** Tablet member-drawer width (see useLayoutMode) - MemberList's own w-60 at >= md. */
const TABLET_MEMBERS_PX = 240;
/** Finger travel (px) past which a tablet drawer drag commits on release. */
const TABLET_SWIPE_THRESHOLD_PX = 60;

export function ChatArea() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client);
  useMatrixStore((s) => s.syncTick);
  const selectedRoomId = useUiStore((s) => s.selectedRoomId);
  const selectRoom = useUiStore((s) => s.selectRoom);
  const friendsViewOpen = useUiStore((s) => s.friendsViewOpen);
  const inboxViewOpen = useUiStore((s) => s.inboxViewOpen);
  const eventsViewOpen = useUiStore((s) => s.eventsViewOpen);
  const memberListOpen = useUiStore((s) => s.memberListOpen);
  const toggleMemberList = useUiStore((s) => s.toggleMemberList);
  const setMemberListOpen = useUiStore((s) => s.setMemberListOpen);
  const activeThreadRootId = useUiStore((s) => s.activeThreadRootId);
  const threadsListOpen = useUiStore((s) => s.threadsListOpen);
  const toggleThreadsList = useUiStore((s) => s.toggleThreadsList);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const toggleSearch = useUiStore((s) => s.toggleSearch);
  const widgetsPanelOpen = useUiStore((s) => s.widgetsPanelOpen);
  const toggleWidgetsPanel = useUiStore((s) => s.toggleWidgetsPanel);
  const openModal = useModalStore((s) => s.open);
  const activeCall = useCallStore((s) => s.call);
  const { open: openMoreMenu, menu: moreMenu } = useContextMenu();

  const room = client && selectedRoomId ? client.getRoom(selectedRoomId) : null;
  const layoutMode = useLayoutMode();
  const isMobile = layoutMode !== "desktop";
  // Tablet: the member list is a partial-width drawer beside a still-visible
  // chat, not a full-screen page - same idea as MainLayout's list drawer.
  const isTablet = layoutMode === "tablet";
  const isPhone = layoutMode === "phone";
  const isTabletRef = useRef(isTablet);
  isTabletRef.current = isTablet;

  // Mobile: chat is the default page for a room, not the member list -
  // memberListOpen defaults to true for desktop's always-visible third
  // column, which would otherwise cover the whole screen the instant a room
  // opens on a phone. Swiping (below) is what reveals it there instead.
  useEffect(() => {
    if (isMobile) setMemberListOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, room?.roomId]);

  // Mobile chat<->members swipe: a real, finger-following drag rather than a
  // release-only toggle. Both panes stay mounted side by side in a
  // double-wide row (see swipeContainerRef below) and the row's transform is
  // driven 1:1 by touch position while dragging, then eased to whichever
  // side it's closer to on release. Attached as native (non-passive)
  // listeners - React's synthetic touch handlers are passive by default, so
  // preventDefault() inside them can't actually stop the browser's own
  // edge-swipe-back gesture from firing alongside ours.
  const swipeContainerRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  // Live drag offset in ROW-percent units (row is 200% wide -> one screen of
  // finger travel == 50%). A ref + direct DOM write, not React state, so
  // fast/repeated swipes can't outrun the render cycle and drift.
  const dragOffsetRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const showSwipeableMembers = isMobile && !activeThreadRootId && !threadsListOpen && !searchOpen;

  // Reads memberListOpen fresh from the store on every call (NOT from a
  // render-scoped ref/value) - same rule as MainLayout's applyTransform: a
  // rapid follow-up gesture or a rest change must never compute against a
  // stale open/closed flag.
  const applyMemberSwipeTransform = () => {
    const row = rowRef.current;
    if (!row) return;
    const open = useUiStore.getState().memberListOpen;
    // Hard clamp to the valid range - the backstop that makes "drifted so far
    // nothing shows" impossible however the drag races the rest state.
    if (isTabletRef.current) {
      const px = Math.max(-TABLET_MEMBERS_PX, Math.min(0, (open ? -TABLET_MEMBERS_PX : 0) + dragOffsetRef.current));
      row.style.transform = `translateX(${px}px)`;
    } else {
      row.style.transform = `translateX(${Math.max(-50, Math.min(0, (open ? -50 : 0) + dragOffsetRef.current))}%)`;
    }
  };

  useEffect(() => {
    if (!showSwipeableMembers) return;
    const el = swipeContainerRef.current;
    if (!el) return;
    let start: { x: number; y: number; locked: "horizontal" | "vertical" | null } | null = null;
    let raf = 0;
    // MainLayout has its own ancestor-level drag listener for the list<->chat
    // swipe, on a node this container is nested inside - so every touch event
    // here also bubbles up to it. Whenever a drag is actually moving this
    // pane, stop it from bubbling so MainLayout doesn't *also* interpret the
    // same gesture as its own list<->chat swipe.
    let owns = false;

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyMemberSwipeTransform();
      });
    };

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = t ? { x: t.clientX, y: t.clientY, locked: null } : null;
      owns = false;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (start.locked === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        start.locked = Math.abs(dx) > Math.abs(dy) * 1.3 ? "horizontal" : "vertical";
      }
      if (start.locked !== "horizontal") return;
      e.preventDefault();
      const width = el.clientWidth;
      if (!width) return;
      // Tablet: pixels 1:1 with the finger; phone: fraction of the 200% row.
      const raw = isTabletRef.current ? dx : (dx / width) * 50;
      const membersOpenNow = useUiStore.getState().memberListOpen;
      const offset = membersOpenNow ? Math.max(0, raw) : Math.min(0, raw);
      dragOffsetRef.current = offset;
      if (offset !== 0) {
        owns = true;
        e.stopPropagation();
      }
      if (!isDragging) setIsDragging(true);
      schedule();
    };
    const onEnd = (e: TouchEvent) => {
      if (owns) e.stopPropagation();
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (start?.locked === "horizontal") {
        const offset = dragOffsetRef.current;
        const membersOpenNow = useUiStore.getState().memberListOpen;
        const threshold = isTabletRef.current ? TABLET_SWIPE_THRESHOLD_PX : 15;
        if (!membersOpenNow && offset < -threshold) setMemberListOpen(true);
        else if (membersOpenNow && offset > threshold) setMemberListOpen(false);
      }
      start = null;
      owns = false;
      dragOffsetRef.current = 0;
      setIsDragging(false);
      requestAnimationFrame(applyMemberSwipeTransform);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    // Safety net, also on window: see the identical comment on MainLayout's
    // own list<->chat swipe - if the browser's own gesture handling ever
    // "steals" a touch mid-drag, our touchend/touchcancel on `el` can end up
    // never firing, leaving the row stuck offset instead of settled.
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
    // `room` isn't used directly, but ChatArea now stays mounted even before
    // a room is selected (MainLayout keeps both panes alive for the list<->
    // chat swipe). showSwipeableMembers can already be true on that first,
    // room-less render, when the ref div below (gated by `if (!room)`) hasn't
    // rendered yet - so re-run once room actually loads and the node exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSwipeableMembers, setMemberListOpen, !!room]);

  // Keep the row's transform in sync whenever the rest position changes from
  // outside a drag (the header toggle button, closing on room switch, ...) OR
  // on first mount. Synchronous (layout effect, no rAF) so React never paints
  // a frame where the row sits at a stale position - the same "single writer"
  // rule MainLayout's list<->chat swipe already follows, and the reason the
  // row's `transform` is NOT in its style prop: a re-render from any store
  // subscription could otherwise clobber a live drag with a stale rest value.
  useLayoutEffect(() => {
    if (showSwipeableMembers && !isDragging) applyMemberSwipeTransform();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberListOpen, showSwipeableMembers, isTablet, isDragging]);

  // Mobile: the thread / threads-list / search panels are full-screen fixed
  // pages sitting on top of the chat. They get the same swipe-back affordance
  // as everywhere else via the shared drag-to-dismiss hook: a rightward drag
  // moves the panel 1:1 with the finger and, past a threshold on release,
  // closes it back to the chat it covers. (Before this existed, a swipe here
  // only drove MainLayout's row underneath - invisible while the fixed panel
  // covers the screen - and its release dumped the user all the way back to
  // the room list, skipping the chat entirely.)
  // `isolate` keeps MainLayout's ancestor-level list<->chat drag from also
  // interpreting the gesture: its row is fully covered by the fixed panel, so
  // moving it does nothing visible while the drag lasts - and on release it
  // would close the whole room on top of the panel close.
  // Only one of the three panels is ever open (uiStore's openers clear the
  // others); the key just keys the gesture per open panel.
  const mobilePanelKey = activeThreadRootId
    ? `thread:${activeThreadRootId}`
    : threadsListOpen
      ? "threads"
      : searchOpen
        ? "search"
        : null;

  const panelDrag = useDragToDismiss<HTMLDivElement>({
    axis: "x",
    enabled: isMobile && !!mobilePanelKey,
    isolate: true,
    onDismiss: () => {
      // Read which panel is open fresh from the store - a rapid gesture must
      // never act on a stale open/close flag.
      const s = useUiStore.getState();
      if (s.activeThreadRootId) s.closeThread();
      else if (s.threadsListOpen) s.closeThreadsList();
      else if (s.searchOpen) s.closeSearch();
    },
  });

  // Shared by the three full-screen panels below: each insets itself from the
  // status bar (position:fixed lays out against the viewport, so the app
  // shell's padding doesn't apply), and the drag-to-close transition is only
  // suspended while a drag is live.
  const mobilePanelSurface = {
    ref: panelDrag.ref,
    style: {
      transition: panelDrag.dragging ? "none" : "transform 240ms cubic-bezier(0.16, 1, 0.3, 1)",
      willChange: panelDrag.dragging ? "transform" : "auto",
    },
  };

  const pinnedCount = room ? getPinnedEventIds(room).length : 0;
  const tombstone = room ? getRoomTombstone(room) : null;
  // Only 1:1 DMs get in-header call buttons - text channels aren't callable (Discord-style).
  const canDirectCall =
    room && client
      ? isDirectRoom(room, client) && room.getJoinedMemberCount() === 2 && !activeCall
      : false;

  const [pendingMode, setPendingMode] = useState<RoomNotificationMode | null>(null);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [muteDurationMenuOpen, setMuteDurationMenuOpen] = useState(false);
  // The mode lives in server-side push rules; derive it from there every
  // render (the sync tick above keeps this fresh) and only overlay an
  // optimistic value while the server write is in flight.
  const derivedMode = client && room ? getRoomNotificationMode(client, room.roomId) : "all";
  const mode = pendingMode ?? derivedMode;
  const mutedUntil = client && room ? getMutedUntil(client, room.roomId) : null;
  // A local (localStorage) preference has no push-rule/sync-tick signal to
  // key a re-render off of - a small tick bumped on every change is enough
  // to force this <select> to reflect what was just picked.
  const [roomSoundTick, setRoomSoundTick] = useState(0);
  void roomSoundTick;
  const roomSound = room ? getRoomNotificationSound(room.roomId) : "default";
  useEffect(() => {
    setPendingMode(null);
    setModeMenuOpen(false);
    setMuteDurationMenuOpen(false);
  }, [client, room]);

  if (!room) {
    const activeHomeView = friendsViewOpen ? (
      <FriendsPanel />
    ) : eventsViewOpen ? (
      <EventsPanel />
    ) : inboxViewOpen ? (
      <InboxPanel />
    ) : null;
    if (!activeHomeView) return <EmptyState />;
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
          <button
            type="button"
            onClick={() => selectRoom(null)}
            title={t("common.back")}
            aria-label={t("common.back")}
            className="rounded p-1 text-muted hover:bg-bg-modifier-hover hover:text-normal"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1">{activeHomeView}</div>
      </div>
    );
  }
  if (isVoiceChannel(room)) return <VoiceChannelLanding room={room} />;

  function applyNotificationMode(next: RoomNotificationMode) {
    setPendingMode(next);
    setModeMenuOpen(false);
    void setRoomNotificationMode(client!, room!.roomId, next)
      .then(() => useMatrixStore.getState().bumpTick())
      .then(() => setPendingMode(null))
      .catch((err) => {
        console.error("failed to change notification mode", err);
        setPendingMode(null);
      });
  }

  function applyTimedMute(durationMs: number) {
    setPendingMode("muted");
    setMuteDurationMenuOpen(false);
    setModeMenuOpen(false);
    void setTimedMute(client!, room!.roomId, durationMs)
      .then(() => useMatrixStore.getState().bumpTick())
      .then(() => setPendingMode(null))
      .catch((err) => {
        console.error("timed mute failed", err);
        setPendingMode(null);
      });
  }

  function applyIndefiniteMute() {
    setPendingMode("muted");
    setMuteDurationMenuOpen(false);
    setModeMenuOpen(false);
    void setRoomNotificationMode(client!, room!.roomId, "muted")
      .then(() => clearTimedMuteEntry(client!, room!.roomId)) // no expiry for an indefinite mute
      .then(() => useMatrixStore.getState().bumpTick())
      .then(() => setPendingMode(null))
      .catch((err) => {
        console.error("mute failed", err);
        setPendingMode(null);
      });
  }

  const smallIcon = (path: string) => (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
      <path d={path} />
    </svg>
  );
  const notificationTitle = `${t("chat.notifications")}: ${
    mode === "muted"
      ? t("chat.notifyMuted")
      : mode === "mentions"
        ? t("chat.notifyMentions")
        : t("chat.notifyAll")
  }`;
  const moreMenuItems: MenuItem[] = [
    ...(canDirectCall
      ? [
          {
            label: t("chat.voiceCall"),
            icon: smallIcon(
              "M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.4 21 3 13.6 3 4.5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2Z",
            ),
            onClick: () => client && placeAndTrackCall(client, room.roomId, false),
          },
          {
            label: t("chat.videoCall"),
            icon: smallIcon("M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z"),
            onClick: () => client && placeAndTrackCall(client, room.roomId, true),
          },
        ]
      : []),
    ...(pinnedCount > 0
      ? [
          {
            label: `${t("chat.pinnedMessages")} (${pinnedCount})`,
            icon: smallIcon("M16 3v6l2 3v2h-6v6l-1 1-1-1v-6H4v-2l2-3V3h1V2h6v1h1Z"),
            onClick: () => openModal({ type: "pinnedMessages", roomId: room.roomId }),
          },
        ]
      : []),
    {
      label: t("chat.threads"),
      icon: smallIcon("M4 4h16v10H7l-3 3V4Zm4 11h12v6l-3-3H8v-3Z"),
      checked: threadsListOpen,
      onClick: toggleThreadsList,
    },
    {
      label: t("chat.widgets"),
      icon: smallIcon("M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"),
      checked: widgetsPanelOpen,
      onClick: toggleWidgetsPanel,
    },
    {
      label: t("chat.roomSettings"),
      icon: smallIcon(
        "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.94 4a7.94 7.94 0 0 0-.14-1.48l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.97 7.97 0 0 0-1.28-.74l-.38-2.65a.5.5 0 0 0-.5-.42h-4a.5.5 0 0 0-.5.42l-.38 2.65c-.46.2-.89.45-1.28.74l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.06.24-.14.72-.14 1.48s.08 1.24.14 1.48l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.14.24.42.32.6.22l2.49-1c.39.29.82.54 1.28.74l.38 2.65c.05.24.26.42.5.42h4c.24 0 .45-.18.5-.42l.38-2.65c.46-.2.89-.45 1.28-.74l2.49 1c.24.1.46 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65c.06-.24.14-.72.14-1.48Z",
      ),
      onClick: () => openModal({ type: "roomSettings", roomId: room.roomId }),
    },
  ];

  const mainColumn = (
      <div className="relative flex h-full min-w-0 flex-1 flex-col">
        <ReactionEffects room={room} />
        <div data-testid="chat-header" className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 shadow-sm">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => selectRoom(null)}
              title={t("common.back")}
              aria-label={t("common.back")}
              className="-ml-1.5 shrink-0 rounded p-1 text-muted hover:bg-bg-modifier-hover hover:text-normal md:hidden"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z" />
              </svg>
            </button>
            {room.hasEncryptionStateEvent() && <LockIcon />}
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold text-header">{room.name}</h2>
              {room.currentState.getStateEvents("m.room.topic", "")?.getContent().topic && (
                <p className="truncate text-xs text-muted">
                  {room.currentState.getStateEvents("m.room.topic", "")?.getContent().topic}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                type="button"
                onClick={() => setModeMenuOpen((open) => !open)}
                title={notificationTitle}
                aria-label={notificationTitle}
                aria-haspopup="menu"
                aria-expanded={modeMenuOpen}
                className={`rounded p-1.5 hover:bg-bg-modifier-hover ${mode === "muted" ? "text-dnd" : mode === "mentions" ? "text-header" : "text-muted hover:text-normal"}`}
              >
                {mode === "muted" ? (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                    <path d="M20 18.69 7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01c-.52.99-.8 2.16-.8 3.42v5l-2 2v1h13.73l2 2L21 19.72l-1-1.03ZM12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2Zm6-7.32V11c0-3.08-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5-.31 0-.59.1-.83.24L18 14.68Z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2Zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2Z" />
                  </svg>
                )}
              </button>
              {modeMenuOpen && (
                <PhonePortal enabled={isPhone}>
                  <div className="fixed inset-0 z-40" onClick={() => setModeMenuOpen(false)} />
                  <div
                    role="menu"
                    aria-label={t("chat.notifications")}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setModeMenuOpen(false);
                      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const buttons = Array.from(
                          e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
                        );
                        const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
                        const next =
                          e.key === "ArrowDown"
                            ? (idx + 1) % buttons.length
                            : (idx - 1 + buttons.length) % buttons.length;
                        buttons[next]?.focus();
                      }
                    }}
                    className="absolute right-0 top-10 z-50 w-64 rounded-lg border border-border bg-bg-floating py-1.5 shadow-xl ring-1 ring-white/5 max-md:fixed max-md:left-4 max-md:right-4 max-md:top-[calc(3.5rem_+_env(safe-area-inset-top))] max-md:w-auto"
                  >
                    <p className="px-3 pb-1 pt-0.5 text-xs font-bold uppercase tracking-wide text-muted">
                      {t("chat.notifications")}
                    </p>
                    {NOTIFICATION_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={mode === option.value}
                        onClick={() =>
                          option.value === "muted"
                            ? setMuteDurationMenuOpen((v) => !v)
                            : applyNotificationMode(option.value)
                        }
                        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-bg-modifier-hover"
                      >
                        <span className="w-4 shrink-0 pt-0.5 text-online">
                          {mode === option.value && (
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                              <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
                            </svg>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-normal">
                            {t(option.labelKey)}
                            {option.value === "muted" && mode === "muted" && mutedUntil && (
                              <span className="ml-1 font-normal text-muted">
                                (
                                {formatClockTime(mutedUntil)}
                                -ig)
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-muted">{t(option.hintKey)}</span>
                        </span>
                        {option.value === "muted" && (
                          <span className="shrink-0 pt-0.5 text-muted">›</span>
                        )}
                      </button>
                    ))}
                    {muteDurationMenuOpen && (
                      <div className="border-t border-border px-1.5 py-1.5">
                        {TIMED_MUTE_PRESETS.map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            role="menuitem"
                            onClick={() => applyTimedMute(preset.ms)}
                            className="block w-full rounded px-2 py-1.5 text-left text-sm text-normal hover:bg-bg-modifier-hover"
                          >
                            {t("chat.muteFor", { duration: preset.label })}
                          </button>
                        ))}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={applyIndefiniteMute}
                          className="block w-full rounded px-2 py-1.5 text-left text-sm text-normal hover:bg-bg-modifier-hover"
                        >
                          {t("chat.muteUntilOff")}
                        </button>
                        {mode === "muted" && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMuteDurationMenuOpen(false);
                              setModeMenuOpen(false);
                              void clearTimedMute(client!, room!.roomId).then(() => useMatrixStore.getState().bumpTick());
                            }}
                            className="mt-1 block w-full rounded border-t border-border px-2 py-1.5 text-left text-sm text-online hover:bg-bg-modifier-hover"
                          >
                            {t("chat.unmuteNow")}
                          </button>
                        )}
                      </div>
                    )}
                    <div className="border-t border-border px-3 py-2">
                      <label className="flex items-center justify-between gap-2 text-sm text-normal">
                        <span>{t("chat.roomSound")}</span>
                        <select
                          value={roomSound}
                          onChange={(e) => {
                            setRoomNotificationSound(room.roomId, e.target.value as NotificationSoundId | "default");
                            setRoomSoundTick((t) => t + 1);
                          }}
                          className="rounded bg-bg-darkest px-2 py-1 text-xs text-normal outline-none"
                        >
                          <option value="default">{t("chat.soundDefault")}</option>
                          {NOTIFICATION_SOUNDS.map((s) => (
                            <option key={s.id} value={s.id}>
                              {t(s.labelKey)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                </PhonePortal>
              )}
            </div>
            <button
              type="button"
              onClick={toggleSearch}
              title={t("chat.searchInRoom")}
              aria-label={t("chat.searchInRoom")}
              aria-pressed={searchOpen}
              className={`rounded p-1.5 ${searchOpen ? "text-header" : "text-muted"} hover:bg-bg-modifier-hover`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={(e) => openMoreMenu(e, moreMenuItems)}
              title={t("chat.more")}
              aria-label={t("chat.more")}
              aria-haspopup="menu"
              className="rounded p-1.5 text-muted hover:bg-bg-modifier-hover hover:text-normal"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
              </svg>
            </button>
            {moreMenu}
            <button
              type="button"
              onClick={toggleMemberList}
              title={t("chat.members")}
              aria-label={t("chat.members")}
              aria-expanded={memberListOpen}
              aria-controls="jk-member-list"
              className={`rounded p-1.5 ${memberListOpen ? "text-header" : "text-muted"} hover:bg-bg-modifier-hover`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z" />
              </svg>
            </button>
          </div>
        </div>

        {tombstone && (
          <div className="flex items-center justify-between gap-3 border-b border-border bg-bg-secondary px-4 py-2 text-sm">
            <span className="text-muted">{tombstone.body || t("roomUpgrade.tombstoneBanner")}</span>
            <button
              type="button"
              onClick={() => selectRoom(tombstone.replacementRoomId)}
              className="shrink-0 rounded bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-hover"
            >
              {t("roomUpgrade.goToNew")}
            </button>
          </div>
        )}

        <WatchTogetherBar room={room} />

        {widgetsPanelOpen ? (
          <WidgetsPanel room={room} />
        ) : isForumChannel(room) ? (
          <ForumPanel room={room} />
        ) : (
          <ChannelContentGate key={room.roomId} room={room}>
            <Timeline room={room} />
            <TypingIndicator room={room} />
            <MessageComposer roomId={room.roomId} roomName={room.name} />
          </ChannelContentGate>
        )}
      </div>
  );

  if (showSwipeableMembers) {
    return (
      <div className="flex h-full min-w-0 flex-1">
        <div ref={swipeContainerRef} onScroll={resetSwipeScroll} className="relative h-full w-full flex-1 jk-swipe-clip">
          <div
            ref={rowRef}
            className="flex h-full shrink-0"
            style={{
              width: isTablet ? `calc(100% + ${TABLET_MEMBERS_PX}px)` : "200%",
              // `transform` is owned entirely by applyMemberSwipeTransform
              // (imperative DOM writes, applied synchronously by the layout
              // effect above) - deliberately NOT in this style prop, so a
              // re-render (of which there are many, from store subscriptions)
              // can never clobber the live drag position or briefly snap the
              // row to a stale rest value. Same rule as MainLayout's row.
              transition: isDragging ? "none" : "transform 240ms cubic-bezier(0.16, 1, 0.3, 1)",
              // Promote to its own compositor layer while moving so each
              // frame's transform is a cheap composite, not a full repaint of
              // both panes - the difference is very visible on mobile.
              willChange: isDragging ? "transform" : "auto",
            }}
          >
            <div
              className={`relative h-full min-w-0 ${isTablet ? "shrink-0" : "w-1/2"}`}
              style={isTablet ? { width: `calc(100% - ${TABLET_MEMBERS_PX}px)` } : undefined}
            >
              {mainColumn}
              {isTablet && memberListOpen && (
                // Tap the still-visible chat to close the member drawer.
                <button
                  type="button"
                  aria-label={t("a11y.closePanel")}
                  className="absolute inset-0 z-20 bg-black/25"
                  onClick={() => setMemberListOpen(false)}
                />
              )}
            </div>
            <div
              className={`h-full min-w-0 bg-bg-dark ${isTablet ? "shrink-0" : "w-1/2"}`}
              style={isTablet ? { width: TABLET_MEMBERS_PX } : undefined}
            >
              <MemberList room={room} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1">
      {mainColumn}
      {activeThreadRootId ? (
        <PhonePortal enabled={isPhone}>
          <div
            {...mobilePanelSurface}
            className="fixed inset-0 z-40 flex bg-bg-primary pt-[env(safe-area-inset-top)] max-md:animate-page-in-right md:static md:z-auto md:flex md:shrink-0 md:animate-slide-in-right [&>*]:max-md:w-full"
          >
            <ThreadPanel room={room} />
          </div>
        </PhonePortal>
      ) : threadsListOpen ? (
        <PhonePortal enabled={isPhone}>
          <div
            {...mobilePanelSurface}
            className="fixed inset-0 z-40 flex bg-bg-primary pt-[env(safe-area-inset-top)] max-md:animate-page-in-right md:static md:z-auto md:flex md:shrink-0 md:animate-slide-in-right [&>*]:max-md:w-full"
          >
            <ThreadsListPanel room={room} />
          </div>
        </PhonePortal>
      ) : searchOpen ? (
        <PhonePortal enabled={isPhone}>
          <div
            {...mobilePanelSurface}
            className="fixed inset-0 z-40 flex bg-bg-primary pt-[env(safe-area-inset-top)] max-md:animate-page-in-right md:static md:z-auto md:flex md:shrink-0 md:animate-slide-in-right [&>*]:max-md:w-full"
          >
            <SearchPanel room={room} />
          </div>
        </PhonePortal>
      ) : (
        <>
          {/* Mobile: the panel is a full-screen page, mounted only while open - nothing to animate a width against. */}
          {memberListOpen && (
            <PhonePortal enabled={isPhone}>
              <div className="fixed inset-0 z-40 flex bg-bg-primary pt-[env(safe-area-inset-top)] max-md:animate-page-in-right md:hidden">
                <MemberList room={room} />
              </div>
            </PhonePortal>
          )}
          {/* Desktop: always mounted and width-animated instead of popping in/out, so toggling it doesn't jump the whole layout. */}
          <div
            id="jk-member-list"
            className={`hidden overflow-hidden transition-[width] duration-200 ease-out md:block ${
              memberListOpen ? "md:w-60" : "md:w-0"
            }`}
          >
            <MemberList room={room} />
          </div>
        </>
      )}
    </div>
  );
}
