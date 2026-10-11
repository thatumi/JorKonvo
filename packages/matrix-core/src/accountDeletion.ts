import { MatrixError, type MatrixClient } from "matrix-js-sdk";

/**
 * Account deactivation (`POST /_matrix/client/v3/account/deactivate`) -
 * irreversible: the account can never log in again, and with `erase: true`
 * the homeserver also scrubs the account's own messages where it can
 * (redacting content, not removing the events other users already have a
 * copy of - the spec is explicit that "erase" is best-effort, same honesty
 * this codebase already applies elsewhere). Gated behind User-Interactive
 * Auth on most homeservers, same UIA dance as device deletion in
 * devices.ts - deliberately mirrors that exact pattern.
 */
export async function deactivateAccountOrRequireAuth(
  client: MatrixClient,
  erase: boolean,
): Promise<string | null> {
  try {
    await client.deactivateAccount(undefined, erase);
    return null;
  } catch (err) {
    if (err instanceof MatrixError && err.data?.session && err.data?.flows) {
      return err.data.session as string;
    }
    throw err;
  }
}

export async function deactivateAccountWithPassword(
  client: MatrixClient,
  userId: string,
  password: string,
  session: string,
  erase: boolean,
): Promise<void> {
  await client.deactivateAccount(
    {
      type: "m.login.password",
      identifier: { type: "m.id.user", user: userId },
      password,
      session,
    },
    erase,
  );
}
