import { type MatrixClient, type MatrixEvent, MsgType, type Room } from "matrix-js-sdk";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";
import { getThreadReplies } from "./threads.js";

/**
 * Discord-style forum channels: instead of one flowing timeline, each
 * top-level message is a "post" (a thread root with a title and optional
 * tags), shown as a list sorted by most recent activity. This builds
 * entirely on the thread infrastructure already in threads.ts - a post's
 * replies ARE just thread replies, reusing getThreadReplies/ThreadPanel
 * unchanged, so a forum channel is really "a room whose composer creates a
 * new thread root instead of a loose message, with a list view instead of
 * a scrolling timeline" rather than a wholly separate mechanism.
 *
 * A post is identified by carrying io.jorkonvo.forum_title in its content
 * (alongside the ordinary m.room.message fields, the same way m.mentions
 * sits alongside body) - a ROOM SET TO forum type can still receive plain
 * messages from other clients (Element has no notion of this channel type),
 * but those won't show up in the post list, only real posts created
 * through the "new post" flow will. This is a deliberate, documented
 * limitation rather than trying to treat every random top-level message as
 * a post.
 */

export const FORUM_TAGS_EVENT = "io.jorkonvo.forum_tags";
const FORUM_TITLE_FIELD = "io.jorkonvo.forum_title";
const FORUM_TAG_IDS_FIELD = "io.jorkonvo.forum_tag_ids";

export interface ForumTag {
  id: string;
  name: string;
  color: string;
}

export interface ForumPost {
  rootEvent: MatrixEvent;
  eventId: string;
  title: string;
  tagIds: string[];
  authorId: string;
  createdTs: number;
  replyCount: number;
  lastActivityTs: number;
}

export function getForumTags(room: Room): ForumTag[] {
  const content = room.currentState.getStateEvents(FORUM_TAGS_EVENT, "")?.getContent();
  const tags = content?.tags;
  if (!Array.isArray(tags)) return [];
  return tags.filter(
    (t): t is ForumTag => t && typeof t.id === "string" && typeof t.name === "string" && typeof t.color === "string",
  );
}

export function canManageForumTags(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(FORUM_TAGS_EVENT, userId);
}

type LooseSendStateEvent = (roomId: string, eventType: string, content: unknown, stateKey?: string) => Promise<unknown>;

export async function setForumTags(client: MatrixClient, roomId: string, tags: ForumTag[]): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, FORUM_TAGS_EVENT, { tags }, "");
}

function isForumPostRoot(ev: MatrixEvent): boolean {
  if (ev.isRedacted()) return false;
  if (ev.getType() !== "m.room.message") return false;
  const content = ev.getContent();
  if (content?.["m.relates_to"]) return false; // replies/edits are never posts themselves
  return typeof content?.[FORUM_TITLE_FIELD] === "string" && content[FORUM_TITLE_FIELD].length > 0;
}

/** All posts in the room, most-recently-active first (a reply bumps a post the same way it would in Discord). */
export function getForumPosts(room: Room): ForumPost[] {
  const events = room.getLiveTimeline().getEvents().filter(isForumPostRoot);
  const posts = events.map((ev): ForumPost => {
    const content = ev.getContent();
    const eventId = ev.getId() ?? "";
    const replies = getThreadReplies(room, eventId);
    const tagIds = Array.isArray(content[FORUM_TAG_IDS_FIELD])
      ? content[FORUM_TAG_IDS_FIELD].filter((t: unknown): t is string => typeof t === "string")
      : [];
    return {
      rootEvent: ev,
      eventId,
      title: content[FORUM_TITLE_FIELD] as string,
      tagIds,
      authorId: ev.getSender() ?? "",
      createdTs: ev.getTs(),
      replyCount: replies.length,
      lastActivityTs: replies.at(-1)?.getTs() ?? ev.getTs(),
    };
  });
  return posts.sort((a, b) => b.lastActivityTs - a.lastActivityTs);
}

export async function createForumPost(
  client: MatrixClient,
  roomId: string,
  title: string,
  body: string,
  tagIds: string[],
): Promise<void> {
  await client.sendMessage(roomId, {
    msgtype: MsgType.Text,
    body,
    [FORUM_TITLE_FIELD]: title,
    [FORUM_TAG_IDS_FIELD]: tagIds,
  } as RoomMessageEventContent);
}
