import { create } from "zustand";

/**
 * Backing store for the app's own confirm/alert/prompt replacements (see
 * lib/dialogs.ts) - a small stack (not a single slot like modalStore) so a
 * confirm dialog raised from inside an already-open settings modal (e.g.
 * "Kirúgás megerősítése" from within SpaceSettingsModal) layers on top of it
 * instead of replacing it.
 */
export type DialogRequest =
  | { id: number; kind: "alert"; message: string; title?: string }
  | { id: number; kind: "confirm"; message: string; title?: string; danger?: boolean; confirmLabel?: string }
  | { id: number; kind: "prompt"; message: string; title?: string; defaultValue?: string; placeholder?: string };

export type DialogResult<K extends DialogRequest["kind"]> = K extends "alert"
  ? void
  : K extends "confirm"
    ? boolean
    : string | null;

interface DialogStoreState {
  queue: DialogRequest[];
  resolvers: Map<number, (value: unknown) => void>;
  push: (request: DialogRequest, resolve: (value: unknown) => void) => void;
  settle: (id: number, value: unknown) => void;
}

let nextId = 1;

export const useDialogStore = create<DialogStoreState>((set, get) => ({
  queue: [],
  resolvers: new Map(),
  push: (request, resolve) => {
    get().resolvers.set(request.id, resolve);
    set((s) => ({ queue: [...s.queue, request] }));
  },
  settle: (id, value) => {
    const resolve = get().resolvers.get(id);
    get().resolvers.delete(id);
    resolve?.(value);
    set((s) => ({ queue: s.queue.filter((d) => d.id !== id) }));
  },
}));

export function nextDialogId(): number {
  return nextId++;
}
