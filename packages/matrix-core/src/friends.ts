import { ClientEvent, type MatrixClient, type MatrixEvent } from "matrix-js-sdk";

/**
 * Discord-style friends list, built entirely on primitives Matrix already
 * has - no server component. The friends list itself and the pending
 * request queues are private per-account data (so they sync across a
 * user's own devices for free); a request/accept/decline/cancel/remove is
 * communicated to the OTHER party over a plain (unencrypted, not secret)
 * to-device event, which the homeserver queues for delivery until their
 * next sync even if they're offline right now - the same guaranteed-once
 * delivery to-device messages give the E2EE key-sharing/verification flows.
 */
const FRIENDS_ACCOUNT_DATA = "io.jorkonvo.friends";
const FRIEND_REQUESTS_ACCOUNT_DATA = "io.jorkonvo.friend_requests";
const FRIEND_REQUEST_POLICY_ACCOUNT_DATA = "io.jorkonvo.friend_request_policy";
const FRIEND_REQUEST_EVENT = "io.jorkonvo.friend_request";
const FRIEND_ACCEPT_EVENT = "io.jorkonvo.friend_accept";
const FRIEND_DECLINE_EVENT = "io.jorkonvo.friend_decline";
const FRIEND_CANCEL_EVENT = "io.jorkonvo.friend_cancel";
const FRIEND_REMOVE_EVENT = "io.jorkonvo.friend_remove";

type LooseGetAccountData = (eventType: string) => MatrixEvent | undefined;
type LooseSetAccountData = (eventType: string, content: unknown) => Promise<unknown>;
type LooseSendToDevice = (eventType: string, contentMap: Map<string, Map<string, unknown>>) => Promise<unknown>;

export interface FriendRequestEntry {
  userId: string;
  ts: number;
}

export interface FriendRequests {
  incoming: FriendRequestEntry[];
  outgoing: FriendRequestEntry[];
}

function toDeviceAll(userId: string): Map<string, Map<string, unknown>> {
  return new Map([[userId, new Map([["*", {}]])]]);
}

export function getFriends(client: MatrixClient): string[] {
  const ev = (client.getAccountData as unknown as LooseGetAccountData)(FRIENDS_ACCOUNT_DATA);
  return ev?.getContent<{ userIds?: string[] }>().userIds ?? [];
}

async function setFriends(client: MatrixClient, userIds: string[]): Promise<void> {
  await (client.setAccountData as unknown as LooseSetAccountData)(FRIENDS_ACCOUNT_DATA, { userIds });
}

export function getFriendRequests(client: MatrixClient): FriendRequests {
  const ev = (client.getAccountData as unknown as LooseGetAccountData)(FRIEND_REQUESTS_ACCOUNT_DATA);
  const content = ev?.getContent<Partial<FriendRequests>>();
  return { incoming: content?.incoming ?? [], outgoing: content?.outgoing ?? [] };
}

async function setFriendRequests(client: MatrixClient, requests: FriendRequests): Promise<void> {
  await (client.setAccountData as unknown as LooseSetAccountData)(FRIEND_REQUESTS_ACCOUNT_DATA, requests);
}

/**
 * Discord's "Allow Friend Requests from..." - who may send ME a friend
 * request. `everyone` (default), `mutual_servers` (only someone I share a
 * joined space with - Discord's "Server members"), or `none`. Enforced
 * recipient-side by watchFriendEvents, which silently declines a request
 * the policy blocks; there's no server primitive for it. ("Friends of
 * friends" isn't offered - a pure client can't see whether the sender is a
 * friend of one of my friends, since friend lists are private account data.)
 */
export type FriendRequestPolicy = "everyone" | "mutual_servers" | "none";

export function getFriendRequestPolicy(client: MatrixClient): FriendRequestPolicy {
  const p = (client.getAccountData as unknown as LooseGetAccountData)(FRIEND_REQUEST_POLICY_ACCOUNT_DATA)
    ?.getContent<{ policy?: FriendRequestPolicy }>().policy;
  return p === "mutual_servers" || p === "none" ? p : "everyone";
}

export async function setFriendRequestPolicy(client: MatrixClient, policy: FriendRequestPolicy): Promise<void> {
  await (client.setAccountData as unknown as LooseSetAccountData)(FRIEND_REQUEST_POLICY_ACCOUNT_DATA, { policy });
}

function policyAllowsRequestFrom(client: MatrixClient, senderId: string): boolean {
  switch (getFriendRequestPolicy(client)) {
    case "none":
      return false;
    case "mutual_servers":
      return client
        .getRooms()
        .some(
          (r) =>
            r.isSpaceRoom() &&
            r.getMyMembership() === "join" &&
            r.getMember(senderId)?.membership === "join",
        );
    default:
      return true;
  }
}

async function addFriendLocal(client: MatrixClient, userId: string): Promise<void> {
  const friends = getFriends(client);
  if (!friends.includes(userId)) await setFriends(client, [...friends, userId]);
}

async function removeFriendLocal(client: MatrixClient, userId: string): Promise<void> {
  const friends = getFriends(client);
  if (friends.includes(userId)) await setFriends(client, friends.filter((id) => id !== userId));
}

export async function sendFriendRequest(client: MatrixClient, userId: string): Promise<void> {
  const me = client.getUserId();
  if (!me || userId === me) throw new Error("Érvénytelen felhasználó");
  if (getFriends(client).includes(userId)) throw new Error("Már barátok vagytok");
  const { incoming, outgoing } = getFriendRequests(client);
  if (outgoing.some((r) => r.userId === userId)) return;
  // If they already sent US a request, accept it instead of crossing requests.
  if (incoming.some((r) => r.userId === userId)) {
    await acceptFriendRequest(client, userId);
    return;
  }
  await setFriendRequests(client, { incoming, outgoing: [...outgoing, { userId, ts: Date.now() }] });
  await (client.sendToDevice as unknown as LooseSendToDevice)(FRIEND_REQUEST_EVENT, toDeviceAll(userId));
}

export async function acceptFriendRequest(client: MatrixClient, userId: string): Promise<void> {
  const { incoming, outgoing } = getFriendRequests(client);
  await setFriendRequests(client, { incoming: incoming.filter((r) => r.userId !== userId), outgoing });
  await addFriendLocal(client, userId);
  await (client.sendToDevice as unknown as LooseSendToDevice)(FRIEND_ACCEPT_EVENT, toDeviceAll(userId));
}

export async function declineFriendRequest(client: MatrixClient, userId: string): Promise<void> {
  const { incoming, outgoing } = getFriendRequests(client);
  await setFriendRequests(client, { incoming: incoming.filter((r) => r.userId !== userId), outgoing });
  await (client.sendToDevice as unknown as LooseSendToDevice)(FRIEND_DECLINE_EVENT, toDeviceAll(userId));
}

export async function cancelFriendRequest(client: MatrixClient, userId: string): Promise<void> {
  const { incoming, outgoing } = getFriendRequests(client);
  await setFriendRequests(client, { incoming, outgoing: outgoing.filter((r) => r.userId !== userId) });
  await (client.sendToDevice as unknown as LooseSendToDevice)(FRIEND_CANCEL_EVENT, toDeviceAll(userId));
}

export async function removeFriend(client: MatrixClient, userId: string): Promise<void> {
  await removeFriendLocal(client, userId);
  await (client.sendToDevice as unknown as LooseSendToDevice)(FRIEND_REMOVE_EVENT, toDeviceAll(userId));
}

/**
 * Handles incoming friend to-device events from other users, updating our
 * own account data accordingly. Registers once per client (e.g. at boot);
 * the resulting account-data writes flow back through the normal sync loop
 * and the app's existing ClientEvent.AccountData listener, so no separate
 * "on change" callback is needed here - the UI re-renders the same way it
 * does for any other account-data change.
 */
export function watchFriendEvents(client: MatrixClient): () => void {
  async function handler(ev: MatrixEvent) {
    const sender = ev.getSender();
    if (!sender) return;
    const type = ev.getType();

    if (type === FRIEND_REQUEST_EVENT) {
      if (getFriends(client).includes(sender)) return;
      const { incoming, outgoing } = getFriendRequests(client);
      if (incoming.some((r) => r.userId === sender)) return;
      if (!policyAllowsRequestFrom(client, sender)) {
        // Silently bounce it - the sender sees a normal decline, same as
        // Discord surfacing nothing about why a request didn't land.
        await (client.sendToDevice as unknown as LooseSendToDevice)(FRIEND_DECLINE_EVENT, toDeviceAll(sender));
        return;
      }
      await setFriendRequests(client, { incoming: [...incoming, { userId: sender, ts: Date.now() }], outgoing });
    } else if (type === FRIEND_ACCEPT_EVENT) {
      const { incoming, outgoing } = getFriendRequests(client);
      if (!outgoing.some((r) => r.userId === sender)) return;
      await setFriendRequests(client, { incoming, outgoing: outgoing.filter((r) => r.userId !== sender) });
      await addFriendLocal(client, sender);
    } else if (type === FRIEND_DECLINE_EVENT || type === FRIEND_CANCEL_EVENT) {
      const { incoming, outgoing } = getFriendRequests(client);
      await setFriendRequests(client, {
        incoming: incoming.filter((r) => r.userId !== sender),
        outgoing: outgoing.filter((r) => r.userId !== sender),
      });
    } else if (type === FRIEND_REMOVE_EVENT) {
      await removeFriendLocal(client, sender);
    }
  }

  client.on(ClientEvent.ToDeviceEvent, handler);
  return () => client.off(ClientEvent.ToDeviceEvent, handler);
}
