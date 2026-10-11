/**
 * Lightweight markdown + @mention formatting for outgoing messages.
 *
 * Builds a spec-compliant `formatted_body` (org.matrix.custom.html) from a
 * plain-text composer value, without pulling in a full markdown library.
 * Supports **bold**, *italic*, `code`, ~~strike~~, ||spoiler|| (spec's
 * `<span data-mx-spoiler>`), fenced ```code blocks``` and @mentions picked
 * from the autocomplete. Only applied when something actually needs
 * formatting - a plain message stays a plain `m.room.message` with no
 * `formatted_body`, matching how it behaved before this feature.
 */

export interface MentionEntry {
  displayName: string;
  userId: string;
}

/**
 * A Discord-style "@RoleName" mention - unlike a user mention (one fixed
 * userId), the set of people it notifies is resolved FRESH at send time
 * (userIds: who currently holds this role in THIS room), the same
 * "snapshot at send, not decoded later" principle @here already uses for
 * "who's online right now".
 */
export interface RoleMentionEntry {
  roleId: string;
  name: string;
  color: string;
  userIds: string[];
}

/** A known `:shortcode:` in this room's custom emoji pack (see roomEmoji.ts) - unlike mentions, no "picked from autocomplete" tracking needed, since ANY typed shortcode matching a known one is safe to substitute. */
export interface CustomEmojiEntry {
  shortcode: string;
  mxcUrl: string;
}

export interface FormattedContent {
  body: string;
  formatted_body?: string;
  format?: "org.matrix.custom.html";
  "m.mentions"?: { user_ids?: string[]; room?: boolean };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Segment {
  code: boolean;
  lang?: string;
  text: string;
}

/** Split a message into plain-text runs and fenced ```lang ... ``` blocks. */
function splitFences(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /```([A-Za-z0-9_+#-]*)[ \t]*\n?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) segments.push({ code: false, text: text.slice(last, match.index) });
    segments.push({ code: true, lang: match[1] || undefined, text: match[2] });
    last = re.lastIndex;
  }
  if (last < text.length) segments.push({ code: false, text: text.slice(last) });
  return segments;
}

interface InlineResult {
  html: string;
  changed: boolean;
  mentionedIds: Set<string>;
  mentionsRoom: boolean;
}

function formatInline(
  plain: string,
  mentions: MentionEntry[],
  hereMentionUserIds: string[] = [],
  roleMentions: RoleMentionEntry[] = [],
  customEmoji: CustomEmojiEntry[] = [],
): InlineResult {
  let html = escapeHtml(plain);
  const mentionedIds = new Set<string>();
  let mentionsRoom = false;
  let changed = false;

  // @room - the spec's mass-mention, distinct from a user mention (m.mentions.room, not user_ids).
  if (/(^|\s)@room\b/.test(html)) {
    mentionsRoom = true;
    changed = true;
    html = html.replace(/(^|\s)@room\b/g, '$1<span data-mx-pill="room">@room</span>');
  }

  // @here - JorKonvo-only convention, not a spec mass-mention: the composer
  // resolves which room members currently look online (see MessageComposer's
  // send()) and passes their ids in as hereMentionUserIds, a SNAPSHOT of "who
  // was here" at send time. Those ids land in the same m.mentions.user_ids
  // list a regular @mention would use (so server push rules still fire for
  // exactly those people), while the pill itself keeps showing "@here"
  // rather than expanding into every name.
  if (/(^|\s)@here\b/.test(html)) {
    changed = true;
    html = html.replace(/(^|\s)@here\b/g, '$1<span data-mx-pill="here">@here</span>');
    for (const id of hereMentionUserIds) mentionedIds.add(id);
  }

  // :shortcode: -> the spec's own im.ponies image-pack markup, resolved by
  // the READER's own client from the mxc:// URL - see roomEmoji.ts. Longest
  // shortcode first for the same "don't let a short match eat into a
  // longer one" reason as everything else here.
  const sortedEmoji = [...customEmoji].sort((a, b) => b.shortcode.length - a.shortcode.length);
  for (const e of sortedEmoji) {
    const pattern = new RegExp(`:${escapeRegExp(escapeHtml(e.shortcode))}:`, "g");
    if (pattern.test(html)) {
      changed = true;
      const alt = escapeHtml(`:${e.shortcode}:`);
      html = html.replace(
        pattern,
        `<img data-mx-emoticon src="${escapeHtml(e.mxcUrl)}" alt="${alt}" title="${alt}" height="24" />`,
      );
    }
  }

  // Role mentions before individual user mentions, so a role sharing a
  // prefix with someone's display name (or vice versa) resolves to the
  // role - matches this app's own autocomplete precedence (see
  // MessageComposer.tsx), and like @here/@room, the target userIds are
  // ones the CALLER already resolved fresh at send time, not looked up
  // here.
  const sortedRoles = [...roleMentions].sort((a, b) => b.name.length - a.name.length);
  for (const r of sortedRoles) {
    const escapedName = escapeHtml(r.name);
    const pattern = new RegExp(`@${escapeRegExp(escapedName)}\\b`, "g");
    if (pattern.test(html)) {
      changed = true;
      for (const uid of r.userIds) mentionedIds.add(uid);
      html = html.replace(
        pattern,
        `<span data-mx-pill="role" data-mx-color="${escapeHtml(r.color)}">@${escapedName}</span>`,
      );
    }
  }

  // Longest display name first, and matched in a SINGLE combined pass over
  // the original text: replacing one mention at a time (even sorted longest
  // first) still lets a shorter name that's a PREFIX of a longer one (e.g.
  // "Jo" vs "Jordan") match again inside the anchor tag the longer name's
  // pass just inserted - producing broken nested <a> tags and, worse,
  // silently adding the shorter name's userId to m.mentions even though
  // they were never actually @mentioned. A single alternation regex only
  // ever matches each original character span once, so once "@Jordan" is
  // consumed at a position, "@Jo" is never tried there.
  const sortedMentions = [...mentions].sort((a, b) => b.displayName.length - a.displayName.length);
  if (sortedMentions.length > 0) {
    const byMatch = new Map(sortedMentions.map((m) => [`@${escapeHtml(m.displayName)}`, m]));
    const pattern = new RegExp(sortedMentions.map((m) => `@${escapeRegExp(escapeHtml(m.displayName))}`).join("|"), "g");
    if (pattern.test(html)) {
      changed = true;
      html = html.replace(pattern, (match) => {
        const m = byMatch.get(match);
        if (!m) return match;
        mentionedIds.add(m.userId);
        return `<a href="https://matrix.to/#/${m.userId}">${match}</a>`;
      });
    }
  }

  if (/\|\|([^\n]+?)\|\|/.test(html)) {
    html = html.replace(/\|\|([^\n]+?)\|\|/g, '<span data-mx-spoiler>$1</span>');
    changed = true;
  }
  if (/`([^`\n]+)`/.test(html)) {
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    changed = true;
  }
  if (/\*\*([^\n]+?)\*\*/.test(html)) {
    html = html.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
    changed = true;
  }
  if (/(^|[^*])\*([^*\n]+)\*(?!\*)/.test(html)) {
    html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    changed = true;
  }
  if (/~~([^\n]+?)~~/.test(html)) {
    html = html.replace(/~~([^\n]+?)~~/g, "<del>$1</del>");
    changed = true;
  }

  html = html.replace(/\n/g, "<br/>");
  return { html, changed, mentionedIds, mentionsRoom };
}

export function buildFormattedContent(
  plainBody: string,
  mentions: MentionEntry[] = [],
  hereMentionUserIds: string[] = [],
  roleMentions: RoleMentionEntry[] = [],
  customEmoji: CustomEmojiEntry[] = [],
): FormattedContent {
  const segments = splitFences(plainBody);
  const hasFence = segments.some((seg) => seg.code);
  if (!hasFence) {
    const result = formatInline(plainBody, mentions, hereMentionUserIds, roleMentions, customEmoji);
    if (!result.changed) return { body: plainBody };
    return finish(plainBody, result.html, result.mentionedIds, result.mentionsRoom);
  }

  // With fences, each plain segment is formatted independently (so * etc.
  // never leak into code) and newline handling happens inside formatInline -
  // code block contents keep their real newlines.
  const htmlParts: string[] = [];
  const allMentioned = new Set<string>();
  let anyRoom = false;
  for (const seg of segments) {
    if (seg.code) {
      const safeLang = (seg.lang ?? "").replace(/[^A-Za-z0-9_+#.-]/g, "");
      const cls = safeLang ? ` class="language-${safeLang}"` : "";
      htmlParts.push(`<pre><code${cls}>${escapeHtml(seg.text.replace(/\n$/, ""))}</code></pre>`);
      continue;
    }
    const result = formatInline(seg.text, mentions, hereMentionUserIds, roleMentions, customEmoji);
    htmlParts.push(result.html);
    for (const id of result.mentionedIds) allMentioned.add(id);
    anyRoom ||= result.mentionsRoom;
  }
  return finish(plainBody, htmlParts.join(""), allMentioned, anyRoom);
}

function finish(
  plainBody: string,
  html: string,
  mentionedIds: Set<string>,
  mentionsRoom: boolean,
): FormattedContent {
  const mentionsPayload: { user_ids?: string[]; room?: boolean } = {};
  if (mentionedIds.size > 0) mentionsPayload.user_ids = [...mentionedIds];
  if (mentionsRoom) mentionsPayload.room = true;

  return {
    body: plainBody,
    formatted_body: html,
    format: "org.matrix.custom.html",
    ...(Object.keys(mentionsPayload).length > 0 ? { "m.mentions": mentionsPayload } : {}),
  };
}
