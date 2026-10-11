import { create } from "zustand";

const ENABLED_KEY = "jorkonvo-ptt-enabled";
const CODE_KEY = "jorkonvo-ptt-code";
const DEFAULT_CODE = "Space";

function readEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "1";
}

function readCode(): string {
  return localStorage.getItem(CODE_KEY) ?? DEFAULT_CODE;
}

interface PushToTalkState {
  enabled: boolean;
  /** A KeyboardEvent.code (physical key, not layout-dependent), e.g. "Space", "KeyV". */
  code: string;
  setEnabled: (enabled: boolean) => void;
  setCode: (code: string) => void;
}

export const usePushToTalkStore = create<PushToTalkState>((set) => ({
  enabled: readEnabled(),
  code: readCode(),
  setEnabled: (enabled) => {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
    set({ enabled });
  },
  setCode: (code) => {
    localStorage.setItem(CODE_KEY, code);
    set({ code });
  },
}));

/** Friendly label for a KeyboardEvent.code value. */
export function describeKeyCode(code: string): string {
  if (code === "Space") return "Szóköz";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Control")) return "Ctrl";
  if (code.startsWith("Shift")) return "Shift";
  if (code.startsWith("Alt")) return "Alt";
  return code;
}
