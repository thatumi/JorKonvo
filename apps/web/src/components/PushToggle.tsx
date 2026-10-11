import { useEffect, useState } from "react";
import { useTranslation } from "../i18n";
import { isNativePlatform } from "../lib/platform";
import { disablePush, enablePush, getPushState, type PushState } from "../lib/push";
import { getPreviewMode, isNativeStoreSupported, type PreviewMode, setPreviewMode } from "../lib/push/nativeStore";
import { useMatrixStore } from "../state/matrixStore";

/**
 * "Background notifications" toggle for User Settings → Notifications:
 * Web Push in a browser, APNs/FCM in the iOS/Android app. Self-contained
 * (its own state + i18n keys) so it drops into the big settings modal
 * without touching its state. Renders nothing where push can't work
 * (desktop app, or a build without a push gateway).
 */
export function PushToggle() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewMode>(getPreviewMode);
  const native = isNativePlatform();
  // Where the device itself resolves the notification (push phase 2).
  const onDevice = isNativeStoreSupported();

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void getPushState(client).then((s) => !cancelled && setState(s));
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (!client || state === null || state === "unconfigured") return null;
  if (state === "unsupported" && native) return null;

  const on = state === "on";
  const disabled = busy || state === "unsupported" || state === "denied";

  async function toggle() {
    if (!client || disabled) return;
    setBusy(true);
    setError(null);
    try {
      setState(on ? await disablePush(client) : await enablePush(client));
    } catch (err) {
      // Never swallow this - "the toggle does nothing" is undebuggable on a phone.
      setError((err as Error).message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function changePreview(mode: PreviewMode) {
    if (!client) return;
    setPreview(mode);
    setError(null);
    try {
      await setPreviewMode(client, mode);
    } catch (err) {
      setError((err as Error).message || String(err));
    }
  }

  const hint =
    state === "unsupported"
      ? t("settings.webPushUnsupported")
      : state === "denied"
        ? t(native ? "settings.pushDeniedNative" : "settings.webPushDenied")
        : t(native ? "settings.pushHintNative" : "settings.webPushHint");

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="mb-2 text-xs font-bold uppercase text-muted">{t("settings.webPush")}</h3>
      <label className="flex items-center justify-between gap-3 text-sm text-normal">
        <span>
          {t("settings.webPushLabel")}
          <span className="block text-xs font-normal text-muted">{hint}</span>
          <span className="block text-xs font-normal text-muted">
            {t(onDevice ? "settings.pushPrivacyNoteDevice" : "settings.pushPrivacyNote")}
          </span>
        </span>
        <input
          type="checkbox"
          data-testid="settings-webpush-toggle"
          checked={on}
          disabled={disabled}
          onChange={() => void toggle()}
          className="h-4 w-4 shrink-0"
        />
      </label>
      {onDevice && on && (
        <label className="mt-3 block text-sm text-normal">
          {t("settings.pushPreview")}
          <select
            data-testid="settings-push-preview"
            value={preview}
            onChange={(e) => void changePreview(e.target.value as PreviewMode)}
            className="mt-1 block w-full rounded bg-bg-darkest px-2 py-1.5 text-sm text-normal"
          >
            <option value="full">{t("settings.pushPreviewFull")}</option>
            <option value="sender">{t("settings.pushPreviewSender")}</option>
            <option value="hidden">{t("settings.pushPreviewHidden")}</option>
          </select>
          <span className="mt-1 block text-xs font-normal text-muted">{t(`settings.pushPreviewHint_${preview}`)}</span>
        </label>
      )}
      {error && (
        <p className="mt-2 text-xs text-danger" role="alert" data-testid="settings-push-error">
          {t("settings.pushError", { error })}
        </p>
      )}
    </div>
  );
}
