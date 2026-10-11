/**
 * Tiny synthesized-tone helper shared by every "no real audio asset" sound
 * cue in the app (notification sounds, call sounds) - a couple of oscillator
 * tones generated on the fly rather than bundling actual audio files.
 */
let audioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx ??= new Ctor();
  // A call/notification sound is often triggered from deep inside an async
  // chain (e.g. after `await room.connect(...)`), well past the point the
  // browser still credits the action as user-gesture-adjacent - Chromium can
  // (re-)suspend the context by then, and a suspended context schedules
  // tones without ever making sound. Cheap no-op when already running.
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

/** One short tone: a quick attack, exponential decay to near-silence (avoids an audible click at the end). */
export function playTone(ac: AudioContext, destination: GainNode, freq: number, startOffset: number, duration: number): void {
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const gain = ac.createGain();
  const start = ac.currentTime + startOffset;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(1, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}
