import type { MatrixClient } from "@jorkonvo/matrix-core";
import type {
  MSC4108SignInWithQR,
  QrLoginSecrets,
  RendezvousFailureReason,
} from "@jorkonvo/matrix-core/qr";
import { create } from "zustand";
import { t } from "../i18n";
import { useAuthStore } from "./authStore";

/**
 * The QR-login module (transitively) drags in matrix-js-sdk's MSC4108
 * rendezvous classes, which statically import the ~7.8 MB
 * matrix-sdk-crypto-wasm glue. Loaded on first use only, so it never lands
 * on the app's main bundle / pre-auth login-screen path.
 */
type QrModule = typeof import("@jorkonvo/matrix-core/qr");
let qrMod: QrModule | null = null;
const loadQr = async (): Promise<QrModule> => (qrMod ??= await import("@jorkonvo/matrix-core/qr"));

/**
 * Drives the two QR sign-in roles (see qrLogin.ts's module comment for what
 * is and isn't implemented, and the OAuth2/OIDC server prerequisite this
 * has never been able to test against). Each role gets its own slice of
 * state since, in principle, a device could show its own "new device" QR
 * while ALSO being used to scan someone else's - unlikely in practice, but
 * there's no reason to force them to share state.
 */

export type NewDeviceQrStep =
  | "idle"
  | "generating"
  | "waiting-for-scan"
  | "negotiating"
  | "waiting-for-approval"
  | "finishing"
  | "success"
  | "declined"
  | "error";

export type ScanQrStep =
  | "idle"
  | "connecting"
  | "waiting-confirmation"
  | "waiting-device"
  | "success"
  | "declined"
  | "error";

/** Direction 2, existing-device side: this device DISPLAYS a code a new device scans. */
export type DisplayQrStep =
  | "idle"
  | "generating"
  | "waiting-for-scan"
  | "waiting-confirmation"
  | "waiting-device"
  | "success"
  | "declined"
  | "error";

/** Direction 2, new-device side: this (unauthenticated) device SCANS an existing device's code. */
export type NewScanStep =
  | "idle"
  | "connecting"
  | "negotiating"
  | "waiting-for-approval"
  | "finishing"
  | "success"
  | "declined"
  | "error";

interface QrLoginState {
  newDeviceStep: NewDeviceQrStep;
  newDeviceQrBytes: Uint8Array | null;
  newDeviceError: string | null;
  startNewDeviceFlow: (homeserverUrl: string) => Promise<void>;
  cancelNewDeviceFlow: () => void;
  resetNewDeviceFlow: () => void;

  scanStep: ScanQrStep;
  scanError: string | null;
  /** Set once the new device has requested approval - open this (a browser tab/window) so the user, already signed in there, can confirm. */
  scanVerificationUri: string | null;
  startScanFlow: (client: MatrixClient, scannedBytes: Uint8Array) => Promise<void>;
  declineScanFlow: () => Promise<void>;
  resetScanFlow: () => void;

  // --- Direction 2: existing device DISPLAYS a code, new device SCANS it ---

  displayStep: DisplayQrStep;
  displayQrBytes: Uint8Array | null;
  displayError: string | null;
  displayVerificationUri: string | null;
  /** Existing device: generate a code and reciprocate whichever new device scans it. */
  startDisplayFlow: (client: MatrixClient) => Promise<void>;
  cancelDisplayFlow: () => void;
  resetDisplayFlow: () => void;

  newScanStep: NewScanStep;
  newScanError: string | null;
  /** New device: consume an existing device's scanned code and sign this device in. */
  startNewScanFlow: (scannedBytes: Uint8Array) => Promise<void>;
  cancelNewScanFlow: () => void;
  resetNewScanFlow: () => void;
}

let newDeviceAbort: AbortController | null = null;
let newDeviceFlow: MSC4108SignInWithQR | null = null;
let scanFlow: MSC4108SignInWithQR | null = null;
let displayAbort: AbortController | null = null;
let displayFlow: MSC4108SignInWithQR | null = null;
let newScanFlow: MSC4108SignInWithQR | null = null;

function reasonMessage(reason: RendezvousFailureReason): string {
  return qrMod?.describeQrLoginFailureReason(reason) ?? String(reason);
}

export const useQrLoginStore = create<QrLoginState>((set, get) => ({
  newDeviceStep: "idle",
  newDeviceQrBytes: null,
  newDeviceError: null,

  startNewDeviceFlow: async (homeserverUrl) => {
    if (get().newDeviceStep !== "idle" && get().newDeviceStep !== "error" && get().newDeviceStep !== "declined") return;
    set({ newDeviceStep: "generating", newDeviceError: null, newDeviceQrBytes: null });
    newDeviceAbort = new AbortController();
    try {
      const qr = await loadQr();
      const flow = await qr.startNewDeviceQrLogin(
        homeserverUrl,
        (reason) => set({ newDeviceStep: "error", newDeviceError: reasonMessage(reason) }),
        newDeviceAbort.signal,
      );
      newDeviceFlow = flow;
      const codeBytes = flow.code;
      if (!codeBytes) throw new Error(t("qrLogin.codeNotGenerated"));
      set({ newDeviceStep: "waiting-for-scan", newDeviceQrBytes: codeBytes });

      const { serverName } = await flow.negotiateProtocols();
      if (!serverName) throw new Error(t("qrLogin.noServerName"));
      set({ newDeviceStep: "negotiating" });

      const { baseUrl, metadata } = await qr.discoverServerAuthMetadata(serverName);
      const clientId = await qr.getOrRegisterOAuthClientId(metadata, window.location.origin);
      const deviceId = qr.generateQrLoginDeviceId();
      await flow.deviceAuthorizationGrant({ metadata, clientId, deviceId });
      set({ newDeviceStep: "waiting-for-approval" });

      const tokenResponse = await flow.completeLoginOnNewDevice({ clientId });
      if (!tokenResponse) throw new Error(t("qrLogin.notApproved"));
      set({ newDeviceStep: "finishing" });

      const session = await qr.buildSessionFromQrLoginToken(baseUrl, deviceId, tokenResponse.access_token, tokenResponse.refresh_token);
      const { secrets } = await flow.shareSecrets();
      await useAuthStore.getState().loginWithQrSession(session, secrets as QrLoginSecrets | undefined);

      set({ newDeviceStep: "success" });
    } catch (err) {
      const message = (err as Error).message || t("qrLogin.unknownError");
      set((s) => ({
        newDeviceStep: s.newDeviceStep === "error" ? s.newDeviceStep : "error",
        newDeviceError: s.newDeviceError ?? message,
      }));
    } finally {
      await newDeviceFlow?.close().catch(() => undefined);
      newDeviceFlow = null;
    }
  },

  cancelNewDeviceFlow: () => {
    newDeviceAbort?.abort();
    if (qrMod && newDeviceFlow) void newDeviceFlow.cancel(qrMod.ClientRendezvousFailureReason.UserDeclined);
    set({ newDeviceStep: "idle", newDeviceQrBytes: null, newDeviceError: null });
  },

  resetNewDeviceFlow: () => set({ newDeviceStep: "idle", newDeviceQrBytes: null, newDeviceError: null }),

  scanStep: "idle",
  scanError: null,
  scanVerificationUri: null,

  startScanFlow: async (client, scannedBytes) => {
    if (get().scanStep !== "idle" && get().scanStep !== "error" && get().scanStep !== "declined") return;
    set({ scanStep: "connecting", scanError: null, scanVerificationUri: null });
    try {
      const qr = await loadQr();
      const flow = await qr.startExistingDeviceQrScan(client, scannedBytes, (reason) =>
        set({ scanStep: "error", scanError: reasonMessage(reason) }),
      );
      scanFlow = flow;

      await flow.negotiateProtocols();
      const { verificationUri } = await flow.deviceAuthorizationGrant();
      set({ scanStep: "waiting-confirmation", scanVerificationUri: verificationUri ?? null });
      if (verificationUri && typeof window !== "undefined") {
        // Opens the OAuth provider's own approval page - the user is
        // already signed in there via this same browser (same origin's
        // cookies), so this is normally a single "Approve" click, not a
        // fresh login.
        window.open(verificationUri, "_blank", "noopener,noreferrer");
      }

      // shareSecrets() itself blocks through the entire rest of the flow on
      // the existing-device side (waiting for the new device's outcome,
      // then polling for its device id to appear, then exporting and
      // sending the secrets bundle) and only resolves once all of that is
      // done - there's no earlier hook to report progress from in between,
      // so "waiting-device" covers the whole span until it resolves.
      set({ scanStep: "waiting-device" });
      await flow.shareSecrets();
      set({ scanStep: "success" });
    } catch (err) {
      const message = (err as Error).message || t("qrLogin.unknownError");
      set((s) => ({
        scanStep: s.scanStep === "error" ? s.scanStep : "error",
        scanError: s.scanError ?? message,
      }));
    } finally {
      await scanFlow?.close().catch(() => undefined);
      scanFlow = null;
    }
  },

  declineScanFlow: async () => {
    await scanFlow?.declineLoginOnExistingDevice().catch(() => undefined);
    if (qrMod && scanFlow) void scanFlow.cancel(qrMod.ClientRendezvousFailureReason.UserDeclined);
    set({ scanStep: "declined" });
  },

  resetScanFlow: () => set({ scanStep: "idle", scanError: null, scanVerificationUri: null }),

  // --- Direction 2: existing device DISPLAYS a code, new device SCANS it ---

  displayStep: "idle",
  displayQrBytes: null,
  displayError: null,
  displayVerificationUri: null,

  startDisplayFlow: async (client) => {
    const s = get().displayStep;
    if (s !== "idle" && s !== "error" && s !== "declined") return;
    set({ displayStep: "generating", displayError: null, displayQrBytes: null, displayVerificationUri: null });
    displayAbort = new AbortController();
    try {
      const qr = await loadQr();
      const flow = await qr.startExistingDeviceQrDisplay(
        client,
        (reason) => set({ displayStep: "error", displayError: reasonMessage(reason) }),
        displayAbort.signal,
      );
      displayFlow = flow;
      const codeBytes = flow.code;
      if (!codeBytes) throw new Error(t("qrLogin.codeNotGenerated"));
      set({ displayStep: "waiting-for-scan", displayQrBytes: codeBytes });

      // Blocks until the new device connects over the rendezvous channel.
      await flow.negotiateProtocols();
      // Existing-device side: receives the new device's chosen protocol and
      // hands back the OAuth approval URL for out-of-band confirmation.
      const { verificationUri } = await flow.deviceAuthorizationGrant();
      set({ displayStep: "waiting-confirmation", displayVerificationUri: verificationUri ?? null });
      if (verificationUri && typeof window !== "undefined") {
        window.open(verificationUri, "_blank", "noopener,noreferrer");
      }

      set({ displayStep: "waiting-device" });
      await flow.shareSecrets();
      set({ displayStep: "success" });
    } catch (err) {
      const message = (err as Error).message || t("qrLogin.unknownError");
      set((st) => ({
        displayStep: st.displayStep === "error" ? st.displayStep : "error",
        displayError: st.displayError ?? message,
      }));
    } finally {
      await displayFlow?.close().catch(() => undefined);
      displayFlow = null;
    }
  },

  cancelDisplayFlow: () => {
    displayAbort?.abort();
    if (qrMod && displayFlow) void displayFlow.cancel(qrMod.ClientRendezvousFailureReason.UserDeclined);
    set({ displayStep: "idle", displayQrBytes: null, displayError: null, displayVerificationUri: null });
  },

  resetDisplayFlow: () =>
    set({ displayStep: "idle", displayQrBytes: null, displayError: null, displayVerificationUri: null }),

  newScanStep: "idle",
  newScanError: null,

  startNewScanFlow: async (scannedBytes) => {
    const s = get().newScanStep;
    if (s !== "idle" && s !== "error" && s !== "declined") return;
    set({ newScanStep: "connecting", newScanError: null });
    try {
      const qr = await loadQr();
      const { flow, serverName } = await qr.startNewDeviceQrScan(scannedBytes, (reason) =>
        set({ newScanStep: "error", newScanError: reasonMessage(reason) }),
      );
      newScanFlow = flow;

      // No-op for this role (the homeserver came from the scanned code), but
      // it still drives the secure-channel connect handshake.
      await flow.negotiateProtocols();
      set({ newScanStep: "negotiating" });

      const { baseUrl, metadata } = await qr.discoverServerAuthMetadata(serverName);
      const clientId = await qr.getOrRegisterOAuthClientId(metadata, window.location.origin);
      const deviceId = qr.generateQrLoginDeviceId();
      await flow.deviceAuthorizationGrant({ metadata, clientId, deviceId });
      set({ newScanStep: "waiting-for-approval" });

      const tokenResponse = await flow.completeLoginOnNewDevice({ clientId });
      if (!tokenResponse) throw new Error(t("qrLogin.notApproved"));
      set({ newScanStep: "finishing" });

      const session = await qr.buildSessionFromQrLoginToken(
        baseUrl,
        deviceId,
        tokenResponse.access_token,
        tokenResponse.refresh_token,
      );
      const { secrets } = await flow.shareSecrets();
      await useAuthStore.getState().loginWithQrSession(session, secrets as QrLoginSecrets | undefined);

      set({ newScanStep: "success" });
    } catch (err) {
      const message = (err as Error).message || t("qrLogin.unknownError");
      set((st) => ({
        newScanStep: st.newScanStep === "error" ? st.newScanStep : "error",
        newScanError: st.newScanError ?? message,
      }));
    } finally {
      await newScanFlow?.close().catch(() => undefined);
      newScanFlow = null;
    }
  },

  cancelNewScanFlow: () => {
    if (qrMod && newScanFlow) void newScanFlow.cancel(qrMod.ClientRendezvousFailureReason.UserDeclined);
    set({ newScanStep: "idle", newScanError: null });
  },

  resetNewScanFlow: () => set({ newScanStep: "idle", newScanError: null }),
}));
