import { CallEvent, type MatrixCall, type MatrixClient, type Room } from "matrix-js-sdk";
import { CallErrorCode, CallState, CallType } from "matrix-js-sdk/lib/webrtc/call.js";
import { CallEventHandlerEvent } from "matrix-js-sdk/lib/webrtc/callEventHandler.js";
import { CallFeedEvent, type CallFeed } from "matrix-js-sdk/lib/webrtc/callFeed.js";
import { SDPStreamMetadataPurpose } from "matrix-js-sdk/lib/webrtc/callEventTypes.js";

export { CallEvent, CallErrorCode, CallState, CallType, CallEventHandlerEvent, CallFeedEvent, SDPStreamMetadataPurpose };
export type { CallFeed, MatrixCall };

/** Places a 1:1 call in a room. The room must have exactly one other joined member. */
export function placeCall(client: MatrixClient, roomId: string, video: boolean): MatrixCall {
  const call = client.createCall(roomId);
  if (!call) {
    throw new Error("Nem sikerült létrehozni a hívást (a szoba nem alkalmas 1:1 hívásra)");
  }
  if (video) {
    void call.placeVideoCall();
  } else {
    void call.placeVoiceCall();
  }
  return call;
}

export function getOtherPartyName(room: Room, ownUserId: string | null): string {
  const other = room
    .getMembersWithMembership("join")
    .find((m) => m.userId !== ownUserId);
  return other?.name ?? "Ismeretlen";
}

export function localFeed(call: MatrixCall): CallFeed | undefined {
  return call.getLocalFeeds().find((f) => f.purpose === SDPStreamMetadataPurpose.Usermedia);
}

export function localScreenShareFeed(call: MatrixCall): CallFeed | undefined {
  return call.getLocalFeeds().find((f) => f.purpose === SDPStreamMetadataPurpose.Screenshare);
}

export function remoteFeeds(call: MatrixCall): CallFeed[] {
  return call.getRemoteFeeds();
}
