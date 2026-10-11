import { expect, test } from "@playwright/test";
import { loginAs, registerUser } from "./helpers";

test.describe("encrypted messaging", () => {
  test("two users exchange messages in an E2EE room", async ({ browser }) => {
    const alice = await registerUser("alice");
    const bob = await registerUser("bob");

    const aCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const bCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const a = await aCtx.newPage();
    const b = await bCtx.newPage();

    await loginAs(a, alice);
    await loginAs(b, bob);

    // Alice creates an encrypted room (the create-room modal defaults to E2EE on)
    // and invites Bob.
    await a.getByTestId("sidebar-new-room").click();
    const roomName = `secret-${Date.now().toString(36)}`;
    await a.getByTestId("create-room-name").fill(roomName);
    await a.getByTestId("create-room-submit").click();
    await expect(a.getByTestId("modal")).toHaveCount(0);

    const composer = a.getByTestId("composer-input");
    await composer.fill(`/invite ${bob.userId}`);
    await composer.press("Enter");

    // Bob joins BEFORE the first message, so the Megolm key is shared to his
    // device (a message sent before a join can't be retro-decrypted).
    await b
      .locator(`[data-testid="invite-row"][data-room-name="${roomName}"]`)
      .getByTestId("invite-accept")
      .click();
    await b.locator(`[data-testid="room-row"][data-room-name="${roomName}"]`).click();
    await expect(b.getByTestId("composer-input")).toBeVisible();

    // Alice sends; Bob decrypts it.
    await composer.fill("hello from alice, encrypted");
    await composer.press("Enter");
    await expect(a.getByText("hello from alice, encrypted")).toBeVisible();
    await expect(b.getByText("hello from alice, encrypted")).toBeVisible({ timeout: 30_000 });

    // Bob replies; Alice decrypts it.
    await b.getByTestId("composer-input").fill("hi alice, got it");
    await b.getByTestId("composer-input").press("Enter");
    await expect(a.getByText("hi alice, got it")).toBeVisible({ timeout: 30_000 });

    await aCtx.close();
    await bCtx.close();
  });
});
