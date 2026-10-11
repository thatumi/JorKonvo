import {
  createFreshCrossSigningIdentity,
  type CrossSigningStatus,
  getCrossSigningStatus,
  restoreCrossSigningWithRecoveryKey,
  restoreKeyBackupWithRecoveryKey,
} from "@jorkonvo/matrix-core";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

function StatusRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? "bg-online" : "bg-muted"}`} />
      <span className={ok ? "text-normal" : "text-muted"}>{label}</span>
    </div>
  );
}

/**
 * Restore end-to-end encryption for this account: unlock key backup and
 * cross-signing with an existing recovery key, or — when nothing is set up
 * yet — create a fresh identity and reveal its one-time recovery key.
 */
export function RecoveryKeyModal() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const bumpTick = useMatrixStore((s) => s.bumpTick);

  const [recoveryKey, setRecoveryKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [status, setStatus] = useState<CrossSigningStatus | null>(null);
  const [showReset, setShowReset] = useState(false);
  const [password, setPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getCrossSigningStatus(client).then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function refreshStatus() {
    setStatus(await getCrossSigningStatus(client));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!recoveryKey.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      // Independent operations - an account without server-side key backup
      // (e.g. a fresh test account) shouldn't block cross-signing restore
      // from succeeding, and vice versa.
      const [backupResult, crossSigningResult] = await Promise.allSettled([
        restoreKeyBackupWithRecoveryKey(client, recoveryKey, setProgress),
        restoreCrossSigningWithRecoveryKey(client, recoveryKey),
      ]);

      const messages: string[] = [];
      if (backupResult.status === "fulfilled") {
        messages.push(
          t("crypto.keysRestored", {
            imported: backupResult.value.imported,
            total: backupResult.value.total,
          }),
        );
      }
      if (crossSigningResult.status === "fulfilled" && crossSigningResult.value.ready) {
        messages.push(t("crypto.crossSigningUnlocked"));
      }
      if (messages.length === 0) {
        // Prefer the cross-signing error: it's the more common intent, and its
        // message now distinguishes "wrong format" / "wrong key for this
        // account" / "no secret storage" (see resolveSecretStorageKey). The
        // backup side usually just says "no backup on this server", which is
        // noise when the real problem is the key.
        throw new Error(
          crossSigningResult.status === "rejected"
            ? crossSigningResult.reason.message
            : backupResult.status === "rejected"
              ? backupResult.reason.message
              : t("crypto.restoreFailed"),
        );
      }
      setSuccess(messages.join(" "));
      bumpTick();
      await refreshStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateFresh(e: FormEvent) {
    e.preventDefault();
    if (!password.trim() || resetBusy) return;
    setResetBusy(true);
    setResetError(null);
    try {
      const key = await createFreshCrossSigningIdentity(client, async () => password);
      setNewRecoveryKey(key);
      setPassword("");
      bumpTick();
      await refreshStatus();
    } catch (err) {
      setResetError((err as Error).message);
    } finally {
      setResetBusy(false);
    }
  }

  async function handleCopyNewKey() {
    if (!newRecoveryKey) return;
    await navigator.clipboard.writeText(newRecoveryKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const nothingSetUpYet = status !== null && !status.publicKeysOnDevice && !status.privateKeysInSecretStorage;

  return (
    <Modal title={t("crypto.title")} onClose={close}>
      {status && (
        <div className="mb-4 rounded bg-bg-secondary p-3">
          <span className="mb-1.5 block text-xs font-bold uppercase text-muted">{t("crypto.statusHeading")}</span>
          <div className="flex flex-col gap-1">
            <StatusRow ok={status.ready} label={status.ready ? t("crypto.statusReady") : t("crypto.statusNotReady")} />
            <StatusRow ok={status.publicKeysOnDevice} label={t("crypto.statusPublicKeys")} />
            <StatusRow ok={status.privateKeysInSecretStorage} label={t("crypto.statusPrivateInStorage")} />
            <StatusRow ok={status.privateKeysCachedLocally} label={t("crypto.statusPrivateCached")} />
          </div>
        </div>
      )}

      <p className="mb-4 text-sm text-muted">{t("crypto.intro")}</p>
      <form onSubmit={handleSubmit}>
        <ModalField label={t("crypto.recoveryKey")}>
          <input
            className={modalInputClass()}
            value={recoveryKey}
            onChange={(e) => setRecoveryKey(e.target.value)}
            placeholder="EsXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX"
            autoFocus
            autoComplete="off"
          />
        </ModalField>
        {progress && (
          <p aria-live="polite" className="mb-3 text-xs text-muted">
            {t("crypto.progress", { done: progress.done, total: progress.total })}
          </p>
        )}
        {error && <p role="alert" className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        {success && (
          <p aria-live="polite" className="mb-3 rounded bg-online/10 px-3 py-2 text-sm text-online">{success}</p>
        )}
        <ModalPrimaryButton type="submit" disabled={!recoveryKey.trim() || busy}>
          {busy ? t("crypto.restoring") : t("crypto.restore")}
        </ModalPrimaryButton>
      </form>

      {nothingSetUpYet && (
        <div className="mt-5 border-t border-border pt-4">
          {!showReset ? (
            <button
              type="button"
              onClick={() => setShowReset(true)}
              className="w-full rounded border border-border py-2 text-sm font-medium text-normal transition hover:bg-bg-modifier-hover"
            >
              {t("crypto.createNew")}
            </button>
          ) : newRecoveryKey ? (
            <div>
              <p className="mb-2 rounded bg-dnd/10 px-3 py-2 text-xs text-dnd">{t("crypto.newKeyWarning")}</p>
              <div className="mb-2 break-all rounded bg-bg-darkest px-3 py-2 font-mono text-xs text-normal">
                {newRecoveryKey}
              </div>
              <button
                type="button"
                onClick={() => void handleCopyNewKey()}
                aria-live="polite"
                className="w-full rounded bg-brand py-2 text-sm font-medium text-white transition hover:bg-brand-hover"
              >
                {copied ? t("crypto.copiedToClipboard") : t("crypto.copyToClipboard")}
              </button>
            </div>
          ) : (
            <form onSubmit={handleCreateFresh}>
              <p className="mb-3 text-xs text-muted">{t("crypto.createFreshIntro")}</p>
              <ModalField label={t("crypto.password")}>
                <input
                  type="password"
                  className={modalInputClass()}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </ModalField>
              {resetError && <p role="alert" className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{resetError}</p>}
              <ModalPrimaryButton type="submit" disabled={!password.trim() || resetBusy}>
                {resetBusy ? t("crypto.creating") : t("crypto.create")}
              </ModalPrimaryButton>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
