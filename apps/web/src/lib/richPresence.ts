import { type ActivityStatus, type MatrixClient, setActivity } from "@jorkonvo/matrix-core";
import { isActivitySharingEnabled } from "./activityPrivacy";

/**
 * Bridges the desktop app's Discord Rich Presence-compatible local server
 * (apps/desktop/src/discordRpcServer.ts) into the account's Matrix profile
 * (activity.ts). Only ever does anything inside the Electron build - a
 * plain browser tab has no `window.jorkonvoDesktop` (the preload bridge
 * that injects it doesn't exist there), so this is a silent, correct no-op
 * on the web, exactly like the rest of this file's desktop-only siblings.
 */

interface DesktopRpcActivity {
  applicationId: string;
  appName: string | null;
  details?: string;
  state?: string;
  largeImageText?: string;
  smallImageText?: string;
  startedAt?: number;
  partyCurrent?: number;
  partyMax?: number;
}

declare global {
  interface Window {
    jorkonvoDesktop?: {
      platform: string;
      gpu?: unknown; // Linux only, typed in components/GpuSettingsSection.tsx
      onActivityUpdate?: (callback: (activity: DesktopRpcActivity | null) => void) => () => void;
    };
  }
}

// A game's Rich Presence connection doesn't re-send SET_ACTIVITY on any
// fixed schedule (it only sends again when the game's OWN state changes),
// so without a heartbeat here a genuinely-still-playing game's activity
// would drift past activity.ts's staleness cutoff and quietly vanish from
// other people's view. Re-touching updatedAt periodically while a
// connection is live keeps it fresh; the cutoff (5 min, see activity.ts)
// stays there to handle the machine vanishing without a clean disconnect.
const REFRESH_INTERVAL_MS = 2 * 60 * 1000;

export function wireRichPresence(client: MatrixClient): () => void {
  const onActivityUpdate = window.jorkonvoDesktop?.onActivityUpdate;
  if (!onActivityUpdate) return () => undefined;

  let current: Omit<ActivityStatus, "updatedAt"> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  function stopRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function publish() {
    // "Share my activity" off -> never put anything on the profile (and
    // actively clear whatever's there).
    void setActivity(client, isActivitySharingEnabled() ? current : null).catch(() => undefined);
  }

  const unsubscribe = onActivityUpdate((activity) => {
    stopRefresh();
    current = activity;
    publish();
    if (current) refreshTimer = setInterval(publish, REFRESH_INTERVAL_MS);
  });

  return () => {
    unsubscribe();
    stopRefresh();
    // Best-effort: if the account is switching/logging out while a game is
    // still "active", don't leave a stale activity behind on the profile.
    if (current) void setActivity(client, null).catch(() => undefined);
  };
}
