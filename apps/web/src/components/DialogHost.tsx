import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { type DialogRequest, useDialogStore } from "../state/dialogStore";

/**
 * Renders the app's own confirm/alert/prompt overlay (see lib/dialogs.ts),
 * always on top of any open Modal (z-[70] vs Modal's z-50) since a dialog
 * is very often raised from inside an already-open settings modal.
 */
export function DialogHost() {
  const queue = useDialogStore((s) => s.queue);
  const settle = useDialogStore((s) => s.settle);
  const request = queue[0];

  if (!request) return null;

  // Keyed by id so a brand-new request always gets a fresh mount instead of
  // an update - the prompt's initial value then comes straight from the
  // useState initializer (derived at mount) rather than a setState-in-effect
  // that copies it in after the fact.
  return <DialogBody key={request.id} request={request} settle={settle} />;
}

function DialogBody({
  request,
  settle,
}: {
  request: DialogRequest;
  settle: (id: number, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [value, setValue] = useState(request.kind === "prompt" ? request.defaultValue ?? "" : "");
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Captured during the first render, i.e. before the autoFocus input/button
  // below steals focus - so cleanup can hand focus back to the trigger.
  const previouslyFocused = useRef(document.activeElement as HTMLElement | null);

  useEffect(() => {
    if (request.kind === "prompt") requestAnimationFrame(() => inputRef.current?.select());
  }, [request.kind]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        settle(request.id, request.kind === "prompt" ? null : request.kind === "confirm" ? false : undefined);
      } else if (e.key === "Enter" && request.kind !== "prompt") {
        e.preventDefault();
        settle(request.id, request.kind === "confirm" ? true : undefined);
      } else if (e.key === "Tab") {
        // Focus trap: cycle Tab / Shift+Tab within the dialog.
        const root = formRef.current;
        if (!root) return;
        const items = [...root.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")];
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !root.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !root.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [request, settle]);

  const resolve = (v: unknown) => settle(request.id, v);

  return (
    <div className="animate-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-[2px]">
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={request.title ? titleId : undefined}
        data-testid="dialog"
        className="animate-scale-in w-full max-w-sm rounded-lg bg-bg-primary p-5 shadow-xl ring-1 ring-white/5"
        onSubmit={(e) => {
          e.preventDefault();
          resolve(request.kind === "prompt" ? value : request.kind === "confirm" ? true : undefined);
        }}
      >
        {request.title && <h2 id={titleId} className="mb-2 text-lg font-semibold text-header">{request.title}</h2>}
        <p className="whitespace-pre-wrap text-sm text-normal">{request.message}</p>
        {request.kind === "prompt" && (
          <input
            ref={inputRef}
            autoFocus
            value={value}
            placeholder={request.placeholder}
            aria-label={request.title}
            onChange={(e) => setValue(e.target.value)}
            className="mt-3 w-full rounded bg-bg-darkest px-3 py-2 text-normal outline-none focus:ring-2 focus:ring-brand"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          {request.kind !== "alert" && (
            <button
              type="button"
              data-testid="dialog-cancel"
              onClick={() => resolve(request.kind === "prompt" ? null : false)}
              className="rounded px-4 py-2 text-sm font-medium text-normal hover:bg-bg-modifier-hover"
            >
              {t("common.cancel")}
            </button>
          )}
          <button
            type="submit"
            data-testid="dialog-confirm"
            autoFocus={request.kind === "alert"}
            className={`rounded px-4 py-2 text-sm font-medium text-white transition ${
              request.kind === "confirm" && request.danger
                ? "bg-danger hover:brightness-90"
                : "bg-brand hover:bg-brand-hover"
            }`}
          >
            {request.kind === "confirm" ? (request.confirmLabel ?? t("common.confirm")) : t("common.confirm")}
          </button>
        </div>
      </form>
    </div>
  );
}
