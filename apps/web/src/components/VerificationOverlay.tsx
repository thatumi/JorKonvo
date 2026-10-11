import { QR_SCAN_METHOD, QR_SHOW_METHOD, VerificationPhase } from "@jorkonvo/matrix-core";
import { useEffect } from "react";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";
import { useVerificationStore } from "../state/verificationStore";
import { QrScanner } from "./QrScanner";

function Card({ children }: { children: React.ReactNode }) {
  return (
    // pt: the card is vertically centred, but tall phases (QR + emoji grid)
    // can push it to the top edge - keep it clear of the Dynamic Island too.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-lg bg-bg-primary p-6 text-center shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Blocking modal that drives the whole E2EE device-verification flow for the
 * request currently in the verification store - method picker, SAS emoji
 * comparison, QR show/scan, and the done/cancelled/error states. Requests
 * started by the OTHER side first appear as a VerificationToast and only
 * land here once accepted.
 */
export function VerificationOverlay() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client);
  const request = useVerificationStore((s) => s.request);
  const sas = useVerificationStore((s) => s.sas);
  const showQrDataUrl = useVerificationStore((s) => s.showQrDataUrl);
  const reciprocateQr = useVerificationStore((s) => s.reciprocateQr);
  const scanning = useVerificationStore((s) => s.scanning);
  const error = useVerificationStore((s) => s.error);
  const reset = useVerificationStore((s) => s.reset);
  const chooseSas = useVerificationStore((s) => s.chooseSas);
  const chooseShowQr = useVerificationStore((s) => s.chooseShowQr);
  const chooseScanQr = useVerificationStore((s) => s.chooseScanQr);
  const setScanning = useVerificationStore((s) => s.setScanning);
  const bump = useVerificationStore((s) => s.bump);
  useVerificationStore((s) => s.tick);

  // The remaining-time countdown needs its own ticker - request.timeout is a
  // plain getter, not something the SDK's Change event fires on every second.
  useEffect(() => {
    if (!request?.pending) return;
    const interval = setInterval(bump, 1000);
    return () => clearInterval(interval);
  }, [request, bump]);

  if (error) {
    return (
      <Card>
        <div className="mb-3 text-3xl">⚠️</div>
        <h2 aria-live="polite" className="mb-2 text-lg font-semibold text-header">{t("verify.failedTitle")}</h2>
        <p className="mb-4 text-sm text-muted">{error}</p>
        <button
          type="button"
          onClick={reset}
          className="w-full rounded bg-bg-secondary py-2 text-sm font-medium text-normal hover:bg-bg-modifier-hover"
        >
          {t("verify.close")}
        </button>
      </Card>
    );
  }

  if (!request || !client) return null;

  const otherName =
    client.getRoom(request.roomId ?? "")?.getMember(request.otherUserId)?.name ||
    client.getUser(request.otherUserId)?.displayName ||
    request.otherUserId;

  if (sas) {
    return (
      <Card>
        <h2 aria-live="polite" className="mb-2 text-lg font-semibold text-header">{t("verify.compareTitle")}</h2>
        <p className="mb-4 text-sm text-muted">{t("verify.compareBody", { name: otherName })}</p>
        <div data-testid="verify-sas-emoji" className="mb-6 grid grid-cols-4 gap-3">
          {sas.sas.emoji?.map(([emoji, name], i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <span className="text-2xl">{emoji}</span>
              <span data-testid="verify-sas-emoji-name" className="text-[10px] text-muted">{name}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="verify-sas-no-match"
            onClick={() => {
              // sas is only ever cleared by the verifier's own Cancel event
              // (see wireVerifier) - clear it here too so the UI falls
              // through to the Cancelled/waiting screen right away instead
              // of showing this stale SAS card until that event arrives.
              void sas.mismatch();
              useVerificationStore.setState({ sas: null });
            }}
            className="flex-1 rounded border border-dnd py-2 text-sm font-medium text-dnd hover:bg-dnd/10"
          >
            {t("verify.noMatch")}
          </button>
          <button
            type="button"
            data-testid="verify-sas-match"
            onClick={() => {
              void sas.confirm();
              useVerificationStore.setState({ sas: null });
            }}
            className="flex-1 rounded bg-brand py-2 text-sm font-medium text-white hover:bg-brand-hover"
          >
            {t("verify.match")}
          </button>
        </div>
      </Card>
    );
  }

  if (reciprocateQr) {
    return (
      <Card>
        <div className="mb-3 text-3xl">📷</div>
        <h2 aria-live="polite" className="mb-2 text-lg font-semibold text-header">
          {t("verify.otherScannedTitle", { name: otherName })}
        </h2>
        <p className="mb-4 text-sm text-muted">
          {t("verify.otherScannedBody", { name: otherName })}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              reciprocateQr.cancel();
              useVerificationStore.setState({ reciprocateQr: null });
            }}
            className="flex-1 rounded border border-dnd py-2 text-sm font-medium text-dnd hover:bg-dnd/10"
          >
            {t("verify.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              reciprocateQr.confirm();
              useVerificationStore.setState({ reciprocateQr: null });
            }}
            className="flex-1 rounded bg-brand py-2 text-sm font-medium text-white hover:bg-brand-hover"
          >
            {t("verify.confirm")}
          </button>
        </div>
      </Card>
    );
  }

  if (showQrDataUrl) {
    return (
      <Card>
        <h2 aria-live="polite" className="mb-2 text-lg font-semibold text-header">
          {t("verify.showToTitle", { name: otherName })}
        </h2>
        <p className="mb-4 text-sm text-muted">{t("verify.showToBody")}</p>
        <img
          src={showQrDataUrl}
          alt={t("verify.qrAlt")}
          width={240}
          height={240}
          className="mx-auto mb-4 rounded"
        />
        <button
          type="button"
          onClick={() => request.cancel()}
          className="w-full rounded border border-border py-2 text-sm font-medium text-normal hover:bg-bg-modifier-hover"
        >
          {t("verify.cancel")}
        </button>
      </Card>
    );
  }

  if (scanning) {
    return (
      <Card>
        <h2 aria-live="polite" className="mb-2 text-lg font-semibold text-header">
          {t("verify.scanTitle", { name: otherName })}
        </h2>
        <div className="mb-4">
          <QrScanner
            onScan={(data) => void chooseScanQr(data)}
            onError={(message) => {
              setScanning(false);
              useVerificationStore.setState({ error: message });
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setScanning(false)}
          className="w-full rounded border border-border py-2 text-sm font-medium text-normal hover:bg-bg-modifier-hover"
        >
          {t("verify.cancel")}
        </button>
      </Card>
    );
  }

  if (request.phase === VerificationPhase.Done) {
    return (
      <Card>
        <div data-testid="verify-done" className="mb-3 text-3xl">✅</div>
        <h2 aria-live="polite" className="mb-4 text-lg font-semibold text-header">
          {t("verify.doneTitle", { name: otherName })}
        </h2>
        <button
          type="button"
          onClick={reset}
          className="w-full rounded bg-brand py-2 text-sm font-medium text-white hover:bg-brand-hover"
        >
          {t("verify.close")}
        </button>
      </Card>
    );
  }

  if (request.phase === VerificationPhase.Cancelled) {
    const timedOut = request.cancellationCode === "m.timeout";
    return (
      <Card>
        <div className="mb-3 text-3xl">{timedOut ? "⏱️" : "⚠️"}</div>
        <h2 aria-live="polite" className="mb-2 text-lg font-semibold text-header">
          {timedOut ? t("verify.timedOutTitle") : t("verify.cancelledTitle")}
        </h2>
        <p className="mb-4 text-sm text-muted">
          {timedOut
            ? t("verify.timedOutBody", { name: otherName })
            : t("verify.cancelledBody", { name: otherName })}
        </p>
        <button
          type="button"
          onClick={reset}
          className="w-full rounded bg-bg-secondary py-2 text-sm font-medium text-normal hover:bg-bg-modifier-hover"
        >
          {t("verify.close")}
        </button>
      </Card>
    );
  }

  // Note: an incoming request the other side started never reaches this
  // overlay in the Requested phase - it's shown as a dismissible toast
  // (VerificationToast) until the user clicks "Verify", which accepts it and
  // takes it straight to the Ready method-picker below. So there's no
  // auto-popping "Accept / Decline" modal to grief someone with.

  if (request.phase === VerificationPhase.Ready && !request.verifier) {
    const canShowQr = request.otherPartySupportsMethod(QR_SCAN_METHOD);
    const canScanQr = request.otherPartySupportsMethod(QR_SHOW_METHOD);
    return (
      <Card>
        <h2 aria-live="polite" className="mb-2 text-lg font-semibold text-header">{t("verify.methodTitle")}</h2>
        <p className="mb-4 text-sm text-muted">{t("verify.methodBody", { name: otherName })}</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            data-testid="verify-method-sas"
            onClick={chooseSas}
            className="w-full rounded bg-brand py-2 text-sm font-medium text-white hover:bg-brand-hover"
          >
            {t("verify.methodSas")}
          </button>
          {canShowQr && (
            <button
              type="button"
              onClick={chooseShowQr}
              className="w-full rounded border border-border py-2 text-sm font-medium text-normal hover:bg-bg-modifier-hover"
            >
              {t("verify.methodShowQr")}
            </button>
          )}
          {canScanQr && (
            <button
              type="button"
              onClick={() => setScanning(true)}
              className="w-full rounded border border-border py-2 text-sm font-medium text-normal hover:bg-bg-modifier-hover"
            >
              {t("verify.methodScanQr")}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => request.cancel()}
          className="mt-3 w-full rounded py-2 text-sm font-medium text-muted hover:text-normal"
        >
          {t("verify.cancel")}
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <h2 aria-live="polite" className="mb-2 text-lg font-semibold text-header">{t("verify.inProgressTitle")}</h2>
      <p className="mb-2 text-sm text-muted">{t("verify.waitingFor", { name: otherName })}</p>
      {request.timeout !== null && (
        <p className="mb-4 text-xs text-muted">
          {t("verify.expires", { time: formatCountdown(request.timeout) })}
        </p>
      )}
      <button
        type="button"
        onClick={() => request.cancel()}
        className="w-full rounded border border-border py-2 text-sm font-medium text-normal hover:bg-bg-modifier-hover"
      >
        {t("verify.cancel")}
      </button>
    </Card>
  );
}
