import { sendFileMessage } from "@jorkonvo/matrix-core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../i18n";
import { getTenorApiKey, type GifResult, getTrendingGifs, searchGifs } from "../../lib/gifSearch";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { Modal } from "../Modal";

/**
 * GIF picker (Tenor). Fully wired up end to end - search, grid, send - the
 * ONLY missing piece is the user's own Tenor API key (see gifSearch.ts's
 * header for why that can't ship with the app), so this modal's main job
 * without one is to say so clearly rather than fail mysteriously.
 */
export function SendGifModal({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const hasKey = Boolean(getTenorApiKey());

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!hasKey) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      const search = query.trim() ? searchGifs(query.trim()) : getTrendingGifs();
      search
        .then((gifs) => {
          if (requestId === requestIdRef.current) setResults(gifs);
        })
        .catch((err) => {
          if (requestId === requestIdRef.current) setError((err as Error).message);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, hasKey]);

  async function handlePick(gif: GifResult) {
    setSendingId(gif.id);
    setError(null);
    try {
      const res = await fetch(gif.fullUrl);
      if (!res.ok) throw new Error(t("sendGif.downloadFailed", { status: res.status }));
      const blob = await res.blob();
      const file = new File([blob], `${gif.id}.gif`, { type: blob.type || "image/gif" });
      await sendFileMessage(client, roomId, file);
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSendingId(null);
    }
  }

  return (
    <Modal title={t("sendGif.title")} onClose={close}>
      {!hasKey ? (
        <p className="rounded bg-bg-darkest px-3 py-3 text-sm text-normal">{t("sendGif.needKey")}</p>
      ) : (
        <>
          <input
            autoFocus
            aria-label={t("sendGif.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("sendGif.searchPlaceholder")}
            className="mb-3 w-full rounded bg-bg-darkest px-3 py-2 text-sm text-normal outline-none focus:ring-2 focus:ring-brand"
          />
          {loading && <p aria-live="polite" className="py-3 text-center text-sm text-muted">{t("sendGif.searching")}</p>}
          {error && <p role="alert" className="mb-2 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
          {!loading && !error && results.length === 0 && (
            <p className="py-3 text-center text-sm text-muted">{t("sendGif.noResults")}</p>
          )}
          <div className="grid max-h-96 grid-cols-3 gap-1.5 overflow-y-auto">
            {results.map((gif) => (
              <button
                key={gif.id}
                type="button"
                disabled={sendingId !== null}
                onClick={() => void handlePick(gif)}
                title={gif.description}
                className="relative overflow-hidden rounded bg-bg-darkest disabled:opacity-50"
              >
                <img src={gif.previewUrl} alt={gif.description} className="h-24 w-full object-cover" loading="lazy" />
                {sendingId === gif.id && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white">
                    {t("sendGif.sending")}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
