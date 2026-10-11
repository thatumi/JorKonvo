import { EventType, type MatrixClient, type Room } from "matrix-js-sdk";
import { canSetMemberPowerLevel, getMemberPowerLevel, setMemberPowerLevel } from "./moderation.js";
import { computeRequiredPowerLevel, type PermissionId } from "./permissions.js";
import { getRoomsInSpace } from "./rooms.js";

/**
 * Discord-style named, colored, multi-assignable roles. Matrix's own
 * permission model is a single numeric power level per user per room -
 * there's no native concept of a named/colored/reusable role bundle, so
 * this is built as an organizational/visual layer (name badges + colored
 * display names + a member-list grouped by role, same as Discord's
 * "hoisted roles") on a single state event on the SPACE room, exactly like
 * categories.ts.
 *
 * A role's power-level target is OPT-IN and purely additive: a role with
 * no `powerLevel` set behaves exactly as before (pure organization, never
 * touches permissions - the per-room power-level editor in
 * RoomSettingsModal remains the source of truth for anyone not using this).
 * Only when a role DOES carry a `powerLevel` does assigning/unassigning it
 * (or changing the role's own target, or deleting the role) push that
 * change out to every room in the space via setMemberPowerLevel - see
 * syncMemberPowerLevelFromRoles below for exactly how multi-role stacking
 * and removal are resolved.
 *
 * Role order in the stored array IS the hierarchy (index 0 = highest,
 * same convention as Discord's role list) - a member's *first* assigned
 * role in that order wins for name coloring, same pattern moveCategory
 * uses for category ordering.
 *
 * `permissions` (see permissions.ts) is a newer, higher-level alternative
 * to setting `powerLevel` by hand: pick named Discord-style permissions
 * ("Kick Members", "Manage Roles", ...) and the required `powerLevel` is
 * computed and kept in sync automatically (see setRolePermissions). The
 * two fields aren't independent - `permissions`, when present, is what
 * actually determines `powerLevel`; a role from before this feature simply
 * has no `permissions` and keeps behaving exactly as it always did.
 */
export const SPACE_ROLES_EVENT = "io.jorkonvo.space_roles";

export interface SpaceRole {
  id: string;
  name: string;
  color: string;
  /** Power level this role grants in every room of the space, or undefined for a purely cosmetic role. Computed from `permissions` when that's set - see setRolePermissions. */
  powerLevel?: number;
  /** `mxc://` of a small icon shown next to the names of members with this role (Discord's "role icon" / badge). */
  icon?: string;
  /** Whether anyone (not just role managers) can @mention this role. Defaults to true when unset, matching Discord. */
  mentionable?: boolean;
  /** Discord's "Display role members separately from online members" - when true, this role gets its own hoisted section in the member list. Defaults to false. */
  hoist?: boolean;
  /** Discord-style named permissions this role grants - see permissions.ts. Undefined for a role that predates this feature or has never used it (falls back to the plain `powerLevel` field, unaffected). */
  permissions?: PermissionId[];
}

interface RolesContent {
  roles?: SpaceRole[];
  /** userId -> roleIds */
  assignments?: Record<string, string[]>;
}

type LooseSendStateEvent = (
  roomId: string,
  eventType: string,
  content: unknown,
  stateKey?: string,
) => Promise<unknown>;

function getContent(space: Room): RolesContent {
  return (space.currentState.getStateEvents(SPACE_ROLES_EVENT, "")?.getContent() as
    | RolesContent
    | undefined) ?? {};
}

export function getSpaceRoles(space: Room): SpaceRole[] {
  return getContent(space).roles ?? [];
}

export function getMemberRoleIds(space: Room, userId: string): string[] {
  return getContent(space).assignments?.[userId] ?? [];
}

/** Member's assigned roles, in hierarchy order (highest first). */
export function getMemberRoles(space: Room, userId: string): SpaceRole[] {
  const ids = new Set(getMemberRoleIds(space, userId));
  return getSpaceRoles(space).filter((r) => ids.has(r.id));
}

/** Highest-ranked assigned role's color for Discord-style name coloring, or null for the default color. */
export function getMemberRoleColor(space: Room, userId: string): string | null {
  return getMemberRoles(space, userId)[0]?.color ?? null;
}

export function canManageRoles(space: Room, userId: string): boolean {
  return space.currentState.maySendStateEvent(SPACE_ROLES_EVENT, userId);
}

/** Room members (not the whole space's) currently holding a given role - for role-mention resolution, which should only notify people who'll actually see the message. */
export function getRoomMembersWithRole(space: Room, room: Room, roleId: string): string[] {
  return room
    .getMembersWithMembership("join")
    .map((m) => m.userId)
    .filter((userId) => getMemberRoleIds(space, userId).includes(roleId));
}

async function writeContent(client: MatrixClient, spaceId: string, content: RolesContent): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(spaceId, SPACE_ROLES_EVENT, content, "");
}

/** Returns the new role's id, e.g. so a caller (like the space-template cloner) can immediately reference it. */
export async function createRole(
  client: MatrixClient,
  spaceId: string,
  name: string,
  color: string,
  powerLevel?: number,
): Promise<string> {
  const space = client.getRoom(spaceId);
  const content = space ? getContent(space) : {};
  const id = `role_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const role: SpaceRole = powerLevel === undefined ? { id, name, color } : { id, name, color, powerLevel };
  await writeContent(client, spaceId, { ...content, roles: [...(content.roles ?? []), role] });
  return id;
}

export async function renameRole(client: MatrixClient, spaceId: string, roleId: string, name: string): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const content = getContent(space);
  const roles = (content.roles ?? []).map((r) => (r.id === roleId ? { ...r, name } : r));
  await writeContent(client, spaceId, { ...content, roles });
}

export async function recolorRole(client: MatrixClient, spaceId: string, roleId: string, color: string): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const content = getContent(space);
  const roles = (content.roles ?? []).map((r) => (r.id === roleId ? { ...r, color } : r));
  await writeContent(client, spaceId, { ...content, roles });
}

export async function setRoleMentionable(client: MatrixClient, spaceId: string, roleId: string, mentionable: boolean): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const content = getContent(space);
  const roles = (content.roles ?? []).map((r) => (r.id === roleId ? { ...r, mentionable } : r));
  await writeContent(client, spaceId, { ...content, roles });
}

/** True unless explicitly set to false - matches Discord's "mentionable by default" behavior for new roles. */
export function isRoleMentionable(role: SpaceRole): boolean {
  return role.mentionable !== false;
}

export async function setRoleHoisted(client: MatrixClient, spaceId: string, roleId: string, hoist: boolean): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const content = getContent(space);
  const roles = (content.roles ?? []).map((r) => (r.id === roleId ? { ...r, hoist } : r));
  await writeContent(client, spaceId, { ...content, roles });
}

/** Off by default, matching Discord - a role only gets its own member-list section when explicitly hoisted. */
export function isRoleHoisted(role: SpaceRole): boolean {
  return role.hoist === true;
}

/** Uploads (or clears, with `file: null`) the small icon shown next to a role member's name. */
export async function setRoleIcon(
  client: MatrixClient,
  spaceId: string,
  roleId: string,
  file: File | null,
): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const content = getContent(space);
  let icon: string | undefined;
  if (file) {
    const upload = await client.uploadContent(file, { type: file.type });
    icon = upload.content_uri;
  }
  const roles = (content.roles ?? []).map((r) => {
    if (r.id !== roleId) return r;
    const next = { ...r };
    if (icon) next.icon = icon;
    else delete next.icon;
    return next;
  });
  await writeContent(client, spaceId, { ...content, roles });
}

/** `mxc://` icons from a member's assigned roles, highest-ranked first (for name badges). */
export function getMemberRoleIcons(space: Room, userId: string): string[] {
  return getMemberRoles(space, userId)
    .map((r) => r.icon)
    .filter((i): i is string => typeof i === "string" && i.startsWith("mxc://"));
}

/**
 * Re-syncs every one of `holderUserIds`' power level from `roles`/
 * `assignments` - shared by every role-editing function below that changes
 * something a currently-assigned holder must reflect immediately (a
 * power-level target, or the newer `permissions` list it's derived from).
 * `assignments` and `holderUserIds` are separate parameters (rather than
 * deriving the latter from the former) because deleteRole needs to resync
 * the role's PREVIOUS holders using its NEW (already-stripped) assignments.
 */
async function resyncHolders(
  client: MatrixClient,
  spaceId: string,
  roles: SpaceRole[],
  assignments: Record<string, string[]>,
  holderUserIds: string[],
): Promise<void> {
  for (const userId of holderUserIds) {
    await syncMemberPowerLevelFromRoles(client, spaceId, userId, roles, assignments[userId] ?? []);
  }
}

export async function deleteRole(client: MatrixClient, spaceId: string, roleId: string): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const content = getContent(space);
  const deletedRole = (content.roles ?? []).find((r) => r.id === roleId);
  const previousHolders = Object.entries(content.assignments ?? {})
    .filter(([, ids]) => ids.includes(roleId))
    .map(([uid]) => uid);

  const roles = (content.roles ?? []).filter((r) => r.id !== roleId);
  const assignments = Object.fromEntries(
    Object.entries(content.assignments ?? {}).map(([uid, ids]) => [uid, ids.filter((id) => id !== roleId)]),
  );
  await writeContent(client, spaceId, { roles, assignments });

  // A deleted role that granted a power level must not leave its former
  // holders stranded at that level - recompute each of them the same way
  // unassigning it individually would. Passing the just-computed `roles`/
  // `assignments` explicitly (rather than re-reading the room) matters:
  // sendStateEvent is a plain PUT with no local echo, so the room's own
  // currentState won't reflect this write for a beat - re-reading it here
  // would see the STALE (pre-delete) role list and wrongly no-op.
  if (deletedRole && typeof deletedRole.powerLevel === "number") {
    await resyncHolders(client, spaceId, roles, assignments, previousHolders);
  }
}

/**
 * Sets (or clears, with null) the power level a role grants directly, then
 * re-syncs every current holder. This is the low-level primitive - a role
 * using the newer named-permissions editor (see setRolePermissions) has
 * its power level computed automatically instead of set through here, but
 * the underlying mechanism (and every existing role that predates that
 * feature) is unchanged.
 */
export async function setRolePowerLevel(
  client: MatrixClient,
  spaceId: string,
  roleId: string,
  powerLevel: number | null,
): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const content = getContent(space);
  const roles = (content.roles ?? []).map((r) =>
    r.id === roleId ? { ...r, powerLevel: powerLevel ?? undefined } : r,
  );
  await writeContent(client, spaceId, { ...content, roles });

  // Retroactive: existing holders of this role must reflect the new (or
  // cleared) power-level target immediately, not just future assignments.
  const holders = Object.entries(content.assignments ?? {})
    .filter(([, ids]) => ids.includes(roleId))
    .map(([uid]) => uid);
  await resyncHolders(client, spaceId, roles, content.assignments ?? {}, holders);
}

/**
 * Sets the named Discord-style permissions (see permissions.ts) a role
 * grants - the power-level-tier ones among them are compiled down into the
 * exact same `powerLevel` field setRolePowerLevel manages directly, via
 * computeRequiredPowerLevel (the space's own current power-level
 * thresholds decide what number that ends up being, not a fixed mapping).
 * The client-tier ones (attach files, external emoji, create threads) have
 * no power level at all - they're read straight off `permissions` wherever
 * they're enforced (see hasClientPermission), which is why this still
 * stores the full `permissions` list even though only some of it fed into
 * the computed power level.
 */
export async function setRolePermissions(
  client: MatrixClient,
  spaceId: string,
  roleId: string,
  permissions: PermissionId[],
): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const content = getContent(space);
  const powerLevel = computeRequiredPowerLevel(client, spaceId, permissions);
  const roles = (content.roles ?? []).map((r) =>
    r.id === roleId ? { ...r, permissions, powerLevel: powerLevel > 0 ? powerLevel : undefined } : r,
  );
  await writeContent(client, spaceId, { ...content, roles });

  const holders = Object.entries(content.assignments ?? {})
    .filter(([, ids]) => ids.includes(roleId))
    .map(([uid]) => uid);
  await resyncHolders(client, spaceId, roles, content.assignments ?? {}, holders);
}

/**
 * Recomputes and applies a member's power level from their currently
 * assigned power-granting roles. Multiple power-granting roles stack by
 * taking the HIGHEST of them, the same "top role wins" principle already
 * used for name coloring - removing a lower role while a higher one remains
 * assigned correctly leaves the higher level in place. Losing the LAST
 * power-granting role resets the member to each room's own configured
 * users_default (normally 0), since there is no other role left to justify
 * keeping an elevated level.
 *
 * Takes the member's up-to-date role list and assignment explicitly rather
 * than reading them back off the room: state events sent via
 * sendStateEvent have no local echo (a plain PUT, applied only once it
 * comes back through /sync), so re-reading room state immediately after
 * writing it would see stale data and silently no-op - every call site
 * above already has the fresh values in hand from its own write.
 *
 * Applied across every room in the space (plus the space room itself, so a
 * role can also unlock managing space-level state like categories/roles),
 * skipped per-room wherever the acting user lacks permission there or the
 * target isn't a member of that particular room - same best-effort,
 * partial-success pattern the rest of this package uses for multi-room
 * operations.
 */
export async function syncMemberPowerLevelFromRoles(
  client: MatrixClient,
  spaceId: string,
  userId: string,
  roles: SpaceRole[],
  assignedRoleIds: string[],
): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const actingUserId = client.getUserId() ?? "";
  const assignedIds = new Set(assignedRoleIds);
  const powerRoles = roles.filter((r) => assignedIds.has(r.id) && typeof r.powerLevel === "number");
  const targetLevel = powerRoles.length > 0 ? Math.max(...powerRoles.map((r) => r.powerLevel!)) : null;

  const rooms = [space, ...getRoomsInSpace(client, spaceId)];
  for (const room of rooms) {
    if (!room.getMember(userId)) continue;
    const roomDefault =
      (room.currentState.getStateEvents(EventType.RoomPowerLevels, "")?.getContent().users_default as
        | number
        | undefined) ?? 0;
    const level = targetLevel ?? roomDefault;
    if (getMemberPowerLevel(room, userId) === level) continue;
    if (!canSetMemberPowerLevel(room, actingUserId, userId, level)) continue;
    try {
      await setMemberPowerLevel(client, room.roomId, userId, level);
    } catch {
      // Best-effort across many rooms - one room's failure (e.g. a
      // transient network error) shouldn't abort the rest.
    }
  }
}

export async function moveRole(client: MatrixClient, spaceId: string, roleId: string, direction: "up" | "down"): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const content = getContent(space);
  const roles = [...(content.roles ?? [])];
  const index = roles.findIndex((r) => r.id === roleId);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapWith < 0 || swapWith >= roles.length) return;
  [roles[index], roles[swapWith]] = [roles[swapWith]!, roles[index]!];
  await writeContent(client, spaceId, { ...content, roles });
}

export async function setMemberRoleAssigned(
  client: MatrixClient,
  spaceId: string,
  userId: string,
  roleId: string,
  assigned: boolean,
): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const content = getContent(space);
  const current = content.assignments?.[userId] ?? [];
  const next = assigned ? [...new Set([...current, roleId])] : current.filter((id) => id !== roleId);
  await writeContent(client, spaceId, { ...content, assignments: { ...content.assignments, [userId]: next } });

  // Pure cosmetic roles (no powerLevel) must never touch permissions - only
  // sync when the SPECIFIC role just toggled actually carries one. Removing
  // a power-granting role still correctly recomputes down to whatever the
  // member's remaining roles justify (see syncMemberPowerLevelFromRoles).
  const toggledRole = (content.roles ?? []).find((r) => r.id === roleId);
  if (toggledRole && typeof toggledRole.powerLevel === "number") {
    await syncMemberPowerLevelFromRoles(client, spaceId, userId, content.roles ?? [], next);
  }
}
