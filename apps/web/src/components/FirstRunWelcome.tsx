import { useEffect, useState } from "react";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";
import { useModalStore } from "../state/modalStore";
import { useUiStore } from "../state/uiStore";
import { Modal } from "./Modal";

const SEEN_KEY = "jorkonvo-welcomed";

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}
function alreadySeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * A one-time welcome shown to a brand-new account the first time it reaches
 * the app with nothing in it - a Matrix client drops you into an empty
 * three-pane shell otherwise, with no hint of what to do. Each button just
 * opens an existing flow. Dismissing it (any button, or "Explore on my
 * own") sets a localStorage flag so it never shows again; a restored
 * session with existing rooms never sees it at all.
 */
export function FirstRunWelcome() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client);
  useMatrixStore((s) => s.syncTick);
  const openModal = useModalStore((s) => s.open);
  const openFriends = useUiStore((s) => s.openFriends);
  const [dismissed, setDismissed] = useState(alreadySeen);

  // Decide once, when the client first has a settled room list: a fresh
  // account has zero joined rooms/spaces.
  const [shouldShow, setShouldShow] = useState(false);
  useEffect(() => {
    if (dismissed || !client) return;
    const joined = client.getRooms().filter((r) => r.getMyMembership() === "join");
    if (joined.length === 0) setShouldShow(true);
  }, [client, dismissed]);

  if (dismissed || !shouldShow) return null;

  function done(action?: () => void) {
    markSeen();
    setDismissed(true);
    action?.();
  }

  return (
    <Modal title={t("welcome.title")} onClose={() => done()}>
      <p className="mb-5 text-sm text-muted">{t("welcome.body")}</p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          data-testid="welcome-friends"
          onClick={() => done(openFriends)}
          className="w-full rounded bg-brand py-2.5 text-sm font-medium text-white hover:bg-brand-hover"
        >
          {t("welcome.friends")}
        </button>
        <button
          type="button"
          data-testid="welcome-create-space"
          onClick={() => done(() => openModal({ type: "createSpace" }))}
          className="w-full rounded border border-border py-2.5 text-sm font-medium text-normal hover:bg-bg-modifier-hover"
        >
          {t("welcome.createSpace")}
        </button>
        <button
          type="button"
          data-testid="welcome-discover"
          onClick={() => done(() => openModal({ type: "discoverSpaces" }))}
          className="w-full rounded border border-border py-2.5 text-sm font-medium text-normal hover:bg-bg-modifier-hover"
        >
          {t("welcome.discover")}
        </button>
      </div>
      <button
        type="button"
        data-testid="welcome-skip"
        onClick={() => done()}
        className="mt-3 w-full rounded py-2 text-sm font-medium text-muted hover:text-normal"
      >
        {t("welcome.skip")}
      </button>
    </Modal>
  );
}
