/**
 * Inline embeds for the big media/link providers, Discord-style: a pasted
 * YouTube link becomes a playable player instead of a title card. Only
 * providers that expose plain <iframe> embeds (no client-side JS widget)
 * are supported - everything else falls through to the generic OG card.
 */

export interface ParsedEmbed {
  provider: string;
  src: string;
  /** width/height ratio of the embed area */
  aspect: number;
  /** max aspect (e.g. Spotify is a tall little card) */
  maxHeight?: number;
}

const YT_ID = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i;

/** Extracts an 11-char YouTube video id from any of its URL shapes, or null - shared with watch-together, which needs the bare id rather than a ready-made embed src. */
export function parseYouTubeVideoId(rawUrl: string): string | null {
  return YT_ID.exec(rawUrl)?.[1] ?? null;
}

export function parseEmbeddableUrl(rawUrl: string): ParsedEmbed | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  const yt = YT_ID.exec(url.href);
  if (host.endsWith("youtube.com") || host === "youtu.be") {
    if (yt) {
      return {
        provider: "YouTube",
        src: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0`,
        aspect: 16 / 9,
      };
    }
    // A playlist or channel link - no single video; fall through to the card.
    return null;
  }

  if (host.endsWith("vimeo.com")) {
    const id = /^\/(\d{6,})/.exec(url.pathname);
    if (id) {
      return { provider: "Vimeo", src: `https://player.vimeo.com/video/${id[1]}`, aspect: 16 / 9 };
    }
    return null;
  }

  if (host === "spotify.com" || host.endsWith(".spotify.com")) {
    // open.spotify.com/<type>/<id> - embed path joins them with a colon.
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] !== "embed") {
      return {
        provider: "Spotify",
        src: `https://open.spotify.com/embed/${parts[0]}/${parts[1]}`,
        aspect: 16 / 7,
        maxHeight: 152,
      };
    }
    return null;
  }

  if (host === "soundcloud.com") {
    return {
      provider: "SoundCloud",
      src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.href)}&color=%238b5cf6&visual=false&show_comments=false`,
      aspect: 16 / 3.4,
      maxHeight: 166,
    };
  }

  if (host.endsWith("twitch.tv")) {
    // Twitch's embed requires the parent= parameter to match the embedding host.
    const channel = url.pathname.split("/").filter(Boolean)[0];
    if (channel) {
      return {
        provider: "Twitch",
        src: `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${window.location.hostname}&autoplay=false`,
        aspect: 16 / 9,
      };
    }
    return null;
  }

  if (host === "media.ccc.de") {
    const m = /\/v\/([\w-]+)/.exec(url.pathname);
    if (m) {
      return {
        provider: "media.ccc.de",
        src: `https://media.ccc.de/embed/${m[1]}`,
        aspect: 16 / 9,
      };
    }
    return null;
  }

  return null;
}

/**
 * Renders a sandboxed provider embed (iframe) for a pasted URL when the
 * provider is on the allowlist (see `parseEmbeddableUrl`), wrapped in a link
 * to the original URL; otherwise renders nothing (caller falls back to the
 * generic link card).
 */
export function RichEmbed({ url }: { url: string }) {
  const embed = parseEmbeddableUrl(url);
  if (!embed) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={url}
      className="mt-1 block max-w-md overflow-hidden rounded-lg border border-border bg-black/40 transition hover:border-muted"
      style={embed.maxHeight ? { maxHeight: embed.maxHeight } : undefined}
    >
      <iframe
        src={embed.src}
        title={embed.provider}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
        // No allow-top-navigation: the embed can play and pop out its own
        // "watch on <site>" link, but can't redirect the whole app.
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
        className="block w-full border-0"
        style={{ aspectRatio: String(embed.aspect) }}
      />
    </a>
  );
}
