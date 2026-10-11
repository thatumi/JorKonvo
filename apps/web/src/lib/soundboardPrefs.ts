/**
 * Per-listener soundboard playback preference - whether to hear soundboard
 * triggers in a call at all, and how loud. Deliberately local (localStorage),
 * not account data: same reasoning as the notification sound/volume in
 * notificationSound.ts - "how loud on THIS device" has no cross-device
 * meaning.
 */
const ENABLED_KEY = "jorkonvo-soundboard-playback-enabled";
const VOLUME_KEY = "jorkonvo-soundboard-volume";
const DEFAULT_VOLUME = 80;

export function isSoundboardPlaybackEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) !== "0";
}

export function setSoundboardPlaybackEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
}

export function getSoundboardVolume(): number {
  const stored = localStorage.getItem(VOLUME_KEY);
  // `Number(null)` is 0, not NaN - a never-set volume would otherwise pass
  // the range check below as an explicit "0" and silently mute playback
  // instead of falling back to the default.
  if (stored === null) return DEFAULT_VOLUME;
  const raw = Number(stored);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : DEFAULT_VOLUME;
}

export function setSoundboardVolume(volume: number): void {
  localStorage.setItem(VOLUME_KEY, String(Math.round(Math.max(0, Math.min(100, volume)))));
}
