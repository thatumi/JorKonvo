import { EventType, type MatrixClient, type MatrixEvent, MsgType, RelationType, type Room } from "matrix-js-sdk";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";
import { buildFormattedContent, type CustomEmojiEntry, escapeHtml, type MentionEntry, type RoleMentionEntry } from "./formatting.js";

export async function retryMessage(client: MatrixClient, room: Room, ev: MatrixEvent): Promise<void> {
  await client.resendEvent(ev, room);
}

export function cancelFailedMessage(client: MatrixClient, ev: MatrixEvent): void {
  client.cancelPendingEvent(ev);
}

/**
 * Forwards a message (text or media) into another room as a new,
 * standalone message. For an encrypted attachment, the file's AES
 * key/iv/hashes travel inside the message content itself (not derived
 * from the source room's megolm session), so copying the whole content
 * into a new sendMessage call works even across rooms with different
 * encryption - the blob stays on the same mxc:// URL, only the message
 * content gets freshly encrypted for the target room.
 */
export async function forwardMessage(
  client: MatrixClient,
  targetRoomId: string,
  sourceEvent: MatrixEvent,
): Promise<void> {
  const content = { ...sourceEvent.getContent() };
  delete content["m.relates_to"];
  delete content["m.new_content"];
  await client.sendMessage(targetRoomId, content as RoomMessageEventContent);
}

export async function sendTextMessage(
  client: MatrixClient,
  roomId: string,
  body: string,
  mentions: MentionEntry[] = [],
  hereMentionUserIds: string[] = [],
  roleMentions: RoleMentionEntry[] = [],
  customEmoji: CustomEmojiEntry[] = [],
): Promise<void> {
  const formatted = buildFormattedContent(body, mentions, hereMentionUserIds, roleMentions, customEmoji);
  await client.sendMessage(roomId, {
    msgtype: MsgType.Text,
    ...formatted,
  });
}

export async function sendReply(
  client: MatrixClient,
  roomId: string,
  body: string,
  replyToEventId: string,
  replyToSender: string,
  replyToBody: string,
  mentions: MentionEntry[] = [],
  hereMentionUserIds: string[] = [],
  roleMentions: RoleMentionEntry[] = [],
  customEmoji: CustomEmojiEntry[] = [],
): Promise<void> {
  const quoted = replyToBody
    .split("\n")
    .map((line, i) => (i === 0 ? `> <${replyToSender}> ${line}` : `> ${line}`))
    .join("\n");

  const formatted = buildFormattedContent(body, mentions, hereMentionUserIds, roleMentions, customEmoji);
  const content: Record<string, unknown> = {
    msgtype: MsgType.Text,
    body: `${quoted}\n\n${formatted.body}`,
    "m.relates_to": {
      "m.in_reply_to": { event_id: replyToEventId },
    },
  };
  if (formatted.formatted_body) {
    content.formatted_body = `<mx-reply><blockquote>${escapeHtml(quoted)}</blockquote></mx-reply>${formatted.formatted_body}`;
    content.format = formatted.format;
  }
  if (formatted["m.mentions"]) content["m.mentions"] = formatted["m.mentions"];

  await client.sendMessage(roomId, content as unknown as RoomMessageEventContent);
}

export async function editMessage(
  client: MatrixClient,
  roomId: string,
  eventId: string,
  newBody: string,
  mentions: MentionEntry[] = [],
  hereMentionUserIds: string[] = [],
  roleMentions: RoleMentionEntry[] = [],
  customEmoji: CustomEmojiEntry[] = [],
): Promise<void> {
  const formatted = buildFormattedContent(newBody, mentions, hereMentionUserIds, roleMentions, customEmoji);
  const newContent: Record<string, unknown> = { msgtype: MsgType.Text, body: formatted.body };
  if (formatted.formatted_body) {
    newContent.formatted_body = formatted.formatted_body;
    newContent.format = formatted.format;
  }
  if (formatted["m.mentions"]) newContent["m.mentions"] = formatted["m.mentions"];

  const legacyContent: Record<string, unknown> = {
    msgtype: MsgType.Text,
    body: `* ${formatted.body}`,
    "m.new_content": newContent,
    "m.relates_to": {
      rel_type: RelationType.Replace,
      event_id: eventId,
    },
  };
  if (formatted.formatted_body) {
    legacyContent.formatted_body = `* ${formatted.formatted_body}`;
    legacyContent.format = formatted.format;
  }

  await client.sendMessage(roomId, legacyContent as unknown as RoomMessageEventContent);
}

export async function redactEvent(
  client: MatrixClient,
  roomId: string,
  eventId: string,
  reason?: string,
): Promise<void> {
  await client.redactEvent(roomId, eventId, undefined, reason ? { reason } : undefined);
}

export async function sendReaction(
  client: MatrixClient,
  roomId: string,
  eventId: string,
  key: string,
): Promise<void> {
  await client.sendEvent(roomId, EventType.Reaction, {
    "m.relates_to": {
      rel_type: RelationType.Annotation,
      event_id: eventId,
      key,
    },
  });
}

export async function toggleReaction(
  client: MatrixClient,
  roomId: string,
  eventId: string,
  key: string,
  existing: ReactionSummary | undefined,
): Promise<void> {
  if (existing?.reactedByMe && existing.ownReactionEventId) {
    await redactEvent(client, roomId, existing.ownReactionEventId);
  } else {
    await sendReaction(client, roomId, eventId, key);
  }
}

/**
 * Strips the legacy plain-text reply fallback (lines starting with "> ",
 * mandated by the spec for clients that don't render m.in_reply_to
 * natively) from a message body, since we render our own reply preview.
 */
export function stripReplyFallback(body: string): string {
  return body.replace(/^(> [^\n]*\n)+\n?/, "");
}

export function getTimelineEvents(room: Room) {
  return room
    .getLiveTimeline()
    .getEvents()
    .filter((ev) => ev.getType() === "m.room.message" || ev.getType() === "m.room.member" || ev.getType() === "m.reaction");
}

export interface ReactionSummary {
  key: string;
  count: number;
  reactedByMe: boolean;
  /** event id of the current user's own reaction with this key, if any (for un-reacting). */
  ownReactionEventId: string | null;
}

/**
 * Aggregates m.reaction events targeting `eventId` found in the room's live
 * timeline (which includes scrolled-back history) into per-emoji summaries.
 */
export function getReactionsForEvent(
  room: Room,
  eventId: string,
  ownUserId: string | null,
): ReactionSummary[] {
  const byKey = new Map<string, ReactionSummary>();

  for (const ev of room.getLiveTimeline().getEvents()) {
    if (ev.getType() !== EventType.Reaction || ev.isRedacted()) continue;
    const relation = ev.getContent()?.["m.relates_to"];
    if (relation?.rel_type !== RelationType.Annotation || relation.event_id !== eventId) continue;

    const key = relation.key as string;
    const existing = byKey.get(key) ?? {
      key,
      count: 0,
      reactedByMe: false,
      ownReactionEventId: null,
    };
    existing.count += 1;
    if (ownUserId && ev.getSender() === ownUserId) {
      existing.reactedByMe = true;
      existing.ownReactionEventId = ev.getId() ?? null;
    }
    byKey.set(key, existing);
  }

  return [...byKey.values()];
}
