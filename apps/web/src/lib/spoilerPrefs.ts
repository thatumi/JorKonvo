/**
 * How spoiler content (||text|| and spoiler-marked attachments) behaves:
 *  - "click"  (default): hidden until clicked, Discord's normal behaviour
 *  - "show":  always revealed (never blur)
 *  - "hide":  stay hidden even after clicking (for screenshots / shoulder-surfing)
 */
export type SpoilerMode = "click" | "show" | "hide";

const KEY = "jorkonvo-spoiler-mode";

export function getSpoilerMode(): SpoilerMode {
  const v = localStorage.getItem(KEY);
  return v === "show" || v === "hide" ? v : "click";
}

export function setSpoilerMode(mode: SpoilerMode): void {
  localStorage.setItem(KEY, mode);
}
