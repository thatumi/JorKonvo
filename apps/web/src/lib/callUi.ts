import { create } from "zustand";

/**
 * Shared "is the call overlay minimised?" flag. When minimised, the full-screen
 * call screen collapses to a small floating control bar pinned to the corner of
 * the page, so you can keep using the rest of the app (or the tab you're
 * screen-sharing) while still being one click from mute / stop-share / hang-up.
 *
 * Each call screen resets this to false on mount, so a new call always opens
 * full-size.
 */
interface CallUiState {
  minimized: boolean;
  setMinimized: (minimized: boolean) => void;
  toggleMinimized: () => void;
}

export const useCallUiStore = create<CallUiState>((set) => ({
  minimized: false,
  setMinimized: (minimized) => set({ minimized }),
  toggleMinimized: () => set((s) => ({ minimized: !s.minimized })),
}));
