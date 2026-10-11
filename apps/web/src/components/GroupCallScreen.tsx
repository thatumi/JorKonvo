import {
  addSoundboardSound,
  canManageSoundboard,
  canModerateStage,
  canPlaySoundboard,
  getRaisedHandUserIds,
  getSoundboardSounds,
  getStageRoles,
  isStageChannel,
  type MatrixClient,
  matrixUserIdFromLivekitIdentity,
  playSoundboardSound,
  type Room as MatrixRoom,
} from "@jorkonvo/matrix-core";
import { type Participant, ParticipantEvent, RemoteParticipant, Track } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { getCallSoundsVolume, isCallSoundsEnabled, playCallSound, setCallSoundsEnabled, setCallSoundsVolume } from "../lib/callSounds";
import { useCallUiStore } from "../lib/callUi";
import { uiAlert, uiPrompt } from "../lib/dialogs";
import { installIosScreenShareBridge } from "../lib/iosScreenShare";
import {
  getSoundboardVolume,
  isSoundboardPlaybackEnabled,
  setSoundboardPlaybackEnabled,
  setSoundboardVolume,
} from "../lib/soundboardPrefs";
import {
  getMicVolume,
  getPreferredCameraId,
  getPreferredMicId,
  getPreferredSpeakerId,
  getSpeakerVolume,
  setMicVolume,
  setPreferredCameraId,
  setPreferredMicId,
  setPreferredSpeakerId,
  setSpeakerVolume,
} from "../lib/mediaDevicePrefs";
import { MiniCallBar, MiniControl, MinimizeIcon } from "./CallMiniBar";
import { reapplyAllUserCallPrefs, setMicVolumeLive, switchActiveSpeaker, useGroupCallStore } from "../state/groupCallStore";
import { useMatrixStore } from "../state/matrixStore";
import { useNoiseSuppressionStore } from "../state/noiseSuppressionStore";
import {
  getScreenShareQuality,
  screenShareResolution,
  SCREEN_SHARE_QUALITIES,
  setScreenShareQuality,
  type ScreenShareQuality,
} from "../lib/screenShareSettings";
import { describeKeyCode, usePushToTalkStore } from "../state/pushToTalkStore";
import { useVerificationStore } from "../state/verificationStore";
import { Avatar } from "./Avatar";
import { DeviceSelect } from "./DeviceSelect";

const HandIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
    <path d="M9 11.24V7.5a1.5 1.5 0 0 1 3 0v3.74a1 1 0 1 0 2 0V6a1.5 1.5 0 0 1 3 0v5.5a1 1 0 1 0 2 0v-2a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.5a6 6 0 0 1-4.94-2.6L4.35 14.6a1.5 1.5 0 0 1 2.36-1.85L8 14.6V7.5a1.5 1.5 0 0 1 3 0v3.74Z" />
  </svg>
);

function ParticipantTile({
  participant,
  displayName,
  isModerator,
  onDemote,
  onVerify,
}: {
  participant: Participant;
  displayName: string;
  isModerator: boolean;
  onDemote?: () => void;
  onVerify?: () => void;
}) {
  const { t } = useTranslation();
  const deafened = useGroupCallStore((s) => s.deafened);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const cameraPub = participant.getTrackPublication(Track.Source.Camera);
  const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  // Turning the camera off only mutes the existing publication (LiveKit
  // keeps the track around, just disabled, so a quick re-enable doesn't
  // have to re-request camera permission) - it doesn't unpublish it. So
  // `cameraPub.track` stays truthy after "turning off the camera", and
  // without checking isMuted here the tile just kept showing a frozen/black
  // frame instead of falling back to the avatar - looking like the toggle
  // silently did nothing.
  const videoTrack = (screenPub && !screenPub.isMuted ? screenPub.track : undefined) ?? (cameraPub && !cameraPub.isMuted ? cameraPub.track : undefined);
  const isLocal = !(participant instanceof RemoteParticipant);

  // Per-tile listener rather than the shared groupCallStore tick: LiveKit
  // recomputes active speakers on a fast timer while anyone's talking, and
  // bumping a store every app-wide subscriber reads from that often would
  // re-render the whole call screen constantly instead of just this tile.
  const [isSpeaking, setIsSpeaking] = useState(participant.isSpeaking);
  useEffect(() => {
    setIsSpeaking(participant.isSpeaking);
    participant.on(ParticipantEvent.IsSpeakingChanged, setIsSpeaking);
    return () => {
      participant.off(ParticipantEvent.IsSpeakingChanged, setIsSpeaking);
    };
  }, [participant]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoTrack) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack]);

  useEffect(() => {
    const el = audioRef.current;
    const track = micPub?.track;
    if (!el || !track || isLocal) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [micPub?.track, isLocal]);

  const micMuted = !micPub || micPub.isMuted;

  return (
    <div
      className={`relative flex min-h-[140px] min-w-[200px] flex-1 items-center justify-center overflow-hidden rounded-lg bg-bg-darkest ${
        isSpeaking ? "animate-speaking-pulse" : ""
      }`}
    >
      {videoTrack ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal} aria-label={displayName} className="h-full w-full object-contain" />
      ) : (
        <Avatar url={null} name={displayName} size={64} />
      )}
      <audio ref={audioRef} autoPlay muted={deafened} />
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        {micMuted && (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-dnd" fill="currentColor">
            <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28ZM4.27 3 3 4.27l6.01 6.01V11a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08L14.14 15.42A4.98 4.98 0 0 1 7 10.5H5.3c0 3.24 2.4 5.85 5.7 6.33V20h2v-3.17c.6-.09 1.16-.27 1.68-.53L19.73 21 21 19.73 4.27 3Z" />
          </svg>
        )}
        <span>{displayName}</span>
      </div>
      {!isLocal && onVerify && (
        <button
          type="button"
          onClick={onVerify}
          title={t("call.verifyInCall")}
          aria-label={t("call.verifyInCall")}
          className="absolute left-2 top-2 rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm-1.2 14.6L6.4 11.2l1.4-1.4 2.99 2.99L16.2 6.4l1.4 1.4Z" />
          </svg>
        </button>
      )}
      {isModerator && !isLocal && onDemote && (
        <button
          type="button"
          onClick={onDemote}
          title={t("call.makeListener")}
          className="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
        >
          {t("call.makeListener")}
        </button>
      )}
    </div>
  );
}

function AudienceTile({ displayName, raised }: { displayName: string; raised: boolean }) {
  return (
    <div className="relative flex flex-col items-center gap-1 rounded-lg bg-bg-darkest/60 p-2">
      <div className="relative">
        <Avatar url={null} name={displayName} size={40} />
        {raised && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
            {HandIcon}
          </span>
        )}
      </div>
      <span className="max-w-[72px] truncate text-[11px] text-white/80">{displayName}</span>
    </div>
  );
}

function GroupControlButton({
  onClick,
  active,
  danger,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-12 w-12 items-center justify-center rounded-full transition ${
        danger
          ? "bg-dnd text-white hover:bg-red-600"
          : active
            ? "bg-bg-modifier-selected text-header"
            : "bg-bg-secondary text-normal hover:bg-bg-modifier-hover"
      }`}
    >
      {children}
    </button>
  );
}

function SoundboardPanel({
  matrixRoom,
  client,
  onClose,
}: {
  matrixRoom: MatrixRoom;
  client: MatrixClient;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useMatrixStore((s) => s.syncTick);
  const ownUserId = client.getUserId() ?? "";
  const sounds = getSoundboardSounds(matrixRoom);
  const mayManage = canManageSoundboard(matrixRoom, ownUserId);
  const mayPlay = canPlaySoundboard(matrixRoom, ownUserId);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = await uiPrompt(t("call.soundEffectName"), file.name.replace(/\.[^.]+$/, ""));
    if (!name) return;
    setUploading(true);
    void addSoundboardSound(client, matrixRoom.roomId, name, file)
      .catch((err) => console.error("failed to upload soundboard sound", err))
      .finally(() => setUploading(false));
  }

  return (
    <div className="absolute bottom-24 left-1/2 z-10 w-72 -translate-x-1/2 rounded-lg border border-white/10 bg-bg-secondary p-3 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase text-muted">{t("call.soundboard")}</h3>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded p-1 text-muted hover:text-normal">
          ✕
        </button>
      </div>
      {sounds.length === 0 && <p className="mb-2 text-xs text-muted">{t("call.soundboardEmpty")}</p>}
      <div className="mb-2 grid max-h-52 grid-cols-2 gap-1.5 overflow-y-auto">
        {sounds.map((sound) => (
          <button
            key={sound.id}
            type="button"
            disabled={!mayPlay}
            onClick={() => void playSoundboardSound(client, matrixRoom.roomId, sound.id).catch(() => undefined)}
            className="truncate rounded bg-bg-darkest px-2 py-1.5 text-left text-sm text-normal hover:bg-bg-modifier-hover disabled:opacity-50"
          >
            🔊 {sound.name}
          </button>
        ))}
      </div>
      {mayManage && (
        <>
          <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFilePick} />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded border border-border py-1.5 text-xs font-medium text-normal hover:bg-bg-modifier-hover disabled:opacity-50"
          >
            {uploading ? t("call.uploading") : t("call.addSoundEffect")}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Wraps a main control button (mic/camera/screen share) with a small caret
 * badge in its corner that opens a focused quick-settings popover right
 * there - instead of every device/quality setting living behind one single,
 * far-away "call settings" gear (still kept, see AudioSettingsPanel, for
 * the less frequently touched stuff like soundboard/call-sound volumes).
 */
function ControlWithCaret({
  children,
  open,
  onToggle,
  panel,
  ariaLabel,
}: {
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  panel: React.ReactNode;
  /** Accessible name for the icon-only caret toggle. */
  ariaLabel: string;
}) {
  return (
    <div className="relative">
      {children}
      <button
        type="button"
        onClick={onToggle}
        aria-label={ariaLabel}
        aria-expanded={open}
        className={`absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-bg-floating transition ${
          open ? "bg-brand text-white" : "bg-bg-secondary text-muted hover:text-normal"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="currentColor">
          <path d="M7 14l5-5 5 5H7Z" />
        </svg>
      </button>
      {open && panel}
    </div>
  );
}

function QuickPanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="absolute bottom-16 left-1/2 z-10 w-64 -translate-x-1/2 rounded-lg border border-white/10 bg-bg-secondary p-3 text-left shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase text-muted">{title}</h3>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded p-1 text-muted hover:text-normal">
          ✕
        </button>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function AudioSettingsPanel({
  onClose,
  preferredMicId,
  onChangeMic,
  preferredCameraId,
  onChangeCamera,
  preferredSpeakerId,
  onChangeSpeaker,
  micVolume,
  onChangeMicVolume,
  speakerVolume,
  onChangeSpeakerVolume,
  noiseSuppressionEnabled,
  onToggleNoiseSuppression,
  pttEnabled,
  onTogglePtt,
  pttCode,
  capturingKey,
  onCaptureKey,
  soundboardEnabled,
  onToggleSoundboardEnabled,
  soundboardVolume,
  onChangeSoundboardVolume,
  callSoundsEnabled,
  onToggleCallSoundsEnabled,
  callSoundsVolume,
  onChangeCallSoundsVolume,
}: {
  onClose: () => void;
  preferredMicId: string | undefined;
  onChangeMic: (deviceId: string | null) => void;
  preferredCameraId: string | undefined;
  onChangeCamera: (deviceId: string | null) => void;
  preferredSpeakerId: string | undefined;
  onChangeSpeaker: (deviceId: string | null) => void;
  micVolume: number;
  onChangeMicVolume: (percent: number) => void;
  speakerVolume: number;
  onChangeSpeakerVolume: (percent: number) => void;
  noiseSuppressionEnabled: boolean;
  onToggleNoiseSuppression: (enabled: boolean) => void;
  pttEnabled: boolean;
  onTogglePtt: (enabled: boolean) => void;
  pttCode: string;
  capturingKey: boolean;
  onCaptureKey: () => void;
  soundboardEnabled: boolean;
  onToggleSoundboardEnabled: (enabled: boolean) => void;
  soundboardVolume: number;
  onChangeSoundboardVolume: (volume: number) => void;
  callSoundsEnabled: boolean;
  onToggleCallSoundsEnabled: (enabled: boolean) => void;
  callSoundsVolume: number;
  onChangeCallSoundsVolume: (volume: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute bottom-24 left-1/2 z-10 w-72 -translate-x-1/2 rounded-lg border border-white/10 bg-bg-secondary p-3 text-left shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase text-muted">{t("call.audioSettings")}</h3>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded p-1 text-muted hover:text-normal">
          ✕
        </button>
      </div>
      <div className="mb-2 flex max-h-72 flex-col gap-2 overflow-y-auto border-b border-white/10 pb-2">
        <DeviceSelect kind="audioinput" label={t("settings.microphoneDevice")} value={preferredMicId} onChange={onChangeMic} />
        <label className="flex items-center gap-2 text-xs text-normal">
          <span className="w-16 shrink-0">{t("settings.micVolume")}</span>
          <input
            type="range"
            min={0}
            max={200}
            value={micVolume}
            onChange={(e) => onChangeMicVolume(Number(e.target.value))}
            className="min-w-0 flex-1"
          />
          <span className="w-8 shrink-0 text-right text-muted">{micVolume}%</span>
        </label>
        <DeviceSelect kind="videoinput" label={t("settings.cameraDevice")} value={preferredCameraId} onChange={onChangeCamera} />
        <DeviceSelect kind="audiooutput" label={t("settings.speakerDevice")} value={preferredSpeakerId} onChange={onChangeSpeaker} />
        <label className="flex items-center gap-2 text-xs text-normal">
          <span className="w-16 shrink-0">{t("settings.speakerVolume")}</span>
          <input
            type="range"
            min={0}
            max={200}
            value={speakerVolume}
            onChange={(e) => onChangeSpeakerVolume(Number(e.target.value))}
            className="min-w-0 flex-1"
          />
          <span className="w-8 shrink-0 text-right text-muted">{speakerVolume}%</span>
        </label>
      </div>
      <label className="flex items-center justify-between gap-2 py-1.5 text-sm text-normal">
        <span>{t("call.noiseSuppression")}</span>
        <input
          type="checkbox"
          checked={noiseSuppressionEnabled}
          onChange={(e) => onToggleNoiseSuppression(e.target.checked)}
          className="h-4 w-4 shrink-0"
        />
      </label>
      <label className="flex items-center justify-between gap-2 py-1.5 text-sm text-normal">
        <span>{t("call.pushToTalk")}</span>
        <input
          type="checkbox"
          checked={pttEnabled}
          onChange={(e) => onTogglePtt(e.target.checked)}
          className="h-4 w-4 shrink-0"
        />
      </label>
      {pttEnabled && (
        <div className="mt-1 flex items-center justify-between gap-2 rounded bg-bg-darkest px-2.5 py-2 text-xs">
          <span className="text-muted">
            {t("call.pttKey")}: <span className="font-semibold text-normal">{describeKeyCode(pttCode)}</span>
          </span>
          <button
            type="button"
            onClick={onCaptureKey}
            className="rounded border border-border px-2 py-1 font-medium text-normal hover:bg-bg-modifier-hover"
          >
            {capturingKey ? t("call.pttPressKey") : t("call.pttChange")}
          </button>
        </div>
      )}
      <div className="mt-2 border-t border-white/10 pt-2">
        <label className="flex items-center justify-between gap-2 py-1.5 text-sm text-normal">
          <span>{t("call.soundboardPlayback")}</span>
          <input
            type="checkbox"
            checked={soundboardEnabled}
            onChange={(e) => onToggleSoundboardEnabled(e.target.checked)}
            className="h-4 w-4 shrink-0"
          />
        </label>
        {soundboardEnabled && (
          <label className="flex items-center gap-2 py-1.5 text-sm text-normal">
            <span className="shrink-0">{t("call.soundboardVolume")}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={soundboardVolume}
              onChange={(e) => onChangeSoundboardVolume(Number(e.target.value))}
              className="min-w-0 flex-1"
            />
            <span className="w-8 shrink-0 text-right text-xs text-muted">{soundboardVolume}%</span>
          </label>
        )}
      </div>
      <div className="mt-2 border-t border-white/10 pt-2">
        <label className="flex items-center justify-between gap-2 py-1.5 text-sm text-normal">
          <span>{t("call.callSounds")}</span>
          <input
            type="checkbox"
            checked={callSoundsEnabled}
            onChange={(e) => onToggleCallSoundsEnabled(e.target.checked)}
            className="h-4 w-4 shrink-0"
          />
        </label>
        {callSoundsEnabled && (
          <label className="flex items-center gap-2 py-1.5 text-sm text-normal">
            <span className="shrink-0">{t("call.callSoundsVolume")}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={callSoundsVolume}
              onChange={(e) => onChangeCallSoundsVolume(Number(e.target.value))}
              className="min-w-0 flex-1"
            />
            <span className="w-8 shrink-0 text-right text-xs text-muted">{callSoundsVolume}%</span>
          </label>
        )}
      </div>
    </div>
  );
}

/**
 * Full-screen voice-channel / stage-channel call UI (LiveKit-backed): speaker
 * tiles with per-participant controls, raised-hand audience management,
 * soundboard, and mic/camera/screen-share/deafen controls with quick-settings
 * popovers; collapses to the mini bar while minimised.
 */
export function GroupCallScreen({ matrixRoom }: { matrixRoom: MatrixRoom }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const room = useGroupCallStore((s) => s.room);
  const leave = useGroupCallStore((s) => s.leave);
  const deafened = useGroupCallStore((s) => s.deafened);
  const toggleDeafen = useGroupCallStore((s) => s.toggleDeafen);
  const setHandRaised = useGroupCallStore((s) => s.setHandRaised);
  const promoteParticipant = useGroupCallStore((s) => s.promoteParticipant);
  const demoteParticipant = useGroupCallStore((s) => s.demoteParticipant);
  useGroupCallStore((s) => s.tick);
  // Stage role/hand-raise/promote/demote all arrive as ordinary Matrix
  // timeline events (see voiceChannels.ts) rather than LiveKit participant
  // state, so this screen also needs to re-render on the client's own sync
  // tick, not just LiveKit's.
  useMatrixStore((s) => s.syncTick);
  const [busy, setBusy] = useState(false);
  const [soundboardOpen, setSoundboardOpen] = useState(false);
  const startVerification = useVerificationStore((s) => s.start);
  const verificationRequest = useVerificationStore((s) => s.request);
  const pttEnabled = usePushToTalkStore((s) => s.enabled);
  const pttCode = usePushToTalkStore((s) => s.code);
  const setPttEnabled = usePushToTalkStore((s) => s.setEnabled);
  const setPttCode = usePushToTalkStore((s) => s.setCode);
  const noiseSuppressionEnabled = useNoiseSuppressionStore((s) => s.enabled);
  const setNoiseSuppressionEnabled = useNoiseSuppressionStore((s) => s.setEnabled);
  const refreshMicPipeline = useGroupCallStore((s) => s.refreshMicPipeline);
  const minimized = useCallUiStore((s) => s.minimized);
  const setMinimized = useCallUiStore((s) => s.setMinimized);
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
  const [capturingKey, setCapturingKey] = useState(false);
  const [soundboardEnabled, setSoundboardEnabledState] = useState(isSoundboardPlaybackEnabled);
  const [soundboardVolume, setSoundboardVolumeState] = useState(getSoundboardVolume);
  const [callSoundsEnabled, setCallSoundsEnabledState] = useState(isCallSoundsEnabled);
  const [preferredMicId, setPreferredMicIdState] = useState(getPreferredMicId);
  const [preferredCameraId, setPreferredCameraIdState] = useState(getPreferredCameraId);
  const [preferredSpeakerId, setPreferredSpeakerIdState] = useState(getPreferredSpeakerId);
  const [micVolume, setMicVolumeState] = useState(getMicVolume);
  const [speakerVolume, setSpeakerVolumeState] = useState(getSpeakerVolume);
  const [callSoundsVolume, setCallSoundsVolumeState] = useState(getCallSoundsVolume);
  const [micCaretOpen, setMicCaretOpen] = useState(false);
  const [cameraCaretOpen, setCameraCaretOpen] = useState(false);
  const [screenShareCaretOpen, setScreenShareCaretOpen] = useState(false);
  const [screenShareQuality, setScreenShareQualityState] = useState<ScreenShareQuality>(getScreenShareQuality);

  // A fresh call always opens full-size.
  useEffect(() => {
    setMinimized(false);
  }, [setMinimized]);

  useEffect(() => {
    if (!pttEnabled || !room) return;
    const local = room.localParticipant;
    // Entering PTT mode closes the mic; only the held key opens it.
    void local.setMicrophoneEnabled(false).catch(() => undefined);
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === pttCode && !e.repeat) void local.setMicrophoneEnabled(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === pttCode) void local.setMicrophoneEnabled(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      // Leaving PTT mode (toggled off, or the effect re-running) re-opens the
      // mic - a disconnect that follows will mute it anyway, so this is safe.
      void local.setMicrophoneEnabled(true).catch(() => undefined);
    };
  }, [pttEnabled, pttCode, room]);

  useEffect(() => {
    if (!capturingKey) return;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      setPttCode(e.code);
      setCapturingKey(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturingKey, setPttCode]);

  if (!room) return null;

  const local = room.localParticipant;
  const remotes = [...room.remoteParticipants.values()];
  const localUserId = client.getUserId() ?? "";
  const allParticipants: { participant: Participant; name: string; userId: string }[] = [
    { participant: local, name: t("common.you"), userId: localUserId },
    ...remotes.map((p) => {
      const userId = matrixUserIdFromLivekitIdentity(p.identity);
      // Found live: this used to be `matrixRoom.getMember(userId)?.name ?? p.name ?? userId`
      // - `??` only skips null/undefined, not "", so a LiveKit participant
      // with no name claim (p.name === "") silently WON THIS CHAIN over the
      // userId fallback, producing an empty string that Avatar's initials()
      // then rendered as a bare "?" - worse than showing the raw userId.
      // Also adds client.getUser(userId) (the GLOBAL, cross-room profile
      // cache) as a middle fallback, in case this room's own member list
      // hasn't caught up yet for a user only just joined.
      const name =
        matrixRoom.getMember(userId)?.name || client.getUser(userId)?.displayName || p.name || userId;
      return { participant: p, name, userId };
    }),
  ];

  const isStage = isStageChannel(matrixRoom);
  const isModerator = isStage && canModerateStage(matrixRoom, localUserId);
  const stageRoles = isStage ? getStageRoles(matrixRoom) : {};
  const raisedHandIds = isStage ? new Set(getRaisedHandUserIds(matrixRoom)) : new Set<string>();
  const isAudienceId = (userId: string) => stageRoles[userId] === "audience";
  const localIsAudience = isStage && isAudienceId(localUserId);
  const speakers = isStage ? allParticipants.filter((p) => !isAudienceId(p.userId)) : allParticipants;
  const audience = isStage ? allParticipants.filter((p) => isAudienceId(p.userId)) : [];
  const raisedHands = audience.filter((p) => raisedHandIds.has(p.userId));

  const micEnabled = local.isMicrophoneEnabled;
  const cameraEnabled = local.isCameraEnabled;
  const screenShareEnabled = local.isScreenShareEnabled;
  const localHandRaised = raisedHandIds.has(localUserId);

  async function toggle(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  // Starting a screen share can fail in ways the user must hear about - a
  // denied browser prompt, or a native bridge (iOS/Android) that rejected -
  // and a bare `void toggle(...)` swallowed every one of those silently: the
  // button just did nothing. Surface the error name + message instead.
  async function startScreenShare(resolution: ReturnType<typeof screenShareResolution>) {
    installIosScreenShareBridge(); // idempotent; no-op off iOS - see its header
    try {
      await local.setScreenShareEnabled(true, { resolution });
    } catch (err) {
      console.error("screen share failed to start", err);
      let detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      if (err instanceof Error && err.name === "DeviceUnsupportedError") {
        detail += ` (mediaDevices: ${typeof navigator.mediaDevices}, getDisplayMedia: ${typeof navigator.mediaDevices?.getDisplayMedia})`;
      }
      void uiAlert(detail, t("call.screenShareFailed"));
    }
  }

  if (minimized) {
    return (
      <MiniCallBar
        title={matrixRoom.name}
        subtitle={t("call.participants", { count: allParticipants.length })}
        onExpand={() => setMinimized(false)}
      >
        {!localIsAudience && (
          <MiniControl
            title={micEnabled ? t("call.mute") : t("call.unmute")}
            active={micEnabled}
            onClick={() => {
              playCallSound(micEnabled ? "mic-mute" : "mic-unmute");
              void toggle(() => local.setMicrophoneEnabled(!micEnabled));
            }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              {micEnabled ? (
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5.3c0 3.28 2.39 5.99 5.5 6.42V20h2.4v-2.58c3.11-.43 5.5-3.14 5.5-6.42H17Z" />
              ) : (
                <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28ZM4.27 3 3 4.27l6.01 6.01V11a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08L14.14 15.42A4.98 4.98 0 0 1 7 10.5H5.3c0 3.24 2.4 5.85 5.7 6.33V20h2v-3.17c.6-.09 1.16-.27 1.68-.53L19.73 21 21 19.73 4.27 3Z" />
              )}
            </svg>
          </MiniControl>
        )}
        {!localIsAudience && (
          <MiniControl title={deafened ? t("call.undeafen") : t("call.deafen")} danger={deafened} onClick={toggleDeafen}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              {deafened ? (
                <path d="M3.4 2 2 3.4l3 3V13a2 2 0 0 0 2 2h1v6l4-4h2.3l4.3 4.3 1.4-1.4L3.4 2ZM19 13h1a2 2 0 0 0 2-2v-1c0-4.42-3.58-8-8-8-1.36 0-2.64.34-3.76.94l1.5 1.5A5.98 5.98 0 0 1 20 11v.17l-1-1V13Z" />
              ) : (
                <path d="M12 2C6.48 2 2 6.48 2 12v6a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H4v-1a8 8 0 0 1 16 0v1h-1a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-6c0-5.52-4.48-10-10-10Z" />
              )}
            </svg>
          </MiniControl>
        )}
        {screenShareEnabled && (
          <MiniControl
            title={t("call.screenShareStop")}
            danger
            onClick={() => void toggle(() => local.setScreenShareEnabled(false))}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4ZM4 16V6h16v10.01L4 16Z" />
            </svg>
          </MiniControl>
        )}
        <MiniControl title={t("call.leave")} danger onClick={() => void leave()}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1A17.9 17.9 0 0 0 12 9Z" />
          </svg>
        </MiniControl>
      </MiniCallBar>
    );
  }

  // Bottom inset: the control row is bottom-anchored interactive UI, so on a
  // phone it must clear the home indicator (p-6's 24px alone doesn't).
  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex flex-col bg-black/90 p-6 pt-[calc(1.5rem_+_env(safe-area-inset-top))] pb-[calc(1.5rem_+_env(safe-area-inset-bottom))]">
      <button
        type="button"
        onClick={() => setMinimized(true)}
        title={t("call.minimize")}
        aria-label={t("call.minimize")}
        className="absolute right-4 top-[calc(1rem_+_env(safe-area-inset-top))] rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
      >
        {MinimizeIcon}
      </button>
      <div className="mb-4 shrink-0 text-center text-white">
        <div className="text-lg font-semibold">{matrixRoom.name}</div>
        <div className="text-sm text-white/60">
          {isStage ? t("call.stageChannel") : t("call.groupCall")} &middot;{" "}
          {t("call.participants", { count: allParticipants.length })}
        </div>
        {pttEnabled && !localIsAudience && (
          <div className="mt-1 text-xs text-white/50">
            {t("call.pttHint", { key: describeKeyCode(pttCode) })}
          </div>
        )}
      </div>

      {isModerator && raisedHands.length > 0 && (
        <div className="mb-4 shrink-0 rounded-lg bg-bg-secondary/90 p-3">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-white/70">
            {t("call.raisedHandsLabel")} — {raisedHands.length}
          </div>
          <div className="flex flex-wrap gap-2">
            {raisedHands.map(({ participant, name, userId }) => (
              <button
                key={participant.identity}
                type="button"
                onClick={() => promoteParticipant(userId)}
                className="flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
              >
                {HandIcon}
                {t("call.promoteToSpeaker", { name })}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-wrap gap-3 overflow-y-auto">
        {speakers.map(({ participant, name, userId }) => (
          <ParticipantTile
            key={participant.identity}
            participant={participant}
            displayName={name}
            isModerator={isModerator}
            onDemote={() => demoteParticipant(userId)}
            onVerify={verificationRequest ? undefined : () => void startVerification(client, userId)}
          />
        ))}
      </div>

      {isStage && audience.length > 0 && (
        <div className="mt-3 shrink-0 border-t border-white/10 pt-3">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">
            {t("call.audienceLabel")} — {audience.length}
          </div>
          <div className="flex flex-wrap gap-2">
            {audience.map(({ participant, name, userId }) => (
              <AudienceTile key={participant.identity} displayName={name} raised={raisedHandIds.has(userId)} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex shrink-0 flex-wrap items-center justify-center gap-3 md:gap-4">
        {localIsAudience ? (
          <GroupControlButton
            title={localHandRaised ? t("call.lowerHand") : t("call.raiseHand")}
            active={localHandRaised}
            onClick={() => void toggle(() => setHandRaised(!localHandRaised))}
          >
            {HandIcon}
          </GroupControlButton>
        ) : (
          <>
            <ControlWithCaret
              open={micCaretOpen}
              onToggle={() => setMicCaretOpen((v) => !v)}
              ariaLabel={t("call.micQuickSettings")}
              panel={
                <QuickPanel title={t("call.micQuickSettings")} onClose={() => setMicCaretOpen(false)}>
                  <DeviceSelect
                    kind="audioinput"
                    label={t("settings.microphoneDevice")}
                    value={preferredMicId}
                    onChange={(deviceId) => {
                      setPreferredMicId(deviceId);
                      setPreferredMicIdState(deviceId ?? undefined);
                      void refreshMicPipeline();
                    }}
                  />
                  <label className="flex items-center gap-2 text-xs text-normal">
                    <span className="w-16 shrink-0">{t("settings.micVolume")}</span>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      value={micVolume}
                      onChange={(e) => {
                        const percent = Number(e.target.value);
                        setMicVolume(percent);
                        setMicVolumeState(percent);
                        setMicVolumeLive(percent);
                      }}
                      className="min-w-0 flex-1"
                    />
                    <span className="w-8 shrink-0 text-right text-muted">{micVolume}%</span>
                  </label>
                  <label className="flex items-center justify-between gap-2 py-1 text-sm text-normal">
                    <span>{t("call.noiseSuppression")}</span>
                    <input
                      type="checkbox"
                      checked={noiseSuppressionEnabled}
                      onChange={(e) => {
                        setNoiseSuppressionEnabled(e.target.checked);
                        void refreshMicPipeline();
                      }}
                      className="h-4 w-4 shrink-0"
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 py-1 text-sm text-normal">
                    <span>{t("call.pushToTalk")}</span>
                    <input
                      type="checkbox"
                      checked={pttEnabled}
                      onChange={(e) => setPttEnabled(e.target.checked)}
                      className="h-4 w-4 shrink-0"
                    />
                  </label>
                  {pttEnabled && (
                    <div className="flex items-center justify-between gap-2 rounded bg-bg-darkest px-2.5 py-2 text-xs">
                      <span className="text-muted">
                        {t("call.pttKey")}: <span className="font-semibold text-normal">{describeKeyCode(pttCode)}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setCapturingKey(true)}
                        className="rounded border border-border px-2 py-1 font-medium text-normal hover:bg-bg-modifier-hover"
                      >
                        {capturingKey ? t("call.pttPressKey") : t("call.pttChange")}
                      </button>
                    </div>
                  )}
                </QuickPanel>
              }
            >
              <GroupControlButton
                title={micEnabled ? t("call.mute") : t("call.unmute")}
                active={micEnabled}
                onClick={() => {
                  // Unmuting while deafened wouldn't do anything audible for
                  // yourself and would be a confusing half-state to leave
                  // hanging - Discord un-deafens automatically here too.
                  // (toggleDeafen already plays its own sound, so skip the
                  // separate mic one rather than overlapping both.)
                  if (deafened && !micEnabled) {
                    toggleDeafen();
                  } else {
                    playCallSound(micEnabled ? "mic-mute" : "mic-unmute");
                  }
                  void toggle(() => local.setMicrophoneEnabled(!micEnabled));
                }}
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                  {micEnabled ? (
                    <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5.3c0 3.28 2.39 5.99 5.5 6.42V20h2.4v-2.58c3.11-.43 5.5-3.14 5.5-6.42H17Z" />
                  ) : (
                    <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28ZM4.27 3 3 4.27l6.01 6.01V11a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08L14.14 15.42A4.98 4.98 0 0 1 7 10.5H5.3c0 3.24 2.4 5.85 5.7 6.33V20h2v-3.17c.6-.09 1.16-.27 1.68-.53L19.73 21 21 19.73 4.27 3Z" />
                  )}
                </svg>
              </GroupControlButton>
            </ControlWithCaret>

            <ControlWithCaret
              open={cameraCaretOpen}
              onToggle={() => setCameraCaretOpen((v) => !v)}
              ariaLabel={t("call.cameraQuickSettings")}
              panel={
                <QuickPanel title={t("call.cameraQuickSettings")} onClose={() => setCameraCaretOpen(false)}>
                  <DeviceSelect
                    kind="videoinput"
                    label={t("settings.cameraDevice")}
                    value={preferredCameraId}
                    onChange={(deviceId) => {
                      setPreferredCameraId(deviceId);
                      setPreferredCameraIdState(deviceId ?? undefined);
                      if (deviceId) void room?.switchActiveDevice("videoinput", deviceId).catch(() => undefined);
                    }}
                  />
                </QuickPanel>
              }
            >
              <GroupControlButton
                title={cameraEnabled ? t("call.cameraOff") : t("call.cameraOn")}
                active={cameraEnabled}
                onClick={() =>
                  void toggle(() =>
                    local.setCameraEnabled(
                      !cameraEnabled,
                      !cameraEnabled && getPreferredCameraId() ? { deviceId: getPreferredCameraId() } : undefined,
                    ),
                  )
                }
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                  {cameraEnabled ? (
                    <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z" />
                  ) : (
                    <path d="M21 6.5 17 10V7a1 1 0 0 0-1-1H9.83l1.5 1.5H16v6.67l1.5 1.5L21 15V6.5ZM3.4 2 2 3.4l3.6 3.6H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h11c.28 0 .53-.11.71-.29l2.89 2.89L19 19.19 3.4 2Z" />
                  )}
                </svg>
              </GroupControlButton>
            </ControlWithCaret>

            <GroupControlButton title={deafened ? t("call.undeafen") : t("call.deafen")} danger={deafened} onClick={toggleDeafen}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                {deafened ? (
                  <path d="M3.4 2 2 3.4l3 3V13a2 2 0 0 0 2 2h1v6l4-4h2.3l4.3 4.3 1.4-1.4L3.4 2ZM19 13h1a2 2 0 0 0 2-2v-1c0-4.42-3.58-8-8-8-1.36 0-2.64.34-3.76.94l1.5 1.5A5.98 5.98 0 0 1 20 11v.17l-1-1V13Z" />
                ) : (
                  <path d="M12 2C6.48 2 2 6.48 2 12v6a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H4v-1a8 8 0 0 1 16 0v1h-1a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-6c0-5.52-4.48-10-10-10Z" />
                )}
              </svg>
            </GroupControlButton>

            <ControlWithCaret
              open={screenShareCaretOpen}
              onToggle={() => setScreenShareCaretOpen((v) => !v)}
              ariaLabel={t("call.screenShareQuality")}
              panel={
                <QuickPanel title={t("call.screenShareQuality")} onClose={() => setScreenShareCaretOpen(false)}>
                  {SCREEN_SHARE_QUALITIES.map((q) => (
                    <label key={q} className="flex cursor-pointer items-center gap-2 text-sm text-normal">
                      <input
                        type="radio"
                        name="screenshare-quality"
                        checked={screenShareQuality === q}
                        onChange={() => {
                          setScreenShareQualityState(q);
                          setScreenShareQuality(q);
                          if (screenShareEnabled) {
                            void toggle(async () => {
                              await local.setScreenShareEnabled(false);
                              await startScreenShare(screenShareResolution(q));
                            });
                          }
                        }}
                      />
                      {t(`call.screenShareQuality.${q}`)}
                    </label>
                  ))}
                </QuickPanel>
              }
            >
              <GroupControlButton
                title={t("call.screenShare")}
                active={screenShareEnabled}
                onClick={() =>
                  void toggle(() =>
                    screenShareEnabled
                      ? local.setScreenShareEnabled(false)
                      : startScreenShare(screenShareResolution(screenShareQuality)),
                  )
                }
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                  <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4ZM4 16V6h16v10.01L4 16Z" />
                </svg>
              </GroupControlButton>
            </ControlWithCaret>

            <GroupControlButton
              title={t("call.soundboard")}
              active={soundboardOpen}
              onClick={() => {
                setAudioSettingsOpen(false);
                setSoundboardOpen((v) => !v);
              }}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8.03v7.94A4.5 4.5 0 0 0 16.5 12Zm-2.5-9v2.06c3.39.65 6 3.63 6 7.19s-2.61 6.54-6 7.19V22c4.48-.68 8-4.53 8-9.15S18.48 4.68 14 4Z" />
              </svg>
            </GroupControlButton>

            <GroupControlButton
              title={t("call.audioSettings")}
              active={audioSettingsOpen}
              onClick={() => {
                setSoundboardOpen(false);
                setAudioSettingsOpen((v) => !v);
              }}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                <path d="M19.14 12.94a7.14 7.14 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.24-1.12.55-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.14 7.14 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.24.42.32.6.22l2.39-.96c.5.39 1.04.7 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.58-.24 1.12-.55 1.62-.94l2.39.96c.18.1.47.02.6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" />
              </svg>
            </GroupControlButton>
          </>
        )}
        {soundboardOpen && <SoundboardPanel matrixRoom={matrixRoom} client={client} onClose={() => setSoundboardOpen(false)} />}
        {audioSettingsOpen && !localIsAudience && (
          <AudioSettingsPanel
            onClose={() => setAudioSettingsOpen(false)}
            noiseSuppressionEnabled={noiseSuppressionEnabled}
            onToggleNoiseSuppression={(enabled) => {
              setNoiseSuppressionEnabled(enabled);
              void refreshMicPipeline();
            }}
            preferredMicId={preferredMicId}
            onChangeMic={(deviceId) => {
              setPreferredMicId(deviceId);
              setPreferredMicIdState(deviceId ?? undefined);
              // Not switchActiveDevice: the published mic track is always routed
              // through a WebAudio graph now (for the gain slider below), so
              // picking a new device needs a full republish via publishMicrophone,
              // same as toggling noise suppression above.
              void refreshMicPipeline();
            }}
            preferredCameraId={preferredCameraId}
            onChangeCamera={(deviceId) => {
              setPreferredCameraId(deviceId);
              setPreferredCameraIdState(deviceId ?? undefined);
              if (deviceId) void room?.switchActiveDevice("videoinput", deviceId).catch(() => undefined);
            }}
            preferredSpeakerId={preferredSpeakerId}
            onChangeSpeaker={(deviceId) => {
              setPreferredSpeakerId(deviceId);
              setPreferredSpeakerIdState(deviceId ?? undefined);
              if (deviceId) switchActiveSpeaker(deviceId);
            }}
            micVolume={micVolume}
            onChangeMicVolume={(percent) => {
              setMicVolume(percent);
              setMicVolumeState(percent);
              setMicVolumeLive(percent);
            }}
            speakerVolume={speakerVolume}
            onChangeSpeakerVolume={(percent) => {
              setSpeakerVolume(percent);
              setSpeakerVolumeState(percent);
              reapplyAllUserCallPrefs(client);
            }}
            pttEnabled={pttEnabled}
            onTogglePtt={setPttEnabled}
            pttCode={pttCode}
            capturingKey={capturingKey}
            onCaptureKey={() => setCapturingKey(true)}
            soundboardEnabled={soundboardEnabled}
            onToggleSoundboardEnabled={(enabled) => {
              setSoundboardPlaybackEnabled(enabled);
              setSoundboardEnabledState(enabled);
            }}
            soundboardVolume={soundboardVolume}
            onChangeSoundboardVolume={(volume) => {
              setSoundboardVolume(volume);
              setSoundboardVolumeState(volume);
            }}
            callSoundsEnabled={callSoundsEnabled}
            onToggleCallSoundsEnabled={(enabled) => {
              setCallSoundsEnabled(enabled);
              setCallSoundsEnabledState(enabled);
            }}
            callSoundsVolume={callSoundsVolume}
            onChangeCallSoundsVolume={(volume) => {
              setCallSoundsVolume(volume);
              setCallSoundsVolumeState(volume);
            }}
          />
        )}

        <GroupControlButton title={t("call.leave")} danger onClick={() => void leave()}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1A17.9 17.9 0 0 0 12 9Z" />
          </svg>
        </GroupControlButton>
      </div>
      {busy && <span className="sr-only">{t("call.refreshing")}</span>}
    </div>
  );
}
