import type { MatrixEvent } from "matrix-js-sdk";

/**
 * Discord-style search operators the UI parses out of the query box before
 * searching:
 *   from:@user:server  /  from:name   - only that sender
 *   has:link / has:image / has:file   - media/kind filters
 *   in:#room                          - everywhere-scope filter to one room
 *   before:2026-01-31 after:2026-01-01 during:2026-05-04
 *
 * The remaining free text is what actually goes to the server / local scan;
 * the operators are applied afterwards as client-side filters on the hits
 * (the homeserver's search API has no equivalent for most of them).
 */

export interface ParsedQuery {
  term: string;
  from: string | null;
  hasLink: boolean;
  hasImage: boolean;
  hasFile: boolean;
  /** room-name fragment for the everywhere-scope `in:#room` filter */
  inRoomName: string | null;
  beforeTs: number | null;
  afterTs: number | null;
  duringDay: string | null;
}

const OPERATOR = /(\w+):("[^"]*"|\S+)/gi;

function dayStartEnd(day: string): [number, number] {
  const start = new Date(`${day}T00:00:00`).getTime();
  if (Number.isNaN(start)) return [0, 0];
  return [start, start + 24 * 60 * 60 * 1000];
}

export function parseSearchQuery(rawQuery: string): ParsedQuery {
  const out: ParsedQuery = {
    term: "",
    from: null,
    hasLink: false,
    hasImage: false,
    hasFile: false,
    inRoomName: null,
    beforeTs: null,
    afterTs: null,
    duringDay: null,
  };
  const consumed: [number, number][] = [];
  let match: RegExpExecArray | null;
  OPERATOR.lastIndex = 0;
  while ((match = OPERATOR.exec(rawQuery)) !== null) {
    const [, key, rawValue] = match;
    const value = rawValue!.replace(/^"|"$/g, "");
    switch (key!.toLowerCase()) {
      case "from":
        out.from = value.replace(/^@/, "").toLowerCase();
        break;
      case "has": {
        const kind = value.toLowerCase();
        if (kind === "link") out.hasLink = true;
        else if (kind === "image" || kind === "images" || kind === "img") out.hasImage = true;
        else if (kind === "file" || kind === "files") out.hasFile = true;
        else continue; // unknown has: value → keep it as free text
        break;
      }
      case "in":
        out.inRoomName = value.replace(/^#/, "").toLowerCase();
        break;
      case "before":
        out.beforeTs = dayStartEnd(value)[1];
        break;
      case "after":
        out.afterTs = dayStartEnd(value)[0];
        break;
      case "during":
        out.duringDay = value;
        break;
      default:
        continue; // unknown operator → free text
    }
    consumed.push([match.index!, match.index! + match[0]!.length]);
  }

  let rest = rawQuery;
  for (let i = consumed.length - 1; i >= 0; i--) {
    const [start, end] = consumed[i]!;
    rest = rest.slice(0, start) + " " + rest.slice(end);
  }
  out.term = rest.trim().replace(/\s+/g, " ");
  return out;
}

const LINK_RE = /https?:\/\/\S+/i;

/**
 * Client-side post-filter applying the parsed operators to one hit.
 * `senderName` is the room-local display name for `from:` matching.
 */
export function hitMatchesQuery(ev: MatrixEvent, q: ParsedQuery, senderName: string | null): boolean {
  const content = ev.getContent();
  const body = typeof content.body === "string" ? content.body : "";
  const msgtype = content.msgtype as string | undefined;

  if (q.from) {
    const sender = (ev.getSender() ?? "").toLowerCase();
    const name = (senderName ?? "").toLowerCase();
    if (!sender.includes(q.from) && !name.includes(q.from)) return false;
  }
  if (q.hasImage && msgtype !== "m.image") return false;
  if (q.hasFile && !(msgtype === "m.file" || msgtype === "m.audio" || msgtype === "m.video")) return false;
  if (q.hasLink && !LINK_RE.test(body)) return false;
  if (q.beforeTs !== null && ev.getTs() >= q.beforeTs) return false;
  if (q.afterTs !== null && ev.getTs() < q.afterTs) return false;
  if (q.duringDay) {
    const [start, end] = dayStartEnd(q.duringDay);
    if (ev.getTs() < start || ev.getTs() >= end) return false;
  }
  return true;
}
