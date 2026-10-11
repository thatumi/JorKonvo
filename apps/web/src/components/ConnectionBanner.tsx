import { SyncState } from "@jorkonvo/matrix-core";
import { useEffect, useState } from "react";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";

/**
 * A thin status strip shown only while the connection is degraded - the
 * browser reports itself offline, or the Matrix sync loop is retrying /
 * has errored / hasn't produced its first response yet. It disappears the
 * moment sync is healthy again, so in the normal case it renders nothing.
 *
 * Sync state is re-read from the live client on every `syncTick` bump
 * (authStore already forwards `ClientEvent.Sync` into that counter), plus
 * the window online/offline events for the browser-level signal.
 */
export function ConnectionBanner() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client);
  useMatrixStore((s) => s.syncTick);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!client) return null;

  const syncState = client.getSyncState();

  let message: string | null = null;
  if (!online) {
    message = t("connection.offline");
  } else if (syncState === SyncState.Error || syncState === SyncState.Reconnecting) {
    message = t("connection.reconnecting");
  } else if (syncState === null || syncState === SyncState.Catchup) {
    // No sync response yet (first connect, or resuming a stopped client).
    message = t("connection.connecting");
  }

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-banner"
      className="flex shrink-0 items-center justify-center gap-2 bg-idle px-4 py-1 text-xs font-medium text-black"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full bg-black/60 ${online ? "animate-pulse" : ""}`}
        aria-hidden="true"
      />
      {message}
    </div>
  );
}
