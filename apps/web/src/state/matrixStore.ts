import type { MatrixClient } from "@jorkonvo/matrix-core";
import { create } from "zustand";

interface MatrixState {
  client: MatrixClient | null;
  ready: boolean;
  /** Bumped whenever a relevant client event fires, to force derived-state re-reads. */
  syncTick: number;
  setClient: (client: MatrixClient | null) => void;
  setReady: (ready: boolean) => void;
  bumpTick: () => void;
}

export const useMatrixStore = create<MatrixState>((set) => ({
  client: null,
  ready: false,
  syncTick: 0,
  setClient: (client) => set({ client }),
  setReady: (ready) => set({ ready }),
  bumpTick: () => set((s) => ({ syncTick: s.syncTick + 1 })),
}));
