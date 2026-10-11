import { ImportRoomKeyStage } from "matrix-js-sdk/lib/crypto-api/index.js";
import { deriveRecoveryKeyFromPassphrase } from "matrix-js-sdk/lib/crypto-api/key-passphrase.js";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";
import type { MatrixClient } from "matrix-js-sdk";
import type { SecretStorageKeyDescriptionAesV1 } from "matrix-js-sdk/lib/secret-storage.js";
import type { AuthDict } from "matrix-js-sdk/lib/interactive-auth.js";

/**
 * Turns the string a user types into the RecoveryKeyModal into the raw secret
 * storage key, coping with the two things they might actually paste:
 *   - a recovery/security key ("EsX ..." base58), OR
 *   - the passphrase it was derived from (if 4S was set up with one).
 * The resulting key is validated against the account's own secret storage key
 * info, so a genuinely wrong key produces a clear message here rather than an
 * opaque decryption failure three calls deep.
 */
export async function resolveSecretStorageKey(
  client: MatrixClient,
  input: string,
): Promise<{ keyId: string; key: Uint8Array<ArrayBuffer> }> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Add meg a helyreállítási kulcsot");

  const entry = await client.secretStorage.getKey();
  if (!entry) {
    throw new Error("Ehhez a fiókhoz nincs biztonsági tároló (secret storage) beállítva");
  }
  const [keyId, keyInfo] = entry as [string, SecretStorageKeyDescriptionAesV1];

  const candidates: Uint8Array<ArrayBuffer>[] = [];
  try {
    candidates.push(decodeRecoveryKey(trimmed) as Uint8Array<ArrayBuffer>);
  } catch {
    // Not a recovery key - maybe it's the passphrase.
  }
  if (keyInfo.passphrase?.salt && keyInfo.passphrase?.iterations) {
    try {
      candidates.push(
        await deriveRecoveryKeyFromPassphrase(
          trimmed,
          keyInfo.passphrase.salt,
          keyInfo.passphrase.iterations,
          keyInfo.passphrase.bits,
        ),
      );
    } catch {
      // ignore - handled by the "no candidate matched" throw below
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      "Érvénytelen helyreállítási kulcs formátum - a fiók biztonsági kulcsát ('EsX …') vagy a hozzá tartozó jelmondatot add meg",
    );
  }

  for (const key of candidates) {
    if (await client.secretStorage.checkKey(key, keyInfo)) {
      return { keyId, key };
    }
  }

  throw new Error(
    "Ez a kulcs nem ehhez a fiókhoz tartozik - ellenőrizd, hogy a helyreállítási/biztonsági kulcsot adtad meg (nem a jelszavadat)",
  );
}

/**
 * Registers a `getSecretStorageKey` crypto callback that serves the given
 * key. Must MUTATE the existing callback objects in place, not reassign
 * `client.cryptoCallbacks`: `MatrixClient` builds its `ServerSideSecretStorage`
 * (and passes it into rust-crypto) with a reference to whatever
 * `cryptoCallbacks` object existed at construction time - since this app
 * creates the client without a `cryptoCallbacks` option, that's a *separate*
 * empty object from `client.cryptoCallbacks`, and reassigning the latter
 * leaves secret storage with no callback at all ("No getSecretStorageKey
 * callback supplied"). So write onto both.
 */
function installSecretStorageKeyCallback(
  client: MatrixClient,
  keyId: string,
  key: Uint8Array<ArrayBuffer>,
): void {
  const cb: NonNullable<MatrixClient["cryptoCallbacks"]>["getSecretStorageKey"] = async ({ keys }) => {
    if (keys[keyId]) return [keyId, key];
    const first = Object.keys(keys)[0];
    return first ? [first, key] : null;
  };
  if (!client.cryptoCallbacks) client.cryptoCallbacks = {};
  client.cryptoCallbacks.getSecretStorageKey = cb;
  const ssCallbacks = (client.secretStorage as unknown as { callbacks?: Record<string, unknown> }).callbacks;
  if (ssCallbacks) ssCallbacks.getSecretStorageKey = cb;
}

export interface KeyBackupRestoreProgress {
  total: number;
  done: number;
}

export interface KeyBackupRestoreOutcome {
  imported: number;
  total: number;
}

/**
 * Restores the server-side megolm key backup using a 4S recovery key (the
 * "XXXX XXXX ..." string a user is shown once when setting up secure
 * backup). Without this, messages sent from other/previous sessions show as
 * "Unable to decrypt" since this device never had their room keys.
 */
export async function restoreKeyBackupWithRecoveryKey(
  client: MatrixClient,
  recoveryKey: string,
  onProgress?: (progress: KeyBackupRestoreProgress) => void,
): Promise<KeyBackupRestoreOutcome> {
  const crypto = client.getCrypto();
  if (!crypto) {
    throw new Error("A titkosítás nincs inicializálva ezen a kliensen");
  }

  const backupInfo = await crypto.getKeyBackupInfo();
  if (!backupInfo) {
    throw new Error("Ezen a szerveren nincs elérhető kulcs-mentés (key backup)");
  }

  const { keyId, key } = await resolveSecretStorageKey(client, recoveryKey);

  // The megolm-backup decryption key normally lives *inside* secret storage
  // (not equal to the recovery key), so unlock 4S and let the crypto stack
  // pull it out. Registering the callback also covers the older setup where
  // the recovery key doubles as the backup key.
  installSecretStorageKeyCallback(client, keyId, key);
  try {
    await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
  } catch {
    // Fall back to treating the recovery key itself as the backup key.
    await crypto.storeSessionBackupPrivateKey(key, backupInfo.version).catch(() => undefined);
  }

  const result = await crypto.restoreKeyBackup({
    progressCallback: onProgress
      ? (progress) => {
          if (progress.stage === ImportRoomKeyStage.LoadKeys) {
            onProgress({ total: progress.total, done: progress.successes });
          }
        }
      : undefined,
  });

  return result;
}

export async function hasServerKeyBackup(client: MatrixClient): Promise<boolean> {
  const crypto = client.getCrypto();
  if (!crypto) return false;
  const info = await crypto.getKeyBackupInfo();
  return info !== null;
}

export interface CrossSigningStatus {
  /** Cross-signing is fully set up AND this device already trusts/has access to it. */
  ready: boolean;
  /** The public cross-signing keys are visible on this device (via /keys/query). */
  publicKeysOnDevice: boolean;
  /** The private cross-signing keys exist in server-side secret storage (some device set them up). */
  privateKeysInSecretStorage: boolean;
  /** THIS device already has the private cross-signing keys cached locally - no recovery key needed. */
  privateKeysCachedLocally: boolean;
}

export async function getCrossSigningStatus(client: MatrixClient): Promise<CrossSigningStatus | null> {
  const crypto = client.getCrypto();
  if (!crypto) return null;
  const [ready, status] = await Promise.all([crypto.isCrossSigningReady(), crypto.getCrossSigningStatus()]);
  const { masterKey, selfSigningKey, userSigningKey } = status.privateKeysCachedLocally;
  return {
    ready,
    publicKeysOnDevice: status.publicKeysOnDevice,
    privateKeysInSecretStorage: status.privateKeysInSecretStorage,
    privateKeysCachedLocally: masterKey && selfSigningKey && userSigningKey,
  };
}

/**
 * Unlocks/restores an EXISTING cross-signing identity on this device using
 * the account's recovery key, by pulling the private cross-signing keys out
 * of server-side secret storage (set up on some other device, at some point
 * in this account's history). Registers the `getSecretStorageKey` crypto
 * callback matrix-js-sdk needs to decrypt secret storage, then calls
 * `bootstrapCrossSigning` - per its own doc comment this is a safe no-op if
 * this device already has everything it needs, so it's fine to call
 * speculatively without checking `getCrossSigningStatus()` first. Does NOT
 * create or reset any keys - only ever reads existing ones.
 */
export async function restoreCrossSigningWithRecoveryKey(
  client: MatrixClient,
  recoveryKey: string,
): Promise<CrossSigningStatus> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("A titkosítás nincs inicializálva");

  const { keyId, key } = await resolveSecretStorageKey(client, recoveryKey);
  installSecretStorageKeyCallback(client, keyId, key);

  await crypto.bootstrapCrossSigning({});
  const status = await getCrossSigningStatus(client);
  if (!status) throw new Error("A titkosítás nincs inicializálva");
  return status;
}

/**
 * Creates a BRAND NEW cross-signing identity and secret storage for an
 * account that has neither yet. THIS IS DESTRUCTIVE if the account already
 * has cross-signing set up somewhere (it resets the keys, invalidating
 * trust from every other device/user) - callers must confirm via
 * `getCrossSigningStatus()` that nothing exists yet (or have explicit user
 * confirmation to reset) before calling this.
 *
 * `/keys/device_signing/upload` requires User-Interactive Auth on most
 * homeservers; `requestPassword` is called to obtain the account password
 * for that one re-auth request - it is never stored.
 *
 * Returns the newly generated recovery key, which the caller must show to
 * the user exactly once (it's the only time it's ever available in plain
 * form) and never persist anywhere itself.
 */
export async function createFreshCrossSigningIdentity(
  client: MatrixClient,
  requestPassword: () => Promise<string>,
): Promise<string> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("A titkosítás nincs inicializálva");

  try {
    await crypto.bootstrapCrossSigning({
      setupNewCrossSigning: true,
      authUploadDeviceSigningKeys: async (makeRequest) => {
        const password = await requestPassword();
        const authData: AuthDict = {
          type: "m.login.password",
          identifier: { type: "m.id.user", user: client.getUserId() ?? "" },
          password,
        };
        await makeRequest(authData);
      },
    });
  } catch (err) {
    // bootstrapCrossSigning() flushes the crypto stack's whole outgoing-
    // request queue, which can include an unrelated, racy one-time-key
    // replenishment upload (the well-known, harmless "One time key ...
    // already exists" 400 seen elsewhere in this app too) - that failure
    // has nothing to do with whether the actual cross-signing keys got
    // created, so only treat this as a real failure if they didn't.
    const status = await crypto.getCrossSigningStatus();
    if (!status.publicKeysOnDevice) throw err;
  }

  // bootstrapSecretStorage may need to read back the key it just created
  // (e.g. to encrypt the freshly-created cross-signing private keys into
  // secret storage) - cache it via the documented cacheSecretStorageKey
  // callback so getSecretStorageKey can serve it back without re-prompting.
  const cache = new Map<string, Uint8Array<ArrayBuffer>>();
  const cacheSecretStorageKey = (keyId: string, _keyInfo: unknown, key: Uint8Array<ArrayBuffer>) => {
    cache.set(keyId, key);
  };
  const getSecretStorageKey = async ({ keys }: { keys: Record<string, unknown> }) => {
    for (const keyId of Object.keys(keys)) {
      const key = cache.get(keyId);
      if (key) return [keyId, key] as [string, Uint8Array<ArrayBuffer>];
    }
    return null;
  };
  // See installSecretStorageKeyCallback: must mutate both callback objects in
  // place, not reassign client.cryptoCallbacks.
  for (const target of [
    client.cryptoCallbacks,
    (client.secretStorage as unknown as { callbacks?: Record<string, unknown> }).callbacks,
  ]) {
    if (!target) continue;
    (target as Record<string, unknown>).cacheSecretStorageKey = cacheSecretStorageKey;
    (target as Record<string, unknown>).getSecretStorageKey = getSecretStorageKey;
  }

  let recoveryKey = "";
  try {
    await crypto.bootstrapSecretStorage({
      setupNewSecretStorage: true,
      setupNewKeyBackup: true,
      createSecretStorageKey: async () => {
        const generated = await crypto.createRecoveryKeyFromPassphrase();
        recoveryKey = generated.encodedPrivateKey ?? "";
        return generated;
      },
    });
  } catch (err) {
    // Same reasoning as above - only a real failure if secret storage
    // genuinely isn't usable afterwards.
    if (!recoveryKey || !(await crypto.isSecretStorageReady())) throw err;
  }

  if (!recoveryKey) throw new Error("Nem sikerült helyreállítási kulcsot létrehozni");
  return recoveryKey;
}
