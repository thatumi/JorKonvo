import { computeWaveform, sendVoiceMessage } from "@jorkonvo/matrix-core";
import type { MatrixClient } from "matrix-js-sdk";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Picks the best-supported audio mimetype for MediaRecorder across browsers. */
function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const type of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) return type;
  }
  return "";
}

/**
 * Replaces the composer's text row while recording: live elapsed-time
 * readout + a small live level meter (from the same analyser used to
 * compute the final waveform's peaks), Cancel and Send.
 */
export function VoiceRecorderBar({
  client,
  roomId,
  onDone,
}: {
  client: MatrixClient;
  roomId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const BAR_COUNT = 64;
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(0));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const rafRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        // navigator.mediaDevices doesn't exist at all outside a secure context
        // (https, or plain http on localhost) - calling .getUserMedia on it
        // then throws a raw, unhelpful "undefined is not an object" TypeError.
        if (!navigator.mediaDevices?.getUserMedia) {
          setError(t("voiceRec.httpsRequired"));
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);
        let lastPush = 0;
        function tick() {
          if (!analyserRef.current) return;
          analyserRef.current.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
          setElapsedMs(Date.now() - startedAtRef.current);
          // Scroll a rolling history of peaks leftwards ~20x/s (not every rAF
          // frame - that's both wasteful and too fast to read as a waveform).
          const now = performance.now();
          if (now - lastPush >= 50) {
            lastPush = now;
            setLevels((prev) => [...prev.slice(1), peak]);
          }
          rafRef.current = requestAnimationFrame(tick);
        }

        const mimeType = pickMimeType();
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        startedAtRef.current = Date.now();
        recorder.start();
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || t("voiceRec.micDenied"));
      }
    }

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      closeAudioCtx();
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guards against "Cannot close a closed AudioContext": both the explicit
  // handleCancel/handleSend paths and the unmount cleanup below want to
  // close it, so track whether it's already gone.
  function closeAudioCtx() {
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }

  function stopRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        resolve(blob);
      };
      recorder.stop();
    });
  }

  async function handleCancel() {
    await stopRecording();
    closeAudioCtx();
    onDone();
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const blob = await stopRecording();
      closeAudioCtx();
      if (!blob || blob.size === 0) {
        onDone();
        return;
      }
      const durationMs = Date.now() - startedAtRef.current;
      const waveform = await computeWaveform(blob).catch(() => []);
      await sendVoiceMessage(client, roomId, blob, durationMs, waveform);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setSending(false);
    }
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 text-sm text-dnd">
        <span className="flex-1">{error}</span>
        <button type="button" onClick={onDone} className="rounded px-2 py-1 text-muted hover:text-normal">
          {t("common.close")}
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in flex items-center gap-3 px-4 py-2.5">
      <button
        type="button"
        onClick={() => void handleCancel()}
        disabled={sending}
        className="shrink-0 rounded-full p-1.5 text-muted hover:text-dnd disabled:opacity-40"
        title={t("common.cancel")}
        aria-label={t("common.cancel")}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm3.5 12.1-1.4 1.4L12 13.4l-2.1 2.1-1.4-1.4L10.6 12 8.5 9.9l1.4-1.4L12 10.6l2.1-2.1 1.4 1.4L13.4 12l2.1 2.1Z" />
        </svg>
      </button>
      <span className="flex items-center gap-1.5 shrink-0 text-sm font-medium text-normal">
        <span className="h-2 w-2 animate-pulse rounded-full bg-dnd" />
        {formatElapsed(elapsedMs)}
      </span>
      <div aria-hidden="true" className="flex h-6 flex-1 items-center gap-px overflow-hidden">
        {levels.map((lvl, i) => (
          <span
            key={i}
            className="min-w-[2px] flex-1 rounded-full bg-brand/60"
            style={{ height: `${Math.min(100, Math.max(8, lvl * 140))}%` }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => void handleSend()}
        disabled={sending}
        className="shrink-0 rounded-full bg-brand p-1.5 text-white enabled:hover:brightness-110 disabled:opacity-40"
        title={t("voiceRec.send")}
        aria-label={t("voiceRec.send")}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
          <path d="M2 21 23 12 2 3v7l15 2-15 2v7Z" />
        </svg>
      </button>
    </div>
  );
}
