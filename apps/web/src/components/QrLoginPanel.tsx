import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useTranslation } from "../i18n";
import { useQrLoginStore } from "../state/qrLoginStore";
import { QrScanner } from "./QrScanner";

const STEP_LABELS: Record<string, string> = {
  generating: "qrLogin.generating",
  "waiting-for-scan": "qrLogin.waitingForScan",
  negotiating: "qrLogin.negotiating",
  "waiting-for-approval": "qrLogin.waitingForApproval",
  finishing: "qrLogin.finishing",
  success: "qrLogin.success",
  declined: "qrLogin.declined",
};

const NEW_SCAN_LABELS: Record<string, string> = {
  connecting: "qrLogin.scanConnecting",
  negotiating: "qrLogin.negotiating",
  "waiting-for-approval": "qrLogin.waitingForApproval",
  finishing: "qrLogin.finishing",
  success: "qrLogin.success",
  declined: "qrLogin.declined",
};

/**
 * The NEW (unauthenticated) device's side of MSC4108 QR sign-in, both
 * directions (see qrLogin.ts's module comment for the OAuth2/OIDC server
 * prerequisite this needs). Shown as an alternative to the password form on
 * LoginScreen:
 *
 *   - "show": this device displays a code; a signed-in device scans it
 *     (ScanQrLoginModal's "scan" tab).
 *   - "scan": this device's camera scans a code shown by a signed-in device
 *     (ScanQrLoginModal's "show" tab) - Element's usual flow.
 */
export function QrLoginPanel({ homeserverUrl }: { homeserverUrl: string }) {
  const { t } = useTranslation();
  const [sub, setSub] = useState<"show" | "scan">("show");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex rounded bg-bg-darkest p-1">
        <button
          type="button"
          data-testid="qr-sub-show"
          aria-pressed={sub === "show"}
          onClick={() => setSub("show")}
          className={`flex-1 rounded py-1.5 text-xs font-medium transition ${
            sub === "show" ? "bg-brand text-white" : "text-muted hover:text-normal"
          }`}
        >
          {t("qrLogin.tabShow")}
        </button>
        <button
          type="button"
          data-testid="qr-sub-scan"
          aria-pressed={sub === "scan"}
          onClick={() => setSub("scan")}
          className={`flex-1 rounded py-1.5 text-xs font-medium transition ${
            sub === "scan" ? "bg-brand text-white" : "text-muted hover:text-normal"
          }`}
        >
          {t("qrLogin.tabScan")}
        </button>
      </div>
      {sub === "show" ? <ShowMode homeserverUrl={homeserverUrl} /> : <ScanMode />}
    </div>
  );
}

function ShowMode({ homeserverUrl }: { homeserverUrl: string }) {
  const { t } = useTranslation();
  const step = useQrLoginStore((s) => s.newDeviceStep);
  const qrBytes = useQrLoginStore((s) => s.newDeviceQrBytes);
  const error = useQrLoginStore((s) => s.newDeviceError);
  const start = useQrLoginStore((s) => s.startNewDeviceFlow);
  const cancel = useQrLoginStore((s) => s.cancelNewDeviceFlow);
  const reset = useQrLoginStore((s) => s.resetNewDeviceFlow);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (step === "idle") void start(homeserverUrl.trim() || "https://matrix.org");
    // Only ever auto-start once per mount - re-running belongs to the retry button, not this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!qrBytes) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    // Byte-mode segment: the MSC4108 payload is arbitrary binary, not text -
    // encoding it as a plain string would corrupt it (same reasoning as the
    // MSC1544 device-verification QR code elsewhere in this app).
    QRCode.toDataURL([{ data: qrBytes, mode: "byte" }], { width: 260, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [qrBytes]);

  useEffect(() => {
    return () => {
      if (useQrLoginStore.getState().newDeviceStep !== "idle") cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <p className="text-center text-xs text-muted">{t("qrLogin.showHint")}</p>
      <div className="flex h-[260px] w-[260px] items-center justify-center rounded bg-white p-3">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt={t("qrLogin.qrAlt")} width={236} height={236} />
        ) : (
          <span className="text-xs text-muted">{t("qrLogin.generatingShort")}</span>
        )}
      </div>
      <p role="status" aria-live="polite" className="text-center text-sm text-normal">
        {STEP_LABELS[step] ? t(STEP_LABELS[step]!) : "…"}
      </p>
      {error && (
        <p role="alert" className="rounded bg-dnd/10 px-3 py-2 text-center text-sm text-dnd">
          {error}
        </p>
      )}
      {(step === "error" || step === "declined") && (
        <button
          type="button"
          onClick={() => {
            reset();
            void start(homeserverUrl.trim() || "https://matrix.org");
          }}
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
        >
          {t("qrLogin.retry")}
        </button>
      )}
    </div>
  );
}

function ScanMode() {
  const { t } = useTranslation();
  const step = useQrLoginStore((s) => s.newScanStep);
  const error = useQrLoginStore((s) => s.newScanError);
  const startNewScan = useQrLoginStore((s) => s.startNewScanFlow);
  const cancel = useQrLoginStore((s) => s.cancelNewScanFlow);
  const reset = useQrLoginStore((s) => s.resetNewScanFlow);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (useQrLoginStore.getState().newScanStep !== "idle") cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="text-center text-xs text-muted">{t("qrLogin.scanHint")}</p>
      {step === "idle" && !scanError && (
        <QrScanner
          onScan={(data) => void startNewScan(new Uint8Array(data))}
          onError={(message) => setScanError(message)}
        />
      )}
      {scanError && (
        <p role="alert" className="rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">
          {scanError}
        </p>
      )}
      {step !== "idle" && (
        <div className="flex flex-col items-center gap-3 py-2">
          <p role="status" aria-live="polite" className="text-center text-sm text-normal">
            {NEW_SCAN_LABELS[step] ? t(NEW_SCAN_LABELS[step]!) : "…"}
          </p>
          {error && (
            <p role="alert" className="rounded bg-dnd/10 px-3 py-2 text-center text-sm text-dnd">
              {error}
            </p>
          )}
          {(step === "error" || step === "declined") && (
            <button
              type="button"
              onClick={() => {
                reset();
                setScanError(null);
              }}
              className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            >
              {t("qrLogin.retry")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
