import { EventType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

/**
 * Discord-style space onboarding: a rules screen (with an explicit "I agree"
 * gate), optional self-assignable roles, and an optional welcome message -
 * shown once per (account, space) the first time a member opens a space
 * that has it enabled.
 *
 * Config lives on the SPACE room as a state event (same pattern as
 * categories.ts/roles.ts - admin-managed, state_default-gated). Whether a
 * given account has already clicked through it is private per-account
 * bookkeeping, so it's the user's own account data instead (same reasoning
 * as timedMute.ts - syncs across that account's other clients for free).
 */
export const SPACE_ONBOARDING_EVENT = "io.jorkonvo.onboarding";
const ONBOARDING_SEEN_ACCOUNT_DATA = "io.jorkonvo.onboarding_seen";

export interface OnboardingConfig {
  enabled: boolean;
  rules: string;
  welcomeMessage: string;
  /** Space role ids a member may toggle for themselves on the rules screen. */
  selfAssignableRoleIds: string[];
}

interface OnboardingContent {
  enabled?: boolean;
  rules?: string;
  welcomeMessage?: string;
  selfAssignableRoleIds?: string[];
}

type LooseSendStateEvent = (
  roomId: string,
  eventType: string,
  content: unknown,
  stateKey?: string,
) => Promise<unknown>;
type LooseGetAccountData = (eventType: string) => MatrixEvent | undefined;
type LooseSetAccountData = (eventType: string, content: unknown) => Promise<unknown>;

function getContent(space: Room): OnboardingContent {
  return (space.currentState.getStateEvents(SPACE_ONBOARDING_EVENT, "")?.getContent() as
    | OnboardingContent
    | undefined) ?? {};
}

export function getOnboardingConfig(space: Room): OnboardingConfig {
  const c = getContent(space);
  return {
    enabled: c.enabled ?? false,
    rules: c.rules ?? "",
    welcomeMessage: c.welcomeMessage ?? "",
    selfAssignableRoleIds: c.selfAssignableRoleIds ?? [],
  };
}

export function canManageOnboarding(space: Room, userId: string): boolean {
  return space.currentState.maySendStateEvent(SPACE_ONBOARDING_EVENT, userId);
}

export async function setOnboardingConfig(client: MatrixClient, spaceId: string, config: OnboardingConfig): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(spaceId, SPACE_ONBOARDING_EVENT, config, "");
}

/**
 * Matrix has no per-user-scoped state - "let a member assign themselves a
 * role" and "let a member overwrite the entire roles list" are the exact
 * same permission (space_roles is one singleton state event). So
 * self-assignable roles only actually work once a space lowers that event's
 * required power level to its users_default. This does that - a deliberate,
 * admin-triggered widening (never automatic), since it also lets any member
 * rename/recolor/delete roles, not just pick their own.
 */
export async function allowMembersToManageRoles(client: MatrixClient, spaceId: string): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const plContent =
    (space.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() as
      | Record<string, unknown>
      | undefined) ?? {};
  const usersDefault = typeof plContent.users_default === "number" ? plContent.users_default : 0;
  const events = {
    ...(plContent.events as Record<string, number> | undefined),
    "io.jorkonvo.space_roles": usersDefault,
  };
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(
    spaceId,
    EventType.RoomPowerLevels,
    { ...plContent, events },
    "",
  );
}

/** Whether an ordinary member (at the room's users_default level) can currently write the space's roles event - i.e. whether self-assignable roles will actually work. */
export function membersCanManageRoles(space: Room): boolean {
  const plContent =
    (space.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() as
      | Record<string, unknown>
      | undefined) ?? {};
  const usersDefault = typeof plContent.users_default === "number" ? plContent.users_default : 0;
  const events = plContent.events as Record<string, number> | undefined;
  const stateDefault = typeof plContent.state_default === "number" ? plContent.state_default : 50;
  const required = events?.["io.jorkonvo.space_roles"] ?? stateDefault;
  return usersDefault >= required;
}

function getSeenSpaceIds(client: MatrixClient): string[] {
  const ev = (client.getAccountData as unknown as LooseGetAccountData)(ONBOARDING_SEEN_ACCOUNT_DATA);
  return ev?.getContent<{ spaceIds?: string[] }>().spaceIds ?? [];
}

export function hasSeenOnboarding(client: MatrixClient, spaceId: string): boolean {
  return getSeenSpaceIds(client).includes(spaceId);
}

export async function markOnboardingSeen(client: MatrixClient, spaceId: string): Promise<void> {
  const seen = getSeenSpaceIds(client);
  if (seen.includes(spaceId)) return;
  await (client.setAccountData as unknown as LooseSetAccountData)(ONBOARDING_SEEN_ACCOUNT_DATA, {
    spaceIds: [...seen, spaceId],
  });
}
