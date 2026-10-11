import type { MatrixClient, Room } from "matrix-js-sdk";

/**
 * Discord's per-channel content flags from a text channel's "Overview":
 * "Age-Restricted Channel" and "Spoiler Channel". Both are a single room
 * state event (empty state key) so every client sees the current value and
 * it survives reconnects for free.
 *
 * - `age_restricted`: the channel is gated behind a one-time "are you over
 *   18" confirmation, and (on Discord) exempt from the sensitive-media
 *   filter. We can't do server-side enforcement, so this is a client-side
 *   confirmation gate, remembered per device.
 * - `spoiler`: the channel carries plot spoilers / heavy topics; clients
 *   show a dismissible warning before its contents.
 */
export const CHANNEL_CONTENT_RATING_EVENT = "io.jorkonvo.channel_content_rating";

export type ChannelContentRating = "default" | "spoiler" | "age_restricted";

type LooseSendStateEvent = (roomId: string, eventType: string, content: unknown, stateKey?: string) => Promise<unknown>;

export function canSetChannelContentRating(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(CHANNEL_CONTENT_RATING_EVENT, userId);
}

export function getChannelContentRating(room: Room): ChannelContentRating {
  const rating = room.currentState
    .getStateEvents(CHANNEL_CONTENT_RATING_EVENT, "")
    ?.getContent()?.rating;
  return rating === "spoiler" || rating === "age_restricted" ? rating : "default";
}

export async function setChannelContentRating(
  client: MatrixClient,
  roomId: string,
  rating: ChannelContentRating,
): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(
    roomId,
    CHANNEL_CONTENT_RATING_EVENT,
    { rating },
    "",
  );
}
