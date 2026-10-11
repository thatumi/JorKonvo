/**
 * Which camera/microphone/speaker to use, and at what input/output gain -
 * plain localStorage prefs (device IDs, so "system default" - nothing
 * chosen yet, or the previously-chosen device unplugged - naturally falls
 * back to whatever getUserMedia/LiveKit pick on their own by simply not
 * constraining deviceId at all).
 */
const MIC_KEY = "jorkonvo-preferred-mic-id";
const CAMERA_KEY = "jorkonvo-preferred-camera-id";
const SPEAKER_KEY = "jorkonvo-preferred-speaker-id";
const MIC_VOLUME_KEY = "jorkonvo-mic-volume";
const SPEAKER_VOLUME_KEY = "jorkonvo-speaker-volume";
const DEFAULT_VOLUME = 100;
const MAX_VOLUME = 200;

export function getPreferredMicId(): string | undefined {
  return localStorage.getItem(MIC_KEY) || undefined;
}

export function setPreferredMicId(deviceId: string | null): void {
  if (deviceId) localStorage.setItem(MIC_KEY, deviceId);
  else localStorage.removeItem(MIC_KEY);
}

export function getPreferredCameraId(): string | undefined {
  return localStorage.getItem(CAMERA_KEY) || undefined;
}

export function setPreferredCameraId(deviceId: string | null): void {
  if (deviceId) localStorage.setItem(CAMERA_KEY, deviceId);
  else localStorage.removeItem(CAMERA_KEY);
}

export function getPreferredSpeakerId(): string | undefined {
  return localStorage.getItem(SPEAKER_KEY) || undefined;
}

export function setPreferredSpeakerId(deviceId: string | null): void {
  if (deviceId) localStorage.setItem(SPEAKER_KEY, deviceId);
  else localStorage.removeItem(SPEAKER_KEY);
}

function getVolume(key: string): number {
  const stored = localStorage.getItem(key);
  // `Number(null)` is 0, not NaN - a never-set volume would otherwise pass
  // the range check below as an explicit "0" and silently mute instead of
  // falling back to the default (same bug class as callSounds.ts's
  // getCallSoundsVolume - fixed there earlier this session).
  if (stored === null) return DEFAULT_VOLUME;
  const raw = Number(stored);
  return Number.isFinite(raw) && raw >= 0 && raw <= MAX_VOLUME ? raw : DEFAULT_VOLUME;
}

function setVolume(key: string, percent: number): void {
  localStorage.setItem(key, String(Math.round(Math.max(0, Math.min(MAX_VOLUME, percent)))));
}

/** Input gain, 0-200% (100 = unchanged). Applied as a WebAudio GainNode on the mic graph. */
export function getMicVolume(): number {
  return getVolume(MIC_VOLUME_KEY);
}

export function setMicVolume(percent: number): void {
  setVolume(MIC_VOLUME_KEY, percent);
}

/** Output gain, 0-200% (100 = unchanged). Applied via LiveKit's webAudioMix GainNode. */
export function getSpeakerVolume(): number {
  return getVolume(SPEAKER_VOLUME_KEY);
}

export function setSpeakerVolume(percent: number): void {
  setVolume(SPEAKER_VOLUME_KEY, percent);
}
