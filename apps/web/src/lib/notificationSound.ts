/**
 * Discord-style notification sound customization. Rather than bundling
 * actual audio files (extra weight, licensing, asset pipeline for something
 * this small), each "ringtone" is a short Web Audio synth patch - a couple
 * of oscillator tones, generated on the fly. No network fetch, no binary
 * asset, and it's trivial to add another one later.
 */
import { getAudioContext, playTone } from "./webAudioTone";
import { isStreamerModeActive } from "./streamerMode";

export type NotificationSoundId = "classic" | "soft" | "pop" | "none";

export const NOTIFICATION_SOUNDS: { id: NotificationSoundId; labelKey: string }[] = [
  { id: "classic", labelKey: "notifSound.classic" },
  { id: "soft", labelKey: "notifSound.soft" },
  { id: "pop", labelKey: "notifSound.pop" },
  { id: "none", labelKey: "notifSound.none" },
];

const SOUND_KEY = "jorkonvo-notif-sound";
const VOLUME_KEY = "jorkonvo-notif-volume";
const DEFAULT_VOLUME = 60;
const ROOM_SOUND_PREFIX = "jorkonvo-notif-sound-room-";

/**
 * Per-room sound override - deliberately a LOCAL (localStorage) preference,
 * not account data: unlike the mute mechanism (a real server-side push
 * rule, meaningfully shared across every client/pusher on the account),
 * "which synthesized tone plays on THIS device" has no cross-device
 * meaning at all - Element X/Sable/etc. wouldn't understand it, and even
 * another JorKonvo instance on a different device might reasonably want a
 * different sound setup. Same reasoning already applied to auto-away.
 */
export function getRoomNotificationSound(roomId: string): NotificationSoundId | "default" {
  const stored = localStorage.getItem(ROOM_SOUND_PREFIX + roomId);
  return stored && NOTIFICATION_SOUNDS.some((s) => s.id === stored) ? (stored as NotificationSoundId) : "default";
}

export function setRoomNotificationSound(roomId: string, id: NotificationSoundId | "default"): void {
  if (id === "default") localStorage.removeItem(ROOM_SOUND_PREFIX + roomId);
  else localStorage.setItem(ROOM_SOUND_PREFIX + roomId, id);
}

export function getNotificationSound(): NotificationSoundId {
  const stored = localStorage.getItem(SOUND_KEY);
  return NOTIFICATION_SOUNDS.some((s) => s.id === stored) ? (stored as NotificationSoundId) : "classic";
}

export function setNotificationSound(id: NotificationSoundId): void {
  localStorage.setItem(SOUND_KEY, id);
}

export function getNotificationVolume(): number {
  const stored = localStorage.getItem(VOLUME_KEY);
  // `Number(null)` is 0, not NaN - a never-set volume would otherwise pass
  // the range check below as an explicit "0" and silently mute the sound
  // instead of falling back to the default.
  if (stored === null) return DEFAULT_VOLUME;
  const raw = Number(stored);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : DEFAULT_VOLUME;
}

export function setNotificationVolume(volume: number): void {
  localStorage.setItem(VOLUME_KEY, String(Math.round(Math.max(0, Math.min(100, volume)))));
}

function playPattern(soundId: NotificationSoundId, volume: number): void {
  if (soundId === "none" || volume <= 0) return;
  const ac = getAudioContext();
  if (!ac) return;
  try {
    const master = ac.createGain();
    master.gain.value = volume / 100;
    master.connect(ac.destination);
    switch (soundId) {
      case "classic":
        playTone(ac, master, 880, 0, 0.12);
        playTone(ac, master, 1318.5, 0.09, 0.18);
        break;
      case "soft":
        playTone(ac, master, 660, 0, 0.22);
        break;
      case "pop":
        playTone(ac, master, 523.25, 0, 0.05);
        playTone(ac, master, 261.63, 0.04, 0.1);
        break;
    }
  } catch {
    // Autoplay policy, unsupported browser, suspended context, etc. - a
    // missed sound is never worth surfacing as an error.
  }
}

/** Plays the user's currently configured notification sound at their configured volume. */
export function playNotificationSound(): void {
  if (isStreamerModeActive()) return; // Streamer Mode silences notification sounds
  playPattern(getNotificationSound(), getNotificationVolume());
}

/** Plays this room's sound if it has an override, else falls back to the account-wide default. */
export function playNotificationSoundForRoom(roomId: string): void {
  if (isStreamerModeActive()) return; // Streamer Mode silences notification sounds
  const override = getRoomNotificationSound(roomId);
  playPattern(override === "default" ? getNotificationSound() : override, getNotificationVolume());
}

/** Plays a given sound immediately, ignoring persisted settings - for a "preview" button. */
export function previewNotificationSound(id: NotificationSoundId, volume: number): void {
  playPattern(id, volume);
}
