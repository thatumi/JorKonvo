import { type MatrixClient, type MatrixEvent, type Room, RoomEvent } from "matrix-js-sdk";

/**
 * Per-user, per-space "allow direct messages from members of this server"
 * preference (Discord's Privacy Settings toggle). This is MY OWN
 * preference about DMs directed at ME, so it's account data (synced across
 * my own devices), not a space-wide setting - same reasoning as friends.ts.
 * Defaults to allowed, matching Discord's own default.
 *
 * Matrix has no server-side "reject invites from these people" primitive,
 * so enforcement is recipient-side and best-effort, exactly like AutoMod,
 * slowmode and reaction-roles elsewhere in this package: while my client is
 * open, watchDmInvitePrivacy auto-declines a fresh DM invite from someone I
 * only share DM-blocked spaces with. An already-open conversation is never
 * touched (Discord's toggle only filters unsolicited first contact).
 */
const ACCOUNT_DATA_EVENT = "io.jorkonvo.space_dm_privacy";

type LooseGetAccountData = (eventType: string) => MatrixEvent | undefined;
type LooseSetAccountData = (eventType: string, content: unknown) => Promise<unknown>;

function readAll(client: MatrixClient): Record<string, boolean> {
  const ev = (client.getAccountData as unknown as LooseGetAccountData)(ACCOUNT_DATA_EVENT);
  return ev?.getContent<{ allowDmsBySpace?: Record<string, boolean> }>().allowDmsBySpace ?? {};
}

export function isDmAllowedFromSpace(client: MatrixClient, spaceId: string): boolean {
  return readAll(client)[spaceId] ?? true;
}

export async function setDmAllowedFromSpace(client: MatrixClient, spaceId: string, allowed: boolean): Promise<void> {
  const all = readAll(client);
  await (client.setAccountData as unknown as LooseSetAccountData)(ACCOUNT_DATA_EVENT, {
    allowDmsBySpace: { ...all, [spaceId]: allowed },
  });
}

/** Spaces both I and `userId` are joined members of - the servers a DM between us "shares". */
function sharedSpaceIds(client: MatrixClient, userId: string): string[] {
  return client
    .getRooms()
    .filter(
      (r) => r.isSpaceRoom() && r.getMyMembership() === "join" && r.getMember(userId)?.membership === "join",
    )
    .map((r) => r.roomId);
}

/**
 * True if `userId` may open a brand-new DM with me right now: allowed unless
 * we share at least one space and I've turned DMs off for *every* space we
 * share (any one space left on is enough, matching how Discord scopes the
 * toggle per-server). Someone I share no space with is unaffected by this
 * setting entirely.
 */
export function mayStartDmWithMe(client: MatrixClient, userId: string): boolean {
  const shared = sharedSpaceIds(client, userId);
  if (shared.length === 0) return true;
  return shared.some((spaceId) => isDmAllowedFromSpace(client, spaceId));
}

/**
 * Auto-declines incoming DM invites that my per-space privacy setting blocks.
 * Best-effort: only runs while this client is open. Returns an unsubscribe fn.
 */
export function watchDmInvitePrivacy(client: MatrixClient): () => void {
  const handled = new Set<string>();

  const consider = (room: Room) => {
    if (room.getMyMembership() !== "invite") return;
    if (handled.has(room.roomId)) return;
    const inviter = room.getDMInviter();
    if (!inviter) return; // not a DM invite
    if (mayStartDmWithMe(client, inviter)) return;
    handled.add(room.roomId);
    void client.leave(room.roomId).catch(() => undefined);
  };

  const onMembership = (room: Room) => consider(room);
  client.on(RoomEvent.MyMembership, onMembership);

  for (const room of client.getRooms()) consider(room);

  return () => client.removeListener(RoomEvent.MyMembership, onMembership);
}
