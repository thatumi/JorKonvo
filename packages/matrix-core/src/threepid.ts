import { type MatrixClient, MatrixError } from "matrix-js-sdk";
import type { AuthDict } from "matrix-js-sdk/lib/interactive-auth.js";
import { secureRandomString } from "matrix-js-sdk/lib/randomstring.js";

/**
 * Managing your OWN account's email/phone (3PIDs) - for password recovery
 * and account discovery, NOT the same thing as inviting someone ELSE by
 * email (see the identity-server invite this app deliberately skipped:
 * that needs a real third-party identity server this project's test server
 * doesn't advertise). Adding your own address is a homeserver-only
 * operation - no identity server involved unless you separately choose to
 * bind it for discoverability, which isn't offered here.
 *
 * The add flow is two calls, spec-mandated: requestAddEmail sends a
 * validation email with a link the account owner must actually click
 * (nothing in this codebase can do that step - it requires a real inbox),
 * then confirmAddEmail finalizes it once that's done. Calling
 * confirmAddEmail before the link is clicked fails with M_UNAUTHORIZED -
 * that's expected, not a bug, and the caller should let the user retry
 * after checking their email.
 */

export interface OwnThreePid {
  medium: "email" | "msisdn";
  address: string;
  addedAt?: number;
}

export async function getOwnThreePids(client: MatrixClient): Promise<OwnThreePid[]> {
  const res = await client.getThreePids();
  return res.threepids.map((t) => ({
    medium: t.medium === "msisdn" ? "msisdn" : "email",
    address: t.address,
    addedAt: t.added_at,
  }));
}

export interface PendingEmailValidation {
  clientSecret: string;
  sid: string;
}

/** Sends a validation email to the given address. */
export async function requestAddEmail(client: MatrixClient, email: string): Promise<PendingEmailValidation> {
  const clientSecret = secureRandomString(32);
  const res = await client.requestAdd3pidEmailToken(email, clientSecret, 1);
  return { clientSecret, sid: res.sid };
}

/**
 * Finalizes adding a validated email to the account (fails until the
 * validation link has been clicked). Some homeservers additionally require
 * User-Interactive Auth (password re-confirmation) for this specific
 * operation - if the server responds that way, `requestPassword` is called
 * once to obtain it (never stored, same pattern as
 * crypto.ts's createFreshCrossSigningIdentity) and the request is retried
 * with it attached.
 */
export async function confirmAddEmail(
  client: MatrixClient,
  pending: PendingEmailValidation,
  requestPassword?: () => Promise<string>,
): Promise<void> {
  try {
    await client.addThreePidOnly({ client_secret: pending.clientSecret, sid: pending.sid });
  } catch (err) {
    const session = err instanceof MatrixError && err.httpStatus === 401 ? (err.data?.session as string | undefined) : undefined;
    if (!session || !requestPassword) throw err;
    const password = await requestPassword();
    const auth: AuthDict = {
      type: "m.login.password",
      identifier: { type: "m.id.user", user: client.getUserId() ?? "" },
      password,
      session,
    };
    // IAddThreePidOnlyBody types `auth` narrower ({type, session?}) than the
    // full password-auth dict the spec's UIA actually needs here
    // (identifier + password too) - the SDK just forwards whatever object
    // is given as JSON, so this is a real spec-compliant request the type
    // is simply too strict to describe.
    await client.addThreePidOnly({
      client_secret: pending.clientSecret,
      sid: pending.sid,
      auth: auth as unknown as { type: string; session?: string },
    });
  }
}

export async function removeThreePid(client: MatrixClient, medium: string, address: string): Promise<void> {
  await client.deleteThreePid(medium, address);
}
