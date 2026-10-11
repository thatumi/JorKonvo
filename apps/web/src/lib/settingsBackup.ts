import { getClientSettingsSnapshot, saveClientSettingsSnapshot, type MatrixClient } from "@jorkonvo/matrix-core";

/**
 * Client-side preferences (theme, wallpaper, density, notification sound,
 * push-to-talk, etc.) all live in localStorage, keyed under a shared
 * "jorkonvo-" prefix - which is per-BROWSER, not per-account, so a fresh
 * device or browser profile starts from scratch. This is the one place that
 * knows which of those keys are actual settings (as opposed to local
 * history/tracking data like call history or slowmode timestamps, which
 * intentionally don't travel with a settings backup) and packages them into
 * a plain string map that can be written to a JSON file or to the user's own
 * Matrix account data (io.jorkonvo.client_settings) for real cross-device
 * sync.
 */
const SETTINGS_KEYS_BASE = [
  "jorkonvo-density",
  "jorkonvo-compact-mode",
  "jorkonvo-developer-mode",
  "jorkonvo-font-scale",
  "jorkonvo-private-read-receipts",
  "jorkonvo-link-previews",
  "jorkonvo-notif-sound",
  "jorkonvo-notif-volume",
  "jorkonvo-auto-away",
  "jorkonvo-idle-timeout-ms",
  "jorkonvo-chat-wallpaper",
  "jorkonvo-calendar-reminder-lead-ms",
  "jorkonvo-noise-suppression",
  "jorkonvo-soundboard-playback-enabled",
  "jorkonvo-soundboard-volume",
  "jorkonvo-call-sounds-enabled",
  "jorkonvo-call-sounds-volume",
  "jorkonvo-ptt-enabled",
  "jorkonvo-ptt-code",
  "jorkonvo-theme",
  "jorkonvo-accent",
  "jorkonvo-surface",
  "jorkonvo-corners",
  "jorkonvo-tenor-api-key",
];
// Present for explicit file export/import, but NEVER pushed to the Matrix
// account (see customCss.ts): arbitrary CSS auto-propagating to every device -
// with no easy in-app way to undo a rule that breaks the settings UI itself -
// is a footgun, and a small injection surface.
const LOCAL_ONLY_KEYS = ["jorkonvo-custom-css"];
const SETTINGS_KEYS = [...SETTINGS_KEYS_BASE, ...LOCAL_ONLY_KEYS];
const SETTINGS_KEY_PREFIXES = ["jorkonvo-notif-sound-room-"];

// Deliberately NOT part of the snapshot above - "should THIS device
// auto-sync at all" is a per-device choice, syncing it would be circular.
const AUTO_SYNC_KEY = "jorkonvo-settings-autosync";
const LAST_SYNCED_AT_KEY = "jorkonvo-settings-last-synced-at";

export function isSettingsAutoSyncEnabled(): boolean {
  return localStorage.getItem(AUTO_SYNC_KEY) !== "0";
}

export function setSettingsAutoSyncEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_SYNC_KEY, enabled ? "1" : "0");
}

function getLastSyncedAt(): number {
  return Number(localStorage.getItem(LAST_SYNCED_AT_KEY)) || 0;
}

function setLastSyncedAt(updatedAt: number): void {
  localStorage.setItem(LAST_SYNCED_AT_KEY, String(updatedAt));
}

/**
 * @param scope "file" includes everything; "account" drops the keys that must
 *   never leave this device (LOCAL_ONLY_KEYS).
 */
export function collectSettingsSnapshot(scope: "file" | "account" = "file"): Record<string, string> {
  const keys = scope === "account" ? SETTINGS_KEYS_BASE : SETTINGS_KEYS;
  const data: Record<string, string> = {};
  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value !== null) data[key] = value;
  }
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !SETTINGS_KEY_PREFIXES.some((p) => key.startsWith(p))) continue;
    const value = localStorage.getItem(key);
    if (value !== null) data[key] = value;
  }
  return data;
}

/**
 * Writes a snapshot back into localStorage. Returns how many keys were
 * applied. Ignores anything outside the "jorkonvo-" namespace as a safety net
 * against a corrupted or hand-edited file. With scope "account", also skips
 * LOCAL_ONLY_KEYS - so a stale custom-CSS value left in an account snapshot
 * from before it was excluded doesn't get re-applied on every device.
 */
export function applySettingsSnapshot(data: Record<string, string>, scope: "file" | "account" = "file"): number {
  let count = 0;
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string" || !key.startsWith("jorkonvo-")) continue;
    if (scope === "account" && LOCAL_ONLY_KEYS.includes(key)) continue;
    localStorage.setItem(key, value);
    count++;
  }
  return count;
}

export function exportSettingsToFile(): void {
  const payload = { version: 1, exportedAt: Date.now(), settings: collectSettingsSnapshot() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jorkonvo-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importSettingsFromFile(file: File): Promise<number> {
  const text = await file.text();
  const parsed = JSON.parse(text) as { settings?: unknown };
  if (!parsed.settings || typeof parsed.settings !== "object") {
    throw new Error("A fájl nem egy érvényes JorKonvo beállítás-export.");
  }
  return applySettingsSnapshot(parsed.settings as Record<string, string>);
}

export async function saveSettingsToMatrixAccount(client: MatrixClient): Promise<void> {
  const updatedAt = await saveClientSettingsSnapshot(client, collectSettingsSnapshot("account"));
  setLastSyncedAt(updatedAt);
}

/** Returns null if nothing has ever been saved from any device. */
export function restoreSettingsFromMatrixAccount(client: MatrixClient): number | null {
  const snapshot = getClientSettingsSnapshot(client);
  if (!snapshot) return null;
  const count = applySettingsSnapshot(snapshot.settings, "account");
  setLastSyncedAt(snapshot.updatedAt);
  return count;
}

const AUTO_SYNC_PUSH_DEBOUNCE_MS = 3000;
const AUTO_SYNC_POLL_INTERVAL_MS = 4000;

/**
 * Background auto-sync: pulls a newer snapshot from the account once at
 * boot (a page reload here is unremarkable - the app is still starting up),
 * then just watches this device's OWN settings for changes and pushes them,
 * without ever pulling/reloading again mid-session. A live pull-and-reload
 * triggered by some OTHER device's change would be jarring mid-conversation
 * - boot is the only safe moment for that half of the sync.
 *
 * Watches by polling rather than hooking every individual settings mutation
 * site (there are a dozen-plus, scattered across themeStore/displayPrefs/
 * chatWallpaper/notificationSound/etc.) - a cheap snapshot-diff every few
 * seconds is far less invasive than threading a "push" call through all of
 * them, and nothing here is latency-sensitive.
 */
export function wireSettingsAutoSync(client: MatrixClient): () => void {
  if (!isSettingsAutoSyncEnabled()) return () => undefined;

  const remote = getClientSettingsSnapshot(client);
  if (remote && remote.updatedAt > getLastSyncedAt()) {
    applySettingsSnapshot(remote.settings, "account");
    setLastSyncedAt(remote.updatedAt);
    // Every store that reads one of these keys only does so once, at its
    // own module init - a reload is the only way they all pick this up.
    setTimeout(() => window.location.reload(), 300);
    return () => undefined;
  }

  let lastPushedJson = JSON.stringify(collectSettingsSnapshot("account"));
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  const pollTimer = setInterval(() => {
    if (!isSettingsAutoSyncEnabled()) return;
    const current = JSON.stringify(collectSettingsSnapshot("account"));
    if (current === lastPushedJson) return;
    lastPushedJson = current;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      void saveSettingsToMatrixAccount(client).catch(() => undefined);
    }, AUTO_SYNC_PUSH_DEBOUNCE_MS);
  }, AUTO_SYNC_POLL_INTERVAL_MS);

  return () => {
    clearInterval(pollTimer);
    if (pushTimer) clearTimeout(pushTimer);
  };
}
