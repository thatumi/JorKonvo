import { type MatrixClient } from "@jorkonvo/matrix-core";
import { useRef, useState } from "react";
import { useTranslation } from "../../i18n";
import {
  exportSettingsToFile,
  importSettingsFromFile,
  isSettingsAutoSyncEnabled,
  restoreSettingsFromMatrixAccount,
  saveSettingsToMatrixAccount,
  setSettingsAutoSyncEnabled,
} from "../../lib/settingsBackup";

/**
 * All client-side preferences (theme, wallpaper, notification sound, PTT,
 * etc.) live in this browser's localStorage only - a fresh device or
 * browser profile starts from scratch. This lets someone carry them over
 * either through their own Matrix account (real cross-device sync) or a
 * plain JSON file (works even without touching the account, e.g. moving
 * between two people's machines).
 */
export function SettingsBackupSection({ client }: { client: MatrixClient }) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(isSettingsAutoSyncEnabled);

  async function handleSaveToAccount() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await saveSettingsToMatrixAccount(client);
      setStatus(t("settings.backupSaved"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Most of the individual settings stores only ever read localStorage once,
  // at their own module init - overwriting the keys behind their back
  // wouldn't be picked up by the already-running app. A reload is the
  // simplest way to guarantee every store re-reads the restored values.
  function reloadShortly() {
    setTimeout(() => window.location.reload(), 1200);
  }

  function handleRestoreFromAccount() {
    setError(null);
    setStatus(null);
    const count = restoreSettingsFromMatrixAccount(client);
    if (count === null) {
      setError(t("settings.backupNoneOnAccount"));
      return;
    }
    setStatus(t("settings.backupRestored", { count }));
    reloadShortly();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setStatus(null);
    try {
      const count = await importSettingsFromFile(file);
      setStatus(t("settings.backupRestored", { count }));
      reloadShortly();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("settings.backupTitle")}</h3>
      <p className="mb-3 text-xs text-muted">{t("settings.backupHint")}</p>
      <label className="mb-3 flex items-center justify-between gap-2 text-sm text-normal">
        <span>{t("settings.autoSync")}</span>
        <input
          type="checkbox"
          checked={autoSync}
          onChange={(e) => {
            setSettingsAutoSyncEnabled(e.target.checked);
            setAutoSync(e.target.checked);
          }}
          className="h-4 w-4 shrink-0"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleSaveToAccount()}
          className="rounded bg-bg-secondary px-3 py-1.5 text-xs font-medium text-normal hover:bg-bg-modifier-hover disabled:opacity-60"
        >
          {t("settings.backupSaveToAccount")}
        </button>
        <button
          type="button"
          onClick={handleRestoreFromAccount}
          className="rounded bg-bg-secondary px-3 py-1.5 text-xs font-medium text-normal hover:bg-bg-modifier-hover"
        >
          {t("settings.backupRestoreFromAccount")}
        </button>
        <button
          type="button"
          onClick={exportSettingsToFile}
          className="rounded bg-bg-secondary px-3 py-1.5 text-xs font-medium text-normal hover:bg-bg-modifier-hover"
        >
          {t("settings.backupExportFile")}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded bg-bg-secondary px-3 py-1.5 text-xs font-medium text-normal hover:bg-bg-modifier-hover"
        >
          {t("settings.backupImportFile")}
        </button>
        <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={(e) => void handleImportFile(e)} />
      </div>
      {status && <p aria-live="polite" className="mt-2 text-xs text-online">{status}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-dnd">{error}</p>}
    </div>
  );
}
