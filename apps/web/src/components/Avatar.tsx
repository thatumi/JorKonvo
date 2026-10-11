import { useEffect, useState } from "react";
import { useAuthedMedia } from "../lib/authedMedia";
import { BlobUrlCache } from "../lib/blobUrlCache";
import { initials } from "../lib/mxc";
import { useMatrixStore } from "../state/matrixStore";

interface AvatarProps {
  url: string | null;
  name: string;
  size?: number;
  /** "none" = don't round the image/fallback itself, let a clipping parent
   *  decide the shape (used by SpaceRail, whose button already animates its
   *  own border-radius on hover/active). */
  rounded?: "full" | "lg" | "none";
  statusColor?: string;
  /** Stretch to 100% of the parent instead of a fixed `size` box - so a
   *  rem-sized parent (which font-scale can grow) stays fully covered and its
   *  background never peeks out around the image. `size` is still used for the
   *  requested thumbnail resolution and the fallback initials sizing. */
  fill?: boolean;
  /** Ask the homeserver for an animated thumbnail (Discord's "animated
   *  avatar", free here). A no-op on a static source. Default on; pass false
   *  in very dense lists if it ever becomes a problem. */
  animated?: boolean;
  /** `mxc://` of a Discord-style avatar decoration (frame overlay). Drawn on
   *  top of the avatar, ~1.3x its size. See profileFlair.ts. */
  decorationMxc?: string | null;
}

/**
 * Adds `animated=true` to a media thumbnail URL so an animated GIF/APNG/WebP
 * avatar or space icon actually moves (Synapse serves a still frame
 * otherwise). Left alone for non-thumbnail URLs and blob:/data: URIs.
 */
function withAnimated(url: string): string {
  if (!url.includes("/thumbnail/") || url.includes("animated=")) return url;
  return url + (url.includes("?") ? "&" : "?") + "animated=true";
}

// Some homeservers (this test server included, per MSC3916) have dropped the
// legacy unauthenticated /_matrix/media/v3/* endpoints entirely (confirmed
// live: 404) in favor of the authenticated /_matrix/client/v1/media/*
// equivalent, which needs an Authorization header a plain <img src> can't
// send. Cache blob: URLs (module-level, so every Avatar showing the same
// mxc content shares one fetch) and only pay the extra fetch when the plain
// <img> actually fails to load - servers where the legacy endpoint still
// works never hit this path at all.
const authedBlobCache = new BlobUrlCache(400);
const inFlightFetch = new Map<string, Promise<string | null>>();

function toAuthenticatedMediaUrl(url: string): string | null {
  if (!url.includes("/_matrix/media/v3/")) return null;
  return url.replace("/_matrix/media/v3/", "/_matrix/client/v1/media/");
}

/**
 * Avatar image for a user/room/space with an initials fallback (and an
 * authenticated-media retry for MSC3916 homeservers), optional presence dot
 * and avatar-decoration overlay. Sizing/shape options are documented on
 * `AvatarProps` above.
 */
export function Avatar({
  url: rawUrl,
  name,
  size = 40,
  rounded = "full",
  statusColor,
  fill,
  animated = true,
  decorationMxc,
}: AvatarProps) {
  const client = useMatrixStore((s) => s.client);
  const url = rawUrl && animated ? withAnimated(rawUrl) : rawUrl;
  const decorationSrc = useAuthedMedia(decorationMxc ?? null, {
    width: Math.round(size * 1.4),
    height: Math.round(size * 1.4),
    method: "scale",
    animated: true,
  });
  const radius = rounded === "none" ? "" : rounded === "full" ? "rounded-full" : "rounded-2xl";
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(url ? (authedBlobCache.get(url) ?? null) : null);
  const [failed, setFailed] = useState(false);

  // A different avatar URL (switching rooms/users) invalidates any earlier
  // failure/fallback state for the previous URL.
  useEffect(() => {
    setFallbackSrc(url ? (authedBlobCache.get(url) ?? null) : null);
    setFailed(false);
  }, [url]);

  async function handleImgError() {
    if (!url || fallbackSrc || failed) {
      setFailed(true);
      return;
    }
    const authedUrl = toAuthenticatedMediaUrl(url);
    const token = client?.getAccessToken();
    if (!authedUrl || !token) {
      setFailed(true);
      return;
    }
    try {
      let promise = inFlightFetch.get(url);
      if (!promise) {
        promise = fetch(authedUrl, { headers: { Authorization: `Bearer ${token}` } })
          .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
          .then((blob) => {
            const blobUrl = URL.createObjectURL(blob);
            authedBlobCache.set(url, blobUrl);
            return blobUrl;
          })
          .finally(() => inFlightFetch.delete(url));
        inFlightFetch.set(url, promise);
      }
      const blobUrl = await promise;
      if (blobUrl) setFallbackSrc(blobUrl);
      else setFailed(true);
    } catch {
      setFailed(true);
    }
  }

  const effectiveSrc = failed ? null : (fallbackSrc ?? url);
  const box = fill ? undefined : { width: size, height: size };

  return (
    <div className={`relative shrink-0 ${fill ? "h-full w-full" : ""}`} style={box}>
      {effectiveSrc ? (
        <img
          src={effectiveSrc}
          alt={name}
          onError={() => void handleImgError()}
          // Browsers make <img> natively draggable by default (drag-out-of-
          // page) - found live: this silently hijacks any custom pointer-
          // based drag gesture started on it (space/room reordering) before
          // our own handlers ever see the pointermove, which is why only
          // avatars WITH a real image (not the initials-letter fallback div
          // below, which isn't an <img> at all) were affected.
          draggable={false}
          className={`h-full w-full object-cover ${radius}`}
          style={box}
        />
      ) : (
        <div
          role="img"
          aria-label={name}
          className={`flex h-full w-full items-center justify-center bg-brand font-semibold text-white ${radius}`}
          style={{ ...box, fontSize: size * 0.4 }}
        >
          {initials(name)}
        </div>
      )}
      {decorationSrc && (
        <img
          src={decorationSrc}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute left-1/2 top-1/2 max-w-none -translate-x-1/2 -translate-y-1/2"
          style={{ width: size * 1.35, height: size * 1.35 }}
        />
      )}
      {statusColor && (
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 z-10 rounded-full border-[3px] border-bg-dark"
          style={{ width: size * 0.32, height: size * 0.32, backgroundColor: statusColor }}
        />
      )}
    </div>
  );
}
