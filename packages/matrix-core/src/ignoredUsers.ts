import type { MatrixClient } from "matrix-js-sdk";

export function isUserIgnored(client: MatrixClient, userId: string): boolean {
  return client.isUserIgnored(userId);
}

export function getIgnoredUserIds(client: MatrixClient): string[] {
  return client.getIgnoredUsers();
}

export async function setUserIgnored(client: MatrixClient, userId: string, ignored: boolean): Promise<void> {
  const current = new Set(client.getIgnoredUsers());
  if (ignored) current.add(userId);
  else current.delete(userId);
  await client.setIgnoredUsers([...current]);
}
