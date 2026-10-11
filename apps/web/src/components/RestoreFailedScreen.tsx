import { useTranslation } from "../i18n";
import { useAuthStore } from "../state/authStore";

/**
 * Full-screen fallback shown when a stored session cannot be restored at
 * startup (expired token, unreachable homeserver, ...): offers a retry and
 * a sign-out escape hatch.
 */
export function RestoreFailedScreen() {
  const { t } = useTranslation();
  const error = useAuthStore((s) => s.error);
  const restore = useAuthStore((s) => s.restore);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="flex h-full w-full items-center justify-center bg-bg-darkest">
      <div className="w-full max-w-md rounded-lg bg-bg-primary p-8 text-center shadow-xl">
        <h1 className="mb-2 text-xl font-bold text-header">{t("restore.failedTitle")}</h1>
        <p className="mb-4 text-sm text-muted">
          {t("restore.failedBody")}
          {error && <span className="mt-2 block text-xs text-dnd">{error}</span>}
        </p>
        <button
          type="button"
          onClick={() => void restore()}
          className="mb-2 w-full rounded bg-brand py-2.5 font-medium text-white transition hover:bg-brand-hover"
        >
          {t("restore.retry")}
        </button>
        <button
          type="button"
          onClick={() => void logout()}
          className="w-full rounded py-2 text-sm text-muted hover:text-normal"
        >
          {t("restore.logoutInstead")}
        </button>
      </div>
    </div>
  );
}
