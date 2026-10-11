import type { MatrixClient } from "matrix-js-sdk";

const ACTIVITY_KEY = "io.jorkonvo.activity";
// Unlike the voice-channel "who's in" heartbeat (which has no reliable
// disconnect signal at all), the desktop app DOES get a clean "the game's
// socket closed" event and pushes a clearing update immediately - but if
// the whole machine crashes/sleeps/loses network before that clear can be
// sent, the last-published activity would otherwise sit there forever.
// The desktop-side wiring re-touches updatedAt periodically while an
// activity is active (see richPresence.ts); a reader older than this is
// treated as no longer accurate, the same honesty already applied to
// voiceChannels.ts's presence entries.
const ACTIVITY_STALE_MS = 5 * 60 * 1000;

/**
 * Discord Rich Presence-style "Playing X" status - published via the same
 * MSC4133 extended-profile mechanism as bio/banner (see profile.ts), so
 * it's readable by anyone, not just people sharing a room. The desktop app
 * (apps/desktop) is what actually populates this, by reimplementing
 * Discord's own local Rich Presence IPC protocol so games that already
 * integrate Discord's Game SDK report to JorKonvo too - see
 * apps/desktop/src/discordRpcServer.ts for the full explanation of what
 * that does and doesn't cover. This module only knows about the RESULT
 * (a plain JSON blob on the user's profile), not how it got there - the
 * web build can read/display someone else's activity same as anyone else's
 * profile field, it just has no way to ever SET one for itself.
 */
export interface ActivityStatus {
  applicationId: string;
  appName: string | null;
  details?: string;
  state?: string;
  largeImageText?: string;
  smallImageText?: string;
  startedAt?: number;
  partyCurrent?: number;
  partyMax?: number;
  updatedAt: number;
}

export async function getActivity(client: MatrixClient, userId: string): Promise<ActivityStatus | null> {
  try {
    const value = await client.getExtendedProfileProperty(userId, ACTIVITY_KEY);
    if (!value || typeof value !== "object") return null;
    const activity = value as ActivityStatus;
    if (typeof activity.applicationId !== "string") return null;
    if (typeof activity.updatedAt !== "number" || Date.now() - activity.updatedAt > ACTIVITY_STALE_MS) return null;
    return activity;
  } catch {
    return null;
  }
}

export async function setActivity(client: MatrixClient, activity: Omit<ActivityStatus, "updatedAt"> | null): Promise<void> {
  if (!activity) {
    await client.deleteExtendedProfileProperty(ACTIVITY_KEY).catch(() => undefined);
    return;
  }
  await client.setExtendedProfileProperty(ACTIVITY_KEY, { ...activity, updatedAt: Date.now() });
}
