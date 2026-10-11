import { ScreenSharePresets, type VideoResolution } from "livekit-client";

/**
 * Personal screen-share resolution/framerate preference - a per-user client
 * choice (like mic volume), not a room-admin policy (that's voiceChannels.ts's
 * getVoiceVideoQuality, for the CAMERA feed). Persisted in localStorage since
 * it's a "how I like to share", not something worth syncing across devices.
 */
export type ScreenShareQuality = "1080p30" | "1080p15" | "720p30" | "720p15" | "original";

const KEY = "jorkonvo-screenshare-quality";
const DEFAULT_QUALITY: ScreenShareQuality = "1080p30";

const PRESET_BY_QUALITY: Record<ScreenShareQuality, VideoResolution> = {
  "1080p30": ScreenSharePresets.h1080fps30.resolution,
  "1080p15": ScreenSharePresets.h1080fps15.resolution,
  "720p30": ScreenSharePresets.h720fps30.resolution,
  "720p15": ScreenSharePresets.h720fps15.resolution,
  original: ScreenSharePresets.original.resolution,
};

export const SCREEN_SHARE_QUALITIES: ScreenShareQuality[] = ["original", "1080p30", "1080p15", "720p30", "720p15"];

export function getScreenShareQuality(): ScreenShareQuality {
  try {
    const stored = localStorage.getItem(KEY);
    return stored && stored in PRESET_BY_QUALITY ? (stored as ScreenShareQuality) : DEFAULT_QUALITY;
  } catch {
    return DEFAULT_QUALITY;
  }
}

export function setScreenShareQuality(quality: ScreenShareQuality): void {
  try {
    localStorage.setItem(KEY, quality);
  } catch {
    /* storage unavailable - preference just won't persist */
  }
}

export function screenShareResolution(quality: ScreenShareQuality): VideoResolution {
  return PRESET_BY_QUALITY[quality];
}
