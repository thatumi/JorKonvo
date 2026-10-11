/**
 * Discord-style "convert emoticons to emoji as you type" - :) becomes 🙂 the
 * moment the closing character lands. Off by default; the toggle lives in
 * Appearance settings.
 */
const ENABLED_KEY = "jorkonvo-emoticon-to-emoji";

export function isEmoticonToEmojiEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "1";
}

export function setEmoticonToEmojiEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
}

// Longest first so ":'(" wins over ":(", etc.
const MAP: [emoticon: string, emoji: string][] = [
  [":'(", "😢"],
  [":')", "🥲"],
  ["D:", "😧"],
  [":D", "😃"],
  ["xD", "😆"],
  ["XD", "😆"],
  [":P", "😛"],
  [":p", "😛"],
  [";P", "😜"],
  [":)", "🙂"],
  ["(:", "🙂"],
  [":-)", "🙂"],
  [":(", "🙁"],
  ["):", "🙁"],
  [":-(", "🙁"],
  [";)", "😉"],
  [";-)", "😉"],
  [":o", "😮"],
  [":O", "😮"],
  [":|", "😐"],
  [":/", "😕"],
  [":\\", "😕"],
  [":*", "😘"],
  ["<3", "❤️"],
  ["</3", "💔"],
  [">:(", "😠"],
  ["o/", "👋"],
];

/**
 * If `text` ends with a recognised emoticon that's at a word boundary
 * (start of string or preceded by whitespace), returns `text` with that
 * emoticon replaced by its emoji; otherwise returns `text` unchanged.
 * Meant to run on every keystroke against the full value.
 */
export function convertTrailingEmoticon(text: string): string {
  for (const [emoticon, emoji] of MAP) {
    if (!text.endsWith(emoticon)) continue;
    const before = text.slice(0, text.length - emoticon.length);
    if (before === "" || /\s$/.test(before)) return before + emoji;
  }
  return text;
}
