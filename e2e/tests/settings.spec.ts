import { expect, test } from "@playwright/test";
import { loginAs, registerUser } from "./helpers";

test.describe("settings persistence", () => {
  test("a changed preference survives a full reload", async ({ page }) => {
    const user = await registerUser("settings");
    await loginAs(page, user);

    await page.getByTestId("open-user-settings").click();
    await expect(page.getByTestId("settings-modal")).toBeVisible();
    await page.getByTestId("settings-nav-language").click();

    // Default is "auto"; switch to an explicit 24-hour clock.
    await page.getByTestId("settings-timeformat-24h").click();
    await expect(page.getByTestId("settings-timeformat-24h")).toHaveAttribute("aria-pressed", "true");

    // Close, hard reload, reopen - the choice is still applied.
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 45_000 });

    await page.getByTestId("open-user-settings").click();
    await page.getByTestId("settings-nav-language").click();
    await expect(page.getByTestId("settings-timeformat-24h")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("settings-timeformat-auto")).toHaveAttribute("aria-pressed", "false");

    expect(await page.evaluate(() => localStorage.getItem("jorkonvo-time-format"))).toBe("24h");
  });

  test("a settings pane taller than the viewport actually scrolls, not just clips (2026-09-16 fix)", async ({
    page,
  }) => {
    // Real bug reported live on iPhone: the settings shell's content pane
    // (the flex item between the outer dialog and the scrollable div) had
    // no min-h-0, so - per the flexbox spec's default min-height:auto on a
    // flex item - it grew to fit its own content instead of being clamped
    // to the available space. The deeper overflow-y-auto div never actually
    // became shorter than its content, so it had nothing to scroll; the
    // excess was just silently clipped by the outer dialog's overflow-hidden
    // one level up. A short viewport reproduces this for ANY pane, not just
    // a specific one - the bug was structural, not pane-specific.
    await page.setViewportSize({ width: 390, height: 300 });
    const user = await registerUser("settings-scroll");
    await loginAs(page, user);

    await page.getByTestId("open-user-settings").click();
    await expect(page.getByTestId("settings-modal")).toBeVisible();
    await page.getByTestId("settings-nav-appearance").click();

    const pane = page.getByTestId("settings-pane-content");
    await expect(pane).toBeVisible();

    // The pane's content genuinely overflows its box...
    const { scrollHeight, clientHeight } = await pane.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    // ...and it can actually be scrolled to reveal the rest, not stuck at 0.
    await pane.evaluate((el) => {
      el.scrollTop = 200;
    });
    const scrollTop = await pane.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
  });
});
