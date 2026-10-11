import { expect, test } from "@playwright/test";
import { loginAs, registerUser } from "./helpers";

test.describe("first-login security setup", () => {
  test("a brand-new account gets its recovery key created and revealed automatically on first login", async ({
    page,
  }) => {
    // registerUser() creates the account out-of-band via Synapse's admin API
    // (no client has ever booted for it), so the very first loginAs() below
    // is exactly the "nothing set up anywhere yet" case runPostAuthKeySetup
    // handles - it should auto-create a fresh identity using the password
    // already in hand from the login form, with no extra prompt.
    // navigator.clipboard.writeText() needs this granted explicitly in a
    // Playwright-driven Chromium, or it silently rejects and the "copied"
    // confirmation never shows.
    await page.context().grantPermissions(["clipboard-write", "clipboard-read"]);

    const user = await registerUser("keysetup");
    await loginAs(page, user, { handleSecuritySetup: false });

    await expect(page.getByTestId("firstlogin-recovery-key")).toBeVisible({ timeout: 30_000 });
    const key = (await page.getByTestId("firstlogin-recovery-key").textContent())?.trim();
    expect(key).toBeTruthy();
    expect(key!.length).toBeGreaterThan(10);

    await page.getByTestId("firstlogin-copy-key").click();
    await expect(page.getByTestId("firstlogin-done")).toContainText("continue");
    await page.getByTestId("firstlogin-done").click();

    await expect(page.getByTestId("modal")).toHaveCount(0);

    // A second sign-in with the SAME session (this device already has the
    // keys cached locally now) must not show the prompt again.
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("firstlogin-recovery-key")).toHaveCount(0);
  });
});
