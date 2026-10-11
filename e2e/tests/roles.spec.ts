import { expect, test } from "@playwright/test";
import { apiLogin, inviteToRoom, loginAs, registerUser } from "./helpers";

test.describe("roles", () => {
  test("assigning a role with a power-level permission raises the member's power level", async ({ browser }) => {
    const alice = await registerUser("roleadmin");
    const bob = await registerUser("rolemember");

    const aCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const bCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const a = await aCtx.newPage();
    const b = await bCtx.newPage();
    await loginAs(a, alice);
    await loginAs(b, bob);

    // Alice creates a space and reads its room id off the rail.
    await a.getByTestId("rail-new-space").click();
    const spaceName = `guild-${Date.now().toString(36)}`;
    await a.getByTestId("create-space-name").fill(spaceName);
    await a.getByTestId("create-space-submit").click();
    await expect(a.getByTestId("modal")).toHaveCount(0);
    const spaceRail = a.locator(`[data-testid="space-rail-item"][data-space-name="${spaceName}"]`);
    await expect(spaceRail).toBeVisible();
    const spaceId = await spaceRail.getAttribute("data-space-id");
    expect(spaceId).toBeTruthy();

    // Invite Bob into the space room itself (roles operate on space membership).
    const aAuth = await apiLogin(alice);
    await inviteToRoom(aAuth.accessToken, spaceId!, bob.userId);

    // Bob accepts the space invite.
    await b.locator(`[data-testid="invite-row"][data-room-name="${spaceName}"]`).getByTestId("invite-accept").click();

    // Alice opens Space Settings -> Roles, creates "Moderator", gives it
    // "Kick Members", and assigns it to Bob.
    await spaceRail.click();
    await a.getByTestId("sidebar-space-roles").click();
    await expect(a.getByTestId("roles-new-name")).toBeVisible();
    await a.getByTestId("roles-new-name").fill("Moderator");
    await a.getByTestId("roles-create").click();

    await a.getByTestId("role-list-item").filter({ hasText: "Moderator" }).click();
    await a.getByTestId("role-perm-kickMembers").check();

    const bobCheckbox = a.locator(`[data-testid="role-member-checkbox"][data-user-id="${bob.userId}"]`);
    await expect(bobCheckbox).toBeVisible({ timeout: 20_000 });
    await bobCheckbox.check();

    // Verify server-side: Bob's power level in the space room is now >= 50.
    await expect
      .poll(
        async () => {
          const res = await fetch(
            `${process.env.E2E_HOMESERVER ?? "https://localhost:18448"}/_matrix/client/v3/rooms/${encodeURIComponent(
              spaceId!,
            )}/state/m.room.power_levels/`,
            { headers: { Authorization: `Bearer ${aAuth.accessToken}` } },
          );
          const pl = (await res.json()) as { users?: Record<string, number> };
          return pl.users?.[bob.userId] ?? 0;
        },
        { timeout: 25_000, intervals: [1000] },
      )
      .toBeGreaterThanOrEqual(50);

    await aCtx.close();
    await bCtx.close();
  });
});
