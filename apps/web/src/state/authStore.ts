import {
  ClientEvent,
  createRestoredClient,
  ensurePushRules,
  getCrossSigningStatus,
  initCrypto,
  LocalStorageSessionStorage,
  loginWithPassword,
  registerAccount,
  registerGuest,
  logoutClient,
  type MatrixClient,
  MatrixEventEvent,
  RoomEvent,
  RoomMemberEvent,
  getGlobalUnreadSummary,
  seedUnreadFromServer,
  startClient,
  type StoredSession,
  watchAutoMod,
  watchFriendEvents,
  watchPolicyLists,
  watchReactionRoles,
  watchChannelAccess,
  watchDmInvitePrivacy,
  watchMemberJoins,
  watchTimedMutes,
  watchUserTimeouts,
  watchUnread,
} from "@jorkonvo/matrix-core";
import type { QrLoginSecrets } from "@jorkonvo/matrix-core/qr";
import { MatrixError } from "matrix-js-sdk";
import { create } from "zustand";
import { wireCalendarReminders } from "../lib/calendarReminders";
import { applyBadgeCount } from "../lib/desktopBadge";
import { wireIdlePresence } from "../lib/idlePresence";
import { wireRichPresence } from "../lib/richPresence";
import { wireSettingsAutoSync } from "../lib/settingsBackup";
import { wireSoundboardPlayback } from "../lib/soundboardPlayback";
import { useGroupCallStore } from "./groupCallStore";
import { useMatrixStore } from "./matrixStore";
import { useModalStore } from "./modalStore";
import { useProfileStore } from "./profileStore";
import { useUiStore } from "./uiStore";

const AUTH_FAILURE_ERRCODES = new Set(["M_UNKNOWN_TOKEN", "M_MISSING_TOKEN", "M_FORBIDDEN"]);

/** True only for errors that mean the stored credentials are actually invalid. */
function isAuthFailure(err: unknown): boolean {
  if (!(err instanceof MatrixError)) return false;
  if (err.httpStatus === 401) return true;
  return Boolean(err.errcode && AUTH_FAILURE_ERRCODES.has(err.errcode));
}

export type AuthStatus =
  | "checking"
  | "loggedOut"
  | "loggingIn"
  | "ready"
  | "error"
  | "restoreFailed";

interface AuthState {
  status: AuthStatus;
  error: string | null;
  /** All stored accounts (Discord/Element-style switcher), for rendering the account rail. */
  accounts: StoredSession[];
  activeUserId: string | null;
  switching: boolean;
  restore: () => Promise<void>;
  login: (homeserverUrl: string, userId: string, password: string) => Promise<void>;
  /** Registers a throwaway guest session on the homeserver and boots it (no crypto). */
  guestLogin: (homeserverUrl: string) => Promise<void>;
  /** Registers a brand-new full (non-guest) account and boots it, same as a fresh login. */
  register: (homeserverUrl: string, username: string, password: string, registrationToken?: string) => Promise<void>;
  /** Logs into a SECOND (or further) account without disturbing the ones already stored, then switches to it. */
  addAccount: (homeserverUrl: string, userId: string, password: string) => Promise<void>;
  /** Persists an already-completed QR sign-in (see qrLoginStore.ts) as a new account and boots it, importing the shared E2EE secrets bundle if one was received. */
  loginWithQrSession: (session: StoredSession, secrets: QrLoginSecrets | undefined) => Promise<void>;
  switchAccount: (userId: string) => Promise<void>;
  /** Signs the given account out entirely (server-side logout + removes it from the stored list). */
  removeAccount: (userId: string) => Promise<void>;
  /** Signs the CURRENTLY ACTIVE account out - kept for existing call sites (logout buttons). */
  logout: () => Promise<void>;
}

const sessionStore = new LocalStorageSessionStorage();

// The in-flight (or completed) boot of the restored client. Kept non-null
// after a successful boot so repeat restore() calls are no-ops; reset on
// logout/failure so the next session can boot. See restore() below.
let bootInFlight: Promise<void> | null = null;

// Cleanup for whichever account is CURRENTLY booted (window-level idle
// listeners, client-level friend-event listener) - run before switching to
// another account or logging out, so switching accounts repeatedly doesn't
// pile up duplicate listeners bound to stopped clients.
let activeCleanup: (() => void) | null = null;

function sanitizeForDbName(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * After a successful boot, decides whether this device needs to do
 * something about its encryption identity, Discord-onboarding-style rather
 * than leaving it to be discovered by accident in Settings later:
 *   - nothing set up ANYWHERE for this account yet -> safe to create a
 *     fresh identity and reveal the recovery key (no existing trust to
 *     orphan). `knownPassword`, when the caller already has it in memory
 *     (a login/register form that just succeeded), skips re-prompting.
 *   - an identity exists elsewhere but this device lacks the keys (the
 *     normal "new device for an existing account" case) -> offer entering
 *     the recovery key or verifying from another signed-in device. Never
 *     creates a fresh identity here - that would reset trust for every
 *     other device/user, a much worse outcome than a bit of onboarding
 *     friction.
 *   - this device already has everything -> no interruption at all.
 */
async function runPostAuthKeySetup(client: MatrixClient, knownPassword?: string): Promise<void> {
  const status = await getCrossSigningStatus(client).catch(() => null);
  if (!status || status.privateKeysCachedLocally) return;
  if (!status.publicKeysOnDevice && !status.privateKeysInSecretStorage) {
    useModalStore.getState().open({ type: "firstLoginSecurity", mode: "create", knownPassword });
  } else {
    useModalStore.getState().open({ type: "firstLoginSecurity", mode: "restore" });
  }
}

function wireClientEvents(client: MatrixClient): void {
  // syncTick is a single global counter that ~30 components across the app
  // subscribe to, so every bump fans out into a re-render cascade well
  // beyond whatever one event actually changed. Typing/Receipt/Timeline
  // events in particular can fire many times a second (several people
  // typing at once, a fast-scrolling backlog) - bumping synchronously per
  // event turns ordinary chat activity into a steady stream of full-app
  // re-renders. Coalescing to at most one bump per animation frame (the
  // same trick already used for Decrypted below) loses no information for
  // any consumer, since they all just re-derive current state from the
  // client on the next render.
  let bumpScheduled = false;
  const bump = () => {
    if (bumpScheduled) return;
    bumpScheduled = true;
    requestAnimationFrame(() => {
      bumpScheduled = false;
      useMatrixStore.getState().bumpTick();
    });
  };
  client.on(ClientEvent.Sync, bump);
  client.on(ClientEvent.Room, bump);
  client.on(ClientEvent.AccountData, bump);
  client.on(RoomEvent.Timeline, bump);
  client.on(RoomEvent.LocalEchoUpdated, bump);
  client.on(RoomEvent.Name, bump);
  client.on(RoomEvent.MyMembership, bump);
  client.on(RoomEvent.Receipt, bump);
  client.on(RoomEvent.Tags, bump);
  client.on(RoomMemberEvent.Membership, bump);
  client.on(RoomMemberEvent.Typing, bump);
  // In E2EE rooms a freshly-arrived message decrypts in the background and
  // the SDK does NOT re-emit RoomEvent.Timeline once it does (only its own
  // per-event Decrypted event fires, reEmitted onto the client). Without this
  // the timeline, unread badges and read receipts can all miss the message
  // until some unrelated event happens to trigger a re-render.
  client.on(MatrixEventEvent.Decrypted, bump);
  // Note: ThreadEvent.* is emitted on individual Room/Thread instances, not
  // re-emitted onto the client - but thread replies are still ordinary
  // m.room.message events that also flow through RoomEvent.Timeline above,
  // so the sync-tick bump still happens correctly without a per-room listener.
}

async function bootClient(
  client: MatrixClient,
  session: StoredSession,
  afterCryptoInit?: () => Promise<void>,
  skipCrypto = false,
): Promise<void> {
  wireClientEvents(client);
  useMatrixStore.getState().setClient(client);
  // Guests can't do E2EE (no recovery, no cross-signing) and the crypto
  // bootstrap can fail outright for a guest account - just skip it.
  if (!skipCrypto) {
    // initCrypto can self-heal onto a different prefix than requested (see
    // its own doc comment) - write back whatever it actually used so a
    // caller that persists `session` doesn't keep retrying the failing one
    // on every future login.
    session.cryptoDatabasePrefix = await initCrypto(client, session.cryptoDatabasePrefix);
  }
  // Only used by the QR sign-in flow, to import the E2EE secrets bundle
  // shared by the existing device - has to happen after crypto is
  // initialised but before the sync loop starts relying on it.
  await afterCryptoInit?.();
  await startClient(client);
  useMatrixStore.getState().setReady(true);
  void useProfileStore.getState().refresh(client);
  const unwatchFriends = watchFriendEvents(client);

  // Mention badges are computed client-side (see unread.ts) - the server can't
  // see m.mentions inside E2EE ciphertext. Counters seed from the server's
  // own (coarser) notification counts for messages that arrived while offline.
  const unwatchUnread = watchUnread(client, {
    isRoomVisible: (roomId) =>
      useUiStore.getState().selectedRoomId === roomId && document.visibilityState === "visible",
    onUnreadChange: () => {
      useMatrixStore.getState().bumpTick();
      // Discord's app-icon unread badge (desktop shell only - a no-op in a tab).
      applyBadgeCount(getGlobalUnreadSummary(client).mentionCount);
    },
  });
  void ensurePushRules(client);
  const unwireIdlePresence = wireIdlePresence(client);
  // Discord Rich Presence bridge - a genuine no-op outside the Electron
  // build (see richPresence.ts).
  const unwireRichPresence = wireRichPresence(client);
  const unwireCalendarReminders = wireCalendarReminders(client);
  const unwireSoundboardPlayback = wireSoundboardPlayback(client);
  const unwireSettingsAutoSync = wireSettingsAutoSync(client);
  // Best-effort AutoMod (see automod.ts for why this can only ever be
  // "catches it if a permitted client happens to be open", not real
  // enforcement) - runs for every account, but only actually redacts in
  // rooms where THIS account can redact others' messages.
  const unwatchAutoMod = watchAutoMod(client);
  // Best-effort moderation policy list (MSC2313) enforcement - see
  // policyLists.ts for the same "only while a permitted client is online"
  // honesty already applied to AutoMod/slowmode.
  const unwatchPolicyLists = watchPolicyLists(client);
  // Best-effort reaction-role enforcement (see reactionRoles.ts) - same "only while a permitted client is online" honesty.
  const unwatchReactionRoles = watchReactionRoles(client);
  // Timed-mute expiry (see timedMute.ts) - same "only while a client is open" honesty.
  const unwatchTimedMutes = watchTimedMutes(client);
  // Member-timeout expiry (see userTimeout.ts) - restores power levels when a
  // "time out" runs out; same best-effort honesty.
  const unwatchUserTimeouts = watchUserTimeouts(client);
  // Role-gated ("private") channel membership sync + auto-join of space-child
  // invites (see channelAccess.ts) - same best-effort honesty.
  const unwatchChannelAccess = watchChannelAccess(client);
  // Discord-style "welcome message posted when someone joins" (see
  // welcomeMessages.ts) - same best-effort, only-while-a-client-is-open honesty.
  const unwatchMemberJoins = watchMemberJoins(client);
  // Discord-style per-space "allow DMs from members of this server" - enforced
  // recipient-side (auto-declines a blocked DM invite), same best-effort,
  // only-while-a-client-is-open honesty (see spacePrivacy.ts).
  const unwatchDmInvitePrivacy = watchDmInvitePrivacy(client);
  // Once the first sync brought the rooms in, fold the server-side counts in.
  client.once(ClientEvent.Sync, (state) => {
    if (state === "PREPARED") {
      seedUnreadFromServer(client);
      applyBadgeCount(getGlobalUnreadSummary(client).mentionCount);
    }
  });

  activeCleanup = () => {
    unwatchFriends();
    unwatchUnread();
    unwireIdlePresence();
    unwireRichPresence();
    unwireCalendarReminders();
    unwireSoundboardPlayback();
    unwireSettingsAutoSync();
    unwatchAutoMod();
    unwatchPolicyLists();
    unwatchReactionRoles();
    unwatchTimedMutes();
    unwatchUserTimeouts();
    unwatchChannelAccess();
    unwatchMemberJoins();
    unwatchDmInvitePrivacy();
    applyBadgeCount(0);
  };
}

/**
 * Shared by addAccount and the QR sign-in flow: both end up with a freshly
 * obtained StoredSession that needs to be (a) given its own isolated crypto
 * prefix - a QR-signed-in session is, structurally, always "new" the same
 * way a password-added second account is, never the pre-multi-account
 * legacy one - and (b) saved alongside whatever accounts already exist and
 * booted as the new active one.
 */
async function persistAndBootNewAccount(
  session: StoredSession,
  afterCryptoInit?: () => Promise<void>,
  knownPassword?: string,
): Promise<StoredSession[]> {
  session.cryptoDatabasePrefix = `matrix-js-sdk-account-${sanitizeForDbName(session.userId)}`;
  const existing = sessionStore.loadAccounts().filter((a) => a.userId !== session.userId);
  const accounts = [...existing, session];
  sessionStore.saveAccounts(accounts);
  sessionStore.setActiveUserId(session.userId);

  await teardownActiveAccount();
  const client = createRestoredClient(session);
  await bootClient(client, session, afterCryptoInit);
  bootInFlight = Promise.resolve();
  void runPostAuthKeySetup(client, knownPassword);
  return accounts;
}

/** Tears down whatever account is currently active - listeners, then the client's own sync loop - before booting a different one. */
async function teardownActiveAccount(): Promise<void> {
  activeCleanup?.();
  activeCleanup = null;
  // A group call is tied to the outgoing client's LiveKit connection and its
  // Matrix stage-signal listeners - leave it before the client under it disappears.
  const call = useGroupCallStore.getState();
  if (call.room) await call.leave();
  useModalStore.getState().close();
  // Each account has an entirely different room/space list - stale
  // selection would otherwise point at a room/space that doesn't exist (or
  // means something else) for the account being switched to.
  useUiStore.getState().selectSpace(null);
  useUiStore.getState().closeSearch();
  useUiStore.getState().closeThread();
  const client = useMatrixStore.getState().client;
  if (client) client.stopClient();
  useMatrixStore.getState().setClient(null);
  useMatrixStore.getState().setReady(false);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "checking",
  error: null,
  accounts: [],
  activeUserId: null,
  switching: false,

  restore: () => {
    // In React StrictMode (dev) App's mount effect fires twice; without this
    // guard each call would create and start a SECOND client syncing the same
    // account - duplicate unread bumps, duplicate event listeners and two
    // devices' worth of OTK uploads fighting over the same device keys.
    bootInFlight ??= (async () => {
      const accounts = sessionStore.loadAccounts();
      const activeUserId = sessionStore.getActiveUserId();
      const session = accounts.find((a) => a.userId === activeUserId) ?? accounts[0] ?? null;
      set({ accounts, activeUserId: session?.userId ?? null });
      if (!session) {
        set({ status: "loggedOut" });
        bootInFlight = null; // allow a later login/boot
        return;
      }
      set({ status: "checking", error: null });
      try {
        const client = createRestoredClient(session);
        await bootClient(client, session);
        void runPostAuthKeySetup(client);
        set({ status: "ready" });
      } catch (err) {
        bootInFlight = null; // allow retrying from RestoreFailedScreen
        if (isAuthFailure(err)) {
          // The token is genuinely invalid (revoked, expired, wrong device) -
          // no point keeping it around, the user must log in again.
          const remaining = accounts.filter((a) => a.userId !== session.userId);
          sessionStore.saveAccounts(remaining);
          sessionStore.setActiveUserId(remaining[0]?.userId ?? null);
          set({ accounts: remaining, activeUserId: remaining[0]?.userId ?? null, status: "loggedOut", error: (err as Error).message });
        } else {
          // Transient failure (network blip, sync hiccup, etc.) - keep the
          // session so the user isn't forced into a fresh login (which would
          // also mint a new device) just because one attempt failed.
          set({ status: "restoreFailed", error: (err as Error).message });
        }
      }
    })();
    return bootInFlight;
  },

  login: async (homeserverUrl, userId, password) => {
    bootInFlight = null;
    set({ status: "loggingIn", error: null });
    try {
      const session = await loginWithPassword({ homeserverUrl, userId, password });
      const accounts = [session];
      sessionStore.saveAccounts(accounts);
      sessionStore.setActiveUserId(session.userId);
      const client = createRestoredClient(session);
      await bootClient(client, session);
      // bootClient may have self-healed session.cryptoDatabasePrefix (e.g. a
      // leftover default store from a previously logged-out, different
      // account on this device) - persist that correction.
      sessionStore.saveAccounts(accounts);
      bootInFlight = Promise.resolve(); // session is live; restore() must not boot again
      void runPostAuthKeySetup(client, password);
      set({ status: "ready", accounts, activeUserId: session.userId });
    } catch (err) {
      set({ status: "error", error: (err as Error).message });
    }
  },

  guestLogin: async (homeserverUrl) => {
    bootInFlight = null;
    set({ status: "loggingIn", error: null });
    try {
      const guest = await registerGuest(homeserverUrl.trim());
      const session: StoredSession = {
        homeserverUrl: guest.homeserverUrl,
        accessToken: guest.accessToken,
        userId: guest.userId,
        deviceId: guest.deviceId,
        guest: true,
      };
      const accounts = [session];
      sessionStore.saveAccounts(accounts);
      sessionStore.setActiveUserId(session.userId);
      const client = createRestoredClient(session);
      (client as unknown as { setGuest?: (g: boolean) => void }).setGuest?.(true);
      await bootClient(client, session, undefined, true);
      bootInFlight = Promise.resolve();
      set({ status: "ready", accounts, activeUserId: session.userId });
    } catch (err) {
      set({ status: "error", error: (err as Error).message });
    }
  },

  register: async (homeserverUrl, username, password, registrationToken) => {
    bootInFlight = null;
    set({ status: "loggingIn", error: null });
    try {
      const registered = await registerAccount(homeserverUrl.trim(), { username, password, registrationToken });
      const session: StoredSession = {
        homeserverUrl: registered.homeserverUrl,
        accessToken: registered.accessToken,
        userId: registered.userId,
        deviceId: registered.deviceId,
      };
      const accounts = [session];
      sessionStore.saveAccounts(accounts);
      sessionStore.setActiveUserId(session.userId);
      const client = createRestoredClient(session);
      await bootClient(client, session);
      // bootClient may have self-healed session.cryptoDatabasePrefix (e.g. a
      // leftover default store from a previously logged-out, different
      // account on this device) - persist that correction.
      sessionStore.saveAccounts(accounts);
      bootInFlight = Promise.resolve();
      void runPostAuthKeySetup(client, password);
      set({ status: "ready", accounts, activeUserId: session.userId });
    } catch (err) {
      set({ status: "error", error: (err as Error).message });
    }
  },

  addAccount: async (homeserverUrl, userId, password) => {
    set({ switching: true, error: null });
    try {
      const session = await loginWithPassword({ homeserverUrl, userId, password });
      const accounts = await persistAndBootNewAccount(session, undefined, password);
      set({ status: "ready", accounts, activeUserId: session.userId, switching: false });
    } catch (err) {
      set({ switching: false, error: (err as Error).message });
      throw err;
    }
  },

  loginWithQrSession: async (session, secrets) => {
    set({ switching: true, error: null });
    try {
      const accounts = await persistAndBootNewAccount(session, async () => {
        const client = useMatrixStore.getState().client;
        if (client && secrets) {
          const { importQrLoginSecrets } = await import("@jorkonvo/matrix-core/qr");
          await importQrLoginSecrets(client, secrets);
        }
      });
      set({ status: "ready", accounts, activeUserId: session.userId, switching: false });
    } catch (err) {
      set({ switching: false, error: (err as Error).message });
      throw err;
    }
  },

  switchAccount: async (userId) => {
    if (userId === get().activeUserId || get().switching) return;
    const accounts = sessionStore.loadAccounts();
    const session = accounts.find((a) => a.userId === userId);
    if (!session) return;
    set({ switching: true, error: null });
    try {
      await teardownActiveAccount();
      sessionStore.setActiveUserId(userId);
      const client = createRestoredClient(session);
      await bootClient(client, session);
      bootInFlight = Promise.resolve();
      void runPostAuthKeySetup(client);
      set({ status: "ready", activeUserId: userId, switching: false });
    } catch (err) {
      set({ switching: false, status: "restoreFailed", error: (err as Error).message });
    }
  },

  removeAccount: async (userId) => {
    const wasActive = userId === get().activeUserId;
    const accounts = sessionStore.loadAccounts();
    const target = accounts.find((a) => a.userId === userId);
    const remaining = accounts.filter((a) => a.userId !== userId);

    if (wasActive) {
      const client = useMatrixStore.getState().client;
      if (client) await logoutClient(client);
      await teardownActiveAccount();
    } else if (target) {
      // Not the active account - no live client to log out through, but the
      // server-side session should still be revoked, not just forgotten locally.
      try {
        const client = createRestoredClient(target);
        await logoutClient(client);
      } catch {
        // best-effort - still remove it locally either way
      }
    }

    sessionStore.saveAccounts(remaining);
    bootInFlight = null;

    if (!wasActive) {
      set({ accounts: remaining });
      return;
    }

    const next = remaining[0] ?? null;
    sessionStore.setActiveUserId(next?.userId ?? null);
    if (!next) {
      set({ accounts: remaining, activeUserId: null, status: "loggedOut", error: null });
      return;
    }
    set({ switching: true });
    try {
      const client = createRestoredClient(next);
      await bootClient(client, next);
      bootInFlight = Promise.resolve();
      set({ accounts: remaining, activeUserId: next.userId, status: "ready", switching: false });
    } catch (err) {
      set({ accounts: remaining, activeUserId: next.userId, switching: false, status: "restoreFailed", error: (err as Error).message });
    }
  },

  logout: async () => {
    const userId = get().activeUserId;
    if (!userId) return;
    await get().removeAccount(userId);
  },
}));

/** Whether the active session is a throwaway guest one. */
export function isGuestSession(): boolean {
  const s = useAuthStore.getState();
  return s.accounts.find((a) => a.userId === s.activeUserId)?.guest === true;
}

/** Reactive selector version for components. */
export const selectIsGuest = (s: AuthState): boolean =>
  s.accounts.find((a) => a.userId === s.activeUserId)?.guest === true;
