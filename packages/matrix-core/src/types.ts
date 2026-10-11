export interface StoredSession {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
  /**
   * IndexedDB name prefix for this account's rust-crypto store. Left
   * undefined for whichever account was already logged in before
   * multi-account support existed, so it keeps using the SDK's own default
   * prefix and its already-verified crypto identity - only accounts added
   * afterward get a generated, isolated prefix (see authStore.ts), since
   * two accounts sharing one prefix in the same browser origin would
   * clobber each other's crypto state.
   */
  cryptoDatabasePrefix?: string;
  /**
   * Present only for a session obtained via OAuth2 (currently: QR sign-in -
   * see qrLogin.ts). A password-login session has none - its access token
   * is long-lived and never needs refreshing the way an OAuth one does.
   * Stored so it's not silently discarded, but no automatic refresh is
   * wired up yet (see qrLogin.ts's module comment) - once the OAuth access
   * token expires, a session restored from this would need a fresh login.
   */
  refreshToken?: string;
  /** True for a throwaway guest session (registerGuest). Crypto is skipped and the UI is read-mostly. */
  guest?: boolean;
}

export interface LoginParams {
  homeserverUrl: string;
  userId: string;
  password: string;
}

/**
 * Multiple stored accounts (Discord/Element-style account switcher), plus
 * which one is currently active. Transparently migrates the older
 * single-session storage format the first time it's read.
 */
export interface SessionStorage {
  loadAccounts(): StoredSession[];
  saveAccounts(sessions: StoredSession[]): void;
  getActiveUserId(): string | null;
  setActiveUserId(userId: string | null): void;
}
