import {
  confirmAddEmail,
  getOwnThreePids,
  type MatrixClient,
  type OwnThreePid,
  type PendingEmailValidation,
  removeThreePid,
  requestAddEmail,
} from "@jorkonvo/matrix-core";
import { useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { uiConfirm, uiPrompt } from "../../lib/dialogs";
import { modalInputClass } from "../Modal";
import { Sensitive } from "../Sensitive";

/**
 * Managing the account's OWN email/phone (3PIDs) - password recovery/
 * discoverability, not the same thing as the identity-server-based email
 * INVITE feature this app deliberately skips (see PLAN.md). Adding one is
 * a two-step, spec-mandated flow: a validation email gets sent with a link
 * only the account owner can click (nothing in this codebase can do that
 * step), then "Megerősítés" finalizes it - clicking that before the link
 * is opened fails with a clear "still not verified" message, which is
 * expected, not a bug.
 */
export function ThreePidSection({ client }: { client: MatrixClient }) {
  const { t } = useTranslation();
  const [threePids, setThreePids] = useState<OwnThreePid[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [pending, setPending] = useState<PendingEmailValidation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    void getOwnThreePids(client).then(setThreePids).catch(() => undefined);
  }, [client]);

  async function refresh() {
    setThreePids(await getOwnThreePids(client).catch(() => []));
  }

  async function handleRequestAdd() {
    const email = newEmail.trim();
    if (!email || busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await requestAddEmail(client, email);
      setPending(result);
      setInfo(t("threePid.sentInfo", { email }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      await confirmAddEmail(client, pending, async () => {
        // Only reached if the homeserver requires UIA (password
        // re-confirmation) for this specific operation - never stored.
        return (await uiPrompt(t("threePid.uiaPrompt"))) ?? "";
      });
      setPending(null);
      setNewEmail("");
      setInfo(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(threePid: OwnThreePid) {
    if (!(await uiConfirm(t("threePid.removeConfirm", { address: threePid.address }), { danger: true }))) return;
    setBusy(true);
    try {
      await removeThreePid(client, threePid.medium, threePid.address);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="mb-1 text-xs font-bold uppercase text-muted">{t("threePid.title")}</h3>
      <p className="mb-2 text-xs text-muted">{t("threePid.hint")}</p>
      {threePids.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {threePids.map((tp) => (
            <div key={`${tp.medium}:${tp.address}`} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-normal">
                <Sensitive>{tp.address}</Sensitive>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRemove(tp)}
                className="shrink-0 text-xs font-medium text-link hover:underline disabled:opacity-50"
              >
                {t("threePid.remove")}
              </button>
            </div>
          ))}
        </div>
      )}
      {pending ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleConfirm()}
          className="w-full rounded bg-brand py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? t("threePid.confirming") : t("threePid.confirm")}
        </button>
      ) : (
        <div className="flex gap-2">
          <input
            type="email"
            aria-label={t("threePid.emailPlaceholder")}
            className={modalInputClass()}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder={t("threePid.emailPlaceholder")}
          />
          <button
            type="button"
            disabled={busy || !newEmail.trim()}
            onClick={() => void handleRequestAdd()}
            className="shrink-0 rounded bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {t("threePid.send")}
          </button>
        </div>
      )}
      {info && <p aria-live="polite" className="mt-2 rounded bg-brand/10 px-3 py-2 text-xs text-normal">{info}</p>}
      {error && <p role="alert" className="mt-2 rounded bg-dnd/10 px-3 py-2 text-xs text-dnd">{error}</p>}
    </div>
  );
}
