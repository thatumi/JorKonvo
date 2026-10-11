import type { QrCodeData as QrCodeDataType } from "@matrix-org/matrix-sdk-crypto-wasm";
import { createClient, type MatrixClient } from "matrix-js-sdk";
import { AutoDiscovery } from "matrix-js-sdk/lib/autodiscovery.js";
import { OAuth2, type ValidatedAuthMetadata } from "matrix-js-sdk/lib/oauth/index.js";
import { secureRandomString } from "matrix-js-sdk/lib/randomstring.js";
import {
  ClientRendezvousFailureReason,
  isSignInWithQRAvailable,
  linkNewDeviceByGeneratingQR,
  MSC4108FailureReason,
  MSC4108RendezvousSession,
  MSC4108SecureChannel,
  MSC4108SignInWithQR,
  type RendezvousFailureListener,
  type RendezvousFailureReason,
  signInByGeneratingQR,
} from "matrix-js-sdk/lib/rendezvous/index.js";
import type { StoredSession } from "./types.js";

/**
 * MSC4108 "Sign in with QR code" - built on the matrix-js-sdk's own
 * rendezvous implementation (which is real and complete; matrix-js-sdk has
 * shipped this since well before this file was written), NOT a from-scratch
 * protocol implementation. What this module adds on top: the "existing
 * device scans a new device's code" role (the SDK only exports ready-made
 * helpers for the two "this device generates and shows a code" roles -
 * signInByGeneratingQR and linkNewDeviceByGeneratingQR - the scanning
 * counterpart has to be constructed from the lower-level
 * MSC4108RendezvousSession/MSC4108SecureChannel/MSC4108SignInWithQR
 * primitives directly, following the exact same construction those two
 * helpers use internally, just fed from a SCANNED QrCodeData instead of a
 * freshly generated one), plus OAuth2 dynamic client registration/caching
 * and session-building glue.
 *
 * BOTH directions are wired up here:
 *
 *   1. Discord-style: the NEW, unauthenticated device displays a QR code
 *      (startNewDeviceQrLogin), and an EXISTING, already-signed-in device
 *      scans it with its camera to reciprocate (startExistingDeviceQrScan).
 *
 *   2. Element's usual flow: the EXISTING device displays a QR code
 *      (startExistingDeviceQrDisplay, a thin wrapper over the SDK's
 *      linkNewDeviceByGeneratingQR), and the NEW device scans it
 *      (startNewDeviceQrScan). startNewDeviceQrScan is the mirror image of
 *      startExistingDeviceQrScan - built from the same
 *      MSC4108RendezvousSession/MSC4108SecureChannel/MSC4108SignInWithQR
 *      primitives, fed a SCANNED QrCodeData, but taking the NEW-device role
 *      (no `client` passed to MSC4108SignInWithQR) and reading the
 *      homeserver name straight out of the scanned Reciprocate-mode code
 *      instead of over the channel.
 *
 * After construction, direction 2's new-device side runs the exact same
 * OAuth2 device-authorization-grant / token / secrets sequence as direction
 * 1's new-device side (see qrLoginStore.ts), and direction 2's existing
 * device side is just the SDK helper driven to completion.
 *
 * IMPORTANT, and the reason none of this has been exercised against a real
 * server in this codebase: MSC4108 sign-in requires the homeserver to run
 * next-generation OAuth2/OIDC-delegated auth (MSC2965/3861, e.g. via Matrix
 * Authentication Service) instead of - or alongside - classic password
 * login. Checked live against this project's test server
 * (matrix.szabotar.dev): it advertises no OAuth auth_issuer at all, so this
 * entire module is currently unusable there and has not been live-tested
 * with real accounts, unlike everything else in this package. It's built
 * to be correct against the documented SDK contract so it's ready the
 * moment a homeserver here actually supports it, not as a stopgap.
 *
 * Also NOT implemented: automatic OAuth2 access-token refresh. A session
 * obtained this way carries a refreshToken (see StoredSession), but nothing
 * currently uses it - once the access token expires, that account would
 * need a fresh login. Wiring token refresh into the ongoing session
 * lifecycle is a separate, larger piece of work than QR sign-in itself.
 */

export type { RendezvousFailureListener, RendezvousFailureReason, ValidatedAuthMetadata };
export { ClientRendezvousFailureReason, MSC4108FailureReason, MSC4108SignInWithQR };

/** Whether the homeserver this client is connected to advertises OAuth2 device-authorization support, a prerequisite for MSC4108. */
export async function checkQrLoginAvailable(client: MatrixClient): Promise<boolean> {
  try {
    return await isSignInWithQRAvailable(client);
  } catch {
    return false;
  }
}

export function describeQrLoginFailureReason(reason: RendezvousFailureReason): string {
  switch (reason) {
    case MSC4108FailureReason.AuthorizationExpired:
      return "A bejelentkezési kérés túllépte az időt.";
    case MSC4108FailureReason.DeviceAlreadyExists:
      return "Ez az eszköz-azonosító már létezik ezen a fiókon.";
    case MSC4108FailureReason.DeviceNotFound:
      return "Az új eszköz nem jelent meg a szerveren - próbáld újra.";
    case MSC4108FailureReason.UnexpectedMessageReceived:
      return "Váratlan üzenet érkezett, a folyamat megszakadt.";
    case MSC4108FailureReason.UnsupportedProtocol:
      return "A másik eszköz nem támogatja ezt a bejelentkezési módot.";
    case MSC4108FailureReason.UserCancelled:
      return "A folyamatot megszakították.";
    case ClientRendezvousFailureReason.Expired:
      return "A QR kód lejárt - generálj egy újat.";
    case ClientRendezvousFailureReason.HomeserverLacksSupport:
      return "A szerver nem támogatja a QR-kódos bejelentkezést (nincs OAuth2/OIDC hitelesítés beállítva).";
    case ClientRendezvousFailureReason.InsecureChannelDetected:
      return "A biztonságos csatorna ellenőrzése sikertelen - lehet, hogy valaki megpróbálta lehallgatni a kapcsolatot. A folyamat megszakítva.";
    case ClientRendezvousFailureReason.InvalidCode:
      return "Érvénytelen vagy nem felismert QR kód.";
    case ClientRendezvousFailureReason.OtherDeviceNotSignedIn:
      return "A beolvasó eszköz nincs bejelentkezve.";
    case ClientRendezvousFailureReason.OtherDeviceAlreadySignedIn:
      return "A másik eszköz már be van jelentkezve.";
    case ClientRendezvousFailureReason.UserDeclined:
      return "A kérést a másik eszközön elutasították.";
    case ClientRendezvousFailureReason.ETagMissing:
      return "A böngésző (vagy egy kiegészítője) blokkolja a szükséges hálózati fejlécet - próbáld másik böngészővel, kiegészítők nélkül.";
    default:
      return "Ismeretlen hiba történt a QR-kódos bejelentkezés közben.";
  }
}

/**
 * Resolves a homeserver's domain name - as reported by the OTHER device
 * over the secure channel, not typed by hand - to its actual base URL and
 * OAuth2/OIDC metadata, the same discovery a normal login already performs.
 */
export async function discoverServerAuthMetadata(
  serverName: string,
): Promise<{ baseUrl: string; metadata: ValidatedAuthMetadata }> {
  const config = await AutoDiscovery.findClientConfig(serverName);
  const baseUrl = config["m.homeserver"]?.base_url;
  if (!baseUrl) {
    throw new Error(`A(z) "${serverName}" szerver nem található, vagy nem érvényes Matrix szerver`);
  }
  const discoveryClient = createClient({ baseUrl });
  const metadata = await discoveryClient.getAuthMetadata();
  return { baseUrl, metadata };
}

const OAUTH_CLIENT_ID_CACHE_KEY = "jorkonvo-oauth-client-ids";

function loadCachedClientIds(): Record<string, string> {
  try {
    const raw = localStorage.getItem(OAUTH_CLIENT_ID_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Registers this app as an OAuth2 client with the given issuer, or reuses a
 * previously registered client id for the SAME issuer. Dynamic client
 * registration is meant to happen once per (app, issuer) pair, not on
 * every login - re-registering every time would pile up orphaned client
 * records on the server for no benefit.
 */
export async function getOrRegisterOAuthClientId(metadata: ValidatedAuthMetadata, appOrigin: string): Promise<string> {
  const cache = loadCachedClientIds();
  const cached = cache[metadata.issuer];
  if (cached) return cached;

  const clientId = await OAuth2.registerClient(metadata, {
    client_name: "JorKonvo",
    client_uri: appOrigin,
    application_type: "web",
    grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    response_types: ["code"],
  });
  cache[metadata.issuer] = clientId;
  try {
    localStorage.setItem(OAUTH_CLIENT_ID_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache is a pure optimization - a failed write just means re-registering next time.
  }
  return clientId;
}

/** A fresh, self-chosen device id for the OAuth2 device-authorization grant - unlike password login (where the server assigns one), the client picks its own here and tells the server what it wants. */
export function generateQrLoginDeviceId(): string {
  return secureRandomString(10);
}

/**
 * Starts the NEW device's side: generates a QR code for an existing,
 * already-signed-in device to scan with its camera and reciprocate the
 * login. `homeserverUrl` is only used to find the rendezvous relay to talk
 * to (whatever the user typed on this device's own login screen) - the
 * AUTHORITATIVE homeserver is whatever negotiateProtocols() reports back
 * once the other device responds; prefer that if the two ever disagree.
 */
export async function startNewDeviceQrLogin(
  homeserverUrl: string,
  onFailure: RendezvousFailureListener,
  abortSignal: AbortSignal,
): Promise<MSC4108SignInWithQR> {
  const tempClient = createClient({ baseUrl: homeserverUrl });
  // Pre-check the server actually runs an MSC4108 rendezvous endpoint before
  // starting: matrix-js-sdk's signInByGeneratingQR constructs its
  // MSC4108RendezvousSession with NO fallback rendezvous server, so against a
  // homeserver without one the very first send() dies with the raw, cryptic
  // SDK error "Invalid rendezvous URI" (seen live on matrix.szabotar.dev).
  // Surface the real reason instead: without this endpoint the whole flow
  // can't work regardless of what else the server supports.
  let rendezvousSupported = true;
  try {
    rendezvousSupported = await tempClient.doesServerSupportUnstableFeature("org.matrix.msc4108");
  } catch {
    // Network/autodiscovery failure - fall through and let the SDK flow
    // itself report it with its own (accurate) error.
  }
  if (!rendezvousSupported) {
    throw new Error(
      "Ez a szerver nem támogatja a QR-kódos bejelentkezést (nincs MSC4108 rendezvous szolgáltatása). Használd a jelszavas bejelentkezést, vagy a regisztrációt.",
    );
  }
  return signInByGeneratingQR(tempClient, onFailure, abortSignal);
}

/**
 * Starts the EXISTING device's side: given the raw bytes scanned from a new
 * device's QR code (see QrScanner.tsx - jsQR already hands back binary
 * data, not a decoded string, which is exactly what's needed here) and
 * this device's own authenticated client, constructs the flow that
 * reciprocates the login. Mirrors exactly what signInByGeneratingQR/
 * linkNewDeviceByGeneratingQR do internally (see matrix-js-sdk's
 * rendezvous/index.ts), just starting from a SCANNED QrCodeData instead of
 * generating a fresh one - the resulting session is constructed with an
 * explicit `url` (from the scanned code) rather than POSTing a new one, and
 * the channel is given `theirPublicKey` so it takes the "scanning device"
 * role in the secure-channel handshake.
 */
export async function startExistingDeviceQrScan(
  client: MatrixClient,
  scannedBytes: Uint8Array,
  onFailure: RendezvousFailureListener,
): Promise<MSC4108SignInWithQR> {
  // Dynamic import: this is the only spot in the app that needs a symbol
  // from matrix-sdk-crypto-wasm directly (matrix-js-sdk lazy-loads the rest
  // of that ~7.8 MB module itself, at initRustCrypto time). A static import
  // here would instead pull the wasm glue into the main bundle - i.e. onto
  // the pre-auth login screen's critical path - for a code path only ever
  // hit when someone actually scans a QR code.
  const { QrCodeData } = await import("@matrix-org/matrix-sdk-crypto-wasm");
  let qrData: QrCodeDataType;
  try {
    qrData = QrCodeData.fromBytes(scannedBytes);
  } catch {
    throw new Error(describeQrLoginFailureReason(ClientRendezvousFailureReason.InvalidCode));
  }
  const rendezvousUrl = qrData.rendezvousUrl;
  if (!rendezvousUrl) {
    throw new Error(describeQrLoginFailureReason(ClientRendezvousFailureReason.InvalidCode));
  }
  // `client` is passed to MSC4108SignInWithQR itself below (used for
  // getDevice/getCrypto lookups later in the flow), not to the session -
  // the session only needs it to POST a brand-new rendezvous URL, which
  // isn't the case here since we already have one from the scanned code.
  const session = new MSC4108RendezvousSession({ url: rendezvousUrl, onFailure });
  const channel = new MSC4108SecureChannel(session, qrData.publicKey, onFailure);
  return new MSC4108SignInWithQR(channel, true, client, onFailure);
}

/**
 * Direction 2, existing-device side: this already-signed-in device DISPLAYS
 * a QR code for a brand-new device to scan (Element's usual flow). This is
 * just the SDK's own `linkNewDeviceByGeneratingQR` - crypto must already be
 * initialised on `client` (it always is for a signed-in JorKonvo session).
 * The caller renders `flow.code` as a QR image, then drives the flow:
 * `negotiateProtocols()` -> `deviceAuthorizationGrant()` (no input, existing
 * device) -> `shareSecrets()`.
 */
export async function startExistingDeviceQrDisplay(
  client: MatrixClient,
  onFailure: RendezvousFailureListener,
  abortSignal: AbortSignal,
): Promise<MSC4108SignInWithQR> {
  return linkNewDeviceByGeneratingQR(client, onFailure, abortSignal);
}

/**
 * Direction 2, new-device side: given the raw bytes scanned from an existing
 * device's QR code, constructs the NEW-device flow. The exact mirror of
 * startExistingDeviceQrScan (same primitives, explicit rendezvous `url` from
 * the scanned code, channel seeded with `theirPublicKey`) except that NO
 * `client` is passed to MSC4108SignInWithQR - that is what makes this side
 * take the new-device (`QrCodeIntent.Login`) role rather than the
 * reciprocating role.
 *
 * The homeserver name is read straight out of the scanned code: an existing
 * device generates its code in `Reciprocate` mode, which embeds `serverName`
 * (a `Login`-mode code from a NEW device showing its own QR does not - so a
 * code with no `serverName` here means the user scanned the wrong kind of
 * code, i.e. pointed a new device at another new device). After this
 * returns, the caller runs the same sequence as direction 1's new-device
 * side: `negotiateProtocols()` (a no-op for this role) ->
 * `deviceAuthorizationGrant({ metadata, clientId, deviceId })` ->
 * `completeLoginOnNewDevice()` -> `buildSessionFromQrLoginToken()` ->
 * `shareSecrets()` -> `importQrLoginSecrets()`.
 */
export async function startNewDeviceQrScan(
  scannedBytes: Uint8Array,
  onFailure: RendezvousFailureListener,
): Promise<{ flow: MSC4108SignInWithQR; serverName: string }> {
  const { QrCodeData } = await import("@matrix-org/matrix-sdk-crypto-wasm");
  let qrData: QrCodeDataType;
  try {
    qrData = QrCodeData.fromBytes(scannedBytes);
  } catch {
    throw new Error(describeQrLoginFailureReason(ClientRendezvousFailureReason.InvalidCode));
  }
  const rendezvousUrl = qrData.rendezvousUrl;
  const serverName = qrData.serverName;
  if (!rendezvousUrl || !serverName) {
    throw new Error(describeQrLoginFailureReason(ClientRendezvousFailureReason.InvalidCode));
  }
  const session = new MSC4108RendezvousSession({ url: rendezvousUrl, onFailure });
  const channel = new MSC4108SecureChannel(session, qrData.publicKey, onFailure);
  const flow = new MSC4108SignInWithQR(channel, true, undefined, onFailure);
  return { flow, serverName };
}

/**
 * Builds a StoredSession from the OAuth2 device-access-token response the
 * new device gets back once the existing device approves - the token
 * response itself doesn't carry a user id, so this does one `whoami` call
 * with the fresh token to learn it (the same way any OAuth2-authenticated
 * Matrix client would).
 */
export async function buildSessionFromQrLoginToken(
  baseUrl: string,
  deviceId: string,
  accessToken: string,
  refreshToken: string | undefined,
): Promise<StoredSession> {
  const client = createClient({ baseUrl, accessToken });
  const whoami = await client.whoami();
  return {
    homeserverUrl: baseUrl,
    accessToken,
    refreshToken,
    userId: whoami.user_id,
    deviceId,
  };
}

export type QrLoginSecrets = NonNullable<Awaited<ReturnType<MSC4108SignInWithQR["shareSecrets"]>>["secrets"]>;

/** Installs the E2EE secrets bundle (cross-signing keys, key backup, etc.) shared by the existing device, once the new device's client has crypto initialised. */
export async function importQrLoginSecrets(client: MatrixClient, secrets: QrLoginSecrets): Promise<void> {
  await client.getCrypto()?.importSecretsBundle?.(secrets);
}
