import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { createMicTrack, type DenoisedMic } from "../lib/noiseSuppression";
import { getMicVolume, getPreferredSpeakerId } from "../lib/mediaDevicePrefs";
import { useGroupCallStore } from "../state/groupCallStore";
import { useNoiseSuppressionStore } from "../state/noiseSuppressionStore";

/**
 * "Mic Test" button + a live RMS level meter, same idea as Discord's
 * settings-page mic test - and, like Discord, it loops your own voice back
 * to your speakers so you can actually hear how you sound (through RNNoise
 * when noise suppression is on, since that's the pipeline a call would use).
 * If a call is in progress the call is deafened + mic-muted for the duration
 * of the test and restored afterwards, so the two don't talk over each other.
 *
 * `micVolume` is accepted as a prop (rather than read once from
 * mediaDevicePrefs) so the parent's live slider actually has an audible
 * effect while a test is running - see the effect below.
 */
export function MicTest({ deviceId, micVolume }: { deviceId: string | undefined; micVolume?: number }) {
  const { t } = useTranslation();
  const denoise = useNoiseSuppressionStore((s) => s.enabled);
  const setAudioTestActive = useGroupCallStore((s) => s.setAudioTestActive);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);
  const micRef = useRef<DenoisedMic | null>(null);
  const testingRef = useRef(false);

  useEffect(() => () => cleanupRef.current?.(), []);

  // Live mic-volume changes (the settings slider) should be audible in an
  // already-running test, not just apply to the next one.
  useEffect(() => {
    if (micVolume !== undefined) micRef.current?.setGain(micVolume);
  }, [micVolume]);

  // Toggling noise suppression while a test is running has no effect on the
  // graph unless the pipeline is rebuilt with the new setting - restart it
  // so the change is actually audible, same as flipping it and re-clicking
  // "Mic Test" by hand would be.
  useEffect(() => {
    if (testingRef.current) {
      stop();
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [denoise]);

  async function start() {
    try {
      const mic = await createMicTrack(deviceId, denoise, micVolume ?? getMicVolume());
      micRef.current = mic;
      const monitorStream = new MediaStream([mic.track]);

      // Self-monitoring playback.
      const audio = new Audio();
      audio.srcObject = monitorStream;
      audio.autoplay = true;
      const speakerId = getPreferredSpeakerId();
      const sinkable = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (speakerId && sinkable.setSinkId) void sinkable.setSinkId(speakerId).catch(() => undefined);
      void audio.play().catch(() => undefined);

      // Level meter, tapped off the same processed track.
      const meterContext = new AudioContext();
      const source = meterContext.createMediaStreamSource(monitorStream);
      const analyser = meterContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (const sample of data) {
          const centered = sample - 128;
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / data.length) / 128;
        setLevel(Math.min(1, rms * 4)); // *4: typical speech RMS is quiet relative to the meter's 0-1 range
        raf = requestAnimationFrame(tick);
      };
      tick();

      setAudioTestActive(true);
      cleanupRef.current = () => {
        cancelAnimationFrame(raf);
        audio.pause();
        audio.srcObject = null;
        source.disconnect();
        void meterContext.close();
        mic.cleanup();
        micRef.current = null;
        setAudioTestActive(false);
      };
      testingRef.current = true;
      setTesting(true);
    } catch {
      // Permission denied, device unavailable, insecure context, etc. - the button just stays untested.
    }
  }

  function stop() {
    cleanupRef.current?.();
    cleanupRef.current = null;
    testingRef.current = false;
    setLevel(0);
    setTesting(false);
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => (testing ? stop() : void start())}
        className="shrink-0 rounded border border-border px-2 py-1 text-xs font-medium text-normal hover:bg-bg-modifier-hover"
      >
        {testing ? t("settings.micTestStop") : t("settings.micTest")}
      </button>
      {testing && (
        <div
          role="progressbar"
          aria-label={t("settings.micVolume")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
          className="h-2 flex-1 overflow-hidden rounded-full bg-bg-darkest"
        >
          <div className="h-full rounded-full bg-online transition-[width] duration-75" style={{ width: `${level * 100}%` }} />
        </div>
      )}
    </div>
  );
}
