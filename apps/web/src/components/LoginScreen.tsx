import { probeRegistration, type RegistrationCapability } from "@jorkonvo/matrix-core";
import { type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "../i18n";
import { uiAlert } from "../lib/dialogs";
import { CUSTOM_HOMESERVER_VALUE, HOMESERVER_PRESETS, presetValueFor } from "../lib/homeserverPresets";
import { useAuthStore } from "../state/authStore";
import { THEME_OPTIONS, useThemeStore } from "../state/themeStore";
import { QrLoginPanel } from "./QrLoginPanel";

/** Reads ?server=&token= from the current URL (a shareable "join this server" link, see login.copySignupLink) and clears them from the address bar once read. */
function readDeepLinkParams(): { server: string | null; token: string | null } {
  const params = new URLSearchParams(window.location.search);
  const server = params.get("server");
  const token = params.get("token");
  if (server || token) {
    params.delete("server");
    params.delete("token");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
  }
  return { server, token };
}

const THEME_ICON: Record<string, React.ReactNode> = {
  dark: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.4 5.4 0 0 1-7.54-7.54c-.44-.06-.9-.1-1.36-.1Z" />
    </svg>
  ),
  light: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M4 4h16v11H4V4Zm-1 13h18v2H3v-2Z" />
    </svg>
  ),
};

function ThemeQuickToggle() {
  const { t } = useTranslation();
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  return (
    <div className="fixed right-3 top-[calc(0.75rem_+_env(safe-area-inset-top))] z-20 flex gap-0.5 rounded-full bg-bg-primary/80 p-1 shadow-md ring-1 ring-white/5 backdrop-blur">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={t(opt.labelKey)}
          aria-label={t(opt.labelKey)}
          onClick={() => setPreference(opt.value)}
          className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
            preference === opt.value ? "bg-brand text-white" : "text-muted hover:bg-bg-modifier-hover hover:text-normal"
          }`}
        >
          {THEME_ICON[opt.value]}
        </button>
      ))}
    </div>
  );
}

/**
 * Module-level, per-homeserver cache of registration-capability probes for
 * the login screen's lifetime (see the probing effect below for why only
 * positive results are cached).
 */
const probeCache = new Map<string, import("@jorkonvo/matrix-core").RegistrationCapability>();

/**
 * The unauthenticated sign-in screen: password login, registration (with
 * registration-capability probing and shareable sign-up deep links) and QR
 * login behind one tab strip, plus a continue-as-guest fallback.
 */
export function LoginScreen() {
  const { t } = useTranslation();
  const errorId = useId();
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const guestLogin = useAuthStore((s) => s.guestLogin);
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);

  const [homeserverUrl, setHomeserverUrl] = useState(HOMESERVER_PRESETS[0].url);
  // Tracked separately from homeserverUrl so explicitly picking "Other" sticks
  // in the dropdown instead of snapping back to a matching preset - it only
  // re-syncs to a preset when the free-text field itself changes to match one.
  const [homeserverPreset, setHomeserverPreset] = useState(presetValueFor(HOMESERVER_PRESETS[0].url));
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "register" | "qr">("password");

  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regPasswordConfirm, setRegPasswordConfirm] = useState("");
  const [regToken, setRegToken] = useState("");
  const [regCapability, setRegCapability] = useState<RegistrationCapability | null>(null);
  const [regChecking, setRegChecking] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  // A shared "join this server" link (login.copySignupLink below generates
  // one) prefills the homeserver + token and jumps straight to the
  // registration tab, so the recipient doesn't have to know either by hand.
  useEffect(() => {
    const { server, token } = readDeepLinkParams();
    if (server) {
      setHomeserverUrl(server);
      setHomeserverPreset(presetValueFor(server));
    }
    if (token) {
      setRegToken(token);
      setMode("register");
    }
  }, []);

  useEffect(() => {
    if (mode !== "register" || !homeserverUrl.trim()) return;
    // Every probe is a real POST /register and counts toward the server's
    // registration rate limit (aggressively enforced on shared servers), so
    // positive results are cached per homeserver for this component's
    // lifetime. "Closed" verdicts are NOT cached: an admin flipping
    // registration on must be picked up by the next retry, not stuck behind
    // a cached no for the rest of the session.
    const cached = probeCache.get(homeserverUrl.trim());
    if (cached) {
      setRegCapability(cached);
      setRegChecking(false);
      return;
    }
    let cancelled = false;
    setRegChecking(true);
    setRegCapability(null);
    const timer = setTimeout(() => {
      void probeRegistration(homeserverUrl.trim())
        .then((cap) => {
          if (!cancelled) {
            if (cap.enabled) probeCache.set(homeserverUrl.trim(), cap);
            setRegCapability(cap);
          }
        })
        .catch(() => {
          if (!cancelled) setRegCapability(null);
        })
        .finally(() => {
          if (!cancelled) setRegChecking(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, homeserverUrl]);

  const isLoggingIn = status === "loggingIn";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!homeserverUrl || !userId || !password) return;
    void login(homeserverUrl.trim(), userId.trim(), password);
  }

  function handleRegisterSubmit(e: FormEvent) {
    e.preventDefault();
    setRegError(null);
    if (!homeserverUrl.trim() || !regUsername.trim() || !regPassword) return;
    if (regPassword !== regPasswordConfirm) {
      setRegError(t("login.passwordsMismatch"));
      return;
    }
    void register(homeserverUrl.trim(), regUsername.trim(), regPassword, regToken.trim() || undefined);
  }

  function handleCopySignupLink() {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("server", homeserverUrl.trim());
    if (regToken.trim()) url.searchParams.set("token", regToken.trim());
    void navigator.clipboard.writeText(url.toString());
    void uiAlert(t("common.copied"));
  }

  return (
    <div className="relative flex h-full w-full items-start justify-center overflow-x-hidden overflow-y-auto bg-bg-darkest p-4">
      <ThemeQuickToggle />
      {/* Soft brand glow, so the sign-in screen has some identity of its own. */}
      <div
        className="pointer-events-none fixed -top-1/3 left-1/2 h-[70vh] w-[70vh] -translate-x-1/2 rounded-full opacity-30 blur-[120px]"
        style={{ background: "radial-gradient(circle, var(--color-brand), transparent 70%)" }}
      />
      {/* my-auto keeps the card vertically centered when it fits and lets it
          scroll (with the whole container) when a tall form - registration
          with a token field, the QR panel - exceeds the viewport, instead of
          clipping the card's top edge off-screen on phones. */}
      <div className="animate-slide-in-up relative my-auto w-full max-w-md rounded-xl bg-bg-primary p-8 shadow-xl ring-1 ring-white/5">
        <div className="mb-5 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-xl font-black text-white shadow-lg shadow-brand/30">
            J
          </div>
          <h1 className="text-2xl font-bold text-header">{t("login.welcome")}</h1>
          <p className="text-center text-sm text-muted">{t("login.subtitle")}</p>
        </div>

        <div className="mb-5 flex rounded bg-bg-darkest p-1">
          <button
            type="button"
            data-testid="login-tab-password"
            onClick={() => setMode("password")}
            className={`flex-1 rounded py-1.5 text-sm font-medium transition ${
              mode === "password" ? "bg-brand text-white" : "text-muted hover:text-normal"
            }`}
          >
            {t("login.withPassword")}
          </button>
          <button
            type="button"
            data-testid="login-tab-register"
            onClick={() => setMode("register")}
            className={`flex-1 rounded py-1.5 text-sm font-medium transition ${
              mode === "register" ? "bg-brand text-white" : "text-muted hover:text-normal"
            }`}
          >
            {t("login.withRegister")}
          </button>
          <button
            type="button"
            data-testid="login-tab-qr"
            onClick={() => setMode("qr")}
            className={`flex-1 rounded py-1.5 text-sm font-medium transition ${
              mode === "qr" ? "bg-brand text-white" : "text-muted hover:text-normal"
            }`}
          >
            {t("login.withQr")}
          </button>
        </div>

        <label className="mb-1.5 block text-xs font-bold uppercase text-muted">
          {t("login.homeserver")}
          <select
            data-testid="login-homeserver-preset"
            value={homeserverPreset}
            onChange={(e) => {
              setHomeserverPreset(e.target.value);
              if (e.target.value !== CUSTOM_HOMESERVER_VALUE) setHomeserverUrl(e.target.value);
            }}
            className="mt-1 w-full rounded bg-bg-darkest px-3 py-2.5 text-normal outline-none focus:ring-2 focus:ring-brand"
          >
            {HOMESERVER_PRESETS.map((preset) => (
              <option key={preset.url} value={preset.url}>
                {preset.label}
              </option>
            ))}
            <option value={CUSTOM_HOMESERVER_VALUE}>{t("login.homeserverCustom")}</option>
          </select>
        </label>
        <label className="mb-3 block text-xs font-bold uppercase text-muted">
          {t("login.homeserverUrl")}
          <input
            type="text"
            data-testid="login-homeserver"
            value={homeserverUrl}
            onChange={(e) => {
              setHomeserverUrl(e.target.value);
              setHomeserverPreset(presetValueFor(e.target.value));
            }}
            className="mt-1 w-full rounded bg-bg-darkest px-3 py-2.5 text-normal outline-none focus:ring-2 focus:ring-brand"
            placeholder="https://matrix.example.com"
            autoComplete="url"
          />
        </label>

        {mode === "qr" ? (
          <>
            <p className="mb-1 text-xs text-muted">{t("login.qrHint")}</p>
            <p className="mb-3 text-xs font-medium text-idle">{t("login.qrBeta")}</p>
            <QrLoginPanel homeserverUrl={homeserverUrl} />
          </>
        ) : mode === "register" ? (
          <form onSubmit={handleRegisterSubmit}>
            <label className="mb-3 block text-xs font-bold uppercase text-muted">
              {t("login.username")}
              <input
                type="text"
                data-testid="register-username"
                value={regUsername}
                onChange={(e) => setRegUsername(e.target.value)}
                className="mt-1 w-full rounded bg-bg-darkest px-3 py-2.5 text-normal outline-none focus:ring-2 focus:ring-brand"
                placeholder={t("login.usernamePlaceholder")}
                autoComplete="username"
              />
            </label>

            <label className="mb-3 block text-xs font-bold uppercase text-muted">
              {t("login.password")}
              <input
                type="password"
                data-testid="register-password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                className="mt-1 w-full rounded bg-bg-darkest px-3 py-2.5 text-normal outline-none focus:ring-2 focus:ring-brand"
                autoComplete="new-password"
              />
            </label>

            <label className="mb-3 block text-xs font-bold uppercase text-muted">
              {t("login.confirmPassword")}
              <input
                type="password"
                data-testid="register-password-confirm"
                value={regPasswordConfirm}
                onChange={(e) => setRegPasswordConfirm(e.target.value)}
                aria-describedby={(regError || error) ? errorId : undefined}
                className="mt-1 w-full rounded bg-bg-darkest px-3 py-2.5 text-normal outline-none focus:ring-2 focus:ring-brand"
                autoComplete="new-password"
              />
            </label>

            {(regCapability?.requiresToken || regToken) && (
              <label className="mb-3 block text-xs font-bold uppercase text-muted">
                {t("login.registrationToken")}
                <input
                  type="text"
                  value={regToken}
                  onChange={(e) => setRegToken(e.target.value)}
                  className="mt-1 w-full rounded bg-bg-darkest px-3 py-2.5 text-normal outline-none focus:ring-2 focus:ring-brand"
                />
              </label>
            )}

            {regChecking && <p className="mb-3 text-xs text-muted">{t("login.checkingRegistration")}</p>}
            {!regChecking && regCapability && !regCapability.enabled && (
              <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{t("login.registrationClosed")}</p>
            )}
            {!regChecking && regCapability?.unsupportedStage && (
              <p className="mb-3 rounded bg-idle/10 px-3 py-2 text-sm text-idle">
                {t("login.registrationUnsupported", { stage: regCapability.unsupportedStage })}
              </p>
            )}
            {(regError || error) && (
              <p id={errorId} role="alert" className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{regError ?? error}</p>
            )}

            <button
              type="submit"
              data-testid="register-submit"
              disabled={isLoggingIn || regCapability?.enabled === false}
              className="w-full rounded bg-brand py-2.5 font-medium text-white transition hover:bg-brand-hover disabled:opacity-60"
            >
              {isLoggingIn ? t("login.registerSubmitting") : t("login.registerSubmit")}
            </button>

            <button
              type="button"
              onClick={handleCopySignupLink}
              disabled={!homeserverUrl.trim()}
              title={t("login.signupLinkHint")}
              className="mt-2 w-full rounded border border-border py-2 text-xs font-medium text-muted transition hover:border-brand hover:text-normal disabled:opacity-60"
            >
              {t("login.copySignupLink")}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="mb-3 block text-xs font-bold uppercase text-muted">
              {t("login.username")}
              <input
                type="text"
                data-testid="login-username"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="mt-1 w-full rounded bg-bg-darkest px-3 py-2.5 text-normal outline-none focus:ring-2 focus:ring-brand"
                placeholder={t("login.usernamePlaceholder")}
                autoComplete="username"
              />
            </label>

            <label className="mb-4 block text-xs font-bold uppercase text-muted">
              {t("login.password")}
              <input
                type="password"
                data-testid="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={error ? errorId : undefined}
                className="mt-1 w-full rounded bg-bg-darkest px-3 py-2.5 text-normal outline-none focus:ring-2 focus:ring-brand"
                autoComplete="current-password"
              />
            </label>

            {error && (
              <p id={errorId} role="alert" className="mb-4 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>
            )}

            <button
              type="submit"
              data-testid="login-submit"
              disabled={isLoggingIn}
              className="w-full rounded bg-brand py-2.5 font-medium text-white transition hover:bg-brand-hover disabled:opacity-60"
            >
              {isLoggingIn ? t("login.submitting") : t("login.submit")}
            </button>
          </form>
        )}

        {mode !== "register" && (
          <div className="mt-4 border-t border-border pt-4 text-center">
            <button
              type="button"
              disabled={isLoggingIn}
              onClick={() => void guestLogin(homeserverUrl.trim())}
              className="text-sm font-medium text-link hover:underline disabled:opacity-60"
            >
              {t("login.continueAsGuest")}
            </button>
            <p className="mt-1 text-xs text-muted">{t("login.guestHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
