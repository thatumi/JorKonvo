/**
 * Discord's "Share my activity" (Activity Privacy) - the master switch for
 * whether the desktop Rich Presence bridge publishes what you're playing to
 * your profile at all. Device-local: it's about what this machine reports.
 * Discord also has per-server toggles, but our activity lives on a single
 * globally-readable profile field, so there's nothing per-server to gate.
 */
const KEY = "jorkonvo-share-activity";

export function isActivitySharingEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setActivitySharingEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
