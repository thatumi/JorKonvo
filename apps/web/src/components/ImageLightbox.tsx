import { resolveAttachmentUrl } from "@jorkonvo/matrix-core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { useLightboxStore } from "../state/lightboxStore";
import { useMatrixStore } from "../state/matrixStore";

/**
 * Discord-style in-page image viewer: clicking an attachment opens it enlarged
 * over the current page (no new tab / route). Click the backdrop or press Esc
 * to close. Resolves its own blob URL so it survives the message row that
 * opened it unmounting (scrolled out of the timeline).
 */
export function ImageLightbox() {
  const { t } = useTranslation();
  const item = useLightboxStore((s) => s.item);
  const close = useLightboxStore((s) => s.close);
  const client = useMatrixStore((s) => s.client);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!item || !client) {
      setUrl(null);
      return;
    }
    setUrl(null);
    setError(false);
    let revoke: string | null = null;
    let cancelled = false;
    resolveAttachmentUrl(client, item.content)
      .then((resolved) => {
        if (cancelled) {
          URL.revokeObjectURL(resolved);
          return;
        }
        revoke = resolved;
        setUrl(resolved);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [item, client]);

  useEffect(() => {
    if (!item) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, close]);

  // Modal dialog: remember the trigger when the lightbox opens and put focus
  // back there when it closes (or the item is swapped).
  useEffect(() => {
    if (!item) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => restoreFocusRef.current?.focus();
  }, [item]);

  if (!item) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      className="animate-fade-in fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/85 p-6 pt-[calc(1.5rem_+_env(safe-area-inset-top))] backdrop-blur-sm"
      onClick={close}
    >
      {/* The X sits inside this fixed overlay, so it offsets itself below the
          status bar on its own - a positioned child is not protected by the
          overlay's padding (and the overlay ignores #root's, if any). */}
      <div className="absolute right-4 top-[calc(1rem_+_env(safe-area-inset-top))] flex items-center gap-2">
        {url && (
          <a
            href={url}
            download={item.name}
            onClick={(e) => e.stopPropagation()}
            title={t("lightbox.download")}
            aria-label={t("lightbox.download")}
            className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M5 20h14v-2H5v2ZM19 9h-4V3H9v6H5l7 7 7-7Z" />
            </svg>
          </a>
        )}
        <button
          type="button"
          onClick={close}
          title={t("common.close")}
          aria-label={t("common.close")}
          className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
          </svg>
        </button>
      </div>

      {error ? (
        <p className="text-sm text-white/70">{t("lightbox.failed")}</p>
      ) : !url ? (
        <p className="text-sm text-white/50">{t("common.loading")}</p>
      ) : item.video ? (
        <video
          src={url}
          controls
          autoPlay
          aria-label={item.name}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[88vh] max-w-[92vw] rounded-lg"
        />
      ) : (
        <img
          src={url}
          alt={item.name}
          onClick={(e) => e.stopPropagation()}
          className="animate-scale-in max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
        />
      )}
      {url && <p className="mt-3 max-w-[92vw] truncate text-sm text-white/70">{item.name}</p>}
    </div>
  );
}
