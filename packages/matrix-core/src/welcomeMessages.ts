import { KnownMembership, type MatrixClient, type MatrixEvent, RoomMemberEvent, type Room } from "matrix-js-sdk";
import { getOwningSpace } from "./rooms.js";

/**
 * Discord-style "send a random welcome message when someone joins this
 * server" - a space-level state event configuring it, and a live watcher
 * that posts a plain m.room.message into the configured channel whenever a
 * member's membership transitions to join in any room of an enabled space.
 * Distinct from onboarding.ts's `welcomeMessage`, which is only ever shown
 * inside the once-per-account rules-gate popup, never actually posted as a
 * real message anyone else sees.
 */
export const WELCOME_MESSAGE_EVENT = "io.jorkonvo.welcome_message";

export interface WelcomeMessageConfig {
  enabled: boolean;
  channelId: string | null;
  /** A pool of possible messages - one is picked at random per join, same as Discord. `{user}` is replaced with the new member's display name. */
  messages: string[];
}

const DEFAULT_CONFIG: WelcomeMessageConfig = { enabled: false, channelId: null, messages: [] };

type LooseSendStateEvent = (roomId: string, eventType: string, content: unknown, stateKey?: string) => Promise<unknown>;
type LooseSendEvent = (roomId: string, eventType: string, content: unknown) => Promise<unknown>;

export function canManageWelcomeMessage(space: Room, userId: string): boolean {
  return space.currentState.maySendStateEvent(WELCOME_MESSAGE_EVENT, userId);
}

export function getWelcomeMessageConfig(space: Room): WelcomeMessageConfig {
  const content = space.currentState.getStateEvents(WELCOME_MESSAGE_EVENT, "")?.getContent() as
    | Partial<WelcomeMessageConfig>
    | undefined;
  return {
    enabled: content?.enabled ?? DEFAULT_CONFIG.enabled,
    channelId: content?.channelId ?? DEFAULT_CONFIG.channelId,
    messages: content?.messages ?? DEFAULT_CONFIG.messages,
  };
}

export async function setWelcomeMessageConfig(
  client: MatrixClient,
  spaceId: string,
  config: WelcomeMessageConfig,
): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(spaceId, WELCOME_MESSAGE_EVENT, config, "");
}

/**
 * Elects a single client to act, so N online members don't each post N
 * copies of the welcome message: the joined space member with the
 * lexicographically smallest user id among those who *could* configure the
 * welcome message (a reasonable proxy for "an admin"). If that member is
 * offline nobody posts - accepted best-effort, same honesty as AutoMod etc.
 */
function isElectedPoster(space: Room, client: MatrixClient): boolean {
  const me = client.getUserId();
  if (!me) return false;
  const eligible = space
    .getMembersWithMembership(KnownMembership.Join)
    .map((m) => m.userId)
    .filter((uid) => canManageWelcomeMessage(space, uid))
    .sort();
  return eligible.length > 0 ? eligible[0] === me : false;
}

/** Guards against races/restarts: was an identical welcome for this member already posted very recently? */
function alreadyWelcomedRecently(client: MatrixClient, channelId: string, body: string): boolean {
  const channel = client.getRoom(channelId);
  if (!channel) return false;
  const cutoff = Date.now() - 60_000;
  return channel
    .getLiveTimeline()
    .getEvents()
    .some(
      (ev) =>
        ev.getType() === "m.room.message" &&
        ev.getTs() > cutoff &&
        ev.getContent()?.body === body,
    );
}

/**
 * Watches every joined room for a membership transition to "join" and, if
 * that room belongs to a space with welcome messages enabled and a channel
 * configured, posts one - picked at random from the pool - into that
 * channel. Registers once per client (e.g. at boot), same pattern as
 * watchFriendEvents/watchSoundboardPlays.
 */
export function watchMemberJoins(client: MatrixClient): () => void {
  function onMembership(
    event: MatrixEvent,
    member: { userId: string; membership?: string; roomId: string; name?: string },
  ) {
    if (member.membership !== KnownMembership.Join) return;
    // Only a fresh join, not a profile change on an already-joined member.
    if (event.getPrevContent()?.membership === KnownMembership.Join) return;
    const room = client.getRoom(member.roomId);
    if (!room) return;
    const space = getOwningSpace(client, member.roomId);
    if (!space) return;
    const config = getWelcomeMessageConfig(space);
    if (!config.enabled || !config.channelId || config.messages.length === 0) return;
    if (!isElectedPoster(space, client)) return;
    const template = config.messages[Math.floor(Math.random() * config.messages.length)]!;
    const name = room.getMember(member.userId)?.name ?? member.userId;
    const body = template.replaceAll("{user}", name);
    if (alreadyWelcomedRecently(client, config.channelId, body)) return;
    void (client.sendEvent as unknown as LooseSendEvent)(config.channelId, "m.room.message", {
      msgtype: "m.text",
      body,
    });
  }

  client.on(RoomMemberEvent.Membership, onMembership);
  return () => client.removeListener(RoomMemberEvent.Membership, onMembership);
}
