import {
  announceStageRole,
  announceVoicePresence,
  demoteToAudience,
  getLivekitConnectionInfo,
  getActiveVoiceMemberIds,
  getSoundboardSounds,
  getUserCallPrefs,
  getVoiceBitrateKbps,
  getVoiceUserLimit,
  getVoiceVideoQuality,
  type MatrixClient,
  MatrixEventEvent,
  matrixUserIdFromLivekitIdentity,
  playSoundboardSound,
  promoteToSpeaker,
  RoomEvent as MatrixRoomEvent,
  setStageHandRaised,
  STAGE_DEMOTE_EVENT,
  STAGE_PROMOTE_EVENT,
  VOICE_PRESENCE_HEARTBEAT_MS,
} from "@jorkonvo/matrix-core";
import {
  ConnectionState,
  LocalAudioTrack,
  RemoteParticipant,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
} from "livekit-client";
import { create } from "zustand";
import { addCallHistoryEntry } from "../lib/callHistory";
import { playCallSound } from "../lib/callSounds";
import { consumeEntranceSoundSuppression, getEntranceSoundId } from "../lib/entranceSound";
import { createMicTrack } from "../lib/noiseSuppression";
import {
  getMicVolume,
  getPreferredCameraId,
  getPreferredMicId,
  getPreferredSpeakerId,
  getSpeakerVolume,
} from "../lib/mediaDevicePrefs";
import { useNoiseSuppressionStore } from "./noiseSuppressionStore";
import { usePushToTalkStore } from "./pushToTalkStore";

interface GroupCallState {
  room: Room | null;
  matrixRoomId: string | null;
  connecting: boolean;
  /** Which room `connecting` is for - `matrixRoomId` itself isn't set until
   *  the LiveKit room actually connects, so this is the only way for a
   *  specific voice-channel row to know it's the one currently joining. */
  connectingRoomId: string | null;
  error: string | null;
  /** Deafened: mutes all incoming audio (everyone else's mic), not just your
   *  own - separate from, and stronger than, muting your own mic. */
  deafened: boolean;
  /** Bumped on any relevant LiveKit room event, to force re-render. */
  tick: number;
  bump: () => void;
  /** Turning deafen ON also mutes the mic (can't hear -> shouldn't be heard
   *  either), matching Discord - turning it back off does NOT auto-unmute. */
  toggleDeafen: () => void;
  /** Flips the local mic on/off (with the mute/unmute cue) - the keybind equivalent of the in-call mute button. */
  toggleMicMute: () => void;
  /**
   * While the settings mic/audio test is running, deafen the call and mute
   * the mic so the test playback and the live call don't talk over each
   * other - then restore both to exactly what they were. A no-op when not
   * in a call.
   */
  setAudioTestActive: (active: boolean) => void;
  join: (
    client: MatrixClient,
    matrixRoomId: string,
    opts?: { startWithVideo?: boolean; asAudience?: boolean },
  ) => Promise<void>;
  leave: () => Promise<void>;
  /** Re-publishes the mic track to pick up a changed RNNoise setting mid-call. */
  refreshMicPipeline: () => Promise<void>;
  clearError: () => void;
  /** Audience member's own raised-hand toggle. */
  setHandRaised: (raised: boolean) => Promise<void>;
  /** Moderator action: asks a currently-audience participant to become a speaker. */
  promoteParticipant: (targetUserId: string) => void;
  /** Moderator action: asks a currently-speaking participant to go back to muted audience. */
  demoteParticipant: (targetUserId: string) => void;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let micCleanup: (() => void) | null = null;
let micSetGain: ((percent: number) => void) | null = null;
let stageSignalCleanup: (() => void) | null = null;
/** Call state to put back once the settings audio test stops (see setAudioTestActive). */
let audioTestRestore: { deafened: boolean; micEnabled: boolean } | null = null;

/**
 * LiveKit's `switchActiveDevice("audiooutput", ...)` requires
 * `AudioContext.setSinkId` specifically when `webAudioMix` is on (it routes
 * playback through a WebAudio graph, not plain `<audio>` elements - see the
 * webAudioMix comment below). A CEF/WebView build can lag behind that API
 * even while otherwise being modern Chromium - real bug hit live on the
 * Windows desktop build: every device selection was silently accepted in
 * the UI (localStorage updated) but audio kept coming out of the OS
 * default, because switchActiveDevice threw synchronously and every call
 * site swallowed it with `.catch(() => undefined)`. Feature-detecting this
 * up front and disabling webAudioMix when it's missing trades away >100%
 * per-user volume boost for actually being able to switch the output
 * device - the more commonly needed feature of the two.
 */
function supportsWebAudioMixOutputSwitching(): boolean {
  try {
    return typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
  } catch {
    return false;
  }
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/** Re-targets the published mic's gain node live, if a call's mic pipeline is currently up - a no-op otherwise (the volume still applies to the next publish, via publishMicrophone reading getMicVolume()). Avoids a full republish (and the accompanying brief audio glitch/renegotiation) on every tick of the volume slider. */
export function setMicVolumeLive(percent: number): void {
  micSetGain?.(percent);
}

function cleanupMic() {
  micSetGain = null;
  if (micCleanup) {
    micCleanup();
    micCleanup = null;
  }
}

function cleanupStageSignals() {
  if (stageSignalCleanup) {
    stageSignalCleanup();
    stageSignalCleanup = null;
  }
}

/** Applies this listener's own stored volume/mute prefs for `participant`, combined with the master speaker volume - see userCallPrefs.ts and mediaDevicePrefs.ts. Re-applied on every (re)subscribe via LiveKit's own volumeMap, so a late-arriving track still gets it, and re-runs for everyone already in the call whenever the speaker volume slider changes (see reapplyAllUserCallPrefs below). */
export function applyUserCallPrefs(client: MatrixClient, participant: RemoteParticipant): void {
  const userId = matrixUserIdFromLivekitIdentity(participant.identity);
  const prefs = getUserCallPrefs(client, userId);
  participant.setVolume(prefs.muted ? 0 : (prefs.volume / 100) * (getSpeakerVolume() / 100));
}

/** Publishes the mic - denoised through RNNoise when that setting is on, always gain-adjusted per the user's mic volume slider; falls back to LiveKit's own plain capture (no gain control) on any failure. */
async function publishMicrophone(room: Room): Promise<void> {
  const deviceId = getPreferredMicId();
  const denoise = useNoiseSuppressionStore.getState().enabled;
  const gainPercent = getMicVolume();
  try {
    const { track, cleanup, setGain } = await createMicTrack(deviceId, denoise, gainPercent);
    micCleanup = cleanup;
    micSetGain = setGain;
    const localTrack = new LocalAudioTrack(track, undefined, true);
    await room.localParticipant.publishTrack(localTrack, { source: Track.Source.Microphone });
  } catch (err) {
    console.error("mic pipeline failed, falling back to raw mic", err);
    cleanupMic();
    await room.localParticipant.setMicrophoneEnabled(true, deviceId ? { deviceId } : undefined).catch(() => undefined);
  }
}

/**
 * Listens for Matrix-level promote/demote requests addressed to this user in
 * this room, reacting by (un)muting and re-announcing this device's own
 * stage role - see the module comment in voiceChannels.ts for why this is a
 * Matrix event and not a LiveKit data-channel message.
 */
function wireStageSignals(client: MatrixClient, matrixRoomId: string, livekitRoom: Room, ownUserId: string): () => void {
  function handle(event: import("@jorkonvo/matrix-core").MatrixEvent) {
    if (event.getRoomId() !== matrixRoomId) return;
    const type = event.getType();
    if (type !== STAGE_PROMOTE_EVENT && type !== STAGE_DEMOTE_EVENT) return;
    if (event.getContent().target !== ownUserId) return;

    if (type === STAGE_PROMOTE_EVENT) {
      void publishMicrophone(livekitRoom);
      void announceStageRole(client, matrixRoomId, "speaker");
      void setStageHandRaised(client, matrixRoomId, false);
    } else {
      void livekitRoom.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      void livekitRoom.localParticipant.setCameraEnabled(false).catch(() => undefined);
      void announceStageRole(client, matrixRoomId, "audience");
    }
  }

  function onTimeline(event: import("@jorkonvo/matrix-core").MatrixEvent, room?: { roomId: string }) {
    if (room?.roomId !== matrixRoomId) return;
    handle(event);
  }
  // In E2EE rooms a freshly-arrived promote/demote event decrypts in the
  // background and the SDK does NOT re-emit RoomEvent.Timeline once it does
  // (see wireClientEvents in authStore.ts for the same issue on the main
  // sync path) - without this listener too, a promote/demote sent while this
  // participant's client hadn't yet decrypted the event would silently never
  // take effect.
  function onDecrypted(event: import("@jorkonvo/matrix-core").MatrixEvent) {
    handle(event);
  }

  client.on(MatrixRoomEvent.Timeline, onTimeline);
  client.on(MatrixEventEvent.Decrypted, onDecrypted);
  return () => {
    client.removeListener(MatrixRoomEvent.Timeline, onTimeline);
    client.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
  };
}

export const useGroupCallStore = create<GroupCallState>((set, get) => {
  // Kept outside the store's own state (not reactive data) so action
  // methods below can reach the Matrix client without prop-drilling it
  // through every call site - same non-reactive-ref spirit as the module-
  // level heartbeat/cleanup handles above.
  let activeClient: MatrixClient | null = null;

  return {
    room: null,
    matrixRoomId: null,
    connecting: false,
    connectingRoomId: null,
    error: null,
    deafened: false,
    tick: 0,
    bump: () => set((s) => ({ tick: s.tick + 1 })),

    toggleDeafen: () => {
      const { room, deafened } = get();
      const next = !deafened;
      set({ deafened: next });
      playCallSound(next ? "deafen" : "undeafen");
      if (next) void room?.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
    },

    setAudioTestActive: (active) => {
      const { room, deafened } = get();
      if (!room) return;
      if (active) {
        audioTestRestore = { deafened, micEnabled: room.localParticipant.isMicrophoneEnabled };
        set({ deafened: true });
        void room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      } else {
        const restore = audioTestRestore;
        audioTestRestore = null;
        set({ deafened: restore?.deafened ?? false });
        if (restore?.micEnabled) void room.localParticipant.setMicrophoneEnabled(true).catch(() => undefined);
      }
      get().bump();
    },

    toggleMicMute: () => {
      const { room } = get();
      if (!room) return;
      const local = room.localParticipant;
      const nextMuted = local.isMicrophoneEnabled;
      playCallSound(nextMuted ? "mic-mute" : "mic-unmute");
      void local.setMicrophoneEnabled(!nextMuted).catch(() => undefined);
      get().bump();
    },

    join: async (client, matrixRoomId, opts = {}) => {
      const { startWithVideo = true, asAudience = false } = opts;
      if (get().room || get().connecting) return;
      // Enforce the channel's user limit (0 = unlimited). Audience members in
      // a stage channel don't count against it - they're listeners, not
      // "connections" in the Discord sense.
      const matrixRoom = client.getRoom(matrixRoomId);
      if (matrixRoom && !asAudience) {
        const limit = getVoiceUserLimit(matrixRoom);
        if (limit > 0 && getActiveVoiceMemberIds(matrixRoom).length >= limit) {
          set({ error: "voiceChannelFull", connecting: false, connectingRoomId: null });
          return;
        }
      }
      set({ connecting: true, connectingRoomId: matrixRoomId, error: null, deafened: false });
      const joinedAt = Date.now();
      let historyLogged = false;
      try {
        const { url, jwt } = await getLivekitConnectionInfo(client, matrixRoomId);
        // webAudioMix routes playback through a per-track GainNode instead of
        // a plain <audio> element - required for per-user volume above 100%
        // (HTMLMediaElement.volume is hard-clamped to [0, 1] by the browser).
        //
        // Bitrate / video-quality come from the channel's own settings
        // (Discord's per-channel Bitrate slider + Video Quality) - a higher
        // audio bitrate for a music channel, a 720p cap where bandwidth is
        // tight, etc.
        const bitrateKbps = matrixRoom ? getVoiceBitrateKbps(matrixRoom) : 64;
        const cap720 = matrixRoom ? getVoiceVideoQuality(matrixRoom) === "720p" : false;
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          webAudioMix: supportsWebAudioMixOutputSwitching(),
          publishDefaults: { audioPreset: { maxBitrate: bitrateKbps * 1000 } },
          videoCaptureDefaults: cap720 ? { resolution: VideoPresets.h720.resolution } : undefined,
        });

        const bump = () => get().bump();
        room.on(RoomEvent.ParticipantConnected, (participant) => {
          applyUserCallPrefs(client, participant);
          bump();
          playCallSound("participant-join");
        });
        room.on(RoomEvent.ParticipantDisconnected, () => {
          bump();
          playCallSound("participant-leave");
        });
        room.on(RoomEvent.TrackSubscribed, bump);
        room.on(RoomEvent.TrackUnsubscribed, bump);
        room.on(RoomEvent.TrackMuted, bump);
        room.on(RoomEvent.TrackUnmuted, bump);
        room.on(RoomEvent.LocalTrackPublished, bump);
        room.on(RoomEvent.LocalTrackUnpublished, bump);
        // Only the transition INTO reconnecting is a "something went wrong"
        // moment worth a sound - LiveKit can cycle through this state a few
        // times while it recovers, and playing the cue on every tick would
        // just be noise on top of an already annoying network hiccup.
        let wasReconnecting = false;
        room.on(RoomEvent.ConnectionStateChanged, (state) => {
          bump();
          const isReconnecting = state === ConnectionState.Reconnecting;
          if (isReconnecting && !wasReconnecting) playCallSound("call-error");
          wasReconnecting = isReconnecting;
        });
        room.on(RoomEvent.Disconnected, () => {
          stopHeartbeat();
          cleanupMic();
          cleanupStageSignals();
          activeClient = null;
          void announceVoicePresence(client, matrixRoomId, false).catch(() => undefined);
          if (!historyLogged) {
            historyLogged = true;
            // Always "outgoing"/connected: joining a voice channel is always
            // an active choice, there's no "incoming ring" the way a 1:1
            // call has - by the time this fires, room.connect() already
            // succeeded once (see below), so this was a real, if perhaps
            // short, connected session.
            addCallHistoryEntry({
              roomId: matrixRoomId,
              direction: "outgoing",
              isGroupCall: true,
              startedAt: joinedAt,
              endedAt: Date.now(),
              everConnected: true,
            });
          }
          if (get().room === room) set({ room: null, matrixRoomId: null, connecting: false, connectingRoomId: null });
        });

        await room.connect(url, jwt);
        // ParticipantConnected only fires for people joining AFTER us -
        // anyone already in the room needs their prefs applied here instead.
        for (const participant of room.remoteParticipants.values()) applyUserCallPrefs(client, participant);
        const preferredSpeakerId = getPreferredSpeakerId();
        if (preferredSpeakerId) void room.switchActiveDevice("audiooutput", preferredSpeakerId).catch(() => undefined);

        if (!asAudience) {
          await Promise.all([
            publishMicrophone(room),
            startWithVideo
              ? room.localParticipant
                  .setCameraEnabled(true, getPreferredCameraId() ? { deviceId: getPreferredCameraId() } : undefined)
                  .catch(() => undefined)
              : undefined,
          ]);
          // Push-to-talk starts every call muted - only the held key (wired up
          // in GroupCallScreen) unmutes. Done here (not in the screen's mount
          // effect) so there's no brief unmuted flash between publish and mount.
          if (usePushToTalkStore.getState().enabled) {
            await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
          }
        }
        // Audience members publish nothing at all (not even a muted mic
        // track) until promoted - they only ever subscribe/listen.

        set({ room, matrixRoomId, connecting: false, connectingRoomId: null });
        activeClient = client;
        playCallSound("call-join");

        void announceStageRole(client, matrixRoomId, asAudience ? "audience" : "speaker").catch(() => undefined);
        cleanupStageSignals();
        stageSignalCleanup = wireStageSignals(client, matrixRoomId, room, client.getUserId() ?? "");

        // Announce presence to a lightweight per-room event (see voiceChannels.ts)
        // so the sidebar can show who's connected to a voice channel without
        // anyone having to open that room. Re-announced on a heartbeat while
        // connected; a missing heartbeat lets readers treat it as stale.
        void announceVoicePresence(client, matrixRoomId, true).catch(() => undefined);
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
          void announceVoicePresence(client, matrixRoomId, true).catch(() => undefined);
        }, VOICE_PRESENCE_HEARTBEAT_MS);

        // Discord's "entrance sound" - a soundboard clip that plays for
        // everyone the moment you join. Skipped for audience joins and when
        // the user picked "join without entrance sound" from the menu.
        const entranceSuppressed = consumeEntranceSoundSuppression();
        if (!asAudience && !entranceSuppressed) {
          const entranceSoundId = getEntranceSoundId(matrixRoomId);
          if (entranceSoundId && matrixRoom && getSoundboardSounds(matrixRoom).some((s) => s.id === entranceSoundId)) {
            void playSoundboardSound(client, matrixRoomId, entranceSoundId).catch(() => undefined);
          }
        }
      } catch (err) {
        cleanupMic();
        set({ error: (err as Error).message, connecting: false, connectingRoomId: null });
        playCallSound("call-error");
      }
    },

    leave: async () => {
      const { room } = get();
      if (room) playCallSound("call-leave");
      stopHeartbeat();
      cleanupMic();
      cleanupStageSignals();
      activeClient = null;
      set({ room: null, matrixRoomId: null, deafened: false });
      if (room) await room.disconnect();
    },

    refreshMicPipeline: async () => {
      const { room } = get();
      if (!room) return;
      const local = room.localParticipant;
      const wasMuted = !local.isMicrophoneEnabled;
      cleanupMic();
      const pub = local.getTrackPublication(Track.Source.Microphone);
      if (pub?.track) {
        await local.unpublishTrack(pub.track).catch(() => undefined);
      }
      await publishMicrophone(room);
      // Preserve the pre-refresh mute state (and stay muted under push-to-talk).
      if (wasMuted || usePushToTalkStore.getState().enabled) {
        await local.setMicrophoneEnabled(false).catch(() => undefined);
      }
      get().bump();
    },

    clearError: () => set({ error: null }),

    setHandRaised: async (raised) => {
      const { matrixRoomId } = get();
      if (!activeClient || !matrixRoomId) return;
      await setStageHandRaised(activeClient, matrixRoomId, raised);
      get().bump();
    },

    promoteParticipant: (targetUserId) => {
      const { matrixRoomId } = get();
      if (!activeClient || !matrixRoomId) return;
      void promoteToSpeaker(activeClient, matrixRoomId, targetUserId);
    },

    demoteParticipant: (targetUserId) => {
      const { matrixRoomId } = get();
      if (!activeClient || !matrixRoomId) return;
      void demoteToAudience(activeClient, matrixRoomId, targetUserId);
    },
  };
});

/** Re-applies `userId`'s stored call prefs to their live track right now, if you happen to currently be in a call with them - a no-op otherwise (the prefs still apply the next time you are, via applyUserCallPrefs above). */
export function reapplyUserCallPrefsIfInCall(client: MatrixClient, userId: string): void {
  const room = useGroupCallStore.getState().room;
  if (!room) return;
  for (const participant of room.remoteParticipants.values()) {
    if (matrixUserIdFromLivekitIdentity(participant.identity) === userId) {
      applyUserCallPrefs(client, participant);
      return;
    }
  }
}

/** Re-applies every current participant's volume - call when the master speaker volume slider changes mid-call. */
export function reapplyAllUserCallPrefs(client: MatrixClient): void {
  const room = useGroupCallStore.getState().room;
  if (!room) return;
  for (const participant of room.remoteParticipants.values()) applyUserCallPrefs(client, participant);
}

/** Switches the active output device for the current call, if any - a no-op otherwise (the preference still applies to the next call, via publishMicrophone/join). */
export function switchActiveSpeaker(deviceId: string): void {
  const room = useGroupCallStore.getState().room;
  if (room) void room.switchActiveDevice("audiooutput", deviceId).catch(() => undefined);
}
