import { expect, test } from "@playwright/test";
import { loginAs, registerUser } from "./helpers";

test.describe("1:1 calls", () => {
  test("a voice call rings the callee and reaches 'connected' on both sides", async ({ browser }) => {
    const alice = await registerUser("caller");
    const bob = await registerUser("callee");

    // Fake camera/mic streams are already wired into playwright.config.ts
    // (--use-fake-ui-for-media-stream/--use-fake-device-for-media-stream);
    // granting the "microphone"/"camera" permission here just skips any
    // browser-level prompt on top of that.
    const aCtx = await browser.newContext({
      ignoreHTTPSErrors: true,
      permissions: ["camera", "microphone"],
    });
    const bCtx = await browser.newContext({
      ignoreHTTPSErrors: true,
      permissions: ["camera", "microphone"],
    });
    const a = await aCtx.newPage();
    const b = await bCtx.newPage();
    await loginAs(a, alice);
    await loginAs(b, bob);

    // Alice starts a DM with Bob (creates an encrypted, is_direct room and
    // invites him) - this is what makes the room callable (canDirectCall
    // needs isDirectRoom() + exactly 2 joined members).
    await a.getByTestId("sidebar-start-dm").click();
    await a.getByTestId("start-dm-userid").fill(bob.userId);
    await a.getByTestId("start-dm-submit").click();
    await expect(a.getByTestId("modal")).toHaveCount(0);

    // Bob accepts the DM invite and joins.
    await b.locator('[data-testid="invite-row"]').first().getByTestId("invite-accept").click();
    await b.locator('[data-testid="room-row"]').first().click();
    await expect(b.getByTestId("composer-input")).toBeVisible();

    // Alice places a voice call from the room header's "More" menu.
    // (The composer toolbar has its own, unrelated "More" button with the
    // same English label - `chat.more` vs `composer.more` - so scope to
    // the header to avoid a strict-mode ambiguity.)
    await a.getByTestId("chat-header").getByRole("button", { name: "More" }).click();
    await a.getByRole("menuitem", { name: "Voice call" }).click();

    // Bob's client rings; he accepts.
    await expect(b.getByTestId("call-accept")).toBeVisible({ timeout: 20_000 });
    await b.getByTestId("call-accept").click();

    // Both sides drive the call signalling to "Connected" - this is real
    // peer-to-peer WebRTC (matrix-core's placeCall/CallOverlay), fake
    // media devices on both ends, no LiveKit/SFU involved for a 1:1 call.
    await expect(a.getByTestId("call-state")).toHaveText("Connected", { timeout: 30_000 });
    await expect(b.getByTestId("call-state")).toHaveText("Connected", { timeout: 30_000 });

    // Clean up: Alice hangs up, both sides lose the call overlay.
    await a.getByTestId("call-hangup").click();
    await expect(a.getByTestId("call-state")).toHaveCount(0, { timeout: 20_000 });
    await expect(b.getByTestId("call-state")).toHaveCount(0, { timeout: 20_000 });

    await aCtx.close();
    await bCtx.close();
  });
});
