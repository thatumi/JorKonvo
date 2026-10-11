import type { MatrixClient, MatrixEvent } from "matrix-js-sdk";

/**
 * Per-listener call audio preferences for other users - how loud they sound
 * to YOU, and whether you've locally muted their mic or soundboard triggers.
 * Entirely one-sided (the target never knows), and synced via account data
 * so it follows you across your own devices, same reasoning as the friends
 * list in friends.ts.
 */
const ACCOUNT_DATA_EVENT = "io.jorkonvo.user_call_prefs";

export const USER_VOLUME_MIN = 0;
export const USER_VOLUME_MAX = 150;
export const USER_VOLUME_DEFAULT = 100;

export interface UserCallPrefs {
  /** 0-150, percent - 100 is unchanged, 150 is +50% amplified, 0 is silent. */
  volume: number;
  /** Locally silences their mic for you, independent of `volume` (Discord-style quick mute that doesn't discard your chosen volume). */
  muted: boolean;
  /** Locally silences just soundboard triggers from them, independent of the above. */
  mutedSoundboard: boolean;
}

const DEFAULT_PREFS: UserCallPrefs = { volume: USER_VOLUME_DEFAULT, muted: false, mutedSoundboard: false };

type LooseGetAccountData = (eventType: string) => MatrixEvent | undefined;
type LooseSetAccountData = (eventType: string, content: unknown) => Promise<unknown>;

function readAll(client: MatrixClient): Record<string, Partial<UserCallPrefs>> {
  const ev = (client.getAccountData as unknown as LooseGetAccountData)(ACCOUNT_DATA_EVENT);
  return ev?.getContent<{ users?: Record<string, Partial<UserCallPrefs>> }>().users ?? {};
}

async function writeAll(client: MatrixClient, users: Record<string, Partial<UserCallPrefs>>): Promise<void> {
  await (client.setAccountData as unknown as LooseSetAccountData)(ACCOUNT_DATA_EVENT, { users });
}

export function getUserCallPrefs(client: MatrixClient, userId: string): UserCallPrefs {
  const raw = readAll(client)[userId];
  const volume =
    typeof raw?.volume === "number" && raw.volume >= USER_VOLUME_MIN && raw.volume <= USER_VOLUME_MAX
      ? raw.volume
      : DEFAULT_PREFS.volume;
  return { volume, muted: raw?.muted ?? DEFAULT_PREFS.muted, mutedSoundboard: raw?.mutedSoundboard ?? DEFAULT_PREFS.mutedSoundboard };
}

export async function setUserCallPrefs(client: MatrixClient, userId: string, patch: Partial<UserCallPrefs>): Promise<void> {
  const all = readAll(client);
  await writeAll(client, { ...all, [userId]: { ...getUserCallPrefs(client, userId), ...patch } });
}
