import { expect, test } from "@playwright/test";

test.describe("content security policy", () => {
  test("the app loads with zero CSP violations and the pre-paint script runs", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations.push(m.text());
    });

    await page.addInitScript(() => localStorage.setItem("jorkonvo-theme", "dark"));
    await page.goto("/");
    await expect(page.getByTestId("login-homeserver")).toBeVisible();
    await page.waitForTimeout(1000);

    expect(violations, violations.join("\n")).toHaveLength(0);
    // The inline theme-init script is allow-listed by hash, so it actually
    // executed (round 18's CSP silently blocked it).
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  });
});
