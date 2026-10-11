import { useEffect } from "react";
import { DialogHost } from "./components/DialogHost";
import { LoginScreen } from "./components/LoginScreen";
import { RestoreFailedScreen } from "./components/RestoreFailedScreen";
import { useTranslation } from "./i18n";
import { MainLayout } from "./layout/MainLayout";
import { initChatWallpaper } from "./lib/chatWallpaper";
import { initCustomCss } from "./lib/customCss";
import { initDisplayPrefs } from "./lib/displayPrefs";
import { initHangupOnUnload } from "./lib/hangupOnUnload";
import { initInviteLinkHandler } from "./lib/inviteLinkHandler";
import { initNativeBackButton } from "./lib/nativeBackButton";
import { initPush } from "./lib/push";
import { useAuthStore } from "./state/authStore";
import { useModalStore } from "./state/modalStore";
import { usePendingInviteStore } from "./state/pendingInviteStore";
import { initTheme } from "./state/themeStore";

function App() {
  const { t } = useTranslation();
  const status = useAuthStore((s) => s.status);
  const restore = useAuthStore((s) => s.restore);
  const pendingInviteTarget = usePendingInviteStore((s) => s.target);
  const setPendingInviteTarget = usePendingInviteStore((s) => s.setTarget);
  const openModal = useModalStore((s) => s.open);

  useEffect(() => {
    initCustomCss();
    initDisplayPrefs();
    initChatWallpaper();
    void restore();
    const removeTheme = initTheme();
    const removeBackButton = initNativeBackButton();
    const removeInviteLinkHandler = initInviteLinkHandler();
    const removeHangupOnUnload = initHangupOnUnload();
    const removePush = initPush();
    return () => {
      removeTheme();
      removeBackButton();
      removeInviteLinkHandler();
      removeHangupOnUnload();
      removePush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An invite link can be caught before login finishes restoring (or while
  // logged out entirely) - act on it the moment the app is actually ready
  // to open a modal, then clear it so it isn't replayed on a later status
  // flicker (e.g. switching accounts).
  useEffect(() => {
    if (status === "ready" && pendingInviteTarget) {
      openModal({ type: "joinRoom", initialTarget: pendingInviteTarget });
      setPendingInviteTarget(null);
    }
  }, [status, pendingInviteTarget, openModal, setPendingInviteTarget]);

  let screen: React.ReactNode;
  if (status === "checking") {
    screen = (
      <div className="flex h-full w-full items-center justify-center bg-bg-darkest text-muted">
        {t("common.loading")}
      </div>
    );
  } else if (status === "ready") {
    screen = <MainLayout />;
  } else if (status === "restoreFailed") {
    screen = <RestoreFailedScreen />;
  } else {
    screen = <LoginScreen />;
  }

  return (
    <>
      {screen}
      {/* The themed alert/confirm/prompt overlay (lib/dialogs.ts). Mounted at
          the app root so it works logged-out too (the sign-up link copy uses
          uiAlert), and above everything else. Renders null when idle. */}
      <DialogHost />
    </>
  );
}

export default App;
