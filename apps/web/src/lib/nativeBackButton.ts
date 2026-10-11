import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { CallErrorCode } from "@jorkonvo/matrix-core";
import { useCallStore } from "../state/callStore";
import { useDialogStore } from "../state/dialogStore";
import { useGroupCallStore } from "../state/groupCallStore";
import { useModalStore } from "../state/modalStore";
import { useUiStore } from "../state/uiStore";
import { isMobileNow } from "./useIsMobile";

/**
 * Wires the Android hardware/gesture back button to the app's own
 * navigation instead of the platform default.
 *
 * This app has no router (no history.pushState anywhere), so the WebView's
 * own back-history is always empty - confirmed live on a physical device:
 * with no listener at all, pressing back while inside a room backed
 * straight out to the home screen launcher instead of returning to the
 * room list, because Capacitor's default handler falls back to
 * finishing/backgrounding the activity the moment `webView.canGoBack()` is
 * false (which it always is here).
 *
 * Registering ANY "backButton" listener opts the app out of that default
 * behaviour entirely - from then on, doing nothing on back means back does
 * nothing at all, so the final case below must call `CapApp.exitApp()`
 * itself to keep the expected "back from the top level exits the app"
 * behaviour.
 *
 * Priority mirrors what a user expects back to do: close the topmost
 * dialog/modal; else hang up/leave an in-progress call - confirmed live
 * this is NOT a hypothetical: with nothing here to catch it, back during
 * an active group (LiveKit) call fell through to CapApp.exitApp(), which
 * kills the whole process outright rather than the OS's own default
 * back-with-no-history behaviour (finishing the activity, same net
 * effect here since this is a single-Activity app) - either way the call
 * ends with no hangup signal sent and no chance to warn the user, so it's
 * handled explicitly first; else, on mobile, back out of whichever
 * full-screen room sub-panel is open (thread -> threads list/chat,
 * threads list -> chat, search -> chat, members -> chat, widgets -> chat)
 * one level at a time - these are ChatArea.tsx's own `fixed inset-0`
 * mobile overlays, each with an on-screen back arrow already wired to the
 * matching close action below (closeThread() in particular already knows
 * to land on the threads list rather than the chat, if that's where the
 * thread was opened from - reused here as-is); else return from a room/
 * view to the list (mobile's single-pane layout, MainLayout.tsx); else
 * exit. Modal.tsx and DialogHost.tsx already close on Escape, so the
 * dialog/modal case is handled by reusing that instead of reaching into
 * their component state.
 */
export function initNativeBackButton(): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};

  const listenerPromise = CapApp.addListener("backButton", () => {
    const hasOverlay =
      useModalStore.getState().modal !== null || useDialogStore.getState().queue.length > 0;
    if (hasOverlay) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
      return;
    }

    const activeCall = useCallStore.getState().call;
    if (activeCall) {
      activeCall.hangup(CallErrorCode.UserHangup, false);
      return;
    }
    if (useGroupCallStore.getState().room) {
      void useGroupCallStore.getState().leave();
      return;
    }

    const ui = useUiStore.getState();
    if (isMobileNow()) {
      if (ui.activeThreadRootId !== null) {
        ui.closeThread();
        return;
      }
      if (ui.threadsListOpen) {
        ui.closeThreadsList();
        return;
      }
      if (ui.searchOpen) {
        ui.closeSearch();
        return;
      }
      if (ui.memberListOpen) {
        ui.setMemberListOpen(false);
        return;
      }
      if (ui.widgetsPanelOpen) {
        ui.toggleWidgetsPanel();
        return;
      }
    }

    const showingRoomOrView =
      ui.selectedRoomId !== null || ui.friendsViewOpen || ui.eventsViewOpen || ui.inboxViewOpen;
    if (isMobileNow() && showingRoomOrView) {
      ui.selectRoom(null);
      return;
    }

    void CapApp.exitApp();
  });

  return () => {
    void listenerPromise.then((h) => h.remove());
  };
}
