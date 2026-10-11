import type { ISearchResults, MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";
import { getSortedJoinedRooms, isSpaceRoom } from "./rooms.js";

export interface SearchHit {
  event: MatrixEvent;
  rank: number;
  roomId: string;
}

export interface SearchResultPage {
  hits: SearchHit[];
  /** Estimated total number of matches, if the server reported one. */
  count: number;
  /** Pass this back to `searchMore` to load the next page; null when there are none. */
  raw: ISearchResults | null;
}

function toPage(results: ISearchResults, fallbackRoomId = ""): SearchResultPage {
  const hits = results.results.map((r) => {
    const event = r.context.getEvent();
    return { event, rank: r.rank, roomId: event.getRoomId() ?? fallbackRoomId };
  });
  return {
    hits,
    count: results.count ?? hits.length,
    raw: results.next_batch ? results : null,
  };
}

/**
 * Full-text search of messages within a single room via the homeserver's
 * `/search` endpoint (mandatory core API, unlike some optional MSCs).
 * Server results are paged - `raw` is non-null while more pages exist; feed
 * it to `searchMore`.
 */
export async function searchRoomMessages(
  client: MatrixClient,
  roomId: string,
  term: string,
): Promise<SearchResultPage> {
  const trimmed = term.trim();
  if (!trimmed) return { hits: [], count: 0, raw: null };
  const results = await client.searchRoomEvents({ term: trimmed, filter: { rooms: [roomId] } });
  return toPage(results, roomId);
}

/**
 * Same endpoint, but without a room filter - searches every room the
 * homeserver will let this account search (in practice: every joined,
 * unencrypted room).
 */
export async function searchAllRoomMessages(
  client: MatrixClient,
  term: string,
): Promise<SearchResultPage> {
  const trimmed = term.trim();
  if (!trimmed) return { hits: [], count: 0, raw: null };
  const results = await client.searchRoomEvents({ term: trimmed });
  return toPage(results);
}

/**
 * Load the next page of a server search. `backPaginateRoomEventsSearch`
 * mutates the passed object, growing its `results` array, so the returned
 * page's `hits` is the FULL list so far (older matches appended) - the UI
 * can just replace what it's showing.
 */
export async function searchMore(
  client: MatrixClient,
  previous: ISearchResults,
): Promise<SearchResultPage> {
  const results = await client.backPaginateRoomEventsSearch(previous);
  return toPage(results);
}

/**
 * The homeserver's `/search` indexes only what it can read - in an
 * end-to-end encrypted room it only ever sees ciphertext, so
 * `searchRoomMessages` always comes back empty there (confirmed live: no
 * error, just zero results). This scans the events already decrypted and
 * held in memory (the loaded portion of the room's live timeline) as a
 * best-effort fallback - not full history, but the only text search
 * possible at all in an encrypted room without a local search index.
 */
export function searchLoadedRoomMessages(room: Room, term: string): SearchHit[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];

  const hits: SearchHit[] = [];
  for (const ev of room.getLiveTimeline().getEvents()) {
    if (ev.getType() !== "m.room.message" || ev.isRedacted()) continue;
    const body = ev.getContent().body;
    if (typeof body === "string" && body.toLowerCase().includes(needle)) {
      hits.push({ event: ev, rank: 1, roomId: room.roomId });
    }
  }
  return hits.reverse();
}

/** searchLoadedRoomMessages, across every joined room. */
export function searchAllLoadedRoomMessages(client: MatrixClient, term: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const room of getSortedJoinedRooms(client)) {
    if (isSpaceRoom(room)) continue;
    hits.push(...searchLoadedRoomMessages(room, term));
  }
  return hits;
}
