import { create } from "zustand";

/**
 * Rebindable global keyboard shortcuts. This store owns only the *bindings*
 * (which key combo triggers which action); the actual behaviour lives in
 * KeyboardShortcutsLayer.tsx, which reads bindings from here and matches
 * incoming KeyboardEvents against them. Push-to-talk keeps its own separate
 * store (pushToTalkStore.ts) - it's a hold-to-activate key, not a
 * press-once action, and predates this.
 */

export interface KeyCombo {
  /** KeyboardEvent.code - physical key, layout-independent (e.g. "KeyM", "ArrowUp", "Slash"). */
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export type KeybindActionId =
  | "toggleMute"
  | "toggleDeafen"
  | "toggleMemberList"
  | "navChannelPrev"
  | "navChannelNext"
  | "toggleSearch"
  | "markRead"
  | "toggleHelp";

/** The action ids in the order they should appear in settings, with their factory defaults. */
export const KEYBIND_DEFAULTS: { id: KeybindActionId; combo: KeyCombo }[] = [
  { id: "toggleMute", combo: { code: "KeyM", ctrl: true, shift: true, alt: false, meta: false } },
  { id: "toggleDeafen", combo: { code: "KeyD", ctrl: true, shift: true, alt: false, meta: false } },
  { id: "toggleMemberList", combo: { code: "KeyU", ctrl: true, shift: false, alt: false, meta: false } },
  { id: "navChannelPrev", combo: { code: "ArrowUp", ctrl: false, shift: false, alt: true, meta: false } },
  { id: "navChannelNext", combo: { code: "ArrowDown", ctrl: false, shift: false, alt: true, meta: false } },
  { id: "toggleSearch", combo: { code: "KeyF", ctrl: true, shift: false, alt: false, meta: false } },
  { id: "markRead", combo: { code: "Escape", ctrl: false, shift: false, alt: false, meta: false } },
  { id: "toggleHelp", combo: { code: "Slash", ctrl: false, shift: false, alt: false, meta: false } },
];

const STORAGE_KEY = "jorkonvo-keybinds";

function loadOverrides(): Partial<Record<KeybindActionId, KeyCombo>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function buildBindings(): Record<KeybindActionId, KeyCombo> {
  const overrides = loadOverrides();
  const out = {} as Record<KeybindActionId, KeyCombo>;
  for (const { id, combo } of KEYBIND_DEFAULTS) out[id] = overrides[id] ?? combo;
  return out;
}

interface KeybindsState {
  bindings: Record<KeybindActionId, KeyCombo>;
  setBinding: (id: KeybindActionId, combo: KeyCombo) => void;
  resetBinding: (id: KeybindActionId) => void;
}

export const useKeybindsStore = create<KeybindsState>((set, get) => ({
  bindings: buildBindings(),
  setBinding: (id, combo) => {
    const next = { ...get().bindings, [id]: combo };
    persistOverrides(next);
    set({ bindings: next });
  },
  resetBinding: (id) => {
    const factory = KEYBIND_DEFAULTS.find((d) => d.id === id)!.combo;
    const next = { ...get().bindings, [id]: factory };
    persistOverrides(next);
    set({ bindings: next });
  },
}));

function persistOverrides(bindings: Record<KeybindActionId, KeyCombo>): void {
  const overrides: Partial<Record<KeybindActionId, KeyCombo>> = {};
  for (const { id, combo } of KEYBIND_DEFAULTS) {
    if (!combosEqual(bindings[id], combo)) overrides[id] = bindings[id];
  }
  try {
    if (Object.keys(overrides).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function combosEqual(a: KeyCombo, b: KeyCombo): boolean {
  return a.code === b.code && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.meta === b.meta;
}

/** True when `e` matches `combo` exactly (all modifiers, physical key). */
export function eventMatchesCombo(e: KeyboardEvent, combo: KeyCombo): boolean {
  return (
    e.code === combo.code &&
    e.ctrlKey === combo.ctrl &&
    e.shiftKey === combo.shift &&
    e.altKey === combo.alt &&
    e.metaKey === combo.meta
  );
}

/** Reads a KeyboardEvent into a combo - null for a bare modifier press (not a usable binding on its own). */
export function comboFromEvent(e: KeyboardEvent): KeyCombo | null {
  if (["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(e.code)) {
    return null;
  }
  return { code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey };
}

/** Human-readable combo, e.g. "Ctrl + Shift + M". */
export function describeCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push("Ctrl");
  if (combo.meta) parts.push("⌘");
  if (combo.alt) parts.push("Alt");
  if (combo.shift) parts.push("Shift");
  parts.push(describeKeyCode(combo.code));
  return parts.join(" + ");
}

function describeKeyCode(code: string): string {
  if (code === "Space") return "Space";
  if (code === "Slash") return "/";
  if (code === "Escape") return "Esc";
  if (code === "ArrowUp") return "↑";
  if (code === "ArrowDown") return "↓";
  if (code === "ArrowLeft") return "←";
  if (code === "ArrowRight") return "→";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}
