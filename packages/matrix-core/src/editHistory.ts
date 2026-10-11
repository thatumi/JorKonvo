import { type MatrixClient, type MatrixEvent, RelationType } from "matrix-js-sdk";

/**
 * Full edit history for a message - unlike reactions/threads elsewhere in
 * this package (which scan the LOCAL live timeline, deliberately, because
 * local echoes need to work the same as synced events), this calls the
 * server's own relations endpoint directly. An edit's relation can point at
 * an original event from long before the client's current timeline window
 * (a week-old message edited just now, say), which a local-only scan would
 * never see - the server is the only place guaranteed to have the whole
 * history.
 */

export interface MessageEditVersion {
  eventId: string;
  body: string;
  ts: number;
  senderId: string;
  /** True for the original, pre-edit version. */
  isOriginal: boolean;
}

/**
 * Takes the original MatrixEvent (MessageLine already has it) rather than a
 * plain eventId - matrix-js-sdk transparently substitutes an edited
 * event's OWN getContent() with its latest edit's content, so the true
 * pre-edit text has to come from getOriginalContent() specifically, not
 * getContent(). Only the edit events themselves need a server round-trip.
 */
export async function getEditHistory(client: MatrixClient, roomId: string, original: MatrixEvent): Promise<MessageEditVersion[]> {
  const eventId = original.getId() ?? "";
  const res = await client.relations(roomId, eventId, RelationType.Replace, "m.room.message");
  const edits: MessageEditVersion[] = res.events.map((ev) => {
    const content = ev.getContent();
    const newContent = content?.["m.new_content"] as { body?: string } | undefined;
    return {
      eventId: ev.getId() ?? "",
      body: newContent?.body ?? (content?.body as string) ?? "",
      ts: ev.getTs(),
      senderId: ev.getSender() ?? "",
      isOriginal: false,
    };
  });
  edits.sort((a, b) => a.ts - b.ts);
  const originalContent = original.getOriginalContent();
  return [
    {
      eventId,
      body: (originalContent?.body as string) ?? "",
      ts: original.getTs(),
      senderId: original.getSender() ?? "",
      isOriginal: true,
    },
    ...edits,
  ];
}
