import { expect, test } from "@playwright/test";
import { HS_URL, registerUser } from "./helpers";

test.describe("first-run onboarding", () => {
  test("a brand-new account sees the welcome modal, and it doesn't come back", async ({ page }) => {
    const user = await registerUser("welcome");

    // Sign in WITHOUT the helper's localStorage opt-out, so the welcome
    // modal is live - but keep the locale pinned for stable selectors.
    await page.addInitScript(() => {
      try {
        localStorage.setItem("jorkonvo-locale", "en");
      } catch {
        /* ignore */
      }
    });
    await page.goto("/");
    await page.getByTestId("login-tab-password").click();
    await page.getByTestId("login-homeserver").fill(HS_URL);
    await page.getByTestId("login-username").fill(user.username);
    await page.getByTestId("login-password").fill(user.password);
    await page.getByTestId("login-submit").click();

    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 45_000 });

    // The welcome modal appears for the empty new account.
    await expect(page.getByTestId("welcome-skip")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("welcome-skip").click();
    await expect(page.getByTestId("welcome-skip")).toHaveCount(0);

    // It stays gone across a reload.
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("welcome-skip")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("jorkonvo-welcomed"))).toBe("1");
  });
});
