import { createHmac, randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";

// The test homeserver is fronted by Caddy's internal-CA cert; these Node-side
// admin calls (never the browser) need to accept it. Test-only process.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export const HS_URL = process.env.E2E_HOMESERVER ?? "https://localhost:18448";
/** Matches registration_shared_secret in e2e/synapse/homeserver.yaml (test-only). */
const SHARED_SECRET = "Ml-PsUd#h~mr:ldaQHpZImpx9UlCtARUWFmqQ~SSMrLjfX_Rdd";

export interface TestUser {
  username: string;
  userId: string;
  password: string;
}

/**
 * Registers a fresh user straight through Synapse's admin
 * `/_synapse/admin/v1/register` shared-secret endpoint - far faster and
 * more reliable than driving the sign-up form, and it never touches the
 * flow under test.
 */
export async function registerUser(prefix = "u"): Promise<TestUser> {
  const username = `${prefix}_${randomBytes(4).toString("hex")}`;
  const password = `pw_${randomBytes(8).toString("hex")}`;

  const nonceRes = await fetch(`${HS_URL}/_synapse/admin/v1/register`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };

  const mac = createHmac("sha1", SHARED_SECRET);
  mac.update(nonce);
  mac.update("\x00");
  mac.update(username);
  mac.update("\x00");
  mac.update(password);
  mac.update("\x00");
  mac.update("notadmin");

  const res = await fetch(`${HS_URL}/_synapse/admin/v1/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce, username, password, admin: false, mac: mac.digest("hex") }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { user_id: string; access_token: string; device_id: string };

  // Synapse's admin register endpoint returns a live access_token/device_id
  // of its own (it logs the account in as a side effect of creating it) -
  // an extra, unused device+session nothing in the test drives, sitting
  // invisible in the account's device list. Log it straight back out so
  // every test starts from a clean 0-device account; tests that list/count
  // devices (e.g. verification.spec.ts) would otherwise see this phantom
  // session alongside whatever loginAs() sessions the test itself creates.
  await fetch(`${HS_URL}/_matrix/client/v3/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${body.access_token}` },
  }).catch(() => undefined);

  return { username, userId: body.user_id, password };
}

/** Password-login over the API (no browser) - for test setup that needs a token. */
export async function apiLogin(user: TestUser): Promise<{ accessToken: string; userId: string }> {
  const res = await fetch(`${HS_URL}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: user.username },
      password: user.password,
    }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const b = (await res.json()) as { access_token: string; user_id: string };
  return { accessToken: b.access_token, userId: b.user_id };
}

export async function inviteToRoom(token: string, roomId: string, userId: string): Promise<void> {
  const res = await fetch(`${HS_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!res.ok) throw new Error(`invite failed: ${res.status} ${await res.text()}`);
}

/**
 * Signs in through the password form and waits for the main app shell.
 *
 * By default also dismisses the first-login encryption key setup modal
 * (`runPostAuthKeySetup` in authStore.ts) the same way a user clicking
 * "I'll do this later" would - every `registerUser()` account is brand new
 * with nothing set up yet, so this modal opens automatically on its first
 * login and its backdrop blocks interaction with the rest of the app,
 * which every OTHER spec in this suite doesn't care about. Pass
 * `handleSecuritySetup: false` to leave it open and drive it yourself
 * (see firstLoginSecurity.spec.ts).
 */
export async function loginAs(
  page: Page,
  user: TestUser,
  opts: { handleSecuritySetup?: boolean } = {},
): Promise<void> {
  const { handleSecuritySetup = true } = opts;
  await page.addInitScript(() => {
    try {
      localStorage.setItem("jorkonvo-locale", "en");
      // The first-run welcome modal would otherwise cover the app for every
      // freshly-registered test user; onboarding.spec.ts opts back in.
      localStorage.setItem("jorkonvo-welcomed", "1");
    } catch {
      /* ignore */
    }
  });
  await page.goto("/");

  await page.getByTestId("login-tab-password").click();
  const homeserver = page.getByTestId("login-homeserver");
  await homeserver.fill(HS_URL);
  await page.getByTestId("login-username").fill(user.username);
  await page.getByTestId("login-password").fill(user.password);
  await page.getByTestId("login-submit").click();

  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 45_000 });

  if (handleSecuritySetup) {
    const laterButton = page.getByTestId("firstlogin-done").or(page.getByTestId("firstlogin-restore-later"));
    try {
      await laterButton.waitFor({ state: "visible", timeout: 20_000 });
      await laterButton.click();
    } catch {
      // Nothing to dismiss - this account/device already has its keys
      // (e.g. a second loginAs() for a user this test already set up).
    }
  }
}
