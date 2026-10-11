import { isStreamerModeActive } from "./streamerMode";
import { getAudioContext, playTone } from "./webAudioTone";

/**
 * Placeholder cues for call state changes that otherwise have no audio
 * feedback at all - muting/deafening/joining/leaving/errors are easy to
 * miss when the only affected UI is a small icon. Same synthesized-tone
 * technique as the notification sound (see notificationSound.ts); real
 * sound design can replace these later without touching any call site.
 */
export type CallSoundId =
  | "mic-mute"
  | "mic-unmute"
  | "deafen"
  | "undeafen"
  | "call-join"
  | "call-leave"
  | "call-error"
  | "participant-join"
  | "participant-leave";

const ENABLED_KEY = "jorkonvo-call-sounds-enabled";
const VOLUME_KEY = "jorkonvo-call-sounds-volume";
const KIND_KEY_PREFIX = "jorkonvo-call-sound-";
const DEFAULT_VOLUME = 50;

/** The per-sound-type toggles Discord exposes under Voice & Video > Sounds, in display order. */
export const CALL_SOUND_KINDS: { id: CallSoundId; labelKey: string }[] = [
  { id: "mic-mute", labelKey: "callSound.micMute" },
  { id: "mic-unmute", labelKey: "callSound.micUnmute" },
  { id: "deafen", labelKey: "callSound.deafen" },
  { id: "undeafen", labelKey: "callSound.undeafen" },
  { id: "call-join", labelKey: "callSound.callJoin" },
  { id: "call-leave", labelKey: "callSound.callLeave" },
  { id: "call-error", labelKey: "callSound.callError" },
  { id: "participant-join", labelKey: "callSound.participantJoin" },
  { id: "participant-leave", labelKey: "callSound.participantLeave" },
];

export function isCallSoundKindEnabled(id: CallSoundId): boolean {
  try {
    return localStorage.getItem(KIND_KEY_PREFIX + id) !== "0";
  } catch {
    return true;
  }
}

export function setCallSoundKindEnabled(id: CallSoundId, enabled: boolean): void {
  try {
    localStorage.setItem(KIND_KEY_PREFIX + id, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function isCallSoundsEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) !== "0";
}

export function setCallSoundsEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
}

export function getCallSoundsVolume(): number {
  const stored = localStorage.getItem(VOLUME_KEY);
  // `Number(null)` is 0, not NaN - a never-set volume would otherwise pass
  // the range check below as an explicit "0" and silently mute every call
  // sound instead of falling back to the default.
  if (stored === null) return DEFAULT_VOLUME;
  const raw = Number(stored);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : DEFAULT_VOLUME;
}

export function setCallSoundsVolume(volume: number): void {
  localStorage.setItem(VOLUME_KEY, String(Math.round(Math.max(0, Math.min(100, volume)))));
}

function playNotes(volume: number, notes: { freq: number; at: number; dur: number }[]): void {
  const ac = getAudioContext();
  if (!ac) return;
  try {
    const master = ac.createGain();
    master.gain.value = volume / 100;
    master.connect(ac.destination);
    for (const n of notes) playTone(ac, master, n.freq, n.at, n.dur);
  } catch {
    // Autoplay policy, unsupported browser, suspended context, etc. - a
    // missed sound is never worth surfacing as an error.
  }
}

export function playCallSound(id: CallSoundId): void {
  if (!isCallSoundsEnabled()) return;
  if (!isCallSoundKindEnabled(id)) return;
  if (isStreamerModeActive()) return; // Streamer Mode silences call sounds
  emitCallSound(id, getCallSoundsVolume());
}

/** Plays a sound immediately at the configured volume, ignoring the enabled/per-kind toggles - for the settings preview buttons. */
export function previewCallSound(id: CallSoundId): void {
  emitCallSound(id, getCallSoundsVolume());
}

function emitCallSound(id: CallSoundId, volume: number): void {
  switch (id) {
    case "mic-mute":
      playNotes(volume, [{ freq: 440, at: 0, dur: 0.07 }]);
      break;
    case "mic-unmute":
      playNotes(volume, [{ freq: 660, at: 0, dur: 0.07 }]);
      break;
    case "deafen":
      playNotes(volume, [
        { freq: 440, at: 0, dur: 0.06 },
        { freq: 330, at: 0.06, dur: 0.1 },
      ]);
      break;
    case "undeafen":
      playNotes(volume, [
        { freq: 330, at: 0, dur: 0.06 },
        { freq: 440, at: 0.06, dur: 0.1 },
      ]);
      break;
    case "call-join":
      playNotes(volume, [
        { freq: 523.25, at: 0, dur: 0.09 },
        { freq: 783.99, at: 0.08, dur: 0.14 },
      ]);
      break;
    case "call-leave":
      playNotes(volume, [
        { freq: 783.99, at: 0, dur: 0.09 },
        { freq: 392, at: 0.08, dur: 0.16 },
      ]);
      break;
    case "call-error":
      playNotes(volume, [
        { freq: 220, at: 0, dur: 0.12 },
        { freq: 185, at: 0.1, dur: 0.22 },
      ]);
      break;
    case "participant-join":
      playNotes(volume, [{ freq: 659.25, at: 0, dur: 0.07 }]);
      break;
    case "participant-leave":
      playNotes(volume, [{ freq: 494, at: 0, dur: 0.09 }]);
      break;
  }
}
