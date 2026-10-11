import { expect, test } from "@playwright/test";
import { apiLogin, inviteToRoom, loginAs, registerUser } from "./helpers";

test.describe("Discord-style space access", () => {
  test("a space member auto-joins a channel created in the space, with no per-room invite or knock", async ({
    browser,
  }) => {
    const alice = await registerUser("host");
    const bob = await registerUser("member");

    const aCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const bCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const a = await aCtx.newPage();
    const b = await bCtx.newPage();
    await loginAs(a, alice);

    // Alice creates a space with the default access policy (knocking off -
    // members-only, but any member auto-joins every channel).
    await a.getByTestId("rail-new-space").click();
    const spaceName = `restricted-guild-${Date.now().toString(36)}`;
    await a.getByTestId("create-space-name").fill(spaceName);
    await expect(a.getByTestId("create-space-allow-knocking")).not.toBeChecked();
    await a.getByTestId("create-space-submit").click();
    await expect(a.getByTestId("modal")).toHaveCount(0);

    const spaceId = await a
      .locator(`[data-testid="space-rail-item"][data-space-name="${spaceName}"]`)
      .getAttribute("data-space-id");
    expect(spaceId).toBeTruthy();

    // A channel created afterwards - this is the case a plain invite-only
    // default would get wrong, since Bob isn't even a space member yet at
    // the point this channel is created.
    await a.getByTestId("sidebar-new-room").click();
    const channelName = `general-${Date.now().toString(36)}`;
    await a.getByTestId("create-room-name").fill(channelName);
    await a.getByTestId("create-room-submit").click();
    await expect(a.getByTestId("modal")).toHaveCount(0);

    // Alice invites Bob to the SPACE only - never to the channel itself.
    // (No per-user "invite to space" UI exists yet, so this uses the same
    // admin-style raw invite a real Synapse admin would use - the exact
    // real-world scenario that surfaced this bug.)
    const aliceApi = await apiLogin(alice);
    await inviteToRoom(aliceApi.accessToken, spaceId!, bob.userId);

    await loginAs(b, bob);
    await b.locator('[data-testid="invite-row"]').first().getByTestId("invite-accept").click();

    // Bob is now a space member but has never been invited to (or joined)
    // the channel. Discover it via the space's room browser and join with
    // one click - no invite, no knock request, because the channel's
    // join_rule is "restricted" to this space's membership.
    await b.locator(`[data-testid="space-rail-item"][data-space-name="${spaceName}"]`).click();
    await b.getByTestId("discover-rooms-button").click();
    const row = b.locator(`[data-testid="hierarchy-room"][data-room-name="${channelName}"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByTestId("hierarchy-join").click();

    // Join succeeds immediately (restricted, not knock) - the button flips
    // to "Open" rather than staying on a pending/knock state.
    await expect(row.getByTestId("hierarchy-open")).toBeVisible({ timeout: 20_000 });
    await row.getByTestId("hierarchy-open").click();
    await expect(b.getByTestId("modal")).toHaveCount(0);
    await expect(b.getByTestId("composer-input")).toBeVisible();

    await aCtx.close();
    await bCtx.close();
  });

  test("a channel created AFTER a member already joined the space appears for them automatically, no Discover click needed (2026-09-16 fix)", async ({
    browser,
  }) => {
    const alice = await registerUser("host2");
    const bob = await registerUser("member2");

    const aCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const bCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const a = await aCtx.newPage();
    const b = await bCtx.newPage();
    await loginAs(a, alice);

    await a.getByTestId("rail-new-space").click();
    const spaceName = `preexisting-member-guild-${Date.now().toString(36)}`;
    await a.getByTestId("create-space-name").fill(spaceName);
    await a.getByTestId("create-space-submit").click();
    await expect(a.getByTestId("modal")).toHaveCount(0);

    const spaceId = await a
      .locator(`[data-testid="space-rail-item"][data-space-name="${spaceName}"]`)
      .getAttribute("data-space-id");
    expect(spaceId).toBeTruthy();

    // Bob joins the SPACE first - no channel exists yet.
    const aliceApi = await apiLogin(alice);
    await inviteToRoom(aliceApi.accessToken, spaceId!, bob.userId);
    await loginAs(b, bob);
    await b.locator('[data-testid="invite-row"]').first().getByTestId("invite-accept").click();
    await b.locator(`[data-testid="space-rail-item"][data-space-name="${spaceName}"]`).click();

    // Now, while Bob is already sitting in the space, Alice creates a new
    // channel - the exact live scenario reported 2026-09-16: Bob never gets
    // an invite (restricted join_rule, by design), and previously had no
    // reactive path that joined him to it - he'd see nothing at all unless
    // he happened to open "Discover rooms" himself.
    await a.getByTestId("sidebar-new-room").click();
    const channelName = `late-channel-${Date.now().toString(36)}`;
    await a.getByTestId("create-room-name").fill(channelName);
    await a.getByTestId("create-room-submit").click();
    await expect(a.getByTestId("modal")).toHaveCount(0);

    // Bob should see it show up in his own sidebar on its own - no manual
    // "Discover rooms" browsing required.
    await expect(b.locator(`[data-testid="room-row"][data-room-name="${channelName}"]`)).toBeVisible({
      timeout: 20_000,
    });

    await aCtx.close();
    await bCtx.close();
  });
});
