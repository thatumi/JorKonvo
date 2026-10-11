import { nextDialogId, useDialogStore } from "../state/dialogStore";

/**
 * Drop-in async replacements for `window.alert`/`confirm`/`prompt`, rendered
 * as the app's own themed overlay (DialogHost.tsx) instead of the browser's
 * native chrome - which is unstyleable, blocks the whole tab (not just this
 * app), and looks jarringly out of place next to a Discord-style UI. Every
 * call site in the app should use these instead of the native globals.
 */
export function uiAlert(message: string, title?: string): Promise<void> {
  const id = nextDialogId();
  return new Promise<void>((resolve) => {
    useDialogStore.getState().push({ id, kind: "alert", message, title }, () => resolve());
  });
}

export function uiConfirm(
  message: string,
  options?: { title?: string; danger?: boolean; confirmLabel?: string },
): Promise<boolean> {
  const id = nextDialogId();
  return new Promise<boolean>((resolve) => {
    useDialogStore.getState().push(
      { id, kind: "confirm", message, title: options?.title, danger: options?.danger, confirmLabel: options?.confirmLabel },
      (value) => resolve(value as boolean),
    );
  });
}

export function uiPrompt(
  message: string,
  defaultValue?: string,
  options?: { title?: string; placeholder?: string },
): Promise<string | null> {
  const id = nextDialogId();
  return new Promise<string | null>((resolve) => {
    useDialogStore.getState().push(
      { id, kind: "prompt", message, defaultValue, title: options?.title, placeholder: options?.placeholder },
      (value) => resolve(value as string | null),
    );
  });
}
