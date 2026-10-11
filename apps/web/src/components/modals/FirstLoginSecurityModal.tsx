import {
  createFreshCrossSigningIdentity,
  restoreCrossSigningWithRecoveryKey,
  restoreKeyBackupWithRecoveryKey,
} from "@jorkonvo/matrix-core";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { useVerificationStore } from "../../state/verificationStore";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

/**
 * Shown right after a successful login/registration when this device's
 * encryption identity needs attention - either nothing has EVER been set up
 * for this account ("create" mode: generate + reveal a recovery key), or an
 * identity already exists elsewhere and this device just doesn't have it
 * yet ("restore" mode: enter the existing recovery key, or verify from an
 * already-signed-in device). Deliberately reuses the same matrix-core calls
 * as RecoveryKeyModal (Settings > Security) - this is the same feature,
 * just surfaced at the moment it actually matters instead of waiting for
 * someone to find a small icon in the space rail.
 */
export function FirstLoginSecurityModal({
  mode,
  knownPassword,
}: {
  mode: "create" | "restore";
  knownPassword?: string;
}) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const bumpTick = useMatrixStore((s) => s.bumpTick);
  const startVerification = useVerificationStore((s) => s.start);

  // "create" mode state
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const autoStarted = useRef(false);

  // "restore" mode state
  const [restoreView, setRestoreView] = useState<"menu" | "enterKey">("menu");
  const [enteredKey, setEnteredKey] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  async function runCreate(pw: string) {
    setBusy(true);
    setError(null);
    try {
      const key = await createFreshCrossSigningIdentity(client, async () => pw);
      setRecoveryKey(key);
      bumpTick();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A password from the login/register form the caller just used is still
  // in memory - skip re-prompting for it and start immediately.
  useEffect(() => {
    if (mode === "create" && knownPassword && !autoStarted.current) {
      autoStarted.current = true;
      void runCreate(knownPassword);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, knownPassword]);

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password.trim() || busy) return;
    await runCreate(password);
  }

  async function handleCopyKey() {
    if (!recoveryKey) return;
    await navigator.clipboard.writeText(recoveryKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRestoreSubmit(e: FormEvent) {
    e.preventDefault();
    if (!enteredKey.trim() || restoreBusy) return;
    setRestoreBusy(true);
    setRestoreError(null);
    try {
      const [backupResult, crossSigningResult] = await Promise.allSettled([
        restoreKeyBackupWithRecoveryKey(client, enteredKey),
        restoreCrossSigningWithRecoveryKey(client, enteredKey),
      ]);
      if (crossSigningResult.status === "rejected" && backupResult.status === "rejected") {
        throw new Error(crossSigningResult.reason.message);
      }
      bumpTick();
      close();
    } catch (err) {
      setRestoreError((err as Error).message);
    } finally {
      setRestoreBusy(false);
    }
  }

  function handleVerifyInstead() {
    const userId = client.getUserId();
    if (!userId) return;
    void startVerification(client, userId);
    close();
  }

  if (mode === "restore") {
    return (
      <Modal title={t("firstLoginSecurity.restoreTitle")} onClose={close}>
        <p className="mb-4 text-sm text-muted">{t("firstLoginSecurity.restoreIntro")}</p>
        {restoreView === "menu" ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              data-testid="firstlogin-restore-enterkey"
              onClick={() => setRestoreView("enterKey")}
              className="w-full rounded bg-brand py-2.5 text-sm font-medium text-white transition hover:bg-brand-hover"
            >
              {t("firstLoginSecurity.enterKeyOption")}
            </button>
            <button
              type="button"
              data-testid="firstlogin-restore-verify"
              onClick={handleVerifyInstead}
              className="w-full rounded border border-border py-2.5 text-sm font-medium text-normal transition hover:bg-bg-modifier-hover"
            >
              {t("firstLoginSecurity.verifyOption")}
            </button>
            <button
              type="button"
              data-testid="firstlogin-restore-later"
              onClick={close}
              className="mt-1 w-full py-1.5 text-xs font-medium text-muted transition hover:text-normal"
            >
              {t("firstLoginSecurity.later")}
            </button>
          </div>
        ) : (
          <form onSubmit={handleRestoreSubmit}>
            <ModalField label={t("crypto.recoveryKey")}>
              <input
                className={modalInputClass()}
                value={enteredKey}
                onChange={(e) => setEnteredKey(e.target.value)}
                placeholder="EsXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX"
                autoFocus
                autoComplete="off"
                data-testid="firstlogin-restore-key-input"
              />
            </ModalField>
            {restoreError && (
              <p role="alert" className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">
                {restoreError}
              </p>
            )}
            <ModalPrimaryButton
              type="submit"
              disabled={!enteredKey.trim() || restoreBusy}
              data-testid="firstlogin-restore-submit"
            >
              {restoreBusy ? t("crypto.restoring") : t("crypto.restore")}
            </ModalPrimaryButton>
          </form>
        )}
      </Modal>
    );
  }

  return (
    <Modal title={t("firstLoginSecurity.createTitle")} onClose={close}>
      {!recoveryKey ? (
        <>
          <p className="mb-4 text-sm text-muted">{t("firstLoginSecurity.createExplain")}</p>
          {!knownPassword && (
            <form onSubmit={handlePasswordSubmit}>
              <ModalField label={t("crypto.password")}>
                <input
                  type="password"
                  className={modalInputClass()}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  autoComplete="current-password"
                  data-testid="firstlogin-create-password"
                />
              </ModalField>
              {error && <p role="alert" className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
              <ModalPrimaryButton type="submit" disabled={!password.trim() || busy} data-testid="firstlogin-create-submit">
                {busy ? t("crypto.creating") : t("crypto.create")}
              </ModalPrimaryButton>
            </form>
          )}
          {knownPassword && busy && <p className="text-sm text-muted">{t("crypto.creating")}</p>}
          {knownPassword && error && (
            <p role="alert" className="rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">
              {error}
            </p>
          )}
        </>
      ) : (
        <div>
          <p className="mb-3 text-sm text-normal">{t("firstLoginSecurity.revealExplain")}</p>
          <p className="mb-2 rounded bg-dnd/10 px-3 py-2 text-xs text-dnd">{t("crypto.newKeyWarning")}</p>
          <div
            data-testid="firstlogin-recovery-key"
            className="mb-3 select-all break-all rounded bg-bg-darkest px-3 py-2 font-mono text-sm text-normal"
          >
            {recoveryKey}
          </div>
          <button
            type="button"
            data-testid="firstlogin-copy-key"
            onClick={() => void handleCopyKey()}
            aria-live="polite"
            className="mb-3 w-full rounded bg-brand py-2 text-sm font-medium text-white transition hover:bg-brand-hover"
          >
            {copied ? t("crypto.copiedToClipboard") : t("crypto.copyToClipboard")}
          </button>
          <button
            type="button"
            data-testid="firstlogin-done"
            onClick={close}
            className="w-full rounded border border-border py-2 text-sm font-medium text-normal transition hover:bg-bg-modifier-hover"
          >
            {copied ? t("firstLoginSecurity.savedContinue") : t("firstLoginSecurity.laterAnyway")}
          </button>
        </div>
      )}
    </Modal>
  );
}
