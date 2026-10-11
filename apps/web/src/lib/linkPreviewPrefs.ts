/**
 * Controls whether a URL in a message turns into a preview card / inline
 * embed. Two independent privacy leaks are at stake and this gates both:
 *
 *  - LinkPreview asks the HOMESERVER to fetch the URL (`/preview_url`). In an
 *    E2EE room the message body is end-to-end encrypted, but handing the URL
 *    to the server for a preview quietly defeats that for anything linked.
 *  - RichEmbed loads a third-party <iframe> (YouTube, Spotify, ...) the moment
 *    the message renders - an unsolicited connection that leaks the reader's
 *    IP and "I opened this chat" to that provider, and lets whoever posted a
 *    uniquely-tagged link see who viewed it.
 *
 * Default is "unencrypted": previews in normal rooms (matches what people
 * expect from a chat app), never automatically in encrypted ones. Device-local
 * like the other privacy toggles - see readReceiptPrivacy.ts.
 */

export type LinkPreviewMode = "all" | "unencrypted" | "off";

const KEY = "jorkonvo-link-previews";

// shouldShowLinkPreview() runs on the message render path (once per message
// that contains a URL), so the value is cached module-side rather than read
// from localStorage every time - localStorage.getItem on the render path is a
// measurable stall, especially on mobile Safari.
let cached: LinkPreviewMode | undefined;

function readFromStorage(): LinkPreviewMode {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "all" || stored === "unencrypted" || stored === "off") return stored;
  } catch {
    /* private mode */
  }
  return "unencrypted";
}

export function getLinkPreviewMode(): LinkPreviewMode {
  return (cached ??= readFromStorage());
}

export function setLinkPreviewMode(mode: LinkPreviewMode): void {
  cached = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode */
  }
}

if (typeof window !== "undefined") {
  // Another tab (or settings sync's reload) changed it.
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) cached = undefined;
  });
}

/** Whether a preview/embed may be shown for a message in a room with the given encryption state. */
export function shouldShowLinkPreview(roomIsEncrypted: boolean): boolean {
  const mode = getLinkPreviewMode();
  if (mode === "off") return false;
  if (mode === "unencrypted") return !roomIsEncrypted;
  return true;
}
