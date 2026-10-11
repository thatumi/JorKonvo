import { CallErrorCode } from "@jorkonvo/matrix-core";
import { useCallStore } from "../state/callStore";
import { useGroupCallStore } from "../state/groupCallStore";

/**
 * Closing the browser tab mid-call left the other participant(s) seeing you
 * as still present - confirmed live: no hangup/leave signal is sent, so a
 * 1:1 call only clears for them once ICE times out (tens of seconds), and a
 * group (LiveKit) call shows you in the room until the server's own
 * heartbeat gives up on the dead WebSocket. `pagehide` (not `beforeunload`,
 * which blocks the back/forward cache and is unreliable on mobile Safari)
 * fires reliably on both a tab close and a full navigation, so hang up
 * there. Best-effort only - the page is already unloading, so there's no
 * guarantee any network request started here completes; for the group-call
 * case this still helps in practice because `room.disconnect()` closes the
 * LiveKit WebSocket synchronously, which the server notices immediately
 * rather than waiting out its own timeout.
 */
export function initHangupOnUnload(): () => void {
  const onPageHide = () => {
    const activeCall = useCallStore.getState().call;
    if (activeCall) {
      activeCall.hangup(CallErrorCode.UserHangup, false);
    }
    if (useGroupCallStore.getState().room) {
      void useGroupCallStore.getState().leave();
    }
  };
  window.addEventListener("pagehide", onPageHide);
  return () => window.removeEventListener("pagehide", onPageHide);
}
