import {
  buildDataExport,
  deactivateAccountOrRequireAuth,
  deactivateAccountWithPassword,
  type MatrixClient,
} from "@jorkonvo/matrix-core";
import { useState } from "react";
import { useTranslation } from "../../i18n";
import { uiConfirm } from "../../lib/dialogs";
import { useAuthStore } from "../../state/authStore";
import { modalInputClass } from "../Modal";

/** Downloads `data` as a JSON file - a plain anchor + blob URL, same technique any web app uses for a client-side download. */
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function DataExportButton({ client }: { client: MatrixClient }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const data = await buildDataExport(client);
      downloadJson(`jorkonvo-data-export-${new Date().toISOString().slice(0, 10)}.json`, data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("dataExport.title")}</h3>
      <p className="mb-2 text-xs text-muted">{t("dataExport.hint")}</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleExport()}
        className="rounded border border-border px-3 py-1.5 text-sm font-medium text-normal transition hover:bg-bg-modifier-hover disabled:opacity-60"
      >
        {busy ? t("common.loading") : t("dataExport.button")}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-dnd">{error}</p>}
    </div>
  );
}

function DeleteAccountSection({ client }: { client: MatrixClient }) {
  const { t } = useTranslation();
  const logout = useAuthStore((s) => s.logout);
  const [erase, setErase] = useState(false);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    if (!(await uiConfirm(t(erase ? "account.deleteConfirmErase" : "account.deleteConfirm"), { danger: true, confirmLabel: t("account.deleteButton") })))
      return;
    setBusy(true);
    setError(null);
    try {
      const session = await deactivateAccountOrRequireAuth(client, erase);
      if (session) {
        setPendingSession(session);
      } else {
        await logout();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmPassword() {
    if (!pendingSession || !password) return;
    setBusy(true);
    setError(null);
    try {
      await deactivateAccountWithPassword(client, client.getUserId() ?? "", password, pendingSession, erase);
      await logout();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t border-dnd/30 pt-4">
      <h3 className="mb-1 text-xs font-bold uppercase text-dnd">{t("account.deleteTitle")}</h3>
      <p className="mb-2 text-xs text-muted">{t("account.deleteHint")}</p>
      <label className="mb-2 flex items-center gap-2 text-sm text-normal">
        <input type="checkbox" checked={erase} onChange={(e) => setErase(e.target.checked)} className="h-4 w-4 shrink-0" />
        {t("account.deleteEraseMessages")}
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleStart()}
        className="rounded border border-dnd px-3 py-1.5 text-sm font-medium text-dnd transition hover:bg-dnd/10 disabled:opacity-60"
      >
        {t("account.deleteButton")}
      </button>
      {pendingSession && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="password"
            aria-label={t("devices.passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("devices.passwordPlaceholder")}
            className={modalInputClass()}
          />
          <button
            type="button"
            disabled={busy || !password}
            onClick={() => void handleConfirmPassword()}
            className="shrink-0 rounded bg-dnd px-3 py-2 text-xs font-medium text-white transition hover:bg-red-600 disabled:opacity-60"
          >
            {t("devices.confirm")}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-dnd">{error}</p>}
    </div>
  );
}

/**
 * GDPR-style account controls: download a full JSON export of the account's
 * data, and (danger zone) deactivate the account, optionally erasing all
 * messages - the latter may require re-entering the password via UIA.
 *
 * @param client - Authenticated Matrix client used for the export and deactivation.
 */
export function AccountDataSection({ client }: { client: MatrixClient }) {
  return (
    <>
      <DataExportButton client={client} />
      <DeleteAccountSection client={client} />
    </>
  );
}
