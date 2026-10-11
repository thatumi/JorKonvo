import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";

/**
 * Private per-user notes - visible only to you, synced across your own
 * devices via account data (same reasoning as friends.ts). The other person
 * never sees these; this is purely "how do I remember this person".
 */
const ACCOUNT_DATA_EVENT = "io.jorkonvo.user_notes";

type LooseGetAccountData = (eventType: string) => MatrixEvent | undefined;
type LooseSetAccountData = (eventType: string, content: unknown) => Promise<unknown>;

function readAll(client: MatrixClient): Record<string, string> {
  const ev = (client.getAccountData as unknown as LooseGetAccountData)(ACCOUNT_DATA_EVENT);
  return ev?.getContent<{ notes?: Record<string, string> }>().notes ?? {};
}

export function getUserNote(client: MatrixClient, userId: string): string {
  return readAll(client)[userId] ?? "";
}

export async function setUserNote(client: MatrixClient, userId: string, note: string): Promise<void> {
  const all = readAll(client);
  const trimmed = note.trim();
  if (trimmed) all[userId] = trimmed;
  else delete all[userId];
  await (client.setAccountData as unknown as LooseSetAccountData)(ACCOUNT_DATA_EVENT, { notes: all });
}
