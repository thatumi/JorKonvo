import {
  canControlWatchTogether,
  getWatchTogetherSession,
  reportWatchTogetherPlayback,
  stopWatchTogether,
  type Room,
} from "@jorkonvo/matrix-core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";

/** The slice of the YouTube IFrame Player API this component actually uses. */
interface YTPlayer {
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  loadVideoById: (videoId: string) => void;
  destroy: () => void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      events: { onStateChange: (e: { data: number }) => void };
    },
  ) => YTPlayer;
  PlayerState: { PLAYING: number; PAUSED: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoadPromise: Promise<YTNamespace> | null = null;

/** Loads the YouTube IFrame API script once and resolves with the global `YT` namespace - cached so mounting/unmounting the bar repeatedly never double-loads it. */
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiLoadPromise) return apiLoadPromise;
  apiLoadPromise = new Promise((resolve) => {
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevReady?.();
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return apiLoadPromise;
}

/** How far a follower's local position may drift from the host's reported one before it's forcibly reseeked - small network/timer jitter shouldn't cause constant reseeking. */
const DRIFT_TOLERANCE_SECONDS = 2.5;
const DRIFT_CHECK_INTERVAL_MS = 5000;

/**
 * How far the HOST's own player may drift from what was last reported before
 * it's treated as a manual seek and re-broadcast. Only a play/pause toggle
 * reports a fresh position on its own (via onStateChange below) - if the
 * host drags the scrub bar while paused, or seeks in a way that doesn't
 * happen to trigger a buffering->playing cycle, nothing else would ever
 * notice. Polling the host's own position and comparing it to where it
 * *should* be catches exactly that, the same way followers already poll for
 * their own drift.
 * The tolerance is deliberately looser than a real seek (which is usually a
 * jump of several seconds or more) so an ordinary network buffering stall on
 * the host's end - during which getCurrentTime() just stalls while real
 * time keeps ticking - doesn't get misread as a seek and re-broadcast as
 * the new "true" position.
 */
const HOST_SEEK_TOLERANCE_SECONDS = 4;
const HOST_SEEK_CHECK_INTERVAL_MS = 4000;

/**
 * Banner shown while a watch-together session is live in the room: hosts the
 * shared YouTube player and keeps everyone in sync with the host (followers
 * snap to reported positions and correct drift; the host re-broadcasts
 * manual seeks). Offers minimize, stop-for-everyone (controllers only) and
 * local dismiss controls; a dismissed bar can be re-opened via a Join on the
 * invite card.
 *
 * @param room - The room whose current watch-together session to play.
 */
export function WatchTogetherBar({ room }: { room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const session = getWatchTogetherSession(room);
  const ownUserId = client.getUserId() ?? "";
  const isHost = !!session && session.hostUserId === ownUserId;
  const mayControl = canControlWatchTogether(room, ownUserId);

  const [dismissed, setDismissed] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const loadedVideoIdRef = useRef<string | null>(null);
  const pendingJoin = useUiStore((s) => s.pendingWatchTogetherJoin);
  const clearPendingJoin = useUiStore((s) => s.clearPendingWatchTogetherJoin);

  // A brand-new session (different video) should reappear even if the
  // previous one was locally dismissed.
  useEffect(() => {
    setDismissed(false);
  }, [session?.videoId]);

  // Clicking "Join" on a watch-together invite card in the timeline (see
  // WatchTogetherInviteCard) re-opens the bar even for the SAME session -
  // otherwise a dismissed bar has no way back short of a brand-new session
  // starting.
  useEffect(() => {
    if (pendingJoin !== room.roomId) return;
    setDismissed(false);
    setMinimized(false);
    clearPendingJoin();
  }, [pendingJoin, room.roomId, clearPendingJoin]);

  useEffect(() => {
    if (!session || dismissed || !containerRef.current) return;
    let cancelled = false;
    void loadYouTubeApi().then((YT) => {
      if (cancelled || !containerRef.current) return;
      if (!playerRef.current) {
        playerRef.current = new YT.Player(containerRef.current, {
          videoId: session.videoId,
          events: {
            onStateChange: (e) => {
              if (!isHost) return;
              const player = playerRef.current;
              if (!player) return;
              if (e.data === YT.PlayerState.PLAYING) {
                void reportWatchTogetherPlayback(client, room.roomId, true, player.getCurrentTime());
              } else if (e.data === YT.PlayerState.PAUSED) {
                void reportWatchTogetherPlayback(client, room.roomId, false, player.getCurrentTime());
              }
            },
          },
        });
        loadedVideoIdRef.current = session.videoId;
      } else if (loadedVideoIdRef.current !== session.videoId) {
        playerRef.current.loadVideoById(session.videoId);
        loadedVideoIdRef.current = session.videoId;
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.videoId, dismissed]);

  useEffect(() => {
    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
      loadedVideoIdRef.current = null;
    };
  }, [room.roomId]);

  // The host (or another device) stopping the session removes it from room
  // state entirely - tear the player down rather than leaving it running
  // detached once this component's own render bails out to null below.
  const hasSession = !!session;
  useEffect(() => {
    if (hasSession) return;
    playerRef.current?.destroy();
    playerRef.current = null;
    loadedVideoIdRef.current = null;
  }, [hasSession]);

  // Followers track the host: snap to their reported position/play-state on
  // every update, then keep correcting for drift while playing (a state
  // event only proves where the host was AT `updatedAt` - elapsed real time
  // has to be added back in between updates).
  useEffect(() => {
    if (!session || isHost) return;
    const player = playerRef.current;
    if (!player) return;
    const expected = session.positionSeconds + (session.playing ? (Date.now() - session.updatedAt) / 1000 : 0);
    player.seekTo(expected, true);
    if (session.playing) player.playVideo();
    else player.pauseVideo();
    // Deliberately keyed on the individual fields, not `session` itself -
    // getWatchTogetherSession returns a fresh object every render (every
    // syncTick), so depending on it directly would refire this on every
    // render instead of only on an actual playback change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.playing, session?.positionSeconds, session?.updatedAt, isHost]);

  useEffect(() => {
    if (!session || isHost) return;
    const playing = session.playing;
    const positionSeconds = session.positionSeconds;
    const updatedAt = session.updatedAt;
    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player || !playing) return;
      const expected = positionSeconds + (Date.now() - updatedAt) / 1000;
      if (Math.abs(player.getCurrentTime() - expected) > DRIFT_TOLERANCE_SECONDS) {
        player.seekTo(expected, true);
      }
    }, DRIFT_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
    // Same reasoning as the sync effect above: keyed on the primitive
    // fields so this interval isn't torn down and recreated on every
    // unrelated re-render (session is a fresh object each time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.playing, session?.positionSeconds, session?.updatedAt, isHost]);

  // The host's own manual seeks: onStateChange only fires on an actual
  // play/pause transition, which a seek doesn't always trigger (most
  // reliably NOT while paused). Poll the host's own player against where it
  // should be given the last reported state, and re-broadcast if it's
  // moved - this is what makes "seek while paused" (and any other seek that
  // slips past onStateChange) actually reach everyone else.
  useEffect(() => {
    if (!session || !isHost) return;
    const playing = session.playing;
    const positionSeconds = session.positionSeconds;
    const updatedAt = session.updatedAt;
    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const expected = positionSeconds + (playing ? (Date.now() - updatedAt) / 1000 : 0);
      const current = player.getCurrentTime();
      if (Math.abs(current - expected) > HOST_SEEK_TOLERANCE_SECONDS) {
        void reportWatchTogetherPlayback(client, room.roomId, playing, current);
      }
    }, HOST_SEEK_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
    // Same reasoning as the two effects above: keyed on the primitive
    // fields, not `session` itself, so this isn't torn down and recreated
    // on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.playing, session?.positionSeconds, session?.updatedAt, isHost, client, room.roomId]);

  if (!session || dismissed) return null;

  const hostName = room.getMember(session.hostUserId)?.name ?? session.hostUserId;

  function dismiss() {
    // Returning null below would only remove the iframe from the DOM, not
    // the underlying YT.Player instance - explicitly tear it down so a
    // dismissed video actually stops instead of playing on detached.
    playerRef.current?.destroy();
    playerRef.current = null;
    loadedVideoIdRef.current = null;
    setDismissed(true);
  }

  return (
    <div className="border-b border-border bg-bg-secondary/60">
      <div className="flex items-center gap-2 px-4 py-1.5">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-brand" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7L8 5Z" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {t("watchTogether.hostedBy", { name: hostName })}
        </span>
        <button
          type="button"
          onClick={() => setMinimized((v) => !v)}
          className="rounded p-1 text-muted hover:bg-bg-modifier-hover hover:text-normal"
          title={minimized ? t("watchTogether.expand") : t("watchTogether.minimize")}
          aria-label={minimized ? t("watchTogether.expand") : t("watchTogether.minimize")}
          aria-pressed={minimized}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            {minimized ? <path d="M4 12h16v2H4z" /> : <path d="M19 13H5v-2h14v2Z" />}
          </svg>
        </button>
        {mayControl && (
          <button
            type="button"
            onClick={() => void stopWatchTogether(client, room.roomId)}
            className="rounded p-1 text-muted hover:bg-dnd/15 hover:text-dnd"
            title={t("watchTogether.stop")}
            aria-label={t("watchTogether.stop")}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M6 6h12v12H6z" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="rounded p-1 text-muted hover:bg-bg-modifier-hover hover:text-normal"
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
          </svg>
        </button>
      </div>
      <div className={minimized ? "hidden" : "aspect-video w-full max-h-[45vh]"}>
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
