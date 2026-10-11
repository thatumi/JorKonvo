/**
 * Discord's "Enable Unread Message Badge" - a count on the app's dock /
 * taskbar icon. Only does anything inside the Tauri desktop shell (the core
 * `set_badge_count` window command, allow-listed in the desktop
 * capabilities); a genuine no-op in a plain browser tab.
 *
 * The toggle itself is device-local (localStorage) - it's about this
 * machine's dock, with no cross-device meaning, same as the other
 * appearance/notification-sound preferences.
 */
const ENABLED_KEY = "jorkonvo-unread-badge-enabled";

export function isUnreadBadgeEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setUnreadBadgeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (!enabled) applyBadgeCount(0);
}

type GlobalTauri = {
  window?: { getCurrentWindow?: () => { setBadgeCount?: (count?: number) => Promise<unknown> } };
};

/** Sets (or with 0, clears) the dock badge. Silently ignored outside the desktop shell. */
export function applyBadgeCount(count: number): void {
  if (!isUnreadBadgeEnabled()) count = 0;
  const tauri = (globalThis as unknown as { __TAURI__?: GlobalTauri }).__TAURI__;
  const win = tauri?.window?.getCurrentWindow?.();
  if (!win?.setBadgeCount) return;
  void win.setBadgeCount(count > 0 ? count : undefined).catch(() => undefined);
}
