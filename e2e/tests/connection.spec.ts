import { expect, test } from "@playwright/test";
import { loginAs, registerUser } from "./helpers";

test.describe("connection status", () => {
  test("the offline banner shows when the network drops and clears when it returns", async ({ page, context }) => {
    const user = await registerUser("offline");
    await loginAs(page, user);

    // Healthy sync: no banner.
    await expect(page.getByTestId("connection-banner")).toHaveCount(0);

    await context.setOffline(true);
    await expect(page.getByTestId("connection-banner")).toBeVisible({ timeout: 10_000 });

    await context.setOffline(false);
    await expect(page.getByTestId("connection-banner")).toHaveCount(0, { timeout: 30_000 });
  });
});
