import rnnoiseWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWorkletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";

/**
 * RNNoise-based microphone denoising (xiph/rnnoise via
 * @sapphi-red/web-noise-suppressor's WASM + AudioWorklet build) - a real
 * neural denoiser, well beyond the browser's built-in noiseSuppression
 * constraint (which still helps and is applied too, as a first pass before
 * the neural stage).
 *
 * The WASM binary is loaded once and cached module-wide (every call reuses
 * it - it's ~150-200KB, not worth re-fetching per join).
 *
 * `@sapphi-red/web-noise-suppressor`'s RnnoiseWorkletNode class declares
 * `extends AudioWorkletNode` at its own module top level, which means that
 * class body is evaluated the instant the package is imported - not when a
 * call actually starts. On an insecure (http, non-localhost) origin,
 * Safari doesn't define `AudioWorkletNode` as a global at all, so a plain
 * static import of this package throws a ReferenceError immediately. Since
 * this module used to be pulled into the single main bundle (via
 * groupCallStore.ts, always mounted), that crashed the ENTIRE app before
 * React ever rendered anything - not just voice calls. Importing the
 * package dynamically, only inside the functions that actually use it,
 * defers that evaluation until a call is actually started.
 */

let cachedWasmBinary: ArrayBuffer | null = null;
let wasmLoadPromise: Promise<ArrayBuffer> | null = null;

async function getWasmBinary(): Promise<ArrayBuffer> {
  if (cachedWasmBinary) return cachedWasmBinary;
  if (!wasmLoadPromise) {
    const { loadRnnoise } = await import("@sapphi-red/web-noise-suppressor");
    wasmLoadPromise = loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
  }
  cachedWasmBinary = await wasmLoadPromise;
  return cachedWasmBinary;
}

export interface DenoisedMic {
  track: MediaStreamTrack;
  /** Stops capture and tears down the audio graph - call when leaving the call or switching the setting off. */
  cleanup: () => void;
  /** Re-targets the gain node live, e.g. when the user drags the mic volume slider mid-call. */
  setGain: (percent: number) => void;
}

/**
 * Captures the microphone and returns a new MediaStreamTrack carrying the
 * processed output - publish this instead of the raw getUserMedia track.
 * RNNoise denoising (xiph/rnnoise via @sapphi-red/web-noise-suppressor's
 * WASM + AudioWorklet build) is applied when `denoise` is true; a GainNode
 * for the user's chosen mic volume (see mediaDevicePrefs.ts) is always in
 * the graph, since that's the only way to amplify a mic above what
 * MediaStreamTrack itself allows (there's no native "input gain" constraint).
 *
 * `@sapphi-red/web-noise-suppressor`'s RnnoiseWorkletNode class declares
 * `extends AudioWorkletNode` at its own module top level, which means that
 * class body is evaluated the instant the package is imported - not when a
 * call actually starts. On an insecure (http, non-localhost) origin,
 * Safari doesn't define `AudioWorkletNode` as a global at all, so a plain
 * static import of this package throws a ReferenceError immediately. Since
 * this module used to be pulled into the single main bundle (via
 * groupCallStore.ts, always mounted), that crashed the ENTIRE app before
 * React ever rendered anything - not just voice calls. Importing the
 * package dynamically, only when `denoise` is actually requested, defers
 * that evaluation until a call with noise suppression on is actually started.
 */
export async function createMicTrack(deviceId: string | undefined, denoise: boolean, gainPercent: number): Promise<DenoisedMic> {
  // navigator.mediaDevices doesn't exist outside a secure context (https, or
  // plain http on localhost) - calling .getUserMedia on it then throws a
  // raw, unhelpful "undefined is not an object" TypeError.
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("A mikrofon csak biztonságos (HTTPS) kapcsolaton érhető el.");
  }
  const audioContext = new AudioContext();

  let rnnoise: Awaited<ReturnType<typeof createRnnoiseNode>> | null = null;
  if (denoise) {
    rnnoise = await createRnnoiseNode(audioContext);
  }

  const rawStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      // `ideal` (not `exact`): downmixes a stereo capture device to mono
      // instead of hard-failing on hardware that genuinely can't do 1
      // channel. A voice mic has no business being stereo, and capturing
      // it as 2 channels is exactly how a device/driver that only feeds
      // real signal into one physical channel ends up sounding like it's
      // "only in the left ear" - averaging down to mono fixes that instead
      // of just quietly carrying it through the whole pipeline.
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  // Force every node in the graph to stay strictly mono end-to-end. Without
  // this, a node that (for whatever reason - a worklet's own channel
  // handling, a browser quirk) ends up reporting 2 output channels with
  // real data only in channel 0 gets fed into the destination's default
  // "explicit" 2-channel mode with "speakers" interpretation - which, for a
  // node that already LOOKS 2-channel, does no up-mixing at all, so channel
  // 1 (the right ear) is silently silence. Pinning channelCount=1 with
  // "explicit" mode on every node removes any path for that to happen: each
  // node genuinely only ever has 1 channel, so the final destination's own
  // 1->N up-mix (guaranteed correct, spec-mandated "speakers" behavior) is
  // what actually produces the stereo image on playback, not this graph.
  function forceMono(node: AudioNode): void {
    node.channelCount = 1;
    node.channelCountMode = "explicit";
    node.channelInterpretation = "speakers";
  }

  const source = audioContext.createMediaStreamSource(rawStream);
  forceMono(source);
  const gain = audioContext.createGain();
  forceMono(gain);
  gain.gain.value = gainPercent / 100;
  const destination = audioContext.createMediaStreamDestination();
  forceMono(destination);

  if (rnnoise) {
    forceMono(rnnoise);
    source.connect(rnnoise);
    rnnoise.connect(gain);
  } else {
    source.connect(gain);
  }
  gain.connect(destination);

  const track = destination.stream.getAudioTracks()[0];
  if (!track) throw new Error("Nem sikerült a mikrofon hangsávot létrehozni.");

  const cleanup = () => {
    rnnoise?.destroy();
    source.disconnect();
    rawStream.getTracks().forEach((t) => t.stop());
    void audioContext.close();
  };

  return { track, cleanup, setGain: (percent) => gain.gain.setTargetAtTime(percent / 100, audioContext.currentTime, 0.1) };
}

async function createRnnoiseNode(audioContext: AudioContext) {
  const { RnnoiseWorkletNode } = await import("@sapphi-red/web-noise-suppressor");
  const [wasmBinary] = await Promise.all([getWasmBinary(), audioContext.audioWorklet.addModule(rnnoiseWorkletUrl)]);
  return new RnnoiseWorkletNode(audioContext, { wasmBinary, maxChannels: 1 });
}
