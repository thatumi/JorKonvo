import { afterEach, describe, expect, it, vi } from "vitest";
import { probeRegistration, registerAccount } from "../../../packages/matrix-core/src/registration.js";

/** Queue of responses `fetch` should hand back, in order. */
function mockFetchSequence(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; body: unknown }[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return {
        status: r.status,
        json: async () => r.body,
      } as Response;
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("probeRegistration", () => {
  it("reports disabled on M_FORBIDDEN", async () => {
    mockFetchSequence([{ status: 403, body: { errcode: "M_FORBIDDEN" } }]);
    expect(await probeRegistration("https://hs.test")).toEqual({ enabled: false, requiresToken: false });
  });

  it("reports enabled + no token for a plain dummy flow", async () => {
    mockFetchSequence([{ status: 401, body: { session: "s", flows: [{ stages: ["m.login.dummy"] }] } }]);
    expect(await probeRegistration("https://hs.test")).toEqual({ enabled: true, requiresToken: false });
  });

  it("reports requiresToken when every flow needs a registration token", async () => {
    mockFetchSequence([
      { status: 401, body: { session: "s", flows: [{ stages: ["m.login.registration_token", "m.login.dummy"] }] } },
    ]);
    expect(await probeRegistration("https://hs.test")).toEqual({ enabled: true, requiresToken: true });
  });

  it("surfaces an unsupported stage (e.g. recaptcha) rather than pretending it can proceed", async () => {
    mockFetchSequence([
      { status: 401, body: { session: "s", flows: [{ stages: ["m.login.recaptcha", "m.login.dummy"] }] } },
    ]);
    const cap = await probeRegistration("https://hs.test");
    expect(cap.enabled).toBe(true);
    expect(cap.unsupportedStage).toBe("m.login.recaptcha");
  });
});

describe("registerAccount", () => {
  it("completes a dummy flow and returns the session", async () => {
    const calls = mockFetchSequence([
      { status: 401, body: { session: "sess1", flows: [{ stages: ["m.login.dummy"] }] } },
      { status: 200, body: { access_token: "tok", user_id: "@new:hs.test", device_id: "DEV1" } },
    ]);
    const session = await registerAccount("https://hs.test/", { username: "new", password: "pw12345" });
    expect(session).toEqual({
      homeserverUrl: "https://hs.test",
      accessToken: "tok",
      userId: "@new:hs.test",
      deviceId: "DEV1",
    });
    // second call carries the auth stage + session id
    expect(calls[1].body).toMatchObject({ auth: { session: "sess1", type: "m.login.dummy" } });
  });

  it("sends the token in the registration_token stage", async () => {
    const calls = mockFetchSequence([
      { status: 401, body: { session: "s", flows: [{ stages: ["m.login.registration_token"] }] } },
      { status: 200, body: { access_token: "t", user_id: "@u:hs.test" } },
    ]);
    await registerAccount("https://hs.test", { username: "u", password: "pw", registrationToken: " abc123 " });
    expect(calls[1].body).toMatchObject({ auth: { type: "m.login.registration_token", token: "abc123" } });
  });

  it("throws a clear error when the server demands an unsupported step", async () => {
    mockFetchSequence([{ status: 401, body: { session: "s", flows: [{ stages: ["m.login.email.identity"] }] } }]);
    await expect(registerAccount("https://hs.test", { username: "u", password: "pw" })).rejects.toThrow(
      /unsupported registration step/,
    );
  });

  it("throws when a token flow is offered but no token was supplied", async () => {
    mockFetchSequence([
      { status: 401, body: { session: "s", flows: [{ stages: ["m.login.registration_token"] }] } },
    ]);
    await expect(registerAccount("https://hs.test", { username: "u", password: "pw" })).rejects.toThrow(
      /requires a registration token/,
    );
  });

  it("propagates a server errcode message from a mid-flow rejection", async () => {
    mockFetchSequence([
      { status: 401, body: { session: "s", flows: [{ stages: ["m.login.dummy"] }] } },
      { status: 400, body: { errcode: "M_USER_IN_USE", error: "User ID already taken." } },
    ]);
    await expect(registerAccount("https://hs.test", { username: "taken", password: "pw" })).rejects.toThrow(
      "User ID already taken.",
    );
  });
});
