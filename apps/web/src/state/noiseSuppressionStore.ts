import { create } from "zustand";

const STORAGE_KEY = "jorkonvo-noise-suppression";

function readStored(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? true : stored === "1";
}

interface NoiseSuppressionState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useNoiseSuppressionStore = create<NoiseSuppressionState>((set) => ({
  enabled: readStored(),
  setEnabled: (enabled) => {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    set({ enabled });
  },
}));
