import { EventType, type MatrixClient, type Room } from "matrix-js-sdk";

/**
 * `m.room.history_visibility` - who can read messages sent BEFORE they joined
 * (or, for world_readable, without joining at all). A native, spec-stable
 * Matrix room primitive with no exact Discord analog; the closest framing is
 * "can new members scroll up past the point they joined". Thin typed wrapper
 * around the state event, same shape as joinRules.ts.
 */

export type HistoryVisibilityValue = "world_readable" | "shared" | "invited" | "joined";

export interface HistoryVisibilityOption {
  value: HistoryVisibilityValue;
  labelKey: string;
  hintKey: string;
}

export const HISTORY_VISIBILITY_OPTIONS: HistoryVisibilityOption[] = [
  {
    value: "shared",
    labelKey: "historyVis.sharedLabel",
    hintKey: "historyVis.sharedHint",
  },
  {
    value: "invited",
    labelKey: "historyVis.invitedLabel",
    hintKey: "historyVis.invitedHint",
  },
  {
    value: "joined",
    labelKey: "historyVis.joinedLabel",
    hintKey: "historyVis.joinedHint",
  },
  {
    value: "world_readable",
    labelKey: "historyVis.worldLabel",
    hintKey: "historyVis.worldHint",
  },
];

export function getHistoryVisibility(room: Room): HistoryVisibilityValue {
  const content = room.currentState
    .getStateEvents(EventType.RoomHistoryVisibility, "")
    ?.getContent() as { history_visibility?: string } | undefined;
  const value = content?.history_visibility;
  if (value === "world_readable" || value === "invited" || value === "joined") return value;
  return "shared";
}

export function canSetHistoryVisibility(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(EventType.RoomHistoryVisibility, userId);
}

export async function setHistoryVisibility(
  client: MatrixClient,
  roomId: string,
  value: HistoryVisibilityValue,
): Promise<void> {
  await (
    client.sendStateEvent as unknown as (
      roomId: string,
      eventType: string,
      content: unknown,
      stateKey?: string,
    ) => Promise<unknown>
  )(roomId, EventType.RoomHistoryVisibility, { history_visibility: value }, "");
}
