import { describe, expect, it } from "vitest";
import {
  createRole,
  deleteRole,
  getMemberRoleColor,
  getMemberRoles,
  getRoomMembersWithRole,
  getSpaceRoles,
  isRoleHoisted,
  isRoleMentionable,
  moveRole,
  renameRole,
  SPACE_ROLES_EVENT,
  type SpaceRole,
} from "../../../packages/matrix-core/src/roles.js";
import { FakeClient, FakeRoom } from "../../helpers/fakes.js";

function spaceWith(roles: SpaceRole[], assignments: Record<string, string[]> = {}) {
  return new FakeRoom({
    roomId: "!space:test",
    isSpace: true,
    state: { [`${SPACE_ROLES_EVENT}|`]: { roles, assignments } },
  });
}

const admin: SpaceRole = { id: "r1", name: "Admin", color: "#f00", powerLevel: 50 };
const vip: SpaceRole = { id: "r2", name: "VIP", color: "#0f0" };

describe("role reads", () => {
  it("getSpaceRoles returns [] when no state event", () => {
    expect(getSpaceRoles(new FakeRoom({ isSpace: true }))).toEqual([]);
  });

  it("getMemberRoles returns assigned roles in stored (hierarchy) order", () => {
    const space = spaceWith([admin, vip], { "@u:test": ["r2", "r1"] });
    expect(getMemberRoles(space, "@u:test").map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("getMemberRoleColor is the top assigned role's colour", () => {
    const space = spaceWith([admin, vip], { "@u:test": ["r1", "r2"] });
    expect(getMemberRoleColor(space, "@u:test")).toBe("#f00");
    expect(getMemberRoleColor(space, "@nobody:test")).toBeNull();
  });

  it("isRoleMentionable defaults true, isRoleHoisted defaults false", () => {
    expect(isRoleMentionable(vip)).toBe(true);
    expect(isRoleMentionable({ ...vip, mentionable: false })).toBe(false);
    expect(isRoleHoisted(vip)).toBe(false);
    expect(isRoleHoisted({ ...vip, hoist: true })).toBe(true);
  });

  it("getRoomMembersWithRole intersects space assignment with room membership", () => {
    const space = spaceWith([vip], { "@a:test": ["r2"], "@b:test": ["r2"] });
    const room = new FakeRoom({
      members: [
        { userId: "@a:test", membership: "join" },
        { userId: "@b:test", membership: "leave" },
      ],
    });
    expect(getRoomMembersWithRole(space, room, "r2")).toEqual(["@a:test"]);
  });
});

describe("role writes go through sendStateEvent", () => {
  it("createRole appends and returns the new id", async () => {
    const space = spaceWith([admin]);
    const client = new FakeClient({ userId: "@me:test", rooms: [space] });
    const id = await createRole(client as never, "!space:test", "Mod", "#00f", 25);
    const written = client.sentStateEvents.at(-1)!;
    expect(written.type).toBe(SPACE_ROLES_EVENT);
    const roles = (written.content as { roles: SpaceRole[] }).roles;
    expect(roles).toHaveLength(2);
    expect(roles[1]).toMatchObject({ id, name: "Mod", color: "#00f", powerLevel: 25 });
  });

  it("createRole without a power level stores a purely cosmetic role", async () => {
    const space = spaceWith([]);
    const client = new FakeClient({ rooms: [space] });
    await createRole(client as never, "!space:test", "Cosmetic", "#abc");
    const roles = (client.sentStateEvents.at(-1)!.content as { roles: SpaceRole[] }).roles;
    expect(roles[0]).not.toHaveProperty("powerLevel");
  });

  it("renameRole only touches the matching role", async () => {
    const space = spaceWith([admin, vip]);
    const client = new FakeClient({ rooms: [space] });
    await renameRole(client as never, "!space:test", "r2", "Legend");
    const roles = (client.sentStateEvents.at(-1)!.content as { roles: SpaceRole[] }).roles;
    expect(roles.map((r) => r.name)).toEqual(["Admin", "Legend"]);
  });

  it("deleteRole strips the role and its assignments", async () => {
    const space = spaceWith([admin, vip], { "@u:test": ["r1", "r2"] });
    const client = new FakeClient({ rooms: [space] });
    await deleteRole(client as never, "!space:test", "r1");
    const content = client.sentStateEvents[0].content as {
      roles: SpaceRole[];
      assignments: Record<string, string[]>;
    };
    expect(content.roles.map((r) => r.id)).toEqual(["r2"]);
    expect(content.assignments["@u:test"]).toEqual(["r2"]);
  });

  it("moveRole up swaps a role with its predecessor", async () => {
    const space = spaceWith([admin, vip]);
    const client = new FakeClient({ rooms: [space] });
    await moveRole(client as never, "!space:test", "r2", "up");
    const roles = (client.sentStateEvents.at(-1)!.content as { roles: SpaceRole[] }).roles;
    expect(roles.map((r) => r.id)).toEqual(["r2", "r1"]);
  });

  it("moveRole is a no-op at the top edge (no state event sent)", async () => {
    const space = spaceWith([admin, vip]);
    const client = new FakeClient({ rooms: [space] });
    await moveRole(client as never, "!space:test", "r1", "up");
    expect(client.sentStateEvents).toHaveLength(0);
  });
});
