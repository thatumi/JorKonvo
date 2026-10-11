import { EventType, type MatrixClient, type Room } from "matrix-js-sdk";
import { ROOM_EMOTES_EVENT } from "./roomEmoji.js";
import { getRoomsInSpace } from "./rooms.js";
import { SPACE_SETTINGS_EVENT } from "./spaceSettings.js";

// Deliberately NOT imported from roles.js: this module is a lower layer
// that roles.ts itself depends on (for PermissionId and the compute/check
// helpers below), so importing back from roles.ts would make the two
// modules circular. This one literal is the exception - it has to match
// roles.ts's own (also-exported) SPACE_ROLES_EVENT constant exactly.
const SPACE_ROLES_EVENT = "io.jorkonvo.space_roles";

/**
 * Discord-style named permissions for roles - a hybrid on top of the
 * existing single-number-per-role power level (see roles.ts):
 *
 * Matrix's own permission model is a per-user-per-room SCALAR (power
 * level) compared against per-action THRESHOLDS - a total order. Discord's
 * is an unordered SET of independent bits (a role can grant Kick without
 * Manage Messages, or vice versa - neither implies the other). Those two
 * models are only reconcilable for a subset of Discord's permissions:
 *
 * - "power-level" tier: permissions that correspond to a REAL Matrix
 *   threshold (kick, ban, redact, invite, the base m.room.message level,
 *   m.reaction, or a specific state event like the space roles/settings/
 *   emoji packs). For these, checking a box is genuinely enforced by the
 *   homeserver, same as everything else in this app that gates on power
 *   level - but because Matrix has no per-permission scalar, granting the
 *   HIGHEST-threshold checked permission unavoidably also grants every
 *   OTHER permission whose threshold is at or below it, in every room
 *   Matrix itself doesn't distinguish (see computeRequiredPowerLevel).
 *   That's a real, inherent limitation of layering Discord's model on top
 *   of Matrix's, not a bug - the role editor UI surfaces it rather than
 *   hiding it.
 *
 * - "client" tier: permissions with NO Matrix-level equivalent at all,
 *   because the actions they gate aren't distinct Matrix event types (a
 *   text message and a file attachment are both a plain m.room.message,
 *   differing only in `msgtype`; a thread-starting message is a
 *   m.room.message with a thread relation). These can only ever be
 *   best-effort, UI-side gates - honest, same as AutoMod/slowmode/
 *   reaction-roles elsewhere in this package: enforced by every client
 *   that respects them, bypassable by one that doesn't.
 */
export type PermissionId =
  | "administrator"
  | "manageServer"
  | "manageRoles"
  | "manageEmoji"
  | "manageChannels"
  | "manageMessages"
  | "kickMembers"
  | "banMembers"
  | "inviteMembers"
  | "mentionEveryone"
  | "sendMessages"
  | "addReactions"
  | "attachFiles"
  | "useExternalEmoji"
  | "createThreads";

export type PermissionTier = "power-level" | "client";
export type PermissionCategory = "general" | "membership" | "text";

export interface PermissionDef {
  id: PermissionId;
  tier: PermissionTier;
  category: PermissionCategory;
  labelKey: string;
  descriptionKey: string;
}

/** Display/edit order matches Discord's own permissions list grouping (General, Membership, Text). */
export const PERMISSION_CATALOG: PermissionDef[] = [
  {
    id: "administrator",
    tier: "power-level",
    category: "general",
    labelKey: "permission.administrator",
    descriptionKey: "permission.administratorHint",
  },
  {
    id: "manageServer",
    tier: "power-level",
    category: "general",
    labelKey: "permission.manageServer",
    descriptionKey: "permission.manageServerHint",
  },
  {
    id: "manageRoles",
    tier: "power-level",
    category: "general",
    labelKey: "permission.manageRoles",
    descriptionKey: "permission.manageRolesHint",
  },
  {
    id: "manageChannels",
    tier: "power-level",
    category: "general",
    labelKey: "permission.manageChannels",
    descriptionKey: "permission.manageChannelsHint",
  },
  {
    id: "manageEmoji",
    tier: "power-level",
    category: "general",
    labelKey: "permission.manageEmoji",
    descriptionKey: "permission.manageEmojiHint",
  },
  {
    id: "kickMembers",
    tier: "power-level",
    category: "membership",
    labelKey: "permission.kickMembers",
    descriptionKey: "permission.kickMembersHint",
  },
  {
    id: "banMembers",
    tier: "power-level",
    category: "membership",
    labelKey: "permission.banMembers",
    descriptionKey: "permission.banMembersHint",
  },
  {
    id: "inviteMembers",
    tier: "power-level",
    category: "membership",
    labelKey: "permission.inviteMembers",
    descriptionKey: "permission.inviteMembersHint",
  },
  {
    id: "sendMessages",
    tier: "power-level",
    category: "text",
    labelKey: "permission.sendMessages",
    descriptionKey: "permission.sendMessagesHint",
  },
  {
    id: "attachFiles",
    tier: "client",
    category: "text",
    labelKey: "permission.attachFiles",
    descriptionKey: "permission.attachFilesHint",
  },
  {
    id: "addReactions",
    tier: "power-level",
    category: "text",
    labelKey: "permission.addReactions",
    descriptionKey: "permission.addReactionsHint",
  },
  {
    id: "useExternalEmoji",
    tier: "client",
    category: "text",
    labelKey: "permission.useExternalEmoji",
    descriptionKey: "permission.useExternalEmojiHint",
  },
  {
    id: "createThreads",
    tier: "client",
    category: "text",
    labelKey: "permission.createThreads",
    descriptionKey: "permission.createThreadsHint",
  },
  {
    id: "mentionEveryone",
    tier: "power-level",
    category: "text",
    labelKey: "permission.mentionEveryone",
    descriptionKey: "permission.mentionEveryoneHint",
  },
  {
    id: "manageMessages",
    tier: "power-level",
    category: "text",
    labelKey: "permission.manageMessages",
    descriptionKey: "permission.manageMessagesHint",
  },
];

export function getPermissionDef(id: PermissionId): PermissionDef {
  const def = PERMISSION_CATALOG.find((p) => p.id === id);
  if (!def) throw new Error(`Unknown permission id: ${id}`);
  return def;
}

/** Raw `m.room.power_levels` threshold for one of the handful of named top-level actions - read directly (not via the SDK's hasSufficientPowerLevelFor, which defaults EVERY unset action to 50 and so gets `invite`'s real spec default of 0 wrong). */
function requiredLevelForAction(room: Room, action: "kick" | "ban" | "redact" | "invite", specDefault: number): number {
  const content = room.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() as
    | Record<string, unknown>
    | undefined;
  const v = content?.[action];
  return typeof v === "number" ? v : specDefault;
}

/** Threshold for sending a plain (non-state) event of `eventType` - `events[eventType]`, falling back to `events_default` exactly like matrix-js-sdk's own maySendEvent resolves it. */
function requiredLevelForEvent(room: Room, eventType: string): number {
  const content = room.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() as
    | { events?: Record<string, number>; events_default?: number }
    | undefined;
  const specific = content?.events?.[eventType];
  if (typeof specific === "number") return specific;
  return typeof content?.events_default === "number" ? content.events_default : 0;
}

/** Threshold for sending a STATE event of `eventType` - `events[eventType]`, falling back to `state_default`. */
function requiredLevelForStateEvent(room: Room, eventType: string): number {
  const content = room.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() as
    | { events?: Record<string, number>; state_default?: number }
    | undefined;
  const specific = content?.events?.[eventType];
  if (typeof specific === "number") return specific;
  return typeof content?.state_default === "number" ? content.state_default : 50;
}

/** `notifications.room` - the power level required to have @room/@everyone actually trigger a "notify everyone" push, not just be sent as plain text. */
function requiredLevelForRoomNotification(room: Room): number {
  const content = room.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent() as
    | { notifications?: { room?: number } }
    | undefined;
  return typeof content?.notifications?.room === "number" ? content.notifications.room : 50;
}

/** The power-level threshold ONE room requires for a single power-level-tier permission - undefined for a client-tier id (it contributes nothing to a power level). */
function requiredLevelInRoom(room: Room, id: PermissionId): number | undefined {
  switch (id) {
    case "administrator":
      return 100;
    case "manageServer":
      return requiredLevelForStateEvent(room, SPACE_SETTINGS_EVENT);
    case "manageRoles":
      return requiredLevelForStateEvent(room, SPACE_ROLES_EVENT);
    case "manageEmoji":
      return requiredLevelForStateEvent(room, ROOM_EMOTES_EVENT);
    case "manageChannels":
      // Proxy for name/topic/avatar/channel-type/status/content-rating,
      // which in practice are all left at the room's state_default unless
      // someone has specifically customized one of them differently -
      // an accepted simplification, same spirit as roles.ts already
      // pushing one power level to every room in the space regardless of
      // that room's own specific thresholds.
      return requiredLevelForStateEvent(room, EventType.RoomName);
    case "manageMessages":
      return requiredLevelForAction(room, "redact", 50);
    case "kickMembers":
      return requiredLevelForAction(room, "kick", 50);
    case "banMembers":
      return requiredLevelForAction(room, "ban", 50);
    case "inviteMembers":
      return requiredLevelForAction(room, "invite", 0);
    case "mentionEveryone":
      return requiredLevelForRoomNotification(room);
    case "sendMessages":
      return requiredLevelForEvent(room, EventType.RoomMessage);
    case "addReactions":
      return requiredLevelForEvent(room, EventType.Reaction);
    case "attachFiles":
    case "useExternalEmoji":
    case "createThreads":
      return undefined;
  }
}

/**
 * The power level a role must carry to genuinely satisfy every
 * power-level-tier permission in `permissionIds`, across the whole space
 * (the space room plus every room in it) - the MAXIMUM of each individual
 * room's own threshold for each permission, so the computed level is
 * guaranteed sufficient even in a room whose thresholds were customized
 * higher than the space's typical default. `administrator` short-circuits
 * to 100. Client-tier ids are ignored (they carry no power level).
 */
export function computeRequiredPowerLevel(client: MatrixClient, spaceId: string, permissionIds: PermissionId[]): number {
  if (permissionIds.includes("administrator")) return 100;
  const space = client.getRoom(spaceId);
  if (!space) return 0;
  const rooms = [space, ...getRoomsInSpace(client, spaceId)];
  let max = 0;
  for (const id of permissionIds) {
    for (const room of rooms) {
      const level = requiredLevelInRoom(room, id);
      if (typeof level === "number" && level > max) max = level;
    }
  }
  return max;
}

/**
 * Every power-level-tier permission that a given power level ALSO
 * satisfies in this room, whether or not it was one of the permissions
 * actually checked - the role editor shows this so granting "Ban Members"
 * (say) doesn't silently and invisibly also grant everything gated at a
 * lower threshold. This is the direct, unavoidable consequence of Matrix's
 * power level being a single scalar rather than a set of independent bits.
 */
export function permissionsImpliedByPowerLevel(room: Room, level: number): PermissionId[] {
  // Deliberately no "level >= 100 -> everything" shortcut: client-tier
  // permissions (attachFiles etc.) have no power-level relationship at
  // all, even at 100 - only an explicit "administrator" entry in a role's
  // `permissions` array grants those (see hasClientPermission). A room
  // with an unusually high custom threshold (say redact: 100) computing to
  // level 100 must NOT be reported as implying them.
  return PERMISSION_CATALOG.filter((p) => p.tier === "power-level" && p.id !== "administrator").reduce<PermissionId[]>(
    (acc, p) => {
      const required = requiredLevelInRoom(room, p.id);
      if (typeof required === "number" && level >= required) acc.push(p.id);
      return acc;
    },
    [],
  );
}

/** Structural, not imported from roles.ts (see the note above), so any role-shaped object with a `permissions` field satisfies this. */
export interface PermissionHolder {
  permissions?: PermissionId[];
}

/**
 * Whether a member holding these roles (in hierarchy order, as
 * roles.ts's getMemberRoles already returns them) has a client-tier
 * permission. Backward-compatible by construction: a member with no
 * roles, or whose every assigned role has never had its `permissions`
 * list configured (the field is `undefined`, true for every role that
 * predates this feature), is always allowed - this can only ever take
 * something away once an admin has actually opted a role into the
 * granular list, never as a side effect of roles.ts's older, unrelated
 * per-role power level.
 */
export function hasClientPermission(assignedRoles: PermissionHolder[], id: PermissionId): boolean {
  if (assignedRoles.length === 0) return true;
  if (assignedRoles.some((r) => r.permissions?.includes("administrator"))) return true;
  const configured = assignedRoles.some((r) => r.permissions !== undefined);
  if (!configured) return true;
  return assignedRoles.some((r) => r.permissions?.includes(id));
}
