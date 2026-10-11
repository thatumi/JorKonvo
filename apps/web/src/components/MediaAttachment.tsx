import { isVoiceMessageEvent, type MatrixEvent, MsgType, parseVoiceMessage, resolveAttachmentUrl } from "@jorkonvo/matrix-core";
import { useEffect, useState } from "react";
import { useTranslation } from "../i18n";
import { getSpoilerMode } from "../lib/spoilerPrefs";
import { useLightboxStore } from "../state/lightboxStore";
import { useMatrixStore } from "../state/matrixStore";
import { VoiceMessagePlayer } from "./VoiceMessagePlayer";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Spoiler convention (same as Element's): a filename wrapped in `||...||`
 * marks the attachment hidden until clicked, e.g. body `||cat.png||`.
 * Returns the bare name plus whether it was wrapped.
 */
function parseSpoilerName(rawName: string): { name: string; spoiler: boolean } {
  const match = /^\|\|([\s\S]+)\|\|$/.exec(rawName.trim());
  if (match) return { name: match[1]!.trim() || rawName, spoiler: true };
  return { name: rawName, spoiler: false };
}

function SpoilerWrap({
  onReveal,
  children,
  label,
}: {
  onReveal: () => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onReveal}
      className="group/sp relative mt-1 block max-w-sm overflow-hidden rounded-lg border border-border"
      title={label}
    >
      <div className="pointer-events-none select-none blur-xl brightness-50">{children}</div>
      <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-sm font-medium text-white">
        {label}
      </span>
    </button>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="currentColor">
      <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V8h4.5L14 3.5Z" />
    </svg>
  );
}

/**
 * Renders a Matrix media message (image / video / audio / voice message /
 * file download) for a timeline event: resolves the attachment to a blob URL
 * and honours the `||spoiler||` filename convention plus the global spoiler
 * mode. Images open the lightbox; voice messages use VoiceMessagePlayer.
 */
export function MediaAttachment({ ev }: { ev: MatrixEvent }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const openLightbox = useLightboxStore((s) => s.open);
  const content = ev.getContent();
  const msgtype = content.msgtype as string;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isImage = msgtype === MsgType.Image;
  const isVideo = msgtype === MsgType.Video;
  const isAudio = msgtype === MsgType.Audio;

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    resolveAttachmentUrl(client, { url: content.url, file: content.file, info: content.info })
      .then((resolved) => {
        if (cancelled) {
          URL.revokeObjectURL(resolved);
          return;
        }
        revoke = resolved;
        setUrl(resolved);
      })
      .catch((err) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev.getId()]);

  const { name: fileName, spoiler: rawSpoiler } = parseSpoilerName((content.body as string) ?? t("media.fileFallback"));
  const spoilerMode = getSpoilerMode();
  // "show" reveals everything; "hide" keeps it hidden even when tapped.
  const spoiler = rawSpoiler && spoilerMode !== "show";
  const size = content.info?.size as number | undefined;
  const [spoilerClicked, setSpoilerClicked] = useState(false);
  const spoilerRevealed = spoilerMode === "click" && spoilerClicked;
  const setSpoilerRevealed = setSpoilerClicked;
  // A new event (or a replaced/edit) resets the reveal.
  useEffect(() => {
    setSpoilerClicked(false);
  }, [ev.getId()]);

  if (error) {
    return <p className="mt-1 text-xs text-dnd">{t("media.loadFailed", { error })}</p>;
  }

  if (isImage) {
    const img = (
      <button
        type="button"
        disabled={!url}
        onClick={() => openLightbox({ content: { url: content.url, file: content.file }, name: fileName })}
        className="mt-1 block max-w-sm overflow-hidden rounded-lg border border-border transition hover:brightness-90 disabled:cursor-default"
      >
        {url ? (
          <img src={url} alt={fileName} className="max-h-80 max-w-full object-contain" />
        ) : (
          <div className="flex h-40 w-64 items-center justify-center bg-bg-secondary text-xs text-muted">
            {t("common.loading")}
          </div>
        )}
      </button>
    );
    if (spoiler && !spoilerRevealed) {
      return (
        <SpoilerWrap onReveal={() => setSpoilerRevealed(true)} label={t("media.spoiler")}>
          {img}
        </SpoilerWrap>
      );
    }
    return img;
  }

  if (isVideo) {
    const video = (
      <div className="mt-1 max-w-sm overflow-hidden rounded-lg border border-border">
        {url ? (
          <video src={url} controls aria-label={fileName} className="max-h-80 max-w-full" />
        ) : (
          <div className="flex h-40 w-64 items-center justify-center bg-bg-secondary text-xs text-muted">
            {t("common.loading")}
          </div>
        )}
      </div>
    );
    if (spoiler && !spoilerRevealed) {
      return (
        <SpoilerWrap onReveal={() => setSpoilerRevealed(true)} label={t("media.spoiler")}>
          {video}
        </SpoilerWrap>
      );
    }
    return video;
  }

  if (isAudio) {
    const voice = isVoiceMessageEvent(ev) ? parseVoiceMessage(ev) : null;
    if (voice) {
      return url ? (
        <VoiceMessagePlayer url={url} waveform={voice.waveform} durationMs={voice.durationMs} />
      ) : (
        <p className="mt-1 text-xs text-muted">{t("media.voiceLoading")}</p>
      );
    }
    return (
      <div className="mt-1">
        {url ? <audio src={url} controls /> : <p className="text-xs text-muted">{t("media.audioLoading")}</p>}
      </div>
    );
  }

  return (
    <a
      href={url ?? undefined}
      download={fileName}
      className="mt-1 flex max-w-sm items-center gap-2 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-normal hover:border-muted"
    >
      <FileIcon />
      <span className="min-w-0 flex-1 truncate">{fileName}</span>
      {size !== undefined && <span className="shrink-0 text-xs text-muted">{formatBytes(size)}</span>}
    </a>
  );
}
