/**
 * A single, app-wide visually-hidden `aria-live="polite"` region. Screen
 * readers announce text written here without moving visual focus - used by
 * NotificationManager (gated by displayPrefs' announceMessages) to read out
 * new incoming messages the same way a sighted user would notice a popup.
 */
let liveRegion: HTMLElement | null = null;

function ensureLiveRegion(): HTMLElement {
  if (liveRegion?.isConnected) return liveRegion;
  const el = document.createElement("div");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("role", "status");
  el.className = "sr-only";
  document.body.appendChild(el);
  liveRegion = el;
  return el;
}

export function announceForScreenReader(text: string): void {
  if (typeof document === "undefined") return;
  const el = ensureLiveRegion();
  // Screen readers only announce on a CONTENT CHANGE - clearing first means
  // two consecutive identical announcements (e.g. the same sender twice)
  // both still fire instead of the second being silently a no-op diff.
  el.textContent = "";
  requestAnimationFrame(() => {
    el.textContent = text;
  });
}
