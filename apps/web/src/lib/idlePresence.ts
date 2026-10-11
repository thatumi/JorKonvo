import { type MatrixClient, SetPresence } from "@jorkonvo/matrix-core";

/**
 * Discord-style auto-away: after a period without any user input the Matrix
 * presence flips from "online" to "unavailable" (the yellow dot), and the
 * next input flips it back. The status message (presenceStatusMsg) is not
 * touched - Synapse keeps it when only the presence field changes.
 *
 * This uses client.setSyncPresence() (which sets the `set_presence` query
 * param the SDK's own /sync long-poll sends), NOT client.setPresence() (the
 * PUT /presence/{userId}/status endpoint). The PUT looked like the obvious
 * choice, but it only sets presence for a moment: every regular /sync poll
 * that follows implicitly reasserts "online" again (the Matrix spec default
 * for an omitted set_presence param), silently undoing it within seconds.
 * setSyncPresence changes what that implicit reassertion itself sends.
 */

const ENABLE_KEY = "jorkonvo-auto-away";
const TIMEOUT_KEY = "jorkonvo-idle-timeout-ms";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function isAutoAwayEnabled(): boolean {
  return localStorage.getItem(ENABLE_KEY) !== "0";
}

export function setAutoAwayEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLE_KEY, enabled ? "1" : "0");
}

function idleTimeoutMs(): number {
  const raw = Number(localStorage.getItem(TIMEOUT_KEY));
  return raw > 1000 ? raw : DEFAULT_TIMEOUT_MS;
}

export function wireIdlePresence(client: MatrixClient): () => void {
  let lastActivity = Date.now();
  let idle = false;
  let inFlight = false;

  async function setPresence(presence: SetPresence.Online | SetPresence.Unavailable) {
    if (inFlight) return;
    inFlight = true;
    try {
      await client.setSyncPresence(presence);
    } catch {
      // Presence is cosmetic - a failed update retries on the next transition.
    } finally {
      inFlight = false;
    }
  }

  function markActive() {
    lastActivity = Date.now();
    if (idle) {
      idle = false;
      void setPresence(SetPresence.Online);
    }
  }

  function poll() {
    if (!isAutoAwayEnabled()) return;
    if (!idle && Date.now() - lastActivity > idleTimeoutMs()) {
      idle = true;
      void setPresence(SetPresence.Unavailable);
    }
  }

  // Backgrounding (phone home button, switching app, minimizing the
  // browser) should flip to "unavailable" immediately, not wait out the
  // idle timer - which may not even fire, since a backgrounded WKWebView
  // (the native iOS/Android app) can suspend JS timers altogether. This is
  // the "not in the app but not logged out either" case (real request
  // 2026-09-16): document.hidden still reliably fires in that shell even
  // when setInterval doesn't. Coming back to the foreground counts as
  // activity like any input event.
  function onVisibilityChange() {
    if (document.hidden) {
      if (!isAutoAwayEnabled() || idle) return;
      idle = true;
      void setPresence(SetPresence.Unavailable);
    } else {
      markActive();
    }
  }

  const activityEvents = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
  for (const type of activityEvents) window.addEventListener(type, markActive, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  const interval = setInterval(poll, 5000);

  return () => {
    for (const type of activityEvents) window.removeEventListener(type, markActive);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    clearInterval(interval);
    if (idle) void setPresence(SetPresence.Online);
  };
}
