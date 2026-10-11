import { create } from "zustand";

/**
 * A personal chat wallpaper - a background image shown behind the message
 * timeline, à la Telegram. Device-local (localStorage): it's a per-device
 * cosmetic choice and can be a large data: URL, which has no business
 * syncing through account data. Applied by setting CSS custom properties on
 * <html> that index.css's .jk-chat-wallpaper rule reads.
 */

const STORAGE_KEY = "jorkonvo-chat-wallpaper";
const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.82;

interface Stored {
  dataUrl: string;
  /** 0..1 - how much to dim the image so text stays readable. */
  dim: number;
}

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.dataUrl !== "string") return null;
    return { dataUrl: parsed.dataUrl, dim: typeof parsed.dim === "number" ? parsed.dim : 0.6 };
  } catch {
    return null;
  }
}

function apply(value: Stored | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!value) {
    root.style.removeProperty("--jk-chat-wallpaper");
    root.style.removeProperty("--jk-chat-wallpaper-dim");
    delete root.dataset.wallpaper;
    return;
  }
  root.style.setProperty("--jk-chat-wallpaper", `url(${value.dataUrl})`);
  root.style.setProperty("--jk-chat-wallpaper-dim", String(value.dim));
  root.dataset.wallpaper = "on";
}

/** Downscale a picked image file to a reasonable data URL. */
export async function fileToWallpaperDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas context");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

interface ChatWallpaperState {
  wallpaper: Stored | null;
  setWallpaper: (dataUrl: string) => void;
  setDim: (dim: number) => void;
  clear: () => void;
}

export const useChatWallpaperStore = create<ChatWallpaperState>((set, get) => ({
  wallpaper: read(),
  setWallpaper: (dataUrl) => {
    const next: Stored = { dataUrl, dim: get().wallpaper?.dim ?? 0.6 };
    persist(next);
    set({ wallpaper: next });
  },
  setDim: (dim) => {
    const current = get().wallpaper;
    if (!current) return;
    const next = { ...current, dim: Math.min(1, Math.max(0, dim)) };
    persist(next);
    set({ wallpaper: next });
  },
  clear: () => {
    persist(null);
    set({ wallpaper: null });
  },
}));

function persist(value: Stored | null): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* quota / private mode - the image just won't persist */
  }
  apply(value);
}

/** Call once on boot. */
export function initChatWallpaper(): void {
  apply(read());
}
