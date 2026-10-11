import { MatrixError, type MatrixClient } from "matrix-js-sdk";

export interface DeviceInfo {
  deviceId: string;
  displayName: string;
  lastSeenIp?: string;
  lastSeenTs?: number;
  isCurrent: boolean;
}

export async function listDevices(client: MatrixClient): Promise<DeviceInfo[]> {
  const { devices } = await client.getDevices();
  const currentId = client.getDeviceId();
  return devices
    .map((d) => ({
      deviceId: d.device_id,
      displayName: d.display_name || d.device_id,
      lastSeenIp: d.last_seen_ip,
      lastSeenTs: d.last_seen_ts,
      isCurrent: d.device_id === currentId,
    }))
    .sort((a, b) => (b.isCurrent ? 1 : 0) - (a.isCurrent ? 1 : 0) || (b.lastSeenTs ?? 0) - (a.lastSeenTs ?? 0));
}

export async function renameDevice(client: MatrixClient, deviceId: string, displayName: string): Promise<void> {
  await client.setDeviceDetails(deviceId, { display_name: displayName });
}

/**
 * Deleting a device is gated behind User-Interactive Auth on most
 * homeservers - a bare call gets a 401 naming the session id to retry
 * with. Returns that session id when a password re-confirmation is
 * needed; returns null when the server allowed it outright (no UIA).
 */
export async function deleteDeviceOrRequireAuth(client: MatrixClient, deviceId: string): Promise<string | null> {
  try {
    await client.deleteDevice(deviceId);
    return null;
  } catch (err) {
    if (err instanceof MatrixError && err.data?.session && err.data?.flows) {
      return err.data.session as string;
    }
    throw err;
  }
}

export async function deleteDeviceWithPassword(
  client: MatrixClient,
  deviceId: string,
  userId: string,
  password: string,
  session: string,
): Promise<void> {
  await client.deleteDevice(deviceId, {
    type: "m.login.password",
    identifier: { type: "m.id.user", user: userId },
    password,
    session,
  });
}
