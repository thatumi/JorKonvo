import * as sdk from "matrix-js-sdk";
import { ClientEvent, type MatrixClient, SyncState } from "matrix-js-sdk";
import type { LoginParams, StoredSession } from "./types.js";

/**
 * Performs a password login against a homeserver and returns the
 * credentials needed to restore a session later, without starting sync.
 */
export async function loginWithPassword(
  params: LoginParams,
): Promise<StoredSession> {
  const { homeserverUrl, userId, password } = params;
  const tempClient = sdk.createClient({ baseUrl: homeserverUrl });

  const res = await tempClient.login("m.login.password", {
    identifier: { type: "m.id.user", user: userId },
    password,
  });

  if (!res.device_id) {
    throw new Error("A szerver nem adott vissza device_id-t a bejelentkezéskor");
  }

  return {
    homeserverUrl,
    accessToken: res.access_token,
    userId: res.user_id,
    deviceId: res.device_id,
  };
}

/** Creates a MatrixClient from stored credentials, but does not start it. */
export function createRestoredClient(session: StoredSession): MatrixClient {
  return sdk.createClient({
    baseUrl: session.homeserverUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
  });
}

/** Derives a per-account IndexedDB crypto store prefix from a Matrix user id. */
export function cryptoPrefixForUser(userId: string): string {
  return `matrix-js-sdk-account-${userId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * Enables end-to-end encryption support (rust-crypto / matrix-sdk-crypto-wasm).
 * Must be called after createRestoredClient and before startClient - most
 * rooms on modern homeservers default to encrypted, so without this,
 * sending/reading messages in those rooms fails outright.
 *
 * `cryptoDatabasePrefix`, when given, isolates this account's IndexedDB
 * crypto store from any other account logged in in the same browser origin
 * (multi-account support - see StoredSession.cryptoDatabasePrefix). Left
 * unset, the SDK uses its own fixed default (unprefixed) store name -
 * intentional for whichever account is the FIRST to ever use this browser
 * profile/device, so a pre-existing, possibly-years-old verified identity
 * never silently moves to a different IndexedDB name.
 *
 * Returns the prefix actually used (undefined for the default store), so a
 * caller that persists StoredSession.cryptoDatabasePrefix can save back
 * whatever this function decided - see the self-heal case below for why
 * that can differ from what was passed in.
 *
 * Logging out never clears the default store (a same-user re-login must not
 * orphan it - see above), so if a DIFFERENT account signs in later on the
 * same device without an explicit prefix, rust-crypto refuses to open a
 * store that already belongs to someone else's account ("the account in the
 * store doesn't match the account in the constructor", confirmed live on a
 * real device 2026-09-16). Self-heals by retrying once with a fresh,
 * this-account-only prefix instead of crashing the whole login/registration.
 */
export async function initCrypto(client: MatrixClient, cryptoDatabasePrefix?: string): Promise<string | undefined> {
  try {
    await client.initRustCrypto(cryptoDatabasePrefix ? { cryptoDatabasePrefix } : undefined);
    return cryptoDatabasePrefix;
  } catch (err) {
    const userId = client.getUserId();
    if (cryptoDatabasePrefix || !userId || !(err instanceof Error) || !/account in the store doesn't match/.test(err.message)) {
      throw err;
    }
    const fallbackPrefix = cryptoPrefixForUser(userId);
    await client.initRustCrypto({ cryptoDatabasePrefix: fallbackPrefix });
    return fallbackPrefix;
  }
}

/**
 * Starts the client's sync loop and resolves once the first sync has
 * completed (SyncState.Prepared), i.e. once rooms/timelines are usable.
 */
export function startClient(client: MatrixClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSync = (state: SyncState) => {
      if (state === SyncState.Prepared) {
        client.removeListener(ClientEvent.Sync, onSync);
        resolve();
      } else if (state === SyncState.Error) {
        client.removeListener(ClientEvent.Sync, onSync);
        reject(new Error("Matrix sync hiba"));
      }
    };
    client.on(ClientEvent.Sync, onSync);
    void client.startClient({ initialSyncLimit: 20 });
  });
}

export async function logoutClient(client: MatrixClient): Promise<void> {
  client.stopClient();
  try {
    await client.logout();
  } catch {
    // ha a token már érvénytelen, nincs teendő - helyi session-t úgyis töröljük
  }
}
