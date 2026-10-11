import {
  type MatrixClient,
  QR_SCAN_METHOD,
  QR_SHOW_METHOD,
  requestUserVerification,
  SAS_METHOD,
  type ShowQrCodeCallbacks,
  type ShowSasCallbacks,
  type Verifier,
  type VerificationRequest,
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
} from "@jorkonvo/matrix-core";
import { t } from "../i18n";
import QRCode from "qrcode";
import { create } from "zustand";

interface VerificationState {
  request: VerificationRequest | null;
  /**
   * An incoming verification request the other side started, shown as a
   * dismissible toast rather than a screen-blocking modal - so it can't be
   * used to interrupt/grief someone by spamming requests. Only promoted to
   * `request` (and the full modal) once the user clicks "Verify" on it.
   */
  incomingRequest: VerificationRequest | null;
  /** userId -> timestamp until which further requests from them are auto-ignored (they hit "Ignore"). */
  snoozedUntil: Record<string, number>;
  verifier: Verifier | null;
  sas: ShowSasCallbacks | null;
  /** Set once we've shown our own QR code and are waiting for the other side to scan+confirm it. */
  showQrDataUrl: string | null;
  /** Set once the other side scanned our QR and we need to confirm the reciprocation. */
  reciprocateQr: ShowQrCodeCallbacks | null;
  /** True while this device's camera is open, looking for the other side's QR code. */
  scanning: boolean;
  error: string | null;
  tick: number;
  bump: () => void;
  wireRequest: (request: VerificationRequest) => void;
  /** Called by VerificationManager for a request the other side started. Returns false if it was auto-ignored. */
  presentIncoming: (request: VerificationRequest, otherUserIgnored: boolean) => boolean;
  /** User clicked "Verify" on the incoming toast - promote it to the full flow. */
  acceptIncoming: () => void;
  /** User clicked "Ignore" - decline it and snooze further requests from that person. */
  ignoreIncoming: () => void;
  start: (client: MatrixClient, userId: string) => Promise<void>;
  chooseSas: () => void;
  chooseShowQr: () => void;
  chooseScanQr: (data: Uint8ClampedArray) => Promise<void>;
  setScanning: (scanning: boolean) => void;
  reset: () => void;
}

/**
 * Wires up listeners for a newly-appeared Verifier AND drives it forward by
 * calling verify() - which, per its own doc comment, sends the initial
 * m.key.verification.start if we're first, or an .accept if the other side
 * already sent .start (as happens on the side that DIDN'T click "start
 * verification" - VerificationRequest.startVerification() only sends the
 * .start event and hands back the Verifier, it does not itself drive the
 * exchange). Both the initiating side and the passively-notified side end
 * up here via the request's Change event, so calling verify()
 * unconditionally in one place is what makes both directions progress.
 */
function wireVerifier(
  verifier: Verifier,
  set: (partial: Partial<VerificationState>) => void,
  get: () => VerificationState,
) {
  // The request's Change event can fire again for the same verifier
  // (e.g. once more per phase change) - only wire+verify once.
  if (get().verifier === verifier) return;
  set({ verifier });
  verifier.on(VerifierEvent.ShowSas, (sas) => set({ sas }));
  verifier.on(VerifierEvent.ShowReciprocateQr, (qr) => set({ reciprocateQr: qr }));
  verifier.on(VerifierEvent.Cancel, () => set({ sas: null, reciprocateQr: null }));
  void verifier.verify().catch((err) => set({ error: (err as Error).message }));
}

/** How long to auto-ignore further requests from someone after you dismiss one. */
const SNOOZE_MS = 15 * 60 * 1000;

export const useVerificationStore = create<VerificationState>((set, get) => ({
  request: null,
  incomingRequest: null,
  snoozedUntil: {},
  verifier: null,
  sas: null,
  showQrDataUrl: null,
  reciprocateQr: null,
  scanning: false,
  error: null,
  tick: 0,
  bump: () => set((s) => ({ tick: s.tick + 1 })),

  wireRequest: (request) => {
    set({ request, incomingRequest: null, verifier: null, sas: null, showQrDataUrl: null, reciprocateQr: null, scanning: false, error: null });

    request.on(VerificationRequestEvent.Change, () => {
      get().bump();

      if (request.verifier && get().verifier !== request.verifier) {
        wireVerifier(request.verifier, set, get);
      }
    });
  },

  presentIncoming: (request, otherUserIgnored) => {
    const other = request.otherUserId;
    const snoozed = (get().snoozedUntil[other] ?? 0) > Date.now();
    // Silently drop it if: the requester is blocked, we snoozed them, we're
    // already busy with a verification, or another incoming toast is up.
    if (otherUserIgnored || snoozed || get().request || get().incomingRequest) {
      void request.cancel().catch(() => undefined);
      return false;
    }
    set({ incomingRequest: request });
    // Keep the toast's countdown / auto-dismiss in sync with the request.
    request.on(VerificationRequestEvent.Change, () => {
      get().bump();
      const done = request.phase === VerificationPhase.Cancelled || request.phase === VerificationPhase.Done;
      if (get().incomingRequest === request && (!request.pending || done)) {
        set({ incomingRequest: null });
      }
    });
    return true;
  },

  acceptIncoming: () => {
    const req = get().incomingRequest;
    if (!req) return;
    get().wireRequest(req);
    void req.accept().catch((err) => set({ error: (err as Error).message }));
  },

  ignoreIncoming: () => {
    const req = get().incomingRequest;
    if (!req) return;
    set((s) => ({
      incomingRequest: null,
      snoozedUntil: { ...s.snoozedUntil, [req.otherUserId]: Date.now() + SNOOZE_MS },
    }));
    void req.cancel().catch(() => undefined);
  },

  start: async (client, userId) => {
    set({ request: null, verifier: null, sas: null, showQrDataUrl: null, reciprocateQr: null, scanning: false, error: null });
    try {
      const request = await requestUserVerification(client, userId);
      get().wireRequest(request);
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  chooseSas: () => {
    const { request } = get();
    if (!request) return;
    void request.startVerification(SAS_METHOD).catch((err) => set({ error: (err as Error).message }));
  },

  chooseShowQr: () => {
    const { request } = get();
    if (!request) return;
    void request
      .generateQRCode()
      .then(async (bytes) => {
        if (!bytes) {
          set({ error: t("verify.qrGenFailed") });
          return;
        }
        const dataUrl = await QRCode.toDataURL([{ mode: "byte", data: bytes }], { width: 240, margin: 1 });
        set({ showQrDataUrl: dataUrl });
      })
      .catch((err) => set({ error: (err as Error).message }));
  },

  chooseScanQr: async (data) => {
    const { request } = get();
    if (!request) return;
    try {
      const verifier = await request.scanQRCode(data);
      wireVerifier(verifier, set, get);
      set({ scanning: false });
    } catch (err) {
      set({ error: (err as Error).message, scanning: false });
    }
  },

  setScanning: (scanning) => set({ scanning }),

  reset: () =>
    set({ request: null, incomingRequest: null, verifier: null, sas: null, showQrDataUrl: null, reciprocateQr: null, scanning: false, error: null }),
}));

export { QR_SCAN_METHOD, QR_SHOW_METHOD };
