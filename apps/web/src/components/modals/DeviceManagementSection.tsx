import {
  deleteDeviceOrRequireAuth,
  deleteDeviceWithPassword,
  type DeviceInfo,
  listDevices,
  type MatrixClient,
} from "@jorkonvo/matrix-core";
import { useEffect, useState } from "react";
import { t as tr, useTranslation } from "../../i18n";
import { uiConfirm } from "../../lib/dialogs";
import { useVerificationStore } from "../../state/verificationStore";
import { modalInputClass } from "../Modal";

function formatLastSeen(ts: number | undefined): string {
  if (!ts) return tr("devices.unknown");
  const diffMin = Math.round((Date.now() - ts) / 60000);
  if (diffMin < 1) return tr("devices.justNow");
  if (diffMin < 60) return tr("devices.minutesAgo", { count: diffMin });
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return tr("devices.hoursAgo", { count: diffHour });
  return tr("devices.daysAgo", { count: Math.round(diffHour / 24) });
}

function DeviceRow({
  device,
  client,
  onRemoved,
}: {
  device: DeviceInfo;
  client: MatrixClient;
  onRemoved: (deviceId: string) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const startVerification = useVerificationStore((s) => s.start);

  async function startSignOut() {
    if (!(await uiConfirm(t("devices.signOutConfirmNamed", { name: device.displayName }), { danger: true }))) return;
    setBusy(true);
    setError(null);
    try {
      const session = await deleteDeviceOrRequireAuth(client, device.deviceId);
      if (session) {
        setPendingSession(session);
      } else {
        onRemoved(device.deviceId);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmWithPassword() {
    if (!pendingSession || !password) return;
    setBusy(true);
    setError(null);
    try {
      await deleteDeviceWithPassword(client, device.deviceId, client.getUserId() ?? "", password, pendingSession);
      onRemoved(device.deviceId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-normal">{device.displayName}</span>
            {device.isCurrent && (
              <span className="shrink-0 rounded-full bg-online/20 px-1.5 py-0.5 text-[10px] font-bold text-online">
                {t("devices.thisDevice")}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted">
            {device.deviceId} · {t("devices.lastActive", { when: formatLastSeen(device.lastSeenTs), ip: device.lastSeenIp ?? "?" })}
          </p>
        </div>
        {!device.isCurrent && (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              data-testid="devices-verify"
              data-device-id={device.deviceId}
              disabled={busy}
              // requestUserVerification (matrix-core) targets the account's
              // own userId, not a specific deviceId - same "picks the first
              // known device" limitation documented there for cross-user
              // verification. Fine with exactly one other session (the
              // common case this button is for); a full device picker is a
              // possible future improvement if that ever needs to change.
              onClick={() => void startVerification(client, client.getUserId() ?? "")}
              className="rounded border border-border px-2 py-1 text-xs font-medium text-normal transition hover:bg-bg-modifier-hover disabled:opacity-60"
            >
              {t("devices.verify")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void startSignOut()}
              className="rounded border border-dnd px-2 py-1 text-xs font-medium text-dnd transition hover:bg-dnd/10 disabled:opacity-60"
            >
              {t("devices.signOut")}
            </button>
          </div>
        )}
      </div>
      {pendingSession && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("devices.passwordPlaceholder")}
            aria-label={t("devices.passwordPlaceholder")}
            className={modalInputClass()}
          />
          <button
            type="button"
            disabled={busy || !password}
            onClick={() => void confirmWithPassword()}
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
 * Lists the account's devices/sessions (via `listDevices`) and lets the user
 * sign out other ones, with UIA password confirmation when the server requires it.
 * @param client - signed-in Matrix client used to list and delete devices.
 */
export function DeviceManagementSection({ client }: { client: MatrixClient }) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listDevices(client)
      .then(setDevices)
      .catch((err) => setError((err as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("devices.title")}</h3>
      {error && <p role="alert" className="text-sm text-dnd">{t("devices.error", { error })}</p>}
      {!devices && !error && <p className="text-sm text-muted">{t("common.loading")}</p>}
      <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {devices?.map((d) => (
          <DeviceRow
            key={d.deviceId}
            device={d}
            client={client}
            onRemoved={(id) => setDevices((prev) => prev?.filter((x) => x.deviceId !== id) ?? null)}
          />
        ))}
      </div>
    </div>
  );
}
