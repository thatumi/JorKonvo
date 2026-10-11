import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";

/**
 * Discord-style "watch together": one room-wide shared YouTube session,
 * modelled as a single state event (same pattern as categories.ts/roles.ts)
 * rather than per-message events, since there's only ever one active session
 * per room and every client just needs "what's the current truth" on join.
 *
 * The host's play/pause/seek actions overwrite this event; every other
 * client's player syncs to match on each update, plus a periodic drift
 * correction while playing (state events carry no built-in "this instant"
 * guarantee once network latency is added, so `updatedAt` + elapsed time is
 * how followers extrapolate the host's actual current position between
 * updates instead of only snapping on each write).
 */
export const WATCH_TOGETHER_EVENT = "io.jorkonvo.watch_together";

/**
 * The live session above is a single room-wide state event with no history -
 * it tells anyone CURRENTLY in the room what's playing, but leaves no trace
 * for someone who dismissed the bar (or wasn't looking at this room yet) to
 * find their way back in. This invite is a normal timeline message sent
 * alongside starting a session, the same "visible, clickable, permanent"
 * pattern as calendar events - so a dismissed or missed watch party is
 * always one click away in scrollback, not gone until someone re-shares the
 * link in plain text.
 */
export const WATCH_TOGETHER_INVITE_TYPE = "io.jorkonvo.watch_together.invite";

export interface WatchTogetherInvite {
  eventId: string;
  videoId: string;
  hostUserId: string;
}

export function isWatchTogetherInviteEvent(ev: MatrixEvent): boolean {
  return ev.getType() === WATCH_TOGETHER_INVITE_TYPE;
}

export function parseWatchTogetherInvite(ev: MatrixEvent): WatchTogetherInvite | null {
  const eventId = ev.getId();
  const content = ev.getContent() as { videoId?: string; hostUserId?: string };
  if (!eventId || !content.videoId || !content.hostUserId) return null;
  return { eventId, videoId: content.videoId, hostUserId: content.hostUserId };
}

export interface WatchTogetherSession {
  videoId: string;
  hostUserId: string;
  playing: boolean;
  positionSeconds: number;
  /** Epoch ms when playing/positionSeconds were last set - lets followers extrapolate elapsed playback time between updates. */
  updatedAt: number;
}

interface WatchTogetherContent {
  videoId?: string;
  hostUserId?: string;
  playing?: boolean;
  positionSeconds?: number;
  updatedAt?: number;
}

type LooseSendStateEvent = (
  roomId: string,
  eventType: string,
  content: unknown,
  stateKey?: string,
) => Promise<unknown>;
type LooseSendEvent = (roomId: string, eventType: string, content: unknown) => Promise<unknown>;

function getContent(room: Room): WatchTogetherContent {
  return (room.currentState.getStateEvents(WATCH_TOGETHER_EVENT, "")?.getContent() as
    | WatchTogetherContent
    | undefined) ?? {};
}

export function getWatchTogetherSession(room: Room): WatchTogetherSession | null {
  const c = getContent(room);
  if (!c.videoId || !c.hostUserId) return null;
  return {
    videoId: c.videoId,
    hostUserId: c.hostUserId,
    playing: c.playing ?? false,
    positionSeconds: c.positionSeconds ?? 0,
    updatedAt: c.updatedAt ?? Date.now(),
  };
}

/** Whoever started the session controls it; anyone who could write this event at all may also start a fresh one or take over an abandoned session. */
export function canControlWatchTogether(room: Room, userId: string): boolean {
  const session = getWatchTogetherSession(room);
  if (session && session.hostUserId === userId) return true;
  return room.currentState.maySendStateEvent(WATCH_TOGETHER_EVENT, userId);
}

async function writeSession(client: MatrixClient, roomId: string, content: WatchTogetherContent): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, WATCH_TOGETHER_EVENT, content, "");
}

export async function startWatchTogether(client: MatrixClient, roomId: string, videoId: string): Promise<void> {
  const hostUserId = client.getUserId() ?? "";
  await writeSession(client, roomId, {
    videoId,
    hostUserId,
    playing: true,
    positionSeconds: 0,
    updatedAt: Date.now(),
  });
  try {
    await (client.sendEvent as unknown as LooseSendEvent)(roomId, WATCH_TOGETHER_INVITE_TYPE, {
      body: `🎬 Elindított egy közös YouTube-nézést: https://youtu.be/${videoId}`,
      videoId,
      hostUserId,
    });
  } catch {
    // Best-effort - the session itself (the state event above) already
    // started successfully even if this announcement message fails to send.
  }
}

/** The host reports a play/pause/seek so followers can resync. No-ops if there's no active session (e.g. it was just stopped from another tab). */
export async function reportWatchTogetherPlayback(
  client: MatrixClient,
  roomId: string,
  playing: boolean,
  positionSeconds: number,
): Promise<void> {
  const room = client.getRoom(roomId);
  const session = room ? getWatchTogetherSession(room) : null;
  if (!session) return;
  await writeSession(client, roomId, { ...session, playing, positionSeconds, updatedAt: Date.now() });
}

export async function stopWatchTogether(client: MatrixClient, roomId: string): Promise<void> {
  await writeSession(client, roomId, {});
}
