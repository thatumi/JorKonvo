import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";

/**
 * A generic, app-agnostic carrier for the web client's local (localStorage)
 * preferences - theme, wallpaper, notification sound, etc. - so they can
 * follow the account across devices/browsers instead of being stuck to
 * whichever browser last set them. This package doesn't know or care what
 * the individual settings mean; it just round-trips whatever string map the
 * caller hands it through the user's own account data.
 */
const CLIENT_SETTINGS_ACCOUNT_DATA = "io.jorkonvo.client_settings";

type LooseGetAccountData = (eventType: string) => MatrixEvent | undefined;
type LooseSetAccountData = (eventType: string, content: unknown) => Promise<unknown>;

export interface ClientSettingsSnapshot {
  settings: Record<string, string>;
  /** Epoch ms this snapshot was saved - lets a device tell whether the
   *  account's copy is newer than whatever it last applied/pushed itself,
   *  without needing any server-side ordering guarantee beyond "the account
   *  data's current content is whatever was set last". */
  updatedAt: number;
}

export async function saveClientSettingsSnapshot(
  client: MatrixClient,
  settings: Record<string, string>,
): Promise<number> {
  const updatedAt = Date.now();
  await (client.setAccountData as unknown as LooseSetAccountData)(CLIENT_SETTINGS_ACCOUNT_DATA, {
    settings,
    updatedAt,
  });
  return updatedAt;
}

/** Returns null if this account has never saved a snapshot from any device. */
export function getClientSettingsSnapshot(client: MatrixClient): ClientSettingsSnapshot | null {
  const ev = (client.getAccountData as unknown as LooseGetAccountData)(CLIENT_SETTINGS_ACCOUNT_DATA);
  const content = ev?.getContent<Partial<ClientSettingsSnapshot>>();
  if (!content?.settings) return null;
  return { settings: content.settings, updatedAt: content.updatedAt ?? 0 };
}
