import {
  CallErrorCode,
  type CallFeed,
  CallState,
  CallType,
  getOtherPartyName,
  localFeed,
  localScreenShareFeed,
  remoteFeeds,
  SDPStreamMetadataPurpose,
} from "@jorkonvo/matrix-core";
import { useEffect, useRef, useState } from "react";
import { playCallSound } from "../lib/callSounds";
import { useCallUiStore } from "../lib/callUi";
import { useTranslation } from "../i18n";
import { useCallStore } from "../state/callStore";
import { useMatrixStore } from "../state/matrixStore";
import { describeKeyCode, usePushToTalkStore } from "../state/pushToTalkStore";
import { Avatar } from "./Avatar";
import { MiniCallBar, MiniControl, MinimizeIcon } from "./CallMiniBar";

function MediaTile({ feed, label, muted }: { feed: CallFeed; label: string; muted: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo =
    feed.purpose === SDPStreamMetadataPurpose.Screenshare ||
    (!feed.isVideoMuted() && feed.stream.getVideoTracks().length > 0);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = feed.stream;
  }, [feed, feed.stream]);

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-bg-darkest">
      {isVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={muted} aria-label={label} className="h-full w-full object-contain" />
      ) : (
        <audio ref={videoRef as never} autoPlay muted={muted} />
      )}
      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{label}</span>
    </div>
  );
}

function ControlButton({
  onClick,
  active,
  danger,
  title,
  testId,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  title: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
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

function IncomingCallBanner() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const call = useCallStore((s) => s.call)!;
  const room = client.getRoom(call.roomId);
  const callerName = room ? getOtherPartyName(room, client.getUserId()) : call.roomId;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-4 bg-bg-primary px-6 pb-4 pt-[calc(1rem_+_env(safe-area-inset-top))] shadow-xl">
      <Avatar url={room?.getAvatarUrl(client.baseUrl, 40, 40, "crop", false) ?? null} name={callerName} size={40} />
      <div>
        <div className="font-semibold text-header">{callerName}</div>
        <div className="text-sm text-muted">
          {call.type === CallType.Video ? t("call.incomingVideo") : t("call.incomingVoice")}
        </div>
      </div>
      <button
        type="button"
        data-testid="call-accept"
        onClick={() => void call.answer()}
        className="ml-4 rounded-full bg-online px-5 py-2 font-medium text-white hover:opacity-90"
      >
        {t("call.accept")}
      </button>
      <button
        type="button"
        data-testid="call-decline"
        onClick={() => call.reject()}
        className="rounded-full bg-dnd px-5 py-2 font-medium text-white hover:opacity-90"
      >
        {t("call.decline")}
      </button>
    </div>
  );
}

function ActiveCallScreen() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const call = useCallStore((s) => s.call)!;
  useCallStore((s) => s.tick);
  const [error, setError] = useState<string | null>(null);

  const room = client.getRoom(call.roomId);
  const otherName = room ? getOtherPartyName(room, client.getUserId()) : call.roomId;

  const local = localFeed(call);
  const localScreen = localScreenShareFeed(call);
  const remotes = remoteFeeds(call);

  const isMicMuted = call.isMicrophoneMuted();
  const isVideoMuted = call.isLocalVideoMuted();
  const isSharingScreen = call.isScreensharing();

  const minimized = useCallUiStore((s) => s.minimized);
  const setMinimized = useCallUiStore((s) => s.setMinimized);
  const pttEnabled = usePushToTalkStore((s) => s.enabled);
  const pttCode = usePushToTalkStore((s) => s.code);

  // A fresh call always opens full-size.
  useEffect(() => {
    setMinimized(false);
  }, [setMinimized]);

  // Push-to-talk for the 1:1 call: mic closed while the effect is active,
  // opened only while the configured key is held.
  useEffect(() => {
    if (!pttEnabled) return;
    void call.setMicrophoneMuted(true);
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === pttCode && !e.repeat) void call.setMicrophoneMuted(false);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === pttCode) void call.setMicrophoneMuted(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      void call.setMicrophoneMuted(false);
    };
  }, [pttEnabled, pttCode, call]);

  async function toggleScreenShare() {
    try {
      await call.setScreensharingEnabled(!isSharingScreen);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const stateLabel =
    call.state === CallState.Connecting || call.state === CallState.CreateOffer || call.state === CallState.InviteSent
      ? t("call.ringing")
      : call.state === CallState.Connected
        ? t("call.connected")
        : call.state;

  const micIcon = (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      {isMicMuted ? (
        <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28ZM4.27 3 3 4.27l6.01 6.01V11a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08L14.14 15.42A4.98 4.98 0 0 1 7 10.5H5.3c0 3.24 2.4 5.85 5.7 6.33V20h2v-3.17c.6-.09 1.16-.27 1.68-.53L19.73 21 21 19.73 4.27 3Z" />
      ) : (
        <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5.3c0 3.28 2.39 5.99 5.5 6.42V20h2.4v-2.58c3.11-.43 5.5-3.14 5.5-6.42H17Z" />
      )}
    </svg>
  );

  if (minimized) {
    return (
      <MiniCallBar title={otherName} subtitle={stateLabel} onExpand={() => setMinimized(false)}>
        <MiniControl
          title={isMicMuted ? t("call.unmute") : t("call.mute")}
          active={!isMicMuted}
          onClick={() => {
            playCallSound(isMicMuted ? "mic-unmute" : "mic-mute");
            void call.setMicrophoneMuted(!isMicMuted);
          }}
        >
          {micIcon}
        </MiniControl>
        {isSharingScreen && (
          <MiniControl title={t("call.screenShareStop")} danger onClick={() => void toggleScreenShare()}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4ZM4 16V6h16v10.01L4 16Z" />
            </svg>
          </MiniControl>
        )}
        <MiniControl title={t("call.hangUp")} danger onClick={() => call.hangup(CallErrorCode.UserHangup, false)}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1A17.9 17.9 0 0 0 12 9Z" />
          </svg>
        </MiniControl>
      </MiniCallBar>
    );
  }

  return (
    // Bottom inset: the control row is bottom-anchored interactive UI, so on
    // a phone it must clear the home indicator (p-6's 24px alone doesn't).
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
        <div className="text-lg font-semibold">{otherName}</div>
        {/* aria-live: the label changes as the call progresses (ringing -> connected). */}
        <div data-testid="call-state" className="text-sm text-white/60" aria-live="polite">{stateLabel}</div>
        {pttEnabled && (
          <div className="mt-1 text-xs text-white/50">
            {t("call.pttHint", { key: describeKeyCode(pttCode) })}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-wrap gap-3 overflow-y-auto">
          {remotes.map((feed) => (
            <MediaTile key={feed.stream.id} feed={feed} label={otherName} muted={false} />
          ))}
          {remotes.length === 0 && (
            <div className="flex flex-1 items-center justify-center text-white/60">
              {t("callOverlay.waitingForPeer")}
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-3">
          {local && <div className="h-32 w-48 shrink-0"><MediaTile feed={local} label="Te" muted /></div>}
          {localScreen && (
            <div className="h-32 w-48 shrink-0"><MediaTile feed={localScreen} label={t("callOverlay.screenShare")} muted /></div>
          )}
        </div>
      </div>

      {error && <p className="mt-2 shrink-0 text-center text-sm text-dnd">{error}</p>}

      <div className="mt-6 flex shrink-0 items-center justify-center gap-4">
        <ControlButton
          title={isMicMuted ? t("call.unmute") : t("call.mute")}
          active={!isMicMuted}
          onClick={() => {
            playCallSound(isMicMuted ? "mic-unmute" : "mic-mute");
            void call.setMicrophoneMuted(!isMicMuted);
          }}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
            {isMicMuted ? (
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28ZM4.27 3 3 4.27l6.01 6.01V11a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08L14.14 15.42A4.98 4.98 0 0 1 7 10.5H5.3c0 3.24 2.4 5.85 5.7 6.33V20h2v-3.17c.6-.09 1.16-.27 1.68-.53L19.73 21 21 19.73 4.27 3Z" />
            ) : (
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5.3c0 3.28 2.39 5.99 5.5 6.42V20h2.4v-2.58c3.11-.43 5.5-3.14 5.5-6.42H17Z" />
            )}
          </svg>
        </ControlButton>

        {call.type === CallType.Video && (
          <ControlButton
            title={isVideoMuted ? t("call.cameraOn") : t("call.cameraOff")}
            active={!isVideoMuted}
            onClick={() => void call.setLocalVideoMuted(!isVideoMuted)}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
              {isVideoMuted ? (
                <path d="M21 6.5 17 10V7a1 1 0 0 0-1-1H9.83l1.5 1.5H16v6.67l1.5 1.5L21 15V6.5ZM3.4 2 2 3.4l3.6 3.6H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h11c.28 0 .53-.11.71-.29l2.89 2.89L19 19.19 3.4 2Z" />
              ) : (
                <path d="M17 10.5V7a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z" />
              )}
            </svg>
          </ControlButton>
        )}

        <ControlButton title={t("call.screenShare")} active={isSharingScreen} onClick={() => void toggleScreenShare()}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
            <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4ZM4 16V6h16v10.01L4 16Z" />
          </svg>
        </ControlButton>

        <ControlButton
          title={t("call.hangUp")}
          danger
          testId="call-hangup"
          onClick={() => call.hangup(CallErrorCode.UserHangup, false)}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1A17.9 17.9 0 0 0 12 9Z" />
          </svg>
        </ControlButton>
      </div>
    </div>
  );
}

/**
 * Full-screen UI for 1:1 Matrix calls: an incoming-call banner while ringing,
 * otherwise the active-call screen with media tiles and mute/camera/screen-share/
 * hang-up controls, collapsible to the mini bar. Renders nothing without a call.
 */
export function CallOverlay() {
  const call = useCallStore((s) => s.call);
  useCallStore((s) => s.tick);

  if (!call) return null;
  if (call.state === CallState.Ringing) return <IncomingCallBanner />;
  if (call.state === CallState.Ended) return null;
  return <ActiveCallScreen />;
}
