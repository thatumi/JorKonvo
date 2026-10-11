import type { MatrixClient } from "matrix-js-sdk";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/CryptoEvent.js";
import type {
  ShowQrCodeCallbacks,
  ShowSasCallbacks,
  Verifier,
  VerificationRequest,
} from "matrix-js-sdk/lib/crypto-api/verification.js";
import {
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
} from "matrix-js-sdk/lib/crypto-api/verification.js";

export { CryptoEvent, VerificationPhase, VerificationRequestEvent, VerifierEvent };
export type { ShowQrCodeCallbacks, ShowSasCallbacks, Verifier, VerificationRequest };

/** MSC1544 QR-verification method identifiers, as used by VerificationRequest.otherPartySupportsMethod. */
export const QR_SHOW_METHOD = "m.qr_code.show.v1";
export const QR_SCAN_METHOD = "m.qr_code.scan.v1";
export const SAS_METHOD = "m.sas.v1";

/**
 * Starts verifying another user's device, via a to-device request.
 *
 * Deliberately uses device-level verification (`requestDeviceVerification`)
 * rather than `requestVerificationDM`: the latter requires the target user
 * to already have a published cross-signing identity (it calls the crypto
 * engine's `getIdentity()`, which throws "unknown userId" otherwise, found
 * live - two fresh test accounts that had never bootstrapped cross-signing
 * couldn't be verified via the DM flow at all). Device verification only
 * needs the target device to be known via the normal device-list sync,
 * which happens automatically for members of a shared encrypted room, so it
 * works for any two users regardless of cross-signing setup. If the user
 * has multiple devices, the most recently seen one is picked - a full
 * device picker is a possible future improvement.
 */
export async function requestUserVerification(
  client: MatrixClient,
  userId: string,
): Promise<VerificationRequest> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("A titkosítás nincs inicializálva");

  const deviceMap = await crypto.getUserDeviceInfo([userId], true);
  const devices = deviceMap.get(userId);
  const deviceId = devices ? [...devices.keys()][0] : undefined;
  if (!deviceId) {
    throw new Error(`Nem található titkosítási eszköz ehhez a felhasználóhoz: ${userId}`);
  }

  return crypto.requestDeviceVerification(userId, deviceId);
}

/**
 * Whether `userId`'s cross-signing identity is verified from THIS device's
 * point of view - the same trust check Element shows as a shield badge next
 * to a name. `false` (not `throw`) when crypto isn't ready or the user has
 * no cross-signing identity at all yet, since both are common, ordinary
 * states (not something a badge should treat as an error).
 */
export async function isUserVerified(client: MatrixClient, userId: string): Promise<boolean> {
  const crypto = client.getCrypto();
  if (!crypto) return false;
  try {
    const status = await crypto.getUserVerificationStatus(userId);
    return status.isCrossSigningVerified();
  } catch {
    return false;
  }
}

/** Subscribes to live verification-status changes for whichever userId(s) the caller cares about. Returns an unsubscribe fn. */
export function watchUserTrustChanges(
  client: MatrixClient,
  onChange: (userId: string) => void,
): () => void {
  const handler = (userId: string) => onChange(userId);
  client.on(CryptoEvent.UserTrustStatusChanged, handler);
  return () => client.removeListener(CryptoEvent.UserTrustStatusChanged, handler);
}
