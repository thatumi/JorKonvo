import { expect, test } from "@playwright/test";
import { apiLogin, HS_URL, loginAs, registerUser } from "./helpers";

async function membership(token: string, roomId: string, userId: string): Promise<string> {
  const res = await fetch(
    `${HS_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return `http_${res.status}`;
  return ((await res.json()) as { membership?: string }).membership ?? "unknown";
}

test.describe("moderation", () => {
  test("a room admin can kick another member (context menu + confirm dialog)", async ({ browser }) => {
    const alice = await registerUser("modadmin");
    const bob = await registerUser("modtarget");

    const aCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const bCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const a = await aCtx.newPage();
    const b = await bCtx.newPage();
    await loginAs(a, alice);
    await loginAs(b, bob);

    // Alice (room creator = PL 100) makes a room and invites Bob.
    await a.getByTestId("sidebar-new-room").click();
    const roomName = `mod-${Date.now().toString(36)}`;
    await a.getByTestId("create-room-name").fill(roomName);
    await a.getByTestId("create-room-submit").click();
    await expect(a.getByTestId("modal")).toHaveCount(0);

    await a.getByTestId("composer-input").fill(`/invite ${bob.userId}`);
    await a.getByTestId("composer-input").press("Enter");

    // Bob joins.
    await b.locator(`[data-testid="invite-row"][data-room-name="${roomName}"]`).getByTestId("invite-accept").click();
    await b.locator(`[data-testid="room-row"][data-room-name="${roomName}"]`).click();
    await expect(b.getByTestId("composer-input")).toBeVisible();

    // Alice sees Bob in the member list, right-clicks, picks Kick, confirms.
    // (MemberList is mounted twice - a hidden drag pane + the visible one.)
    const bobRow = a
      .locator(`[data-testid="member-row"][data-user-id="${bob.userId}"]`)
      .filter({ visible: true });
    await expect(bobRow).toBeVisible({ timeout: 20_000 });
    await bobRow.click({ button: "right" });
    await a.getByRole("menuitem", { name: "Kick from room" }).click();
    await expect(a.getByTestId("dialog")).toBeVisible();
    await a.getByTestId("dialog-confirm").click();

    // Bob is gone from Alice's member list...
    await expect(bobRow).toHaveCount(0, { timeout: 20_000 });
    // ...and Bob's own client loses the room (kicked -> membership "leave").
    await expect(
      b.locator(`[data-testid="room-row"][data-room-name="${roomName}"]`),
    ).toHaveCount(0, { timeout: 20_000 });

    await aCtx.close();
    await bCtx.close();
  });

  test("a room admin can ban a member and later unban them from Room settings", async ({ browser }) => {
    const alice = await registerUser("banadmin");
    const bob = await registerUser("bantarget");

    const aCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const bCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const a = await aCtx.newPage();
    const b = await bCtx.newPage();
    await loginAs(a, alice);
    await loginAs(b, bob);

    // Alice makes a room, invites Bob, Bob joins.
    await a.getByTestId("sidebar-new-room").click();
    const roomName = `ban-${Date.now().toString(36)}`;
    await a.getByTestId("create-room-name").fill(roomName);
    await a.getByTestId("create-room-submit").click();
    await expect(a.getByTestId("modal")).toHaveCount(0);

    const roomRow = a.locator(`[data-testid="room-row"][data-room-name="${roomName}"]`);
    await expect(roomRow).toBeVisible();
    const roomId = await roomRow.getAttribute("data-room-id");
    expect(roomId).toBeTruthy();

    await a.getByTestId("composer-input").fill(`/invite ${bob.userId}`);
    await a.getByTestId("composer-input").press("Enter");

    await b.locator(`[data-testid="invite-row"][data-room-name="${roomName}"]`).getByTestId("invite-accept").click();
    await b.locator(`[data-testid="room-row"][data-room-name="${roomName}"]`).click();
    await expect(b.getByTestId("composer-input")).toBeVisible();

    // Alice bans Bob from the member list (context menu -> confirm dialog).
    const bobRow = a
      .locator(`[data-testid="member-row"][data-user-id="${bob.userId}"]`)
      .filter({ visible: true });
    await expect(bobRow).toBeVisible({ timeout: 20_000 });
    await bobRow.click({ button: "right" });
    await a.getByRole("menuitem", { name: "Ban from room" }).click();
    await expect(a.getByTestId("dialog")).toBeVisible();
    await a.getByTestId("dialog-confirm").click();

    const aAuth = await apiLogin(alice);

    // Bob is banned server-side and loses the room on his client.
    await expect.poll(() => membership(aAuth.accessToken, roomId!, bob.userId), { timeout: 20_000 }).toBe("ban");
    await expect(
      b.locator(`[data-testid="room-row"][data-room-name="${roomName}"]`),
    ).toHaveCount(0, { timeout: 20_000 });

    // A banned user cannot rejoin.
    const bBob = await apiLogin(bob);
    const rejoin = await fetch(`${HS_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId!)}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bBob.accessToken}` },
      body: "{}",
    });
    expect(rejoin.ok).toBe(false);

    // Alice lifts the ban from Room settings -> Moderation -> Banned users.
    await a
      .locator(`[data-testid="room-row"][data-room-name="${roomName}"]`)
      .click({ button: "right" });
    await a.getByRole("menuitem", { name: "Room settings" }).click();
    await a.getByTestId("settings-nav-moderation").click();
    const bannedRow = a.locator(`[data-testid="banned-row"][data-user-id="${bob.userId}"]`);
    await expect(bannedRow).toBeVisible({ timeout: 15_000 });
    await bannedRow.getByTestId("unban-button").click();
    await expect(bannedRow).toHaveCount(0, { timeout: 15_000 });
    await a.keyboard.press("Escape");

    await expect.poll(() => membership(aAuth.accessToken, roomId!, bob.userId), { timeout: 20_000 }).toBe("leave");

    // ...and Bob can be invited back in.
    await a.getByTestId("composer-input").fill(`/invite ${bob.userId}`);
    await a.getByTestId("composer-input").press("Enter");
    await b.locator(`[data-testid="invite-row"][data-room-name="${roomName}"]`).getByTestId("invite-accept").click();
    await b.locator(`[data-testid="room-row"][data-room-name="${roomName}"]`).click();
    await expect(b.getByTestId("composer-input")).toBeVisible();

    await aCtx.close();
    await bCtx.close();
  });
});
