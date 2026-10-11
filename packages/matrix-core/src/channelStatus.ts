import type { MatrixClient, Room } from "matrix-js-sdk";

/**
 * Discord-style channel status - a short free-text line shown next to a
 * channel's name, set by anyone who can post there. A plain room state
 * event (single instance per room, empty state key) so every client always
 * sees the latest one and it survives reloads/reconnects for free.
 */
const CHANNEL_STATUS_EVENT = "io.jorkonvo.channel_status";

export interface ChannelStatus {
  text: string;
  setBy: string;
  /** ms epoch, or null for "no expiry - stays until someone changes/clears it". */
  expiresAt: number | null;
}

export const CHANNEL_STATUS_DURATION_PRESETS: { labelKey: string; ms: number | null }[] = [
  { labelKey: "channelStatus.duration30m", ms: 30 * 60 * 1000 },
  { labelKey: "channelStatus.duration1h", ms: 60 * 60 * 1000 },
  { labelKey: "channelStatus.duration4h", ms: 4 * 60 * 60 * 1000 },
  { labelKey: "channelStatus.duration24h", ms: 24 * 60 * 60 * 1000 },
  { labelKey: "channelStatus.durationUntilCleared", ms: null },
];

export const CHANNEL_STATUS_MAX_LENGTH = 128;

type LooseSendStateEvent = (roomId: string, eventType: string, content: unknown, stateKey?: string) => Promise<unknown>;

export function canSetChannelStatus(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(CHANNEL_STATUS_EVENT, userId);
}

/** Null once past its own `expiresAt`, even though the state event itself is still sitting there unchanged - nothing proactively deletes it. */
export function getChannelStatus(room: Room): ChannelStatus | null {
  const content = room.currentState.getStateEvents(CHANNEL_STATUS_EVENT, "")?.getContent() as Partial<ChannelStatus> | undefined;
  if (!content?.text || !content.setBy) return null;
  if (typeof content.expiresAt === "number" && content.expiresAt <= Date.now()) return null;
  return { text: content.text, setBy: content.setBy, expiresAt: content.expiresAt ?? null };
}

export async function setChannelStatus(
  client: MatrixClient,
  roomId: string,
  text: string,
  durationMs: number | null,
): Promise<void> {
  const trimmed = text.trim().slice(0, CHANNEL_STATUS_MAX_LENGTH);
  const userId = client.getUserId();
  if (!trimmed || !userId) return;
  const status: ChannelStatus = { text: trimmed, setBy: userId, expiresAt: durationMs === null ? null : Date.now() + durationMs };
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, CHANNEL_STATUS_EVENT, status, "");
}

export async function clearChannelStatus(client: MatrixClient, roomId: string): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, CHANNEL_STATUS_EVENT, {}, "");
}
