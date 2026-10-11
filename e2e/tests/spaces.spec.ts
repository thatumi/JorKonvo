import { expect, test } from "@playwright/test";
import { loginAs, registerUser } from "./helpers";

test.describe("spaces and channels", () => {
  test("create a space, then a channel inside it", async ({ page }) => {
    const user = await registerUser("space");
    await loginAs(page, user);

    // New space
    await page.getByTestId("rail-new-space").click();
    const spaceName = `guild-${Date.now().toString(36)}`;
    await page.getByTestId("create-space-name").fill(spaceName);
    await page.getByTestId("create-space-submit").click();
    await expect(page.getByTestId("modal")).toHaveCount(0);

    // The sidebar now shows the space; add a channel to it
    await page.getByTestId("sidebar-new-room").click();
    const channelName = `general-${Date.now().toString(36)}`;
    await page.getByTestId("create-room-name").fill(channelName);
    await page.getByTestId("create-room-submit").click();
    await expect(page.getByTestId("modal")).toHaveCount(0);

    // The channel is listed and opens with a working composer
    const row = page.locator(`[data-testid="room-row"][data-room-name="${channelName}"]`);
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByTestId("composer-input")).toBeVisible();

    // It survives a reload (state persisted to the local store + server)
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 45_000 });
    await page.locator(`[data-testid="space-rail-item"][data-space-name="${spaceName}"]`).click();
    await expect(
      page.locator(`[data-testid="room-row"][data-room-name="${channelName}"]`),
    ).toBeVisible({ timeout: 30_000 });
  });
});
