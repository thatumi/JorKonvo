import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { parseInviteLink } from "@jorkonvo/matrix-core";
import { usePendingInviteStore } from "../state/pendingInviteStore";

/** Reconstructs the plain idOrAlias(+via) string JoinRoomModal/joinRoomByIdOrAlias expect, from an already-parsed invite link. */
function targetStringFrom(parsed: { target: string; viaServers: string[] }): string {
  const query = parsed.viaServers.map((v) => `via=${encodeURIComponent(v)}`).join("&");
  return `${parsed.target}${query ? `?${query}` : ""}`;
}

function handleUrl(url: string) {
  const parsed = parseInviteLink(url);
  if (!parsed) return;
  usePendingInviteStore.getState().setTarget(targetStringFrom(parsed));
}

/**
 * Wires up JorKonvo's own invite-link domain (jorkonvo.szabotar.dev/join,
 * see matrix-core's inviteLinks.ts) so opening one - on the web, or via a
 * native Android App Link / iOS Universal Link - jumps straight into the
 * join flow instead of requiring a manual copy-paste into "Join a room".
 * The actual "open the modal" step happens in App.tsx once auth is ready
 * (see pendingInviteStore) - this module only ever captures the target.
 */
export function initInviteLinkHandler(): () => void {
  // A cold web load of /join (the hosting setup's SPA fallback serves
  // index.html for it same as any other path) carries the target in the
  // hash, e.g. https://jorkonvo.szabotar.dev/join#/!room:server?via=x.
  if (window.location.pathname.replace(/\/$/, "") === "/join") {
    handleUrl(window.location.href);
    // Clean the URL so a refresh doesn't re-trigger the same join attempt
    // and the address bar doesn't keep an internal-looking path around.
    window.history.replaceState(null, "", "/");
  }

  if (!Capacitor.isNativePlatform()) return () => {};

  // Fires for both a cold start via the link and the app being resumed by
  // one while already running - Capacitor's App plugin normalizes both to
  // this one event, for both the Android App Link and iOS Universal Link
  // (and any registered custom-scheme fallback) cases.
  const listenerPromise = CapApp.addListener("appUrlOpen", ({ url }) => handleUrl(url));

  return () => {
    void listenerPromise.then((h) => h.remove());
  };
}
