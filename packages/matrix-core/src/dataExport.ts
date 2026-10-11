import type { MatrixClient } from "matrix-js-sdk";
import { isDirectRoom } from "./rooms.js";

export interface DataExportDevice {
  deviceId: string;
  displayName?: string;
  lastSeenTs?: number;
  lastSeenIp?: string;
}

export interface DataExportRoom {
  roomId: string;
  name: string;
  membership: string;
  isSpace: boolean;
  isDirect: boolean;
}

export interface DataExport {
  exportedAt: string;
  userId: string;
  homeserverUrl: string;
  profile: { displayName?: string; avatarUrl?: string };
  devices: DataExportDevice[];
  rooms: DataExportRoom[];
  /** Every account-data type this client has synced (io.jorkonvo.* app data - friends, ignored users, personal emoji, client settings, DM privacy, etc. - plus native `m.*` ones like m.direct), keyed by event type. Read straight from the SDK's own account-data store rather than a hand-maintained list, so it can't silently drift out of date as new account-data types get added. */
  accountData: Record<string, unknown>;
}

/**
 * A best-effort "download my data" export - everything Matrix + this app
 * store ABOUT the account (profile, devices, account data, room
 * memberships), as one JSON object a user can save.
 *
 * Deliberately does NOT include message history: that's a fundamentally
 * different, much larger problem (potentially years of content across every
 * room, E2EE decryption for anything not already loaded locally, and no
 * bulk "give me everything" API a client can call) - excluded on purpose,
 * not an oversight, same honest-scoping choice as automod.ts/slowmode.ts
 * elsewhere in this package.
 */
export async function buildDataExport(client: MatrixClient): Promise<DataExport> {
  const userId = client.getUserId() ?? "";

  const profile = await client
    .getProfileInfo(userId)
    .catch(() => ({}) as { displayname?: string; avatar_url?: string });

  const devices = await client
    .getDevices()
    .then((r) => r.devices)
    .catch(() => []);

  const rooms: DataExportRoom[] = client.getRooms().map((room) => ({
    roomId: room.roomId,
    name: room.name,
    membership: room.getMyMembership(),
    isSpace: room.isSpaceRoom(),
    isDirect: isDirectRoom(room, client),
  }));

  const accountData: Record<string, unknown> = {};
  for (const [type, event] of client.store.accountData) {
    accountData[type] = event.getContent();
  }

  return {
    exportedAt: new Date().toISOString(),
    userId,
    homeserverUrl: client.baseUrl,
    profile: { displayName: profile.displayname, avatarUrl: profile.avatar_url },
    devices: devices.map((d) => ({
      deviceId: d.device_id,
      displayName: d.display_name,
      lastSeenTs: d.last_seen_ts,
      lastSeenIp: d.last_seen_ip,
    })),
    rooms,
    accountData,
  };
}
