import { useEffect, useState } from "react";
import { BlobUrlCache } from "./blobUrlCache";
import { useMatrixStore } from "../state/matrixStore";

/**
 * Resolves an `mxc://` URI to a displayable URL, coping with homeservers that
 * have dropped the legacy unauthenticated `/_matrix/media/v3/*` endpoints
 * (MSC3916 - this project's test server included, confirmed live: those 404).
 *
 * `Avatar.tsx` handles this for `<img>` by reacting to `onError`, but a CSS
 * `background-image` (profile banners) has no error event to hook, so anything
 * that isn't a plain `<img>` needs to pre-resolve to a `blob:` URL instead.
 *
 * Blob URLs are cached module-wide, keyed by the mxc + requested dimensions, so
 * every consumer of the same image shares one fetch and one object URL. The
 * cache is LRU-bounded (see BlobUrlCache) so a long session doesn't pin an
 * ever-growing pile of decoded images in memory.
 */
const blobCache = new BlobUrlCache(300);
const inFlight = new Map<string, Promise<string | null>>();

interface AuthedMediaOpts {
  width?: number;
  height?: number;
  method?: "scale" | "crop";
  /** Request an animated thumbnail (for an animated banner / decoration). No-op on a static source. */
  animated?: boolean;
}

/** Appends `animated=true` to a thumbnail URL (see Avatar.tsx's copy). */
function withAnimated(url: string): string {
  if (!url.includes("/thumbnail/") || url.includes("animated=")) return url;
  return url + (url.includes("?") ? "&" : "?") + "animated=true";
}

async function fetchAsBlobUrl(url: string, token: string | null): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

/**
 * Returns a `blob:` URL for the given mxc content, or `null` while loading /
 * on failure. Tries the authenticated media endpoint first (with the access
 * token), falling back to the legacy unauthenticated one for older servers.
 */
export function useAuthedMedia(
  mxcUrl: string | null | undefined,
  opts: AuthedMediaOpts = {},
): string | null {
  const client = useMatrixStore((s) => s.client);
  const { width, height, method, animated } = opts;
  const cacheKey = mxcUrl ? `${mxcUrl}|${width ?? ""}x${height ?? ""}|${method ?? ""}|${animated ? "a" : ""}` : null;
  const [src, setSrc] = useState<string | null>(() => (cacheKey ? (blobCache.get(cacheKey) ?? null) : null));

  useEffect(() => {
    if (!mxcUrl || !cacheKey || !client) {
      setSrc(null);
      return;
    }
    const cached = blobCache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      return;
    }

    let cancelled = false;
    let promise = inFlight.get(cacheKey);
    if (!promise) {
      const token = client.getAccessToken();
      const rawAuthed = client.mxcUrlToHttp(mxcUrl, width, height, method, false, false, true);
      const rawPlain = client.mxcUrlToHttp(mxcUrl, width, height, method, false, false, false);
      const authedUrl = rawAuthed && animated ? withAnimated(rawAuthed) : rawAuthed;
      const plainUrl = rawPlain && animated ? withAnimated(rawPlain) : rawPlain;
      promise = (async () => {
        const fromAuthed = authedUrl ? await fetchAsBlobUrl(authedUrl, token) : null;
        const blobUrl = fromAuthed ?? (plainUrl ? await fetchAsBlobUrl(plainUrl, null) : null);
        if (blobUrl) blobCache.set(cacheKey, blobUrl);
        return blobUrl;
      })().finally(() => inFlight.delete(cacheKey));
      inFlight.set(cacheKey, promise);
    }
    void promise.then((blobUrl) => {
      if (!cancelled) setSrc(blobUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [mxcUrl, cacheKey, client, width, height, method, animated]);

  return src;
}
