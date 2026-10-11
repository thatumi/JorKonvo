import { useEffect } from "react";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";
import { useVerificationStore } from "../state/verificationStore";

function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * A non-blocking toast for an incoming E2EE verification request the other
 * person started. Deliberately NOT a screen-covering modal: a modal that
 * auto-pops on every request could be used to interrupt or grief someone by
 * spamming them. "Ignore" also snoozes further requests from that user for a
 * while (see verificationStore). The full verification modal only opens once
 * you click "Verify" here (or start one yourself).
 */
export function VerificationToast() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client);
  const incoming = useVerificationStore((s) => s.incomingRequest);
  const accept = useVerificationStore((s) => s.acceptIncoming);
  const ignore = useVerificationStore((s) => s.ignoreIncoming);
  const bump = useVerificationStore((s) => s.bump);
  useVerificationStore((s) => s.tick);

  useEffect(() => {
    if (!incoming?.pending) return;
    const interval = setInterval(bump, 1000);
    return () => clearInterval(interval);
  }, [incoming, bump]);

  if (!incoming || !client) return null;

  const otherName =
    client.getRoom(incoming.roomId ?? "")?.getMember(incoming.otherUserId)?.name ||
    client.getUser(incoming.otherUserId)?.displayName ||
    incoming.otherUserId;

  return (
    <div className="animate-slide-in-up fixed bottom-[calc(1rem_+_env(safe-area-inset-bottom))] right-[calc(1rem_+_env(safe-area-inset-right))] z-40 w-72 rounded-lg border border-border bg-bg-floating p-3 shadow-2xl ring-1 ring-white/5">
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-brand" fill="currentColor" aria-hidden="true">
          <path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm-1 13.99-4-4L8.41 9.6 11 12.17l4.59-4.58L17 9l-6 5.99Z" />
        </svg>
        <div className="min-w-0">
          <p aria-live="polite" className="text-sm font-semibold text-header">{t("verify.incomingTitle", { name: otherName })}</p>
          <p className="mt-0.5 text-xs text-muted">{t("verify.incomingBody")}</p>
          {incoming.timeout !== null && (
            <p className="mt-1 text-[11px] text-muted">
              {t("verify.incomingExpires", { time: formatCountdown(incoming.timeout) })}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          data-testid="verify-incoming-ignore"
          onClick={ignore}
          className="flex-1 rounded border border-border py-1.5 text-xs font-medium text-muted transition hover:bg-bg-modifier-hover hover:text-normal"
        >
          {t("verify.incomingIgnore")}
        </button>
        <button
          type="button"
          data-testid="verify-incoming-accept"
          onClick={accept}
          className="flex-1 rounded bg-brand py-1.5 text-xs font-medium text-white transition hover:bg-brand-hover"
        >
          {t("verify.incomingVerify")}
        </button>
      </div>
    </div>
  );
}
