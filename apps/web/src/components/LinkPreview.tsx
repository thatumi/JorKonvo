import { getUrlPreview, type UrlPreview } from "@jorkonvo/matrix-core";
import { useEffect, useState } from "react";
import { useMatrixStore } from "../state/matrixStore";
import { AuthedImg } from "./AuthedImg";

const URL_RE = /(https?:\/\/[^\s<>"')]+)/i;

/** Extracts the first http(s) URL from a text body, or null. */
export function extractFirstUrl(text: string): string | null {
  return URL_RE.exec(text)?.[1] ?? null;
}

/**
 * Discord-style OG link card for a URL: fetches the homeserver's preview
 * (title / description / thumbnail via `getUrlPreview`) and renders it as a
 * clickable card linking to the original URL.
 */
export function LinkPreview({ url }: { url: string }) {
  const client = useMatrixStore((s) => s.client)!;
  const [preview, setPreview] = useState<UrlPreview | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setPreview(undefined);
    getUrlPreview(client, url).then((p) => !cancelled && setPreview(p));
    return () => {
      cancelled = true;
    };
  }, [client, url]);

  if (!preview) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={preview.title || url}
      className="mt-1 flex max-w-md gap-3 overflow-hidden rounded-lg border border-border bg-bg-secondary p-3 hover:border-muted"
    >
      {preview.imageMxcUrl && (
        <AuthedImg
          mxc={preview.imageMxcUrl}
          alt=""
          width={160}
          height={160}
          className="h-16 w-16 shrink-0 rounded object-cover"
        />
      )}
      <div className="min-w-0">
        {preview.title && (
          <div className="truncate text-sm font-semibold text-link">{preview.title}</div>
        )}
        {preview.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{preview.description}</p>
        )}
      </div>
    </a>
  );
}
