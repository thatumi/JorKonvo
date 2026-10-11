import { Direction, type MatrixClient } from "matrix-js-sdk";

/**
 * "Jump to date" (MSC3030, now a stable spec endpoint -
 * `GET /rooms/{roomId}/timestamp_to_event`) - finds the event closest to a
 * given moment in the given direction, so the UI can jump the timeline
 * straight there instead of scrolling. matrix-js-sdk's own
 * `timestampToEvent()` already handles the stable-vs-unstable endpoint
 * fallback (some homeservers still only implement the older unstable path).
 */
export async function findEventNearTimestamp(
  client: MatrixClient,
  roomId: string,
  timestampMs: number,
  direction: Direction = Direction.Forward,
): Promise<string> {
  const result = await client.timestampToEvent(roomId, timestampMs, direction);
  return result.event_id;
}
