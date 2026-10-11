import { App as CapApp } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  getOwningSpace,
  isDirectRoom,
  type MatrixClient,
  type MatrixEvent,
  MatrixEventEvent,
  type Room,
} from "@jorkonvo/matrix-core";
import { useAuthStore } from "../../state/authStore";
import { useMatrixStore } from "../../state/matrixStore";

/**
 * Push phase 2: the data the native push code needs to show "Sofia: hi" for
 * an event_id_only push while the app is closed - written here while the app
 * runs, into the encrypted native store (Android: PushStore.java, iOS:
 * JorPushCore/PushStore.swift in the App Group, read by the Notification
 * Service Extension).
 *
 * Per the device's preview mode (Settings → Notifications):
 *   full    account (homeserver URL + access token) + Megolm room keys +
 *           room/user names + small avatars -> sender and decrypted text
 *   sender  account + names + avatars, no keys -> "Sofia: New message"
 *   hidden  nothing stored at all -> "New message"
 *
 * Nothing here leaves the device: the native code fetches the event from the
 * homeserver itself and decrypts locally. Documented limit: a Megolm key that
 * arrives while the app is closed isn't exported yet, so that message stays
 * "Encrypted message" until the app has run once.
 */

export type PreviewMode = "full" | "sender" | "hidden";

interface JorPushStorePlugin {
  setAccount(o: { userId: string; homeserverUrl: string; accessToken: string; mode: PreviewMode }): Promise<void>;
  clearAccount(o: { userId: string }): Promise<void>;
  listAccounts(): Promise<{ userIds: string[] }>;
  addRoomKeys(o: { userId: string; sessions: ExportedSession[] }): Promise<{ count: number }>;
  listSessionIds(o: { userId: string }): Promise<{ sessionIds: string[] }>;
  clearRoomKeys(o: { userId: string }): Promise<void>;
  setDirectory(o: { userId: string; directory: Directory }): Promise<void>;
  putAvatar(o: { userId: string; key: string; pngBase64: string }): Promise<void>;
}

interface ExportedSession {
  room_id: string;
  session_id: string;
  session_key: string;
}

interface Directory {
  rooms: Record<string, { n: string; dm: boolean; s?: string }>;
  users: Record<string, string>;
}

const JorPushStore = registerPlugin<JorPushStorePlugin>("JorPushStore");

const MODE_KEY = "jk.push.previewMode";
const avatarMapKey = (userId: string) => `jk.push.avatars.${userId}`;
const KEY_CHUNK = 250;
const AVATAR_SIZE = 96;
/** Recent timeline events per room whose senders get a name + avatar. */
const RECENT_EVENTS = 40;
const AVATARS_PER_RUN = 80;

/** The native apps (the web's service worker resolves nothing on its own). */
export function isNativeStoreSupported(): boolean {
  const p = Capacitor.getPlatform();
  return p === "android" || p === "ios";
}

export function getPreviewMode(): PreviewMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "sender" || v === "hidden" ? v : "full";
  } catch {
    return "full";
  }
}

export async function setPreviewMode(client: MatrixClient, mode: PreviewMode): Promise<void> {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* falls back to "full" next launch */
  }
  sentSessions.clear();
  // Surfaced in the settings UI: a store that can't be written (Keychain,
  // App Group) would otherwise look exactly like "hidden".
  await syncNativeStore(client, { directory: true, rethrow: true });
}

/** Session ids already in the native store, per account (seeded from it once). */
const sentSessions = new Map<string, Set<string>>();

async function knownSessions(userId: string): Promise<Set<string>> {
  let set = sentSessions.get(userId);
  if (!set) {
    const { sessionIds } = await JorPushStore.listSessionIds({ userId });
    set = new Set(sessionIds);
    sentSessions.set(userId, set);
  }
  return set;
}

async function exportKeys(client: MatrixClient, userId: string): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) return;
  const known = await knownSessions(userId);
  const fresh: ExportedSession[] = (await crypto.exportRoomKeys())
    .filter((k) => k.algorithm === "m.megolm.v1.aes-sha2" && !known.has(k.session_id))
    .map((k) => ({ room_id: k.room_id, session_id: k.session_id, session_key: k.session_key }));
  for (let i = 0; i < fresh.length; i += KEY_CHUNK) {
    const chunk = fresh.slice(i, i + KEY_CHUNK);
    await JorPushStore.addRoomKeys({ userId, sessions: chunk });
    for (const s of chunk) known.add(s.session_id);
  }
}

function buildDirectory(client: MatrixClient): { directory: Directory; avatars: Map<string, string> } {
  const directory: Directory = { rooms: {}, users: {} };
  const avatars = new Map<string, string>(); // "u:@id" / "r:!id" -> mxc
  const me = client.getUserId();
  const addUser = (room: Room, userId: string | undefined) => {
    if (!userId || userId === me || directory.users[userId]) return;
    const member = room.getMember(userId);
    if (!member) return;
    directory.users[userId] = member.name;
    const mxc = member.getMxcAvatarUrl();
    if (mxc) avatars.set(`u:${userId}`, mxc);
  };

  for (const room of client.getRooms()) {
    if (room.getMyMembership() !== "join") continue;
    const roomAvatar = room.getMxcAvatarUrl();
    if (roomAvatar) avatars.set(`r:${room.roomId}`, roomAvatar);
    if (room.isSpaceRoom()) continue;
    const dm = isDirectRoom(room, client);
    const space = dm ? null : getOwningSpace(client, room.roomId);
    directory.rooms[room.roomId] = { n: room.name, dm, ...(space ? { s: space.roomId } : {}) };
    if (dm) {
      for (const m of room.getJoinedMembers()) addUser(room, m.userId);
    }
    const events = room.getLiveTimeline().getEvents();
    for (const ev of events.slice(-RECENT_EVENTS)) addUser(room, ev.getSender());
  }
  return { directory, avatars };
}

/** Downloads a thumbnail and turns it into a small circular PNG (base64). */
async function circularPng(client: MatrixClient, mxc: string): Promise<string | null> {
  const url = client.mxcUrlToHttp(mxc, AVATAR_SIZE, AVATAR_SIZE, "crop", false, false, true);
  if (!url) return null;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${client.getAccessToken() ?? ""}` } });
  if (!res.ok) return null;
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.beginPath();
  ctx.arc(AVATAR_SIZE / 2, AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(bitmap, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  return canvas.toDataURL("image/png").split(",")[1] ?? null;
}

async function syncAvatars(client: MatrixClient, userId: string, avatars: Map<string, string>): Promise<void> {
  let written: Record<string, string> = {};
  try {
    written = JSON.parse(localStorage.getItem(avatarMapKey(userId)) ?? "{}") as Record<string, string>;
  } catch {
    /* start over */
  }
  let budget = AVATARS_PER_RUN;
  for (const [key, mxc] of avatars) {
    if (written[key] === mxc) continue;
    if (budget-- <= 0) break; // the rest next run
    try {
      const png = await circularPng(client, mxc);
      if (!png) continue;
      await JorPushStore.putAvatar({ userId, key, pngBase64: png });
      written[key] = mxc;
    } catch {
      /* one bad image shouldn't stop the rest */
    }
  }
  try {
    localStorage.setItem(avatarMapKey(userId), JSON.stringify(written));
  } catch {
    /* re-downloads next time */
  }
}

let running: Promise<void> | null = null;

/**
 * Brings the native store in line with the active account + preview mode.
 * `directory: false` = the cheap path (account + new keys only), used when
 * backgrounding and after new sessions show up. Failures are only logged,
 * unless `rethrow` (a user action that should show the error).
 */
export function syncNativeStore(client: MatrixClient, opts: { directory: boolean; rethrow?: boolean }): Promise<void> {
  if (!isNativeStoreSupported()) return Promise.resolve();
  const run = async () => {
    const userId = client.getUserId();
    const token = client.getAccessToken();
    if (!userId || !token) return;
    const mode = getPreviewMode();
    if (mode === "hidden") {
      await JorPushStore.clearAccount({ userId });
      sentSessions.delete(userId);
      try {
        localStorage.removeItem(avatarMapKey(userId));
      } catch {
        /* ignore */
      }
      return;
    }
    await JorPushStore.setAccount({ userId, homeserverUrl: client.getHomeserverUrl(), accessToken: token, mode });
    if (mode === "full") await exportKeys(client, userId);
    else {
      await JorPushStore.clearRoomKeys({ userId });
      sentSessions.set(userId, new Set());
    }
    if (opts.directory) {
      const { directory, avatars } = buildDirectory(client);
      await JorPushStore.setDirectory({ userId, directory });
      await syncAvatars(client, userId, avatars);
    }
  };
  // One sync at a time; a request during a run queues behind it.
  const next = (running ?? Promise.resolve()).then(run, run);
  running = next.catch((err: unknown) => console.warn("[push] native store sync failed", err));
  return opts.rethrow ? next : running;
}

/** Push turned off on this device: nothing needs to stay in the native store. */
export async function clearNativeStore(userId: string): Promise<void> {
  if (!isNativeStoreSupported()) return;
  sentSessions.delete(userId);
  try {
    localStorage.removeItem(avatarMapKey(userId));
  } catch {
    /* ignore */
  }
  await JorPushStore.clearAccount({ userId });
}

/** Drops stored data of accounts that are no longer signed in on this device. */
async function pruneSignedOutAccounts(): Promise<void> {
  const signedIn = new Set(useAuthStore.getState().accounts.map((a) => a.userId));
  const { userIds } = await JorPushStore.listAccounts();
  for (const id of userIds) {
    if (!signedIn.has(id)) await JorPushStore.clearAccount({ userId: id });
  }
}

/** App-lifetime wiring (called from nativePush.initNativePush). */
export function initNativeStoreSync(): () => void {
  if (!isNativeStoreSupported()) return () => {};

  let wiredClient: MatrixClient | null = null;
  let keyTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleKeySync = () => {
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => {
      const c = useMatrixStore.getState().client;
      if (c) void syncNativeStore(c, { directory: false });
    }, 15_000);
  };
  // A message decrypted with a session we haven't exported yet -> export soon.
  const onDecrypted = (ev: MatrixEvent) => {
    const client = useMatrixStore.getState().client;
    const userId = client?.getUserId();
    const sessionId = ev.getWireContent().session_id as string | undefined;
    if (!userId || !sessionId || getPreviewMode() !== "full") return;
    if (!sentSessions.get(userId)?.has(sessionId)) scheduleKeySync();
  };

  const wire = () => {
    const client = useMatrixStore.getState().client;
    if (useAuthStore.getState().status !== "ready" || !client || client === wiredClient) return;
    wiredClient?.off(MatrixEventEvent.Decrypted, onDecrypted);
    wiredClient = client;
    client.on(MatrixEventEvent.Decrypted, onDecrypted);
    void pruneSignedOutAccounts().catch(() => {});
    // Let the first sync settle before the full pass.
    setTimeout(() => void syncNativeStore(client, { directory: true }), 8_000);
  };
  wire();
  // Sign-out (also of the last account, when no client gets wired again).
  const unsubAccounts = useAuthStore.subscribe((s, prev) => {
    if (s.accounts !== prev.accounts) void pruneSignedOutAccounts().catch(() => {});
  });
  const unsubAuth = useAuthStore.subscribe(wire);
  const unsubMatrix = useMatrixStore.subscribe(wire);

  const refresh = setInterval(() => {
    const c = useMatrixStore.getState().client;
    if (c && useAuthStore.getState().status === "ready") void syncNativeStore(c, { directory: true });
  }, 10 * 60_000);
  const appState = CapApp.addListener("appStateChange", ({ isActive }) => {
    const c = useMatrixStore.getState().client;
    // Going to the background: flush fresh keys + the current token.
    if (!isActive && c) void syncNativeStore(c, { directory: false });
  });

  return () => {
    clearTimeout(keyTimer);
    clearInterval(refresh);
    wiredClient?.off(MatrixEventEvent.Decrypted, onDecrypted);
    unsubAccounts();
    unsubAuth();
    unsubMatrix();
    void appState.then((h) => h.remove());
  };
}
