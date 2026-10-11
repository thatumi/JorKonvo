import { useAuthedMedia } from "../lib/authedMedia";

/**
 * A plain <img> for an `mxc://` URI that works on authenticated-media
 * homeservers (MSC3916): resolves through useAuthedMedia (fetch + Bearer
 * token -> blob: URL) instead of a bare thumbnail URL a homeserver may 404.
 * Use for anything small and decorative (custom emoji, sticker previews,
 * emoji-pack management) where Avatar's letter-fallback doesn't fit.
 */
export function AuthedImg({
  mxc,
  alt,
  width = 32,
  height = 32,
  className,
}: {
  mxc: string | null | undefined;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const src = useAuthedMedia(mxc, { width, height, method: "scale" });
  if (!src) return <span className={className} role="img" aria-label={alt} />;
  return <img src={src} alt={alt} title={alt} loading="lazy" className={className} />;
}
