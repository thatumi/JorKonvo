import { changePassword, type MatrixClient } from "@jorkonvo/matrix-core";
import { type FormEvent, useState } from "react";
import { useTranslation } from "../../i18n";
import { modalInputClass } from "../Modal";

/**
 * Change the account's password: validates the new one locally (length +
 * confirmation match) and optionally logs out all other sessions.
 *
 * @param client - Authenticated Matrix client the change is performed on.
 */
export function ChangePasswordSection({ client }: { client: MatrixClient }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [logoutOthers, setLogoutOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) {
      setError(t("password.tooShort"));
      return;
    }
    if (next !== confirm) {
      setError(t("password.mismatch"));
      return;
    }
    setBusy(true);
    try {
      await changePassword(client, current, next, logoutOthers);
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("password.title")}</h3>
      {done ? (
        <p aria-live="polite" className="rounded bg-online/10 px-3 py-2 text-sm text-online">{t("password.changed")}</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <input
            type="password"
            autoComplete="current-password"
            aria-label={t("password.current")}
            className={modalInputClass()}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder={t("password.current")}
          />
          <input
            type="password"
            autoComplete="new-password"
            aria-label={t("password.new")}
            className={modalInputClass()}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder={t("password.new")}
          />
          <input
            type="password"
            autoComplete="new-password"
            aria-label={t("password.confirm")}
            className={modalInputClass()}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t("password.confirm")}
          />
          <label className="flex items-center gap-2 text-sm text-normal">
            <input
              type="checkbox"
              checked={logoutOthers}
              onChange={(e) => setLogoutOthers(e.target.checked)}
              className="h-4 w-4"
            />
            {t("password.logoutOthers")}
          </label>
          {error && <p role="alert" className="rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
          <button
            type="submit"
            disabled={busy || !current || !next}
            className="mt-1 w-full rounded bg-brand py-2 font-medium text-white transition hover:bg-brand-hover disabled:opacity-60"
          >
            {busy ? t("common.saving") : t("password.submit")}
          </button>
        </form>
      )}
    </div>
  );
}
