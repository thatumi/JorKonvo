/**
 * Password account registration (`POST /_matrix/client/v3/register`),
 * driven with raw `fetch` the same way guestAccess.ts's `registerGuest`
 * is - there's no authenticated MatrixClient yet at this point, so the SDK's
 * own client isn't in play.
 *
 * Registration is a User-Interactive Auth (UIA) dance: the first call (no
 * `auth`) always 401s back a list of acceptable "flows" (ordered stage
 * lists), and completing each stage in a chosen flow means resubmitting
 * with `auth: {session, type: <stage>, ...}` until the server is satisfied
 * and returns 200 with an access token. This client only knows how to
 * complete the stages a plain sign-up form can reasonably drive itself
 * (`m.login.dummy`, `m.login.registration_token`, `m.login.terms`) - a
 * server that also demands `m.login.recaptcha`/`m.login.email.identity`/
 * `m.login.msisdn` needs a flow this app can't complete, so that's
 * surfaced as a clear, named error rather than attempted.
 */

const SUPPORTED_STAGES = new Set(["m.login.dummy", "m.login.registration_token", "m.login.terms"]);

interface UiaFlow {
  stages: string[];
}

interface UiaResponse {
  session?: string;
  flows?: UiaFlow[];
  completed?: string[];
  errcode?: string;
  error?: string;
}

interface RegisterApiResponse extends UiaResponse {
  access_token?: string;
  user_id?: string;
  device_id?: string;
}

async function registerCall(base: string, body: unknown): Promise<{ status: number; data: RegisterApiResponse }> {
  const res = await fetch(`${base}/_matrix/client/v3/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as RegisterApiResponse;
  return { status: res.status, data };
}

/**
 * Maps a rejected register call to a message that names the actual problem.
 * Previously anything that wasn't 200/403/401-with-flows fell into the
 * "unsupported registration step" bucket - most painfully HTTP 429
 * (M_LIMIT_EXCEEDED), which this shared homeserver hands out readily since
 * every UIA probe POST counts toward its registration rate limit, and which
 * surfaced to the user as the nonsensical "unsupported registration step
 * (unknown)" (seen live, 2026-09-16).
 */
function describeRegisterRejection(status: number, data: RegisterApiResponse): string {
  // The server's own wording is usually already correct and specific
  // ("User ID already taken.", "Invalid registration token" for a UIA stage
  // failure, etc.) - prefer it verbatim. The friendlier fallbacks below only
  // cover cases that otherwise had NO useful message at all, which is what
  // actually produced the nonsensical "unsupported registration step
  // (unknown)" report (empty `flows`, no `error`, no recognized `errcode`).
  if (data.error) return data.error;
  if (status === 429 || data.errcode === "M_LIMIT_EXCEEDED") {
    return "Too many attempts in a short time - wait a minute and try again.";
  }
  if (status === 403 || data.errcode === "M_FORBIDDEN") {
    return "This homeserver does not allow account registration.";
  }
  return `Registration failed unexpectedly (HTTP ${status}).`;
}

export interface RegistrationCapability {
  /** False when the server flatly rejects registration (M_FORBIDDEN) - e.g. closed/invite-only servers. */
  enabled: boolean;
  /** True when every offered flow includes a registration-token stage - the sign-up form should show that field. */
  requiresToken: boolean;
  /** Set to the first stage this client can't complete, if none of the offered flows are fully supported. */
  unsupportedStage?: string;
}

/** Probes whether (and how) `homeserverUrl` allows new account registration, without creating one. */
export async function probeRegistration(homeserverUrl: string): Promise<RegistrationCapability> {
  const base = homeserverUrl.replace(/\/$/, "");
  const { status, data } = await registerCall(base, {});
  if (status === 403 || data.errcode === "M_FORBIDDEN") {
    return { enabled: false, requiresToken: false };
  }
  const flows = data.flows ?? [];
  if (flows.length === 0) {
    // No UIA at all required (unusual, but spec-legal for a wide-open server).
    return { enabled: true, requiresToken: false };
  }
  const supportedFlow = flows.find((f) => f.stages.every((s) => SUPPORTED_STAGES.has(s)));
  const requiresToken = flows.every((f) => f.stages.includes("m.login.registration_token"));
  if (!supportedFlow) {
    const unsupportedStage = flows[0]?.stages.find((s) => !SUPPORTED_STAGES.has(s));
    return { enabled: true, requiresToken, unsupportedStage };
  }
  return { enabled: true, requiresToken };
}

export interface RegisteredSession {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
}

/** Registers a brand-new password account, completing whichever supported UIA flow the server offers. */
export async function registerAccount(
  homeserverUrl: string,
  params: { username: string; password: string; registrationToken?: string },
): Promise<RegisteredSession> {
  const base = homeserverUrl.replace(/\/$/, "");
  const baseBody = {
    username: params.username,
    password: params.password,
    initial_device_display_name: "JorKonvo",
  };

  const first = await registerCall(base, baseBody);
  if (first.status === 200 && first.data.access_token && first.data.user_id) {
    return toSession(base, first.data);
  }

  const flows = first.data.flows ?? [];
  if (flows.length === 0) {
    // Not a UIA prompt (that always carries flows) - so this is a rejection.
    // Rate limits, taken usernames, weak passwords, disabled registration...
    // name the actual problem instead of the old "(unknown) unsupported
    // step" catch-all that swallowed all of them.
    throw new Error(describeRegisterRejection(first.status, first.data));
  }
  const flow = flows.find((f) => f.stages.every((s) => SUPPORTED_STAGES.has(s)));
  if (!flow) {
    const unsupported = flows[0]?.stages.find((s) => !SUPPORTED_STAGES.has(s)) ?? "unknown";
    throw new Error(`This homeserver requires an unsupported registration step (${unsupported}).`);
  }
  if (flow.stages.includes("m.login.registration_token") && !params.registrationToken?.trim()) {
    throw new Error("This homeserver requires a registration token.");
  }

  let session = first.data.session;
  let completed = new Set(first.data.completed ?? []);
  let response = first;

  for (let i = 0; i < flow.stages.length + 1; i++) {
    const nextStage = flow.stages.find((s) => !completed.has(s));
    if (!nextStage) break;
    const auth: Record<string, unknown> = { session, type: nextStage };
    if (nextStage === "m.login.registration_token") auth.token = params.registrationToken!.trim();
    response = await registerCall(base, { ...baseBody, auth });
    if (response.status === 200 && response.data.access_token && response.data.user_id) {
      return toSession(base, response.data);
    }
    // A UIA stage failure (bad token, ...) answers 401 again WITH an `error`
    // body and no errcode; plain rejections carry an errcode. Either way the
    // mapped message beats retrying the same stage in a blind loop.
    if (response.data.error || response.data.errcode || response.status === 429) {
      throw new Error(describeRegisterRejection(response.status, response.data));
    }
    session = response.data.session ?? session;
    completed = new Set(response.data.completed ?? [...completed, nextStage]);
  }

  throw new Error("Registration did not complete - the homeserver kept requesting additional steps.");
}

function toSession(base: string, data: RegisterApiResponse): RegisteredSession {
  return {
    homeserverUrl: base,
    accessToken: data.access_token!,
    userId: data.user_id!,
    deviceId: data.device_id ?? "",
  };
}
