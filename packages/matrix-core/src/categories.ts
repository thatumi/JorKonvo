import type { MatrixClient, Room } from "matrix-js-sdk";

/**
 * Discord-style channel categories within a space. Matrix has no native
 * concept of this (spaces can nest, but a nested space is a whole extra
 * room with its own membership/join-rules - much heavier than what a
 * "category" needs to be), so it's modelled as a single lightweight state
 * event on the SPACE room: an ordered list of categories, and a map of
 * which category each child room belongs to. Unassigned rooms just don't
 * appear in the map.
 *
 * This is a STATE event (unlike voiceChannels.ts's presence beacon):
 * category structure is space-wide organization that only people who can
 * manage the space should change, so state_default-gated write access
 * (commonly PL 50) is exactly the right behaviour here, not a limitation
 * to route around.
 */

export const SPACE_CATEGORIES_EVENT = "io.jorkonvo.space_categories";

export interface Category {
  id: string;
  name: string;
}

interface CategoriesContent {
  categories?: Category[];
  assignments?: Record<string, string>;
  /** Display order of child room ids across the whole space (sidebar drag-and-drop). Rooms missing here fall back to their natural order. */
  order?: string[];
}

type LooseSendStateEvent = (
  roomId: string,
  eventType: string,
  content: unknown,
  stateKey?: string,
) => Promise<unknown>;

function getContent(space: Room): CategoriesContent {
  return (space.currentState.getStateEvents(SPACE_CATEGORIES_EVENT, "")?.getContent() as
    | CategoriesContent
    | undefined) ?? {};
}

export function getSpaceCategories(space: Room): Category[] {
  return getContent(space).categories ?? [];
}

/** roomId -> categoryId. A room absent from this map is uncategorized. */
export function getCategoryAssignments(space: Room): Record<string, string> {
  return getContent(space).assignments ?? {};
}

export function getCategoryOfRoom(space: Room, roomId: string): string | null {
  return getCategoryAssignments(space)[roomId] ?? null;
}

/** Display order of child room ids, sidebar drag-and-drop. Rooms not listed here just aren't ordered by it. */
export function getRoomOrder(space: Room): string[] {
  return getContent(space).order ?? [];
}

/** Sorts `rooms` by the persisted order, appending any room missing from it at the end in its given order. */
export function sortRoomsByOrder<T extends { roomId: string }>(rooms: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...rooms].sort((a, b) => {
    const ra = rank.get(a.roomId);
    const rb = rank.get(b.roomId);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return 0;
  });
}

export function canManageCategories(space: Room, userId: string): boolean {
  return space.currentState.maySendStateEvent(SPACE_CATEGORIES_EVENT, userId);
}

async function writeContent(client: MatrixClient, spaceId: string, content: CategoriesContent): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(spaceId, SPACE_CATEGORIES_EVENT, content, "");
}

/** Returns the new category's id, e.g. so a caller (like the space-template cloner) can immediately assign rooms into it. */
export async function createCategory(client: MatrixClient, spaceId: string, name: string): Promise<string> {
  const space = client.getRoom(spaceId);
  const categories = space ? getSpaceCategories(space) : [];
  const assignments = space ? getCategoryAssignments(space) : {};
  const id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await writeContent(client, spaceId, { categories: [...categories, { id, name }], assignments });
  return id;
}

export async function renameCategory(
  client: MatrixClient,
  spaceId: string,
  categoryId: string,
  name: string,
): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const categories = getSpaceCategories(space).map((c) => (c.id === categoryId ? { ...c, name } : c));
  await writeContent(client, spaceId, { categories, assignments: getCategoryAssignments(space) });
}

export async function deleteCategory(client: MatrixClient, spaceId: string, categoryId: string): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const categories = getSpaceCategories(space).filter((c) => c.id !== categoryId);
  const assignments = Object.fromEntries(
    Object.entries(getCategoryAssignments(space)).filter(([, catId]) => catId !== categoryId),
  );
  await writeContent(client, spaceId, { categories, assignments });
}

export async function moveCategory(
  client: MatrixClient,
  spaceId: string,
  categoryId: string,
  direction: "up" | "down",
): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const categories = [...getSpaceCategories(space)];
  const index = categories.findIndex((c) => c.id === categoryId);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapWith < 0 || swapWith >= categories.length) return;
  [categories[index], categories[swapWith]] = [categories[swapWith]!, categories[index]!];
  await writeContent(client, spaceId, { categories, assignments: getCategoryAssignments(space) });
}

/** Pass `categoryId: null` to uncategorize the room. */
export async function assignRoomToCategory(
  client: MatrixClient,
  spaceId: string,
  roomId: string,
  categoryId: string | null,
): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space) return;
  const assignments = { ...getCategoryAssignments(space) };
  if (categoryId) assignments[roomId] = categoryId;
  else delete assignments[roomId];
  await writeContent(client, spaceId, { categories: getSpaceCategories(space), assignments });
}

/**
 * Drag-and-drop reorder: moves `roomId` into `categoryId` (null = uncategorized)
 * and repositions it so it lands right before `beforeRoomId`, or at the end of
 * its bucket when `beforeRoomId` is null.
 *
 * `currentOrder` is the full list of the space's room ids in their current
 * on-screen order (i.e. what `sortRoomsByOrder` produced from the existing
 * persisted order plus natural fallback) - passing the as-displayed order
 * rather than just the persisted one means the very first drag in a space
 * with no order yet still inserts relative to the right neighbour instead of
 * always landing at the end.
 */
export async function moveRoomTo(
  client: MatrixClient,
  spaceId: string,
  roomId: string,
  categoryId: string | null,
  beforeRoomId: string | null,
  currentOrder: string[],
): Promise<void> {
  const space = client.getRoom(spaceId);
  if (!space || roomId === beforeRoomId) return;

  const assignments = { ...getCategoryAssignments(space) };
  if (categoryId) assignments[roomId] = categoryId;
  else delete assignments[roomId];

  const order = currentOrder.filter((id) => id !== roomId);
  const insertAt = beforeRoomId ? order.indexOf(beforeRoomId) : -1;
  if (insertAt === -1) order.push(roomId);
  else order.splice(insertAt, 0, roomId);

  await writeContent(client, spaceId, { categories: getSpaceCategories(space), assignments, order });
}
