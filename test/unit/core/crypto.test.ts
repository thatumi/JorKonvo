import { describe, expect, it } from "vitest";
import type { MatrixClient } from "matrix-js-sdk";
import { encodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";
import { resolveSecretStorageKey } from "../../../packages/matrix-core/src/crypto.js";

function realKeyBytes(): Uint8Array {
  // A syntactically valid recovery key (correct prefix/length/parity) with
  // deterministic-but-arbitrary bytes - resolveSecretStorageKey must accept
  // its *format*, then defer to checkKey (mocked below) for whether it's
  // actually the right key for the account.
  return Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);
}

function makeClient(opts: {
  hasSecretStorage: boolean;
  checkKeyResult: boolean;
}): { client: MatrixClient; keyInfo: Record<string, never> } {
  const keyInfo = {} as Record<string, never>;
  const client = {
    secretStorage: {
      getKey: async () => (opts.hasSecretStorage ? ["key-id-1", keyInfo] : null),
      checkKey: async () => opts.checkKeyResult,
    },
  } as unknown as MatrixClient;
  return { client, keyInfo };
}

describe("resolveSecretStorageKey", () => {
  it("rejects an empty or whitespace-only input before touching the network", async () => {
    const { client } = makeClient({ hasSecretStorage: true, checkKeyResult: true });
    await expect(resolveSecretStorageKey(client, "   ")).rejects.toThrow("Add meg a helyreállítási kulcsot");
  });

  it("reports when the account has no secret storage set up at all", async () => {
    const { client } = makeClient({ hasSecretStorage: false, checkKeyResult: true });
    await expect(resolveSecretStorageKey(client, "anything")).rejects.toThrow(
      "Ehhez a fiókhoz nincs biztonsági tároló",
    );
  });

  it("rejects input that is neither a valid recovery key format nor a usable passphrase", async () => {
    const { client } = makeClient({ hasSecretStorage: true, checkKeyResult: true });
    await expect(resolveSecretStorageKey(client, "not a real recovery key at all")).rejects.toThrow(
      "Érvénytelen helyreállítási kulcs formátum",
    );
  });

  it("rejects a well-formatted recovery key that doesn't match this account's secret storage", async () => {
    const { client } = makeClient({ hasSecretStorage: true, checkKeyResult: false });
    const wrongKey = encodeRecoveryKey(realKeyBytes())!;
    await expect(resolveSecretStorageKey(client, wrongKey)).rejects.toThrow(
      "Ez a kulcs nem ehhez a fiókhoz tartozik",
    );
  });

  it("resolves keyId + key bytes for a recovery key that matches", async () => {
    const { client } = makeClient({ hasSecretStorage: true, checkKeyResult: true });
    const key = encodeRecoveryKey(realKeyBytes())!;
    const result = await resolveSecretStorageKey(client, key);
    expect(result.keyId).toBe("key-id-1");
    expect(result.key).toBeInstanceOf(Uint8Array);
    expect(result.key.length).toBe(32);
  });

  it("tolerates surrounding whitespace the user might paste in", async () => {
    const { client } = makeClient({ hasSecretStorage: true, checkKeyResult: true });
    const key = encodeRecoveryKey(realKeyBytes())!;
    const result = await resolveSecretStorageKey(client, `  ${key}  `);
    expect(result.keyId).toBe("key-id-1");
  });
});
