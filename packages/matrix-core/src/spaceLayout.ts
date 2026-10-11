import type { MatrixClient, Room } from "matrix-js-sdk";
import { getTopLevelSpaces } from "./rooms.js";

/**
 * Discord-style left-rail organisation: a user-defined ORDER for their
 * top-level spaces, plus optional FOLDERS that group several spaces under one
 * rail entry. Matrix has no native concept of either (MSC3230 space ordering
 * never stabilised, and folders are pure client UX), so this lives in a single
 * private account-data event - it syncs between this user's devices but means
 * nothing to other clients, which is fine.
 *
 * The stored shape is deliberately small and self-describing; everything the
 * rail needs (dropping un-joined spaces, appending newly-joined ones) is
 * derived at read time by `getResolvedSpaceLayout`.
 */

export const SPACE_LAYOUT_EVENT = "io.jorkonvo.space_layout";

export interface SpaceFolder {
  id: string;
  name: string;
  /** Optional accent colour (hex), shown behind the folder's mini-grid. */
  color?: string;
  spaceIds: string[];
}

/** One entry in the rail: either a bare space, or a folder of spaces. */
export type LayoutEntry = { kind: "space"; id: string } | { kind: "folder"; folder: SpaceFolder };

export interface StoredSpaceLayout {
  order: LayoutEntry[];
}

type LooseGetAccountData = (eventType: string) => { getContent: () => unknown } | undefined;
type LooseSetAccountData = (eventType: string, content: unknown) => Promise<unknown>;

export function getStoredSpaceLayout(client: MatrixClient): StoredSpaceLayout {
  const raw = (client.getAccountData as unknown as LooseGetAccountData)(SPACE_LAYOUT_EVENT)?.getContent() as
    | Partial<StoredSpaceLayout>
    | undefined;
  const order = Array.isArray(raw?.order) ? raw!.order! : [];
  // Defensive: drop malformed entries rather than crash the whole rail.
  return {
    order: order.filter((e): e is LayoutEntry => {
      if (!e || typeof e !== "object") return false;
      if (e.kind === "space") return typeof e.id === "string";
      if (e.kind === "folder") return !!e.folder && Array.isArray(e.folder.spaceIds);
      return false;
    }),
  };
}

export async function saveSpaceLayout(client: MatrixClient, layout: StoredSpaceLayout): Promise<void> {
  await (client.setAccountData as unknown as LooseSetAccountData)(SPACE_LAYOUT_EVENT, layout);
}

export type RailItem =
  | { type: "space"; space: Room }
  | { type: "folder"; id: string; name: string; color?: string; spaces: Room[] };

/**
 * Merges the stored layout with the user's actual joined top-level spaces:
 * spaces they've left disappear, spaces they've newly joined get appended as
 * bare entries, and empty folders are dropped.
 */
export function getResolvedSpaceLayout(client: MatrixClient): RailItem[] {
  return resolveStoredLayout(client, getStoredSpaceLayout(client));
}

/** Same as {@link getResolvedSpaceLayout} but against an explicit stored layout - lets the UI render an optimistic result before the account-data echo arrives. */
export function resolveStoredLayout(client: MatrixClient, stored: StoredSpaceLayout): RailItem[] {
  const topLevel = getTopLevelSpaces(client);
  const byId = new Map(topLevel.map((s) => [s.roomId, s]));
  const placed = new Set<string>();
  const items: RailItem[] = [];

  for (const entry of stored.order) {
    if (entry.kind === "space") {
      const space = byId.get(entry.id);
      if (space && !placed.has(entry.id)) {
        placed.add(entry.id);
        items.push({ type: "space", space });
      }
      continue;
    }
    const spaces = entry.folder.spaceIds
      .filter((id) => byId.has(id) && !placed.has(id))
      .map((id) => {
        placed.add(id);
        return byId.get(id)!;
      });
    // A folder needs at least two spaces to be a folder (Discord behaviour) -
    // otherwise spill its contents back onto the rail.
    if (spaces.length < 2) {
      for (const space of spaces) items.push({ type: "space", space });
      continue;
    }
    items.push({
      type: "folder",
      id: entry.folder.id,
      name: entry.folder.name,
      color: entry.folder.color,
      spaces,
    });
  }

  // Newly-joined spaces the layout hasn't seen yet.
  for (const space of topLevel) {
    if (!placed.has(space.roomId)) items.push({ type: "space", space });
  }

  return items;
}

/** Serialises the current resolved rail back into the stored shape (used as the base for edits). */
function railToStored(items: RailItem[]): StoredSpaceLayout {
  const order: LayoutEntry[] = [];
  for (const item of items) {
    if (item.type === "space") {
      order.push({ kind: "space", id: item.space.roomId });
      continue;
    }
    if (item.spaces.length < 2) {
      for (const s of item.spaces) order.push({ kind: "space", id: s.roomId });
      continue;
    }
    order.push({
      kind: "folder",
      folder: {
        id: item.id,
        name: item.name,
        color: item.color,
        spaceIds: item.spaces.map((s) => s.roomId),
      },
    });
  }
  return { order };
}

function newFolderId(): string {
  return `fld_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Applies one drag-and-drop gesture and returns the new stored layout to
 * persist. `dragged` is always a space id (folders aren't dragged in this MVP).
 *
 * - dropping a space onto another top-level space -> new folder holding both
 * - dropping a space onto a folder -> added to that folder
 * - dropping a space between entries -> reordered (and pulled out of any folder)
 */
export function applySpaceDrop(
  client: MatrixClient,
  gesture:
    | { type: "onto-space"; draggedSpaceId: string; targetSpaceId: string }
    | { type: "into-folder"; draggedSpaceId: string; folderId: string }
    | { type: "reorder"; draggedSpaceId: string; beforeIndex: number }
    | { type: "out-of-folder"; draggedSpaceId: string },
): StoredSpaceLayout {
  const items = getResolvedSpaceLayout(client);

  // Remove the dragged space from wherever it currently is.
  const removeDragged = (list: RailItem[], id: string): RailItem[] =>
    list
      .map((item) => {
        if (item.type === "space") return item.space.roomId === id ? null : item;
        const spaces = item.spaces.filter((s) => s.roomId !== id);
        return spaces.length > 0 ? { ...item, spaces } : null;
      })
      .filter((x): x is RailItem => x !== null);

  const draggedSpace =
    items.flatMap((i) => (i.type === "space" ? [i.space] : i.spaces)).find((s) => s.roomId === gesture.draggedSpaceId) ??
    client.getRoom(gesture.draggedSpaceId);
  if (!draggedSpace) return railToStored(items);

  if (gesture.type === "onto-space") {
    if (gesture.targetSpaceId === gesture.draggedSpaceId) return railToStored(items);
    const targetIdx = items.findIndex(
      (i) => i.type === "space" && i.space.roomId === gesture.targetSpaceId,
    );
    if (targetIdx === -1) return railToStored(items);
    const targetSpace = (items[targetIdx] as { space: Room }).space;
    const without = removeDragged(items, gesture.draggedSpaceId);
    const insertAt = without.findIndex(
      (i) => i.type === "space" && i.space.roomId === gesture.targetSpaceId,
    );
    const folder: RailItem = {
      type: "folder",
      id: newFolderId(),
      name: "Új mappa",
      spaces: [targetSpace, draggedSpace],
    };
    without.splice(insertAt === -1 ? without.length : insertAt, 1, folder);
    return railToStored(without);
  }

  if (gesture.type === "into-folder") {
    const without = removeDragged(items, gesture.draggedSpaceId);
    const folder = without.find((i) => i.type === "folder" && i.id === gesture.folderId) as
      | Extract<RailItem, { type: "folder" }>
      | undefined;
    if (!folder) return railToStored(items);
    folder.spaces = [...folder.spaces, draggedSpace];
    return railToStored(without);
  }

  // reorder / out-of-folder: pull to top level at a position.
  const without = removeDragged(items, gesture.draggedSpaceId);
  const idx =
    gesture.type === "reorder"
      ? Math.max(0, Math.min(gesture.beforeIndex, without.length))
      : without.length;
  without.splice(idx, 0, { type: "space", space: draggedSpace });
  return railToStored(without);
}

export function renameFolder(client: MatrixClient, folderId: string, name: string): StoredSpaceLayout {
  const stored = getStoredSpaceLayout(client);
  return {
    order: stored.order.map((e) =>
      e.kind === "folder" && e.folder.id === folderId
        ? { kind: "folder", folder: { ...e.folder, name } }
        : e,
    ),
  };
}

export function setFolderColor(client: MatrixClient, folderId: string, color: string | undefined): StoredSpaceLayout {
  const stored = getStoredSpaceLayout(client);
  return {
    order: stored.order.map((e) =>
      e.kind === "folder" && e.folder.id === folderId
        ? { kind: "folder", folder: { ...e.folder, color } }
        : e,
    ),
  };
}

/** Dissolves a folder, spilling its spaces back onto the rail in its place. */
export function dissolveFolder(client: MatrixClient, folderId: string): StoredSpaceLayout {
  const items = getResolvedSpaceLayout(client);
  const out: RailItem[] = [];
  for (const item of items) {
    if (item.type === "folder" && item.id === folderId) {
      for (const space of item.spaces) out.push({ type: "space", space });
    } else {
      out.push(item);
    }
  }
  return railToStored(out);
}
