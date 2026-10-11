import type { MatrixClient, Room } from "matrix-js-sdk";

/**
 * Discord-style per-channel slowmode: a minimum gap between messages from
 * the same (non-exempt) member. Real, unbypassable rate-limiting needs a
 * server or appservice component this app doesn't have - a modified or
 * different client could just ignore the client-side wait. This is
 * therefore honestly a COURTESY limit, not enforcement: the configured
 * interval lives in ordinary room state (so every client can at least see
 * and honor it if it chooses to), and MessageComposer.tsx is the piece that
 * actually withholds sends and shows the countdown, purely on the sending
 * device's own clock.
 */

export const SLOWMODE_EVENT = "io.jorkonvo.slowmode";

/** Discord-like preset choices, in seconds (0 = off). */
export const SLOWMODE_PRESETS: { seconds: number; labelKey: string }[] = [
  { seconds: 0, labelKey: "slowmode.off" },
  { seconds: 5, labelKey: "slowmode.s5" },
  { seconds: 10, labelKey: "slowmode.s10" },
  { seconds: 30, labelKey: "slowmode.s30" },
  { seconds: 60, labelKey: "slowmode.m1" },
  { seconds: 300, labelKey: "slowmode.m5" },
  { seconds: 900, labelKey: "slowmode.m15" },
  { seconds: 3600, labelKey: "slowmode.h1" },
];

export function getSlowmodeSeconds(room: Room): number {
  const seconds = room.currentState.getStateEvents(SLOWMODE_EVENT, "")?.getContent()?.seconds;
  return typeof seconds === "number" && seconds > 0 ? seconds : 0;
}

/** Same threshold as configuring the slowmode itself - whoever can turn it on/off isn't subject to it either, matching Discord's mods-are-exempt behavior. */
export function isSlowmodeExempt(room: Room, userId: string): boolean {
  return canSetSlowmode(room, userId);
}

export function canSetSlowmode(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(SLOWMODE_EVENT, userId);
}

type LooseSendStateEvent = (roomId: string, eventType: string, content: unknown, stateKey?: string) => Promise<unknown>;

export async function setSlowmodeSeconds(client: MatrixClient, roomId: string, seconds: number): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, SLOWMODE_EVENT, { seconds }, "");
}
