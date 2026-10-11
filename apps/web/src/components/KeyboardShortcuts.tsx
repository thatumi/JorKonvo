import {
  getDirectRooms,
  getRoomsInSpace,
  getUngroupedRooms,
  markRoomRead,
  type MatrixClient,
  type Room,
} from "@jorkonvo/matrix-core";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "../i18n";
import { isPrivateReadReceiptsEnabled } from "../lib/readReceiptPrivacy";
import { isNativePlatform } from "../lib/platform";
import { useGroupCallStore } from "../state/groupCallStore";
import { describeCombo, type KeybindActionId, eventMatchesCombo, useKeybindsStore } from "../state/keybindsStore";
import { useLightboxStore } from "../state/lightboxStore";
import { useMatrixStore } from "../state/matrixStore";
import { useModalStore } from "../state/modalStore";
import { useUiStore } from "../state/uiStore";

/**
 * Global keyboard shortcuts (Discord-flavoured). Every action here is
 * rebindable - the actual key combos live in keybindsStore.ts (and its
 * Keybinds settings pane); this component only routes matched events to the
 * behaviour. The one non-rebindable bit is the contextual Escape handling
 * (close the topmost open layer), which is fundamental UI behaviour rather
 * than a "shortcut". Alt+1..9 space-jump also stays fixed (nine of them
 * would swamp the rebind list). Push-to-talk is its own separate store.
 */

/** Flat, sidebar-ish room order for the current scope (prev/next channel navigation). */
function navRoomList(client: MatrixClient, spaceId: string | null): Room[] {
  if (spaceId) return getRoomsInSpace(client, spaceId);
  return [...getDirectRooms(client), ...getUngroupedRooms(client)];
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

function navChannel(direction: 1 | -1): void {
  const store = useUiStore.getState();
  const client = useMatrixStore.getState().client;
  if (!client || !store.selectedRoomId) return;
  const list = navRoomList(client, store.selectedSpaceId);
  const idx = list.findIndex((r) => r.roomId === store.selectedRoomId);
  if (idx === -1) return;
  const target = list[Math.max(0, Math.min(list.length - 1, idx + direction))];
  if (target) store.selectRoom(target.roomId);
}

function markCurrentRoomRead(): void {
  const store = useUiStore.getState();
  const client = useMatrixStore.getState().client;
  if (client && store.selectedRoomId) {
    void markRoomRead(client, store.selectedRoomId, isPrivateReadReceiptsEnabled());
  }
}

/** Runs an action; returns whether it was handled (so the caller can preventDefault). */
function runAction(id: KeybindActionId, toggleHelp: () => void): boolean {
  switch (id) {
    case "toggleMute":
      useGroupCallStore.getState().toggleMicMute();
      return true;
    case "toggleDeafen":
      useGroupCallStore.getState().toggleDeafen();
      return true;
    case "toggleMemberList":
      useUiStore.getState().toggleMemberList();
      return true;
    case "navChannelPrev":
      navChannel(-1);
      return true;
    case "navChannelNext":
      navChannel(1);
      return true;
    case "toggleSearch":
      useUiStore.getState().toggleSearch();
      return true;
    case "markRead":
      markCurrentRoomRead();
      return true;
    case "toggleHelp":
      toggleHelp();
      return true;
  }
}

const HELP_ACTION_LABELS: Record<KeybindActionId, string> = {
  toggleMute: "keybind.toggleMute",
  toggleDeafen: "keybind.toggleDeafen",
  toggleMemberList: "keybind.toggleMemberList",
  navChannelPrev: "keybind.navChannelPrev",
  navChannelNext: "keybind.navChannelNext",
  toggleSearch: "keybind.toggleSearch",
  markRead: "keybind.markRead",
  toggleHelp: "keybind.toggleHelp",
};

/** The shortcuts cheat-sheet overlay: a plain dialog closed by Esc or a backdrop click. */
function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const bindings = useKeybindsStore((s) => s.bindings);

  // Escape-to-close: the panel is otherwise only closable via the rebindable
  // help shortcut or a backdrop click, which a keyboard user may not find.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="animate-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 pt-[max(1rem,env(safe-area-inset-top))]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl bg-bg-primary p-5 shadow-xl ring-1 ring-white/5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="mb-3 text-base font-semibold text-header">{t("shortcut.helpTitle")}</h2>
        <div className="flex flex-col divide-y divide-border">
          {(Object.keys(HELP_ACTION_LABELS) as KeybindActionId[]).map((id) => (
            <div key={id} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span className="text-muted">{t(HELP_ACTION_LABELS[id])}</span>
              <kbd className="rounded border border-border bg-bg-darkest px-2 py-0.5 font-mono text-xs text-normal">
                {describeCombo(bindings[id])}
              </kbd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 py-2 text-sm">
            <span className="text-muted">{t("keybind.quickSwitcher")}</span>
            <kbd className="rounded border border-border bg-bg-darkest px-2 py-0.5 font-mono text-xs text-normal">Ctrl/⌘ K</kbd>
          </div>
          <div className="flex items-center justify-between gap-4 py-2 text-sm">
            <span className="text-muted">{t("keybind.jumpSpace")}</span>
            <kbd className="rounded border border-border bg-bg-darkest px-2 py-0.5 font-mono text-xs text-normal">Alt 1…9</kbd>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">{t("shortcut.hint")}</p>
      </div>
    </div>
  );
}

/**
 * Global key-routing layer mounted once near the app root: listens for the
 * (rebindable) shortcut combos and dispatches them, and renders the
 * ShortcutsHelp overlay while the help action is active. Renders nothing
 * otherwise. On the Capacitor native shells it renders nothing AND mounts
 * no listener at all - phones have no hardware keyboard, so shortcuts (and
 * the help overlay, whose only trigger was one) are desktop-only.
 */
export function KeyboardShortcutsLayer() {
  const [helpOpen, setHelpOpen] = useState(false);
  // Read once per mount: the platform can't change while the app is running.
  const native = isNativePlatform();

  useEffect(() => {
    if (native) return;
    function onKeyDown(e: KeyboardEvent) {
      // Any open modal / lightbox / context menu owns the keyboard first.
      if (useModalStore.getState().modal) return;
      if (useLightboxStore.getState().item) return;
      if (document.querySelector("[data-context-menu]")) return;
      const store = useUiStore.getState();
      const typing = isTypingTarget(e.target);

      // Contextual Escape - close the topmost layer. Not a rebindable action;
      // this is baseline UI behaviour and always Escape.
      if (e.key === "Escape" && !typing) {
        if (store.activeThreadRootId) return void store.closeThread();
        if (store.searchOpen) return void store.closeSearch();
        if (store.threadsListOpen) return void store.closeThreadsList();
        if (store.widgetsPanelOpen) return void store.toggleWidgetsPanel();
        // fall through - an unmodified Escape with nothing open may also be
        // the (rebindable) "mark read" action below.
      }

      const bindings = useKeybindsStore.getState().bindings;
      for (const id of Object.keys(bindings) as KeybindActionId[]) {
        if (!eventMatchesCombo(e, bindings[id])) continue;
        // Most actions shouldn't fire while typing. Exceptions: the call
        // toggles (you're not typing into the call), the member list, and
        // in-room search - find-in-page is useless in a chat app so
        // Ctrl+F is always ours, matching the previous hard-coded behaviour.
        const allowedWhileTyping =
          id === "toggleMute" || id === "toggleDeafen" || id === "toggleMemberList" || id === "toggleSearch";
        if (typing && !allowedWhileTyping) return;
        e.preventDefault();
        runAction(id, () => setHelpOpen((v) => !v));
        return;
      }

      // Alt+1..9 - jump to the Nth joined space (fixed, not rebindable).
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)) {
        e.preventDefault();
        const client = useMatrixStore.getState().client;
        if (!client) return;
        const spaces = client.getRooms().filter((r) => r.isSpaceRoom() && r.getMyMembership() === "join");
        const target = spaces[Number(e.code.slice(5)) - 1];
        if (target) store.selectSpace(target.roomId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [native]);

  // Early return AFTER the hooks (they must run unconditionally): on native
  // the listener effect above is a no-op and there is no UI to render.
  if (native) return null;
  return helpOpen ? <ShortcutsHelp onClose={() => setHelpOpen(false)} /> : null;
}
