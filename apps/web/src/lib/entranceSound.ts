/**
 * Discord's "Entrance Sound" - a soundboard clip that plays for everyone
 * already in a voice channel the moment you join it. The choice is scoped
 * per voice channel (set from that channel's context menu) because the
 * soundboard clips themselves are per-room; stored device-local, same
 * reasoning as soundboardPrefs.ts.
 */
const KEY_PREFIX = "jorkonvo-entrance-sound:";

export function getEntranceSoundId(roomId: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + roomId);
  } catch {
    return null;
  }
}

export function setEntranceSoundId(roomId: string, soundId: string | null): void {
  try {
    if (soundId) localStorage.setItem(KEY_PREFIX + roomId, soundId);
    else localStorage.removeItem(KEY_PREFIX + roomId);
  } catch {
    /* private mode / storage disabled */
  }
}

// "Join without playing your entrance sound" (the context-menu option in
// Discord): a one-shot suppression consumed by the very next join.
let suppressOnce = false;

export function suppressNextEntranceSound(): void {
  suppressOnce = true;
}

export function consumeEntranceSoundSuppression(): boolean {
  const was = suppressOnce;
  suppressOnce = false;
  return was;
}
