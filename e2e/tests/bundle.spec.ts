import { expect, test } from "@playwright/test";

test.describe("bundle / startup cost", () => {
  test("the login screen never fetches the ~7.8 MB crypto wasm", async ({ page }) => {
    const heavy: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (/matrix[_-]sdk[_-]crypto[_-]wasm|matrix_sdk_crypto_wasm_bg\.wasm/i.test(u)) heavy.push(u);
    });

    await page.goto("/");
    await expect(page.getByTestId("login-homeserver")).toBeVisible();
    await page.waitForTimeout(2000);

    expect(heavy, `crypto wasm must stay off the pre-auth path:\n${heavy.join("\n")}`).toHaveLength(0);
  });
});
