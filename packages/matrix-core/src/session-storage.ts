import type { SessionStorage, StoredSession } from "./types.js";

const LEGACY_KEY = "jorkonvo.session.v1";
const ACCOUNTS_KEY = "jorkonvo.accounts.v1";
const ACTIVE_KEY = "jorkonvo.activeAccount.v1";

/**
 * Default session storage backed by browser localStorage. Works unmodified
 * inside Electron and Capacitor shells since both expose a real DOM/window.
 *
 * Stores a LIST of accounts (Discord/Element-style account switcher) plus
 * which one is active. The first read after an upgrade transparently folds
 * the old single-account key into this list (as the sole, active account,
 * with its crypto prefix left at the SDK default - see the comment on
 * StoredSession.cryptoDatabasePrefix), so nobody's already-logged-in session
 * is disturbed by the upgrade.
 */
export class LocalStorageSessionStorage implements SessionStorage {
  private migrated = false;

  private migrateLegacyIfNeeded(): void {
    if (this.migrated) return;
    this.migrated = true;
    if (localStorage.getItem(ACCOUNTS_KEY)) return;
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (!legacyRaw) return;
    try {
      const legacy = JSON.parse(legacyRaw) as StoredSession;
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([legacy]));
      localStorage.setItem(ACTIVE_KEY, legacy.userId);
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // Corrupt legacy entry - nothing usable to migrate, starts as a fresh empty account list.
    }
  }

  loadAccounts(): StoredSession[] {
    this.migrateLegacyIfNeeded();
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as StoredSession[]) : [];
    } catch {
      return [];
    }
  }

  saveAccounts(sessions: StoredSession[]): void {
    if (sessions.length === 0) {
      localStorage.removeItem(ACCOUNTS_KEY);
      return;
    }
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(sessions));
  }

  getActiveUserId(): string | null {
    this.migrateLegacyIfNeeded();
    return localStorage.getItem(ACTIVE_KEY);
  }

  setActiveUserId(userId: string | null): void {
    if (userId === null) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, userId);
  }
}
