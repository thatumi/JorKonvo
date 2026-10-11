import { CallEvent, CallFeedEvent, CallState, type CallFeed, type MatrixClient, type MatrixCall } from "@jorkonvo/matrix-core";
import { create } from "zustand";
import { addCallHistoryEntry } from "../lib/callHistory";
import { playCallSound } from "../lib/callSounds";

export type CallDirection = "incoming" | "outgoing" | null;

interface CallStoreState {
  call: MatrixCall | null;
  direction: CallDirection;
  /** Bumped on any call event, to force components reading live call.* state to re-render. */
  tick: number;
  setCall: (call: MatrixCall | null, direction: CallDirection) => void;
  bump: () => void;
}

export const useCallStore = create<CallStoreState>((set) => ({
  call: null,
  direction: null,
  tick: 0,
  setCall: (call, direction) => set({ call, direction, tick: 0 }),
  bump: () => set((s) => ({ tick: s.tick + 1 })),
}));

/**
 * Wires up event listeners on a MatrixCall so the store tracks its state and
 * clears itself when the call ends. Used for both incoming calls (from
 * CallManager) and outgoing calls (from wherever the user places one).
 */
export function registerCall(call: MatrixCall, direction: CallDirection): void {
  const { bump, setCall } = useCallStore.getState();
  const startedAt = Date.now();
  let everConnected = false;
  let logged = false;

  function logIfNeeded() {
    if (logged || !direction) return;
    logged = true;
    addCallHistoryEntry({
      roomId: call.roomId,
      direction,
      isGroupCall: false,
      startedAt,
      endedAt: Date.now(),
      everConnected,
    });
  }

  function clearIfCurrent() {
    if (useCallStore.getState().call === call) setCall(null, null);
  }

  call.on(CallEvent.State, () => {
    bump();
    if (call.state === CallState.Connected && !everConnected) {
      everConnected = true;
      playCallSound("call-join");
    }
    if (call.state === CallState.Ended) {
      logIfNeeded();
      clearIfCurrent();
    }
  });
  call.on(CallEvent.Hangup, () => {
    logIfNeeded();
    // Never actually connected (declined, failed, etc.) reads as an error
    // rather than a normal "left the call".
    playCallSound(everConnected ? "call-leave" : "call-error");
    clearIfCurrent();
  });
  // Muting audio/video on a feed (ours or theirs) mutates the feed in place
  // and only emits CallFeedEvent.MuteStateChanged - none of the CallEvents
  // above fire for it. Without listening to this directly, the mic/camera
  // buttons and the video tiles only catch up whenever some UNRELATED call
  // event happens to bump next, which on an otherwise-quiet call can be
  // "never" - looking exactly like the toggle did nothing (camera stays on
  // until the call ends and the whole screen unmounts).
  const trackedFeeds = new Set<CallFeed>();
  function trackFeed(feed: CallFeed) {
    if (trackedFeeds.has(feed)) return;
    trackedFeeds.add(feed);
    feed.on(CallFeedEvent.MuteStateChanged, bump);
  }
  call.on(CallEvent.FeedsChanged, () => {
    call.getFeeds().forEach(trackFeed);
    bump();
  });
  call.getFeeds().forEach(trackFeed);
  call.on(CallEvent.Error, () => {
    bump();
    playCallSound("call-error");
  });

  setCall(call, direction);
}

/** Places an outgoing 1:1 call in a room and starts tracking it in the store. */
export function placeAndTrackCall(client: MatrixClient, roomId: string, video: boolean): void {
  if (useCallStore.getState().call) return;
  // navigator.mediaDevices doesn't exist outside a secure context (https, or
  // plain http on localhost) - placeVoiceCall/placeVideoCall would otherwise
  // reject with a raw, unhelpful "undefined is not an object" TypeError as
  // an unhandled rejection.
  if (!navigator.mediaDevices?.getUserMedia) {
    console.error("calls require a secure (HTTPS) connection");
    return;
  }
  const call = client.createCall(roomId);
  if (!call) return;
  // Register before placing, so we don't miss any state transitions that
  // fire synchronously before placeVoiceCall/placeVideoCall's first await.
  registerCall(call, "outgoing");
  (video ? call.placeVideoCall() : call.placeVoiceCall()).catch((err: unknown) => {
    console.error("failed to start call", err);
  });
}
