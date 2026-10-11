import type { MatrixClient } from "matrix-js-sdk";
import { assignRoomToCategory, createCategory, getCategoryOfRoom, getSpaceCategories } from "./categories.js";
import { createRoom, createSpace } from "./room-admin.js";
import { getRoomsInSpace } from "./rooms.js";
import { createRole, getSpaceRoles } from "./roles.js";
import { type ChannelType, getChannelType, setChannelType } from "./voiceChannels.js";

/**
 * Clones a space's STRUCTURE into a brand new space - categories, channels
 * (name/topic/type, correctly re-grouped into the new categories), and
 * roles (name/color/power-level template, deliberately WITHOUT member
 * assignments, since an empty new space has no members yet to assign them
 * to). Nothing about content is copied: no messages, no member list, no
 * encryption state, no existing invites - this is a starting-point
 * template, not a backup/duplicate.
 *
 * Only clones channels this account is currently JOINED to (the same
 * `getRoomsInSpace` a joined-channel list always has - space membership
 * doesn't retroactively grant visibility into channels this account never
 * joined, a limit this app has hit before). Use the space hierarchy
 * browser first if some channels in the source space aren't joined yet.
 */
export async function cloneSpaceAsTemplate(
  client: MatrixClient,
  sourceSpaceId: string,
  newName: string,
): Promise<string> {
  const sourceSpace = client.getRoom(sourceSpaceId);
  if (!sourceSpace) throw new Error("A forrás space nem található");

  const topic = sourceSpace.currentState.getStateEvents("m.room.topic", "")?.getContent()?.topic as
    | string
    | undefined;
  const newSpaceId = await createSpace(client, { name: newName, topic });

  for (const role of getSpaceRoles(sourceSpace)) {
    await createRole(client, newSpaceId, role.name, role.color, role.powerLevel);
  }

  const categoryIdMap = new Map<string, string>();
  for (const category of getSpaceCategories(sourceSpace)) {
    const newCategoryId = await createCategory(client, newSpaceId, category.name);
    categoryIdMap.set(category.id, newCategoryId);
  }

  for (const room of getRoomsInSpace(client, sourceSpaceId)) {
    const roomTopic = room.currentState.getStateEvents("m.room.topic", "")?.getContent()?.topic as
      | string
      | undefined;
    const newRoomId = await createRoom(client, { name: room.name, topic: roomTopic, parentSpaceId: newSpaceId });

    const channelType: ChannelType = getChannelType(room);
    if (channelType !== "text") await setChannelType(client, newRoomId, channelType);

    const oldCategoryId = getCategoryOfRoom(sourceSpace, room.roomId);
    const newCategoryId = oldCategoryId ? categoryIdMap.get(oldCategoryId) : undefined;
    if (newCategoryId) await assignRoomToCategory(client, newSpaceId, newRoomId, newCategoryId);
  }

  return newSpaceId;
}
