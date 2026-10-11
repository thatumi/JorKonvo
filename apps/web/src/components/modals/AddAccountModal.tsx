import { type FormEvent, useState } from "react";
import { useTranslation } from "../../i18n";
import { HOMESERVER_PRESETS } from "../../lib/homeserverPresets";
import { useAuthStore } from "../../state/authStore";
import { useModalStore } from "../../state/modalStore";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

/** Adds a SECOND (or further) account alongside the ones already stored, then switches to it - the account-switcher's "+" button. */
export function AddAccountModal() {
  const { t } = useTranslation();
  const addAccount = useAuthStore((s) => s.addAccount);
  const switching = useAuthStore((s) => s.switching);
  const close = useModalStore((s) => s.close);

  const [homeserverUrl, setHomeserverUrl] = useState(HOMESERVER_PRESETS[0].url);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!homeserverUrl.trim() || !userId.trim() || !password || switching) return;
    setError(null);
    try {
      await addAccount(homeserverUrl.trim(), userId.trim(), password);
      close();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={t("addAccount.title")} onClose={close}>
      <p className="mb-4 text-sm text-muted">{t("addAccount.summary")}</p>
      <form onSubmit={handleSubmit}>
        <ModalField label={t("login.homeserver")}>
          <input
            className={modalInputClass()}
            value={homeserverUrl}
            onChange={(e) => setHomeserverUrl(e.target.value)}
            placeholder="https://matrix.example.com"
            autoComplete="url"
          />
        </ModalField>
        <ModalField label={t("addAccount.usernameLabel")}>
          <input
            className={modalInputClass()}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder={t("login.usernamePlaceholder")}
            autoComplete="username"
            autoFocus
          />
        </ModalField>
        <ModalField label={t("login.password")}>
          <input
            type="password"
            className={modalInputClass()}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </ModalField>
        {error && <p role="alert" className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" disabled={!homeserverUrl.trim() || !userId.trim() || !password || switching}>
          {switching ? t("addAccount.signingIn") : t("addAccount.signIn")}
        </ModalPrimaryButton>
      </form>
    </Modal>
  );
}
