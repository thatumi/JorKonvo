import { expect, test } from "@playwright/test";
import { loginAs, registerUser } from "./helpers";

test.describe("device verification", () => {
  test("SAS emoji verification between two devices of the same account reaches 'verified' on both sides", async ({
    browser,
  }) => {
    const alice = await registerUser("verify");

    const aCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const bCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const a = await aCtx.newPage();
    const b = await bCtx.newPage();

    // Two separate password logins with the SAME account = two devices/
    // sessions, exactly like two real devices signed into one account.
    await loginAs(a, alice);
    await loginAs(b, alice);

    // Device A starts verification against its OTHER session, from
    // Settings > Account > Signed-in devices - the only place the app
    // exposes self-verification (memberMenu/UserProfilePopover both
    // explicitly hide the "Verify" action for your own user id).
    await a.getByTestId("open-user-settings").click();
    await a.getByTestId("settings-nav-account").click();
    await expect(a.getByTestId("devices-verify")).toBeVisible({ timeout: 20_000 });
    await a.getByTestId("devices-verify").click();
    // Close Settings so its modal (same z-index as the verification overlay)
    // doesn't sit on top of the flow that's about to take over the screen.
    await a.keyboard.press("Escape");

    // Device B sees the incoming request as a dismissible toast and accepts it.
    // (A to-device event round-trip through a real sync loop - give it more
    // slack than the other assertions here, which are local UI state.)
    await expect(b.getByTestId("verify-incoming-accept")).toBeVisible({ timeout: 30_000 });
    await b.getByTestId("verify-incoming-accept").click();

    // Both sides land in the Ready phase once B accepts; either side can
    // pick a method - A picks SAS (emoji comparison).
    await expect(a.getByTestId("verify-method-sas")).toBeVisible({ timeout: 20_000 });
    await a.getByTestId("verify-method-sas").click();

    // Both sides should show the SAME emoji sequence.
    await expect(a.getByTestId("verify-sas-emoji")).toBeVisible({ timeout: 20_000 });
    await expect(b.getByTestId("verify-sas-emoji")).toBeVisible({ timeout: 20_000 });
    const aEmoji = await a.getByTestId("verify-sas-emoji-name").allTextContents();
    const bEmoji = await b.getByTestId("verify-sas-emoji-name").allTextContents();
    expect(aEmoji.length).toBeGreaterThan(0);
    expect(aEmoji).toEqual(bEmoji);

    // Confirm the match on both sides.
    await a.getByTestId("verify-sas-match").click();
    await b.getByTestId("verify-sas-match").click();

    // Both land on the "done" screen - the UI's own signal that this
    // session (and, transitively, the account's cross-signing identity) is
    // now verified from the other side's point of view.
    await expect(a.getByTestId("verify-done")).toBeVisible({ timeout: 20_000 });
    await expect(b.getByTestId("verify-done")).toBeVisible({ timeout: 20_000 });

    await aCtx.close();
    await bCtx.close();
  });
});
