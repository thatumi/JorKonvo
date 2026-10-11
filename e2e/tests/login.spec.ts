import { expect, test } from "@playwright/test";
import { HS_URL, loginAs, registerUser } from "./helpers";

test.describe("authentication", () => {
  test("password sign-in reaches the main app shell", async ({ page }) => {
    const user = await registerUser("login");
    await loginAs(page, user);
    await expect(page.getByTestId("app-shell")).toBeVisible();
    // the session is persisted so a reload stays signed in
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 45_000 });
  });

  test("a wrong password shows an error and stays on the login screen", async ({ page }) => {
    const user = await registerUser("login");
    await page.addInitScript(() => localStorage.setItem("jorkonvo-locale", "en"));
    await page.goto("/");
    await page.getByTestId("login-tab-password").click();
    await page.getByTestId("login-homeserver").fill(HS_URL);
    await page.getByTestId("login-username").fill(user.username);
    await page.getByTestId("login-password").fill("definitely-not-the-password");
    await page.getByTestId("login-submit").click();

    await expect(page.getByTestId("login-submit")).toBeVisible();
    await expect(page.getByTestId("app-shell")).toHaveCount(0);
  });

  test("in-app registration creates a usable account", async ({ page }) => {
    const username = `reg_${Date.now().toString(36)}`;
    await page.addInitScript(() => localStorage.setItem("jorkonvo-locale", "en"));
    await page.goto("/");
    await page.getByTestId("login-tab-register").click();
    await page.getByTestId("login-homeserver").fill(HS_URL);
    await page.getByTestId("register-username").fill(username);
    await page.getByTestId("register-password").fill("hunter2hunter2");
    await page.getByTestId("register-password-confirm").fill("hunter2hunter2");
    await page.getByTestId("register-submit").click();

    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 45_000 });
  });
});
