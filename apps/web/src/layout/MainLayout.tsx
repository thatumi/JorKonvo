import { CallManager } from "../components/CallManager";
import { CallOverlay } from "../components/CallOverlay";
import { ChatArea } from "../components/ChatArea";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { EventReminders } from "../components/EventReminders";
import { FirstRunWelcome } from "../components/FirstRunWelcome";
import { GroupCallOverlay } from "../components/GroupCallOverlay";
import { ImageLightbox } from "../components/ImageLightbox";
import { KeyboardShortcutsLayer } from "../components/KeyboardShortcuts";
import { LiveLocationSharer } from "../components/LiveLocationSharer";
import { ModalHost } from "../components/ModalHost";
import { NotificationManager } from "../components/NotificationManager";
import { OnboardingGate } from "../components/OnboardingGate";
import { QuickSwitcher } from "../components/QuickSwitcher";
import { RoomSidebar } from "../components/RoomSidebar";
import { SpaceRail } from "../components/SpaceRail";
import { VerificationManager } from "../components/VerificationManager";
import { VerificationOverlay } from "../components/VerificationOverlay";
import { VerificationToast } from "../components/VerificationToast";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { useLayoutMode } from "../lib/useIsMobile";
import { selectIsGuest, useAuthStore } from "../state/authStore";
import { getLastRoomForScope, useUiStore } from "../state/uiStore";
import { resetSwipeScroll } from "../lib/swipeScroll";

function GuestBanner() {
  const { t } = useTranslation();
  const logout = useAuthStore((s) => s.logout);
  return (
    <div className="flex shrink-0 items-center justify-center gap-3 bg-brand px-4 py-1.5 text-xs font-medium text-white">
      <span>{t("guest.banner")}</span>
      <button
        type="button"
        onClick={() => void logout()}
        className="rounded bg-white/20 px-2 py-0.5 font-semibold hover:bg-white/30"
      >
        {t("guest.signUp")}
      </button>
    </div>
  );
}

/**
 * App shell: skip link, guest/connection banners, the mobile list<->chat
 * swipe container or the desktop three-pane layout (SpaceRail, RoomSidebar,
 * main content), and every global overlay (modals, calls, toasts, shortcuts).
 */
/** Tablet drawer width: SpaceRail (72px) + 10px gap + RoomSidebar (w-60, 240px at >= md) + an 8px gutter before the chat. */
const TABLET_DRAWER_PX = 330;
/** Finger travel (px) past which a tablet drawer drag commits on release. */
const TABLET_SWIPE_THRESHOLD_PX = 60;

export function MainLayout() {
  const { t } = useTranslation();
  const switching = useAuthStore((s) => s.switching);
  const isGuest = useAuthStore(selectIsGuest);
  const selectedSpaceId = useUiStore((s) => s.selectedSpaceId);
  const selectedRoomId = useUiStore((s) => s.selectedRoomId);
  const selectRoom = useUiStore((s) => s.selectRoom);
  const friendsViewOpen = useUiStore((s) => s.friendsViewOpen);
  const eventsViewOpen = useUiStore((s) => s.eventsViewOpen);
  const inboxViewOpen = useUiStore((s) => s.inboxViewOpen);
  const layoutMode = useLayoutMode();
  const isMobile = layoutMode !== "desktop";
  // Tablet (touch UI on an iPad-sized screen): the rail+list is a
  // partial-width drawer beside a still-visible chat instead of a full
  // screen of its own. Open/closed is its own state here, independent of
  // the room selection - closing the drawer must not deselect the room the
  // chat behind it is showing. See useLayoutMode.
  const isTablet = layoutMode === "tablet";
  const isTabletRef = useRef(isTablet);
  isTabletRef.current = isTablet;
  // Below the md breakpoint there's only room for one pane at a time - the
  // server rail + channel list, or the active chat/panel.
  const hasActiveView = !!selectedRoomId || friendsViewOpen || eventsViewOpen || inboxViewOpen;

  // Mobile list<->chat swipe: mirrors ChatArea's own chat<->members drag -
  // both panes stay mounted side by side in a double-wide row and the
  // row's transform is driven 1:1 by touch position while dragging, eased
  // to whichever side it's closer to on release. Native (non-passive)
  // listeners, since React's synthetic touch handlers are passive by
  // default and can't preventDefault() the browser's own edge-swipe-back.
  // The two swipe systems don't fight over the same gesture despite
  // ChatArea's own drag container being a descendant here: each only
  // reacts to the ONE direction relevant to its current state (clamping
  // the other direction to a no-op), so whichever one actually owns the
  // gesture the user is making is the only one that visibly moves.
  const swipeContainerRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  // The live drag offset in ROW-percent units (the row is 200% wide, so one
  // screen-width of finger travel == 50%). A ref, not state, because touch
  // tracking must not wait on React's render cycle - the transform is written
  // straight to the DOM node in onMove. `isDragging` state only exists to
  // toggle the CSS transition on/off.
  const dragOffsetRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  // Whichever pane the current view state says should be at rest: 0 = the
  // rail+list, -50 = the chat/panel. Read fresh from the store inside the
  // handlers too (below) so a rapid follow-up gesture never computes against
  // a stale value mid-commit.
  const restPercent = hasActiveView ? -50 : 0;

  const [drawerOpen, setDrawerOpen] = useState(!hasActiveView);
  const drawerOpenRef = useRef(drawerOpen);
  drawerOpenRef.current = drawerOpen;
  // Nothing to show behind a closed drawer -> it's open. Switching to
  // another space opens it (that space's channel list is what you want next,
  // while the chat behind already shows its entry room); any explicit room
  // pick - even re-tapping the room already selected - or opening a Home view
  // closes it.
  const roomPickSeq = useUiStore((s) => s.roomPickSeq);
  useEffect(() => {
    if (isTablet) setDrawerOpen(true);
  }, [isTablet, selectedSpaceId]);
  useEffect(() => {
    if (isTablet && roomPickSeq > 0 && useUiStore.getState().selectedRoomId) setDrawerOpen(false);
  }, [isTablet, roomPickSeq]);
  useEffect(() => {
    if (isTablet && (friendsViewOpen || eventsViewOpen || inboxViewOpen)) setDrawerOpen(false);
  }, [isTablet, friendsViewOpen, eventsViewOpen, inboxViewOpen]);
  useEffect(() => {
    if (isTablet && !hasActiveView) setDrawerOpen(true);
  }, [isTablet, hasActiveView]);

  const applyTransform = () => {
    const row = rowRef.current;
    if (!row) return;
    const s = useUiStore.getState();
    const active = !!s.selectedRoomId || s.friendsViewOpen || s.eventsViewOpen || s.inboxViewOpen;
    // Clamp to the valid travel range NO MATTER WHAT - this backstop makes
    // "swiped so far nothing shows" structurally impossible however the
    // drag / rest state races.
    if (isTabletRef.current) {
      // Pixels: the drawer is a fixed width, not half of a double-wide row.
      const open = drawerOpenRef.current || !active;
      const px = Math.max(-TABLET_DRAWER_PX, Math.min(0, (open ? 0 : -TABLET_DRAWER_PX) + dragOffsetRef.current));
      row.style.transform = `translateX(${px}px)`;
    } else {
      const offset = Math.max(-50, Math.min(0, (active ? -50 : 0) + dragOffsetRef.current));
      row.style.transform = `translateX(${offset}%)`;
    }
    // Same "never out of range" backstop for the container's own scroll
    // offset - see .jk-swipe-clip in index.css.
    const container = swipeContainerRef.current;
    if (container && (container.scrollLeft !== 0 || container.scrollTop !== 0)) {
      container.scrollLeft = 0;
      container.scrollTop = 0;
    }
  };

  useEffect(() => {
    if (!isMobile) return;
    const el = swipeContainerRef.current;
    if (!el) return;
    let start: { x: number; y: number; locked: "horizontal" | "vertical" | null } | null = null;
    let raf = 0;

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyTransform();
      });
    };
    const activeViewNow = () => {
      const s = useUiStore.getState();
      return !!s.selectedRoomId || s.friendsViewOpen || s.eventsViewOpen || s.inboxViewOpen;
    };

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = t ? { x: t.clientX, y: t.clientY, locked: null } : null;
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
      if (isTabletRef.current) {
        // Pixels 1:1 with the finger; closed drawer only opens (drag right),
        // open drawer only closes (drag left).
        const open = drawerOpenRef.current || !activeViewNow();
        dragOffsetRef.current = open ? Math.min(0, dx) : Math.max(0, dx);
      } else {
        const width = el.clientWidth;
        if (!width) return; // never divide by a zero / unlaid-out width
        // Finger travel as a fraction of the 200%-wide row, then clamped to
        // just the direction that makes sense for the current rest position.
        const raw = (dx / width) * 50;
        dragOffsetRef.current = activeViewNow() ? Math.max(0, raw) : Math.min(0, raw);
      }
      if (!isDragging) setIsDragging(true);
      schedule();
    };
    const onEnd = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (start?.locked === "horizontal" && isTabletRef.current) {
        const offset = dragOffsetRef.current;
        const open = drawerOpenRef.current || !activeViewNow();
        if (!open && offset > TABLET_SWIPE_THRESHOLD_PX) {
          setDrawerOpen(true);
        } else if (open && offset < -TABLET_SWIPE_THRESHOLD_PX) {
          if (activeViewNow()) {
            setDrawerOpen(false);
          } else {
            const lastRoomId = getLastRoomForScope(useUiStore.getState().selectedSpaceId);
            if (lastRoomId) selectRoom(lastRoomId);
          }
        }
      } else if (start?.locked === "horizontal") {
        const offset = dragOffsetRef.current;
        if (!activeViewNow() && offset < -15) {
          const lastRoomId = getLastRoomForScope(useUiStore.getState().selectedSpaceId);
          if (lastRoomId) selectRoom(lastRoomId);
        } else if (activeViewNow() && offset > 15) {
          selectRoom(null);
        }
      }
      start = null;
      dragOffsetRef.current = 0;
      setIsDragging(false);
      // Snap to the (possibly newly changed) rest position with the transition on.
      requestAnimationFrame(applyTransform);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    // Safety net on window too: if the browser's own gesture handling ever
    // "steals" a touch mid-drag, our touchend on `el` can never fire, leaving
    // the row stuck mid-swipe. A touchend fires SOMEWHERE the moment the
    // finger lifts, so catching it on window guarantees the drag is cleared.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, selectRoom]);

  // Keep the DOM transform in sync whenever the rest position changes from
  // outside a drag (tapping a room, back button, account switch, ...) OR on
  // first mount. Synchronous (layout effect, no rAF) so React never paints a
  // frame where the row sits at a stale position - that flash, compounded
  // over rapid back-and-forth swipes, is what made the layout "lose the
  // thread". The inline `transform` was removed from the row's style prop for
  // the same reason: applyTransform() is now the single writer.
  useLayoutEffect(() => {
    if (isMobile && !isDragging) applyTransform();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restPercent, isMobile, isTablet, drawerOpen, isDragging]);

  // Sliding to the other pane leaves a focused text field (typically the DM
  // composer) off screen with the keyboard still up; its later unmount then
  // yanks the keyboard away mid-slide, which on iOS WKWebView can leave the
  // page scrolled with no way back (html/body are overflow: hidden). Close the
  // keyboard cleanly *before* the slide instead.
  useLayoutEffect(() => {
    if (!isMobile) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && el.matches('input, textarea, [contenteditable="true"]')) el.blur();
  }, [restPercent, isMobile, drawerOpen]);

  return (
    // Floating-panel shell: each pane is its own rounded card on a dark gutter,
    // rather than Discord's edge-to-edge columns. Familiar layout, own skin.
    <div
      className="flex h-full w-full flex-col bg-bg-floating pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      data-testid="app-shell"
    >
      {/* The shell carries the safe-area insets for everything in normal flow
          (#root deliberately has none - see index.css). Top so the rails,
          room list and chat header stay clear of the Dynamic Island / notch;
          left/right so nothing hides under the notch in landscape. Bottom
          deliberately NOT inset here - scrolling content may run to the
          bottom edge; only genuinely bottom-fixed bars inset themselves. */}
      <a
        href="#jk-main-content"
        onClick={(e) => {
          e.preventDefault();
          const main = document.getElementById("jk-main-content");
          main?.focus();
          main?.scrollIntoView();
        }}
        className="sr-only left-2 top-2 z-[100] rounded bg-brand px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute"
      >
        {t("a11y.skipToContent")}
      </a>
      {isGuest && <GuestBanner />}
      <ConnectionBanner />
      {isMobile ? (
        <div ref={swipeContainerRef} onScroll={resetSwipeScroll} className="relative flex min-h-0 flex-1 jk-swipe-clip">
          <div
            className="flex h-full shrink-0"
            style={{
              width: isTablet ? `calc(100% + ${TABLET_DRAWER_PX}px)` : "200%",
              // `transform` is owned entirely by applyTransform() (imperative
              // DOM writes, set synchronously by the layout effect below) -
              // it's deliberately NOT in this style prop, so a re-render (of
              // which there are many, from store subscriptions) can never
              // clobber the live drag position or briefly snap the row to a
              // stale rest value.
              transition: isDragging ? "none" : "transform 240ms cubic-bezier(0.16, 1, 0.3, 1)",
              // Promote to its own compositor layer while moving so each
              // frame's transform is a cheap composite, not a full repaint of
              // both panes - the difference is very visible on mobile.
              willChange: isDragging ? "transform" : "auto",
            }}
            ref={rowRef}
          >
            <div
              className={`flex h-full min-w-0 gap-2.5 ${isTablet ? "shrink-0" : "w-1/2"}`}
              style={isTablet ? { width: TABLET_DRAWER_PX } : undefined}
            >
              <SpaceRail />
              <RoomSidebar />
            </div>
            <div
              id="jk-main-content"
              role="main"
              aria-label={t("a11y.mainContent")}
              tabIndex={-1}
              className={`relative h-full min-w-0 bg-bg-primary outline-none ${isTablet ? "shrink-0" : "w-1/2"}`}
              style={isTablet ? { width: `calc(100% - ${TABLET_DRAWER_PX}px)` } : undefined}
            >
              <ChatArea />
              {isTablet && drawerOpen && hasActiveView && (
                // The chat stays visible beside the open drawer; a tap on it
                // closes the drawer (and is swallowed, not delivered to the
                // chat underneath) - the usual tablet-drawer behaviour.
                <button
                  type="button"
                  aria-label={t("a11y.closePanel")}
                  className="absolute inset-0 z-20 bg-black/25 transition-opacity"
                  onClick={() => setDrawerOpen(false)}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-2.5 p-2.5">
          <SpaceRail />
          <RoomSidebar />
          <div
            id="jk-main-content"
            role="main"
            aria-label={t("a11y.mainContent")}
            tabIndex={-1}
            className="jk-chat-wallpaper relative flex min-w-0 flex-1 overflow-hidden rounded-[20px] bg-bg-primary shadow-lg outline-none"
          >
            <ChatArea />
          </div>
        </div>
      )}
      <ModalHost />
      <NotificationManager />
      <EventReminders />
      <LiveLocationSharer />
      <CallManager />
      <CallOverlay />
      <GroupCallOverlay />
      <VerificationManager />
      <VerificationOverlay />
      <VerificationToast />
      <QuickSwitcher />
      <ImageLightbox />
      <KeyboardShortcutsLayer />
      {selectedSpaceId && <OnboardingGate key={selectedSpaceId} />}
      <FirstRunWelcome />
      {switching && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 text-white">
          Fiókváltás…
        </div>
      )}
    </div>
  );
}
