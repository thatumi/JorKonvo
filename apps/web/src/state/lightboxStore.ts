import type { EncryptedFile } from "matrix-js-sdk/lib/@types/media.js";
import { create } from "zustand";

export interface LightboxItem {
  /** The attachment's mxc reference (plain or encrypted) - the lightbox
   *  resolves its own blob URL so it doesn't depend on the message row that
   *  opened it still being mounted. */
  content: { url?: string; file?: EncryptedFile };
  name: string;
  /** True for video, so the lightbox renders a <video> instead of an <img>. */
  video?: boolean;
}

interface LightboxState {
  item: LightboxItem | null;
  open: (item: LightboxItem) => void;
  close: () => void;
}

export const useLightboxStore = create<LightboxState>((set) => ({
  item: null,
  open: (item) => set({ item }),
  close: () => set({ item: null }),
}));
