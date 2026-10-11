/**
 * Discord's "Someone reacts to my messages" notification setting - All
 * messages / Only DMs / Never. Device-local (localStorage), same as the
 * other notification-sound preferences.
 */
export type ReactionNotifyMode = "all" | "dms" | "off";

const KEY = "jorkonvo-reaction-notify-mode";

export function getReactionNotifyMode(): ReactionNotifyMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "all" || v === "dms" || v === "off") return v;
  } catch {
    /* ignore */
  }
  return "all";
}

export function setReactionNotifyMode(mode: ReactionNotifyMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
}
