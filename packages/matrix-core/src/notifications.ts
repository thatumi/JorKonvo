import type { MatrixClient, IPushRule, PushRuleAction, PushRuleCondition, Room } from "matrix-js-sdk";
import { Method } from "matrix-js-sdk";
import { PushRuleActionName, PushRuleKind } from "matrix-js-sdk/lib/@types/PushRules.js";

type LooseSendStateEvent = (roomId: string, eventType: string, content: unknown, stateKey?: string) => Promise<unknown>;

/**
 * Per-room notification modes and keyword notifications, both implemented as
 * real server-side push rules so they apply to every client and pusher of the
 * account - not just a local preference.
 *
 * Mode mapping:
 *  - "all"      no extra rules (server defaults notify every message)
 *  - "mentions" an override rule matching the room with no notify actions,
 *               positioned AFTER the mention rules so real mentions still
 *               notify where the server can see them (plaintext rooms; in
 *               E2EE rooms mentions are evaluated client-side anyway)
 *  - "muted"    the classic room-kind dont_notify rule (same as Element)
 */

export type RoomNotificationMode = "all" | "mentions" | "muted";

const MENTIONS_ONLY_PREFIX = "io.jorkonvo.mentions_only_";
export const KEYWORD_RULE_PREFIX = "io.jorkonvo.keyword.";

/** Fetch the account's push rules and cache them on the client. */
export async function refreshPushRules(client: MatrixClient): Promise<void> {
  client.setPushRules(await client.getPushRules());
}

let rulesPromise: Promise<void> | null = null;

/** Ensure push rules are available locally; cheap after the first call. */
export function ensurePushRules(client: MatrixClient): Promise<void> {
  if (!client.pushRules) {
    rulesPromise ??= refreshPushRules(client).finally(() => {
      rulesPromise = null;
    });
  }
  return client.pushRules ? Promise.resolve() : rulesPromise!;
}

/** Whether a room-level mute rule (dont_notify, no other actions) is active. */
export function isRoomMuted(client: MatrixClient, roomId: string): boolean {
  const rule = client.getRoomPushRule("global", roomId);
  if (!rule || !rule.enabled) return false;
  return rule.actions.length === 1 && rule.actions[0] === PushRuleActionName.DontNotify;
}

function mentionsOnlyRule(client: MatrixClient, roomId: string): IPushRule | undefined {
  return client.pushRules?.global?.override?.find(
    (rule) => rule.rule_id === MENTIONS_ONLY_PREFIX + roomId,
  );
}

/**
 * `space`, if given, supplies the admin-set fallback (see
 * getSpaceDefaultNotificationMode below) for a member who has no personal
 * override at all. NOTE: Matrix push rules have no way to represent
 * "explicitly chose All Messages" as distinct from "never touched this" -
 * both are simply the absence of an override rule - so a member who
 * deliberately picks "All" against a space default of "Only @mentions"
 * currently looks identical to one who never chose anything, and will keep
 * following the space default. Accepted trade-off; a real fix would need a
 * separate "has this member ever explicitly set a mode" marker.
 */
export function getRoomNotificationMode(client: MatrixClient, roomId: string, space?: Room): RoomNotificationMode {
  if (isRoomMuted(client, roomId)) return "muted";
  if (mentionsOnlyRule(client, roomId)?.enabled) return "mentions";
  if (space && getSpaceDefaultNotificationMode(space) === "mentions") return "mentions";
  return "all";
}

export const SPACE_DEFAULT_NOTIFICATIONS_EVENT = "io.jorkonvo.default_notifications";

/** Space-wide default for members who haven't personally overridden their notification mode - Discord's exact two choices ("All Messages" / "Only @mentions"); muted isn't offered as a default since silencing a whole space for everyone by default would defeat the point of it existing. */
export type SpaceDefaultNotificationMode = "all" | "mentions";

export function canSetSpaceDefaultNotifications(space: Room, userId: string): boolean {
  return space.currentState.maySendStateEvent(SPACE_DEFAULT_NOTIFICATIONS_EVENT, userId);
}

export function getSpaceDefaultNotificationMode(space: Room): SpaceDefaultNotificationMode {
  const content = space.currentState.getStateEvents(SPACE_DEFAULT_NOTIFICATIONS_EVENT, "")?.getContent() as
    | { mode?: SpaceDefaultNotificationMode }
    | undefined;
  return content?.mode === "mentions" ? "mentions" : "all";
}

export async function setSpaceDefaultNotificationMode(
  client: MatrixClient,
  spaceId: string,
  mode: SpaceDefaultNotificationMode,
): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(spaceId, SPACE_DEFAULT_NOTIFICATIONS_EVENT, { mode }, "");
}

async function deleteRuleQuietly(
  client: MatrixClient,
  kind: PushRuleKind,
  ruleId: string,
): Promise<void> {
  try {
    await client.deletePushRule("global", kind, ruleId);
  } catch (err) {
    // Deleting an absent rule is a no-op, not a failure.
    if ((err as { errcode?: string }).errcode !== "M_NOT_FOUND") throw err;
  }
}

export async function setRoomMuted(client: MatrixClient, roomId: string, muted: boolean): Promise<void> {
  await client.setRoomMutePushRule("global", roomId, muted);
}

export async function setRoomNotificationMode(
  client: MatrixClient,
  roomId: string,
  mode: RoomNotificationMode,
): Promise<void> {
  const ruleId = MENTIONS_ONLY_PREFIX + roomId;
  if (mode === "muted") {
    await deleteRuleQuietly(client, PushRuleKind.Override, ruleId);
    await client.setRoomMutePushRule("global", roomId, true);
  } else {
    await client.setRoomMutePushRule("global", roomId, false);
    if (mode === "mentions") {
      // Inserted after the built-in mention rules so user/display-name/@room
      // mentions are still notified before our catch-all suppression runs.
      // Positioning only matters on plaintext rooms; E2EE events hide
      // mentions from the server either way.
      const path = `/pushrules/global/override/${encodeURIComponent(ruleId)}`;
      const body = {
        actions: [] as PushRuleAction[],
        conditions: [{ kind: "event_match", key: "room_id", pattern: roomId }] as PushRuleCondition[],
      };
      try {
        await client.http.authedRequest(Method.Put, path, { after: ".m.rule.is_user_mention" }, body);
      } catch {
        // Older servers may reject before/after positioning - add unpositioned.
        await client.addPushRule("global", PushRuleKind.Override, ruleId, body);
      }
    } else {
      await deleteRuleQuietly(client, PushRuleKind.Override, ruleId);
    }
  }
  await refreshPushRules(client);
}

function keywordRuleId(word: string): string {
  const bytes = new TextEncoder().encode(word.trim().toLowerCase());
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return KEYWORD_RULE_PREFIX + hex;
}

/** Keywords that trigger a highlight notification, from the cached rules. */
export function getKeywordPatterns(client: MatrixClient): string[] {
  return (client.pushRules?.global?.content ?? [])
    .filter((rule) => rule.rule_id.startsWith(KEYWORD_RULE_PREFIX) && rule.enabled)
    .map((rule) => rule.pattern ?? "")
    .filter((pattern) => pattern.length > 0);
}

export async function fetchNotificationKeywords(client: MatrixClient): Promise<string[]> {
  await ensurePushRules(client);
  return getKeywordPatterns(client);
}

export async function addNotificationKeyword(client: MatrixClient, word: string): Promise<void> {
  const trimmed = word.trim();
  if (!trimmed) return;
  await client.addPushRule("global", PushRuleKind.ContentSpecific, keywordRuleId(trimmed), {
    pattern: trimmed,
    actions: [PushRuleActionName.Notify, { set_tweak: "highlight" }] as PushRuleAction[],
  });
  await refreshPushRules(client);
}

export async function removeNotificationKeyword(client: MatrixClient, word: string): Promise<void> {
  await client.deletePushRule("global", PushRuleKind.ContentSpecific, keywordRuleId(word));
  await refreshPushRules(client);
}
