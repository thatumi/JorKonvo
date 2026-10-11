import { create } from "zustand";

/**
 * Tracks (at most) one active OUTGOING live location share at a time, in
 * this browser tab. Matches the underlying protocol reality: a live share is
 * a single beacon_info state event per (room, user) - re-sharing just
 * upserts it rather than creating a second one - so there is no meaningful
 * "share to two rooms simultaneously" state to represent beyond what this
 * single-slot store already covers for a normal user action.
 */
export interface ActiveLocationShare {
  roomId: string;
  beaconInfoEventId: string;
  expiresAt: number;
}

interface LocationShareState {
  active: ActiveLocationShare | null;
  watchId: number | null;
  start: (share: ActiveLocationShare, watchId: number) => void;
  stop: () => void;
}

export const useLocationShareStore = create<LocationShareState>((set, get) => ({
  active: null,
  watchId: null,
  start: (share, watchId) => {
    const prevWatchId = get().watchId;
    if (prevWatchId !== null) navigator.geolocation.clearWatch(prevWatchId);
    set({ active: share, watchId });
  },
  stop: () => {
    const prevWatchId = get().watchId;
    if (prevWatchId !== null) navigator.geolocation.clearWatch(prevWatchId);
    set({ active: null, watchId: null });
  },
}));
