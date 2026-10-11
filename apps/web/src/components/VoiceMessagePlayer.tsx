import { useRef, useState } from "react";
import { useTranslation } from "../i18n";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Discord/Element-style voice-message playback: waveform bars double as a seek bar. */
export function VoiceMessagePlayer({ url, waveform, durationMs }: { url: string; waveform: number[]; durationMs: number }) {
  const { t } = useTranslation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0-1
  const [currentSeconds, setCurrentSeconds] = useState(0);

  const bars = waveform.length > 0 ? waveform : Array.from({ length: 40 }, () => 200);
  const maxAmp = Math.max(1, ...bars);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  }

  function seekTo(ratio: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = ratio * audio.duration;
  }

  return (
    <div className="mt-1 flex max-w-sm items-center gap-2.5 rounded-lg border border-border bg-bg-secondary px-3 py-2">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const audio = e.currentTarget;
          setCurrentSeconds(audio.currentTime);
          if (Number.isFinite(audio.duration) && audio.duration > 0) setProgress(audio.currentTime / audio.duration);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={togglePlay}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:brightness-110"
        title={playing ? t("voiceMsg.pause") : t("voiceMsg.play")}
        aria-label={playing ? t("voiceMsg.pause") : t("voiceMsg.play")}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M6 5h4v14H6V5Zm8 0h4v14h-4V5Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M8 5v14l11-7L8 5Z" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="flex h-8 flex-1 items-center gap-px"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          seekTo(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
        }}
        title={t("voiceMsg.seek")}
        aria-label={t("voiceMsg.seek")}
      >
        {bars.map((amp, i) => {
          const barRatio = i / bars.length;
          const played = barRatio <= progress;
          return (
            <span
              key={i}
              className={played ? "min-w-px flex-1 rounded-full bg-brand" : "min-w-px flex-1 rounded-full bg-border"}
              style={{ height: `${Math.max(12, (amp / maxAmp) * 100)}%` }}
            />
          );
        })}
      </button>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted">
        {formatTime(playing || currentSeconds > 0 ? currentSeconds : durationMs / 1000)}
      </span>
    </div>
  );
}
