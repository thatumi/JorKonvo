import { getPersonalStickers, resolveAttachmentUrl, savePersonalSticker } from "@jorkonvo/matrix-core";
import { type MatrixEvent } from "matrix-js-sdk";
import type { EncryptedFile } from "matrix-js-sdk/lib/@types/media.js";
import { useEffect, useState } from "react";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";

/**
 * A sticker message: resolves the sticker's (possibly encrypted) media URL
 * asynchronously, and offers a hover action to save it to the viewer's
 * personal sticker pack.
 *
 * @param ev - The sticker message event to render.
 */
export function StickerMessage({ ev }: { ev: MatrixEvent }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const content = ev.getContent() as {
    body?: string;
    info?: Record<string, unknown>;
    url?: string;
    file?: EncryptedFile;
  };

  const alreadySaved =
    !!content.url && getPersonalStickers(client).some((s) => s.url === content.url);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    resolveAttachmentUrl(client, content)
      .then((resolved) => {
        if (cancelled) return;
        objectUrl = resolved;
        setUrl(resolved);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev.getId()]);

  async function handleSave() {
    setSaveState("saving");
    try {
      await savePersonalSticker(client, content);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  if (error) return <p className="mt-1 text-sm text-dnd">{t("stickerMsg.loadFailed")}</p>;

  const saved = alreadySaved || saveState === "saved";
  const saveLabel = saved ? t("stickerMsg.alreadySaved") : t("stickerMsg.save");

  return (
    <div className="group/sticker relative mt-1 w-fit">
      {url ? (
        <img src={url} alt={content.body ?? t("stickerMsg.altFallback")} title={content.body} className="max-h-40 max-w-40" />
      ) : (
        <div className="h-24 w-24 animate-pulse rounded bg-bg-secondary" aria-hidden="true" />
      )}
      {url && (
        <button
          type="button"
          disabled={saveState === "saving" || saved}
          onClick={() => void handleSave()}
          title={saveLabel}
          aria-label={saveLabel}
          className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white opacity-0 transition hover:bg-black/80 group-hover/sticker:opacity-100 disabled:opacity-60 group-hover/sticker:disabled:opacity-60"
        >
          {saved ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
            </svg>
          ) : saveState === "error" ? (
            <span className="px-1 text-[10px]">{t("stickerMsg.errorBadge")}</span>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M17 3H5a2 2 0 0 0-2 2v16l7-3 7 3V5a2 2 0 0 0-2-2Z" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
