import { type MatrixClient, type MatrixEvent, MatrixEventEvent, type Room, RoomEvent } from "matrix-js-sdk";
import { redactEvent } from "./messages.js";
import { canRedactOthers } from "./moderation.js";

/**
 * Discord-style AutoMod (keyword filtering), scoped honestly to what a pure
 * Matrix client can actually deliver: there's no server/appservice
 * component here, so enforcement only happens on whichever moderator's
 * client is currently open and running - if no permitted member is online,
 * a matching message simply isn't caught until one is. The config itself
 * (io.jorkonvo.automod room state) is visible to any client regardless, so
 * this degrades gracefully rather than silently doing nothing - it's a
 * real, working feature, just not a guarantee, the same honesty already
 * applied to slowmode.ts.
 */

export const AUTOMOD_EVENT = "io.jorkonvo.automod";

/**
 * `keywords` (plain substring, the original mechanism) stays exactly as it
 * was for backward compatibility with any room that already has one
 * configured - `patterns` is a purely additive extension for the two
 * stricter match kinds Discord's own AutoMod also offers: `wildcard`
 * (`*`/`?`, SQL-LIKE, same convention as policyLists.ts's entity matching)
 * for "starts with"/"ends with"-shaped rules without full regex, and
 * `regex` for anything more precise. Link filtering is a separate concern
 * (checks message URLs against an allowlist of domains, not keywords at
 * all) so it gets its own fields rather than being shoehorned into the
 * pattern list.
 */
export interface AutoModPattern {
  value: string;
  kind: "wildcard" | "regex";
}

export interface AutoModConfig {
  enabled: boolean;
  keywords: string[];
  patterns: AutoModPattern[];
  linkFilterEnabled: boolean;
  /** Domains messages are allowed to link to when linkFilterEnabled - a link to anything else gets caught. Subdomains of an allowed domain are allowed too. */
  allowedDomains: string[];
}

const EMPTY_CONFIG: AutoModConfig = { enabled: false, keywords: [], patterns: [], linkFilterEnabled: false, allowedDomains: [] };

export function getAutoModConfig(room: Room): AutoModConfig {
  const content = room.currentState.getStateEvents(AUTOMOD_EVENT, "")?.getContent();
  if (!content) return EMPTY_CONFIG;
  const keywords = Array.isArray(content.keywords) ? content.keywords.filter((k): k is string => typeof k === "string") : [];
  const patterns = Array.isArray(content.patterns)
    ? content.patterns.filter(
        (p): p is AutoModPattern =>
          p && typeof p.value === "string" && (p.kind === "wildcard" || p.kind === "regex"),
      )
    : [];
  const allowedDomains = Array.isArray(content.allowedDomains)
    ? content.allowedDomains.filter((d): d is string => typeof d === "string")
    : [];
  return { enabled: Boolean(content.enabled), keywords, patterns, linkFilterEnabled: Boolean(content.linkFilterEnabled), allowedDomains };
}

export function canConfigureAutoMod(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(AUTOMOD_EVENT, userId);
}

type LooseSendStateEvent = (roomId: string, eventType: string, content: unknown, stateKey?: string) => Promise<unknown>;

export async function setAutoModConfig(client: MatrixClient, roomId: string, config: AutoModConfig): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, AUTOMOD_EVENT, config, "");
}

/**
 * Plain case-insensitive substring match, deliberately NOT the word-boundary
 * matching unread.ts uses for notification keywords - a spam/slur filter
 * needs to catch a banned term embedded in a longer word too (e.g. inside
 * l33tspeak padding or attached punctuation), where a mention keyword
 * wants the opposite (no false positives on partial words).
 */
export function findAutoModMatch(body: string, keywords: string[]): string | null {
  const lower = body.toLowerCase();
  return keywords.find((k) => k.trim() && lower.includes(k.trim().toLowerCase())) ?? null;
}

// This runs against every message in every AutoMod room this account can
// moderate, so a pattern that backtracks catastrophically would freeze the
// moderator's client - a rogue co-moderator (only PL50+ can set the config)
// shouldn't be able to do that. Only nested-quantifier shapes actually cause
// exponential blowup; reject the obvious ones outright.
const NESTED_QUANTIFIER = /(\([^)]*[+*][^)]*\)|\[[^\]]*\][^\s]*)[+*]/;
/** Longer bodies are truncated before regex/wildcard matching - a banned term near the top is what matters, and it bounds the worst case. */
const MAX_MATCH_BODY = 4096;

/** `*`/`?` SQL-LIKE wildcard, same convention as policyLists.ts's matchesPolicyEntity - tested against the WHOLE message body, not a substring search, so a rule like `*http*` behaves like a substring match while `spam*` anchors to the start. */
function wildcardMatches(pattern: string, body: string): boolean {
  const regexSource = pattern
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  try {
    return new RegExp(`^${regexSource}$`, "s").test(body.toLowerCase().slice(0, MAX_MATCH_BODY));
  } catch {
    return false;
  }
}

/**
 * A user-supplied regex - genuinely arbitrary, so wrapped in try/catch (an
 * invalid pattern must never crash the watcher, just never match), length-
 * capped, nested-quantifier-rejected, and run against a bounded slice of the
 * body.
 */
function regexMatches(pattern: string, body: string): boolean {
  if (pattern.length > 200 || NESTED_QUANTIFIER.test(pattern)) return false;
  try {
    return new RegExp(pattern, "i").test(body.slice(0, MAX_MATCH_BODY));
  } catch {
    return false;
  }
}

/** Checks keywords first (existing, cheapest), then the wildcard/regex patterns - returns a human-readable description of what matched, for the redaction reason. */
export function findAutoModPatternMatch(body: string, patterns: AutoModPattern[]): string | null {
  for (const p of patterns) {
    if (!p.value.trim()) continue;
    const matched = p.kind === "wildcard" ? wildcardMatches(p.value, body) : regexMatches(p.value, body);
    if (matched) return p.value;
  }
  return null;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/** First disallowed link in a message, or null if every link (if any) resolves to an allowed domain or its subdomains. */
export function findDisallowedLink(body: string, allowedDomains: string[]): string | null {
  const urls = body.match(URL_RE);
  if (!urls) return null;
  const allowed = allowedDomains.map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return urls[0] ?? null; // linkFilterEnabled with an empty allowlist means "no links at all"
  for (const url of urls) {
    let hostname: string;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return url; // unparseable "URL" is suspicious enough to catch
    }
    const isAllowed = allowed.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    if (!isAllowed) return url;
  }
  return null;
}

export interface AutoModWiring {
  /** Called after a message is auto-redacted, so the UI can note it happened. */
  onAutoRedact?: (roomId: string, eventId: string, keyword: string) => void;
}

/**
 * Watches every room this account can moderate for AutoMod-enabled rooms,
 * auto-redacting new messages that match a configured keyword. Mirrors the
 * unread-counter/notification-manager pattern for E2EE background
 * decryption (a freshly-arrived encrypted message decrypts without a
 * second RoomEvent.Timeline emission, so MatrixEventEvent.Decrypted is
 * watched too) and for de-duplication (an event seen live and later
 * decrypted must only be checked once).
 */
export function watchAutoMod(client: MatrixClient, wiring: AutoModWiring = {}): () => void {
  const checked = new Set<string>();
  const markChecked = (id: string) => {
    checked.add(id);
    if (checked.size > 500) {
      const oldest = checked.values().next().value;
      if (oldest) checked.delete(oldest);
    }
  };
  const liveCandidates = new Set<string>();

  function maybeRedact(event: MatrixEvent, room: Room) {
    if (event.getType() !== "m.room.message") return;
    if (event.getSender() === client.getUserId()) return;
    const id = event.getId();
    if (id === undefined || checked.has(id)) return;
    markChecked(id);

    const config = getAutoModConfig(room);
    if (!config.enabled) return;
    if (!canRedactOthers(room, client.getUserId() ?? "")) return;

    const body = typeof event.getContent().body === "string" ? (event.getContent().body as string) : "";
    if (!body) return;

    const keywordMatch = config.keywords.length > 0 ? findAutoModMatch(body, config.keywords) : null;
    const patternMatch = !keywordMatch && config.patterns.length > 0 ? findAutoModPatternMatch(body, config.patterns) : null;
    const linkMatch = !keywordMatch && !patternMatch && config.linkFilterEnabled ? findDisallowedLink(body, config.allowedDomains) : null;
    const match = keywordMatch ?? patternMatch;
    const reason = match
      ? `AutoMod: tiltott kulcsszó ("${match}")`
      : linkMatch
        ? `AutoMod: nem engedélyezett link ("${linkMatch}")`
        : null;
    if (!reason) return;

    void redactEvent(client, room.roomId, id, reason)
      .then(() => wiring.onAutoRedact?.(room.roomId, id, match ?? linkMatch ?? ""))
      .catch(() => undefined);
  }

  function onTimeline(
    event: MatrixEvent,
    room: Room | undefined,
    toStartOfTimeline: boolean | undefined,
    removed: boolean,
    data: { liveEvent?: boolean },
  ) {
    if (!data?.liveEvent || toStartOfTimeline || removed || !room) return;
    if (event.getType() === "m.room.encrypted") {
      const id = event.getId();
      if (id !== undefined) liveCandidates.add(id);
      return;
    }
    maybeRedact(event, room);
  }

  function onDecrypted(event: MatrixEvent) {
    const id = event.getId();
    if (id === undefined || !liveCandidates.has(id)) return;
    liveCandidates.delete(id);
    const room = client.getRoom(event.getRoomId() ?? "");
    if (room) maybeRedact(event, room);
  }

  client.on(RoomEvent.Timeline, onTimeline);
  client.on(MatrixEventEvent.Decrypted, onDecrypted);
  return () => {
    client.removeListener(RoomEvent.Timeline, onTimeline);
    client.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
  };
}
