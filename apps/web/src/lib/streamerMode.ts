import { create } from "zustand";

/**
 * Discord's Streamer Mode - a manual toggle that hides personal information
 * you wouldn't want on a live stream (your email / linked addresses,
 * invite links) and silences notification + call sounds. Discord also
 * offers auto-activation tied to detecting streaming software; a web/Tauri
 * client has no reliable way to detect that, so this is manual-only.
 *
 * Device-local (localStorage): it's about what THIS screen is showing right
 * now, no cross-device meaning.
 */
const KEY = "jorkonvo-streamer-mode";

interface StreamerModeState {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export const useStreamerModeStore = create<StreamerModeState>((set) => ({
  enabled: read(),
  setEnabled: (v) => {
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ enabled: v });
  },
}));

/** Non-reactive read for use outside React (sound-playback guards). */
export function isStreamerModeActive(): boolean {
  return useStreamerModeStore.getState().enabled;
}
