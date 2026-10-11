import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { useQrLoginStore } from "../../state/qrLoginStore";
import { Modal } from "../Modal";
import { QrScanner } from "../QrScanner";

const SCAN_STEP_KEYS: Record<string, string> = {
  connecting: "scanQr.connecting",
  "waiting-confirmation": "scanQr.waitingConfirmation",
  "waiting-device": "scanQr.waitingDevice",
  success: "scanQr.success",
  declined: "scanQr.declined",
};

const SHOW_STEP_KEYS: Record<string, string> = {
  generating: "linkDevice.showGenerating",
  "waiting-for-scan": "linkDevice.showWaitingForScan",
  "waiting-confirmation": "scanQr.waitingConfirmation",
  "waiting-device": "scanQr.waitingDevice",
  success: "scanQr.success",
  declined: "scanQr.declined",
};

/**
 * The EXISTING (already signed-in) device's side of MSC4108 QR sign-in,
 * both directions (see qrLogin.ts's module comment: needs an OAuth2/OIDC
 * homeserver to exercise against):
 *
 *   - "scan": scan a new device's login QR with the camera and reciprocate.
 *   - "show": display a QR the new device scans - Element's usual flow.
 */
export function ScanQrLoginModal() {
  const { t } = useTranslation();
  const close = useModalStore((s) => s.close);
  const [tab, setTab] = useState<"scan" | "show">("scan");

  const scanStep = useQrLoginStore((s) => s.scanStep);
  const displayStep = useQrLoginStore((s) => s.displayStep);
  const resetScan = useQrLoginStore((s) => s.resetScanFlow);
  const declineScan = useQrLoginStore((s) => s.declineScanFlow);
  const cancelDisplay = useQrLoginStore((s) => s.cancelDisplayFlow);
  const resetDisplay = useQrLoginStore((s) => s.resetDisplayFlow);

  function handleClose() {
    if (scanStep === "waiting-confirmation" || scanStep === "waiting-device") void declineScan();
    if (displayStep !== "idle") cancelDisplay();
    resetScan();
    resetDisplay();
    close();
  }

  return (
    <Modal title={t("linkDevice.title")} onClose={handleClose}>
      <div className="mb-4 flex rounded bg-bg-darkest p-1">
        <button
          type="button"
          data-testid="link-device-tab-scan"
          onClick={() => setTab("scan")}
          aria-pressed={tab === "scan"}
          className={`flex-1 rounded py-1.5 text-sm font-medium transition ${
            tab === "scan" ? "bg-brand text-white" : "text-muted hover:text-normal"
          }`}
        >
          {t("linkDevice.tabScan")}
        </button>
        <button
          type="button"
          data-testid="link-device-tab-show"
          onClick={() => setTab("show")}
          aria-pressed={tab === "show"}
          className={`flex-1 rounded py-1.5 text-sm font-medium transition ${
            tab === "show" ? "bg-brand text-white" : "text-muted hover:text-normal"
          }`}
        >
          {t("linkDevice.tabShow")}
        </button>
      </div>
      {tab === "scan" ? <ScanTab /> : <ShowTab />}
    </Modal>
  );
}

function ScanTab() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const step = useQrLoginStore((s) => s.scanStep);
  const error = useQrLoginStore((s) => s.scanError);
  const verificationUri = useQrLoginStore((s) => s.scanVerificationUri);
  const startScan = useQrLoginStore((s) => s.startScanFlow);
  const reset = useQrLoginStore((s) => s.resetScanFlow);
  const [scanError, setScanError] = useState<string | null>(null);

  return (
    <>
      <p className="mb-3 text-sm text-muted">{t("scanQr.summary")}</p>
      {step === "idle" && !scanError && (
        <QrScanner
          onScan={(data) => void startScan(client, new Uint8Array(data))}
          onError={(message) => setScanError(message)}
        />
      )}
      {scanError && <p role="alert" className="rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{scanError}</p>}
      {step !== "idle" && (
        <div className="flex flex-col items-center gap-3 py-4">
          <p aria-live="polite" className="text-center text-sm text-normal">{SCAN_STEP_KEYS[step] ? t(SCAN_STEP_KEYS[step]!) : "…"}</p>
          {verificationUri && step === "waiting-confirmation" && (
            <a
              href={verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
            >
              {t("scanQr.openApproval")}
            </a>
          )}
          {error && <p role="alert" className="rounded bg-dnd/10 px-3 py-2 text-center text-sm text-dnd">{error}</p>}
          {(step === "error" || step === "declined" || step === "success") && (
            <button
              type="button"
              onClick={() => reset()}
              className="rounded border border-border px-4 py-2 text-sm font-medium text-normal hover:bg-bg-modifier-hover"
            >
              {step === "success" ? t("scanQr.done") : t("scanQr.retry")}
            </button>
          )}
        </div>
      )}
    </>
  );
}

function ShowTab() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const step = useQrLoginStore((s) => s.displayStep);
  const qrBytes = useQrLoginStore((s) => s.displayQrBytes);
  const error = useQrLoginStore((s) => s.displayError);
  const verificationUri = useQrLoginStore((s) => s.displayVerificationUri);
  const start = useQrLoginStore((s) => s.startDisplayFlow);
  const reset = useQrLoginStore((s) => s.resetDisplayFlow);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (useQrLoginStore.getState().displayStep === "idle") void start(client);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!qrBytes) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL([{ data: qrBytes, mode: "byte" }], { width: 260, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [qrBytes]);

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-sm text-muted">{t("linkDevice.showSummary")}</p>
      <div className="flex h-[240px] w-[240px] items-center justify-center rounded bg-white p-3">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt={t("linkDevice.qrAlt")} width={216} height={216} />
        ) : (
          <span className="text-xs text-muted">{t("linkDevice.showGenerating")}</span>
        )}
      </div>
      <p aria-live="polite" className="text-center text-sm text-normal">{SHOW_STEP_KEYS[step] ? t(SHOW_STEP_KEYS[step]!) : "…"}</p>
      {verificationUri && step === "waiting-confirmation" && (
        <a
          href={verificationUri}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
        >
          {t("scanQr.openApproval")}
        </a>
      )}
      {error && <p role="alert" className="rounded bg-dnd/10 px-3 py-2 text-center text-sm text-dnd">{error}</p>}
      {(step === "error" || step === "declined" || step === "success") && (
        <button
          type="button"
          onClick={() => {
            reset();
            if (step !== "success") void start(client);
          }}
          className="rounded border border-border px-4 py-2 text-sm font-medium text-normal hover:bg-bg-modifier-hover"
        >
          {step === "success" ? t("scanQr.done") : t("scanQr.retry")}
        </button>
      )}
    </div>
  );
}
