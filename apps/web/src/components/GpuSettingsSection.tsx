import { useEffect, useState } from "react";
import { useTranslation } from "../i18n";

interface GpuSettings {
  hwDecode: boolean;
  hwEncode: boolean;
  softwareRender: boolean;
}
interface GpuInfo {
  settings: GpuSettings;
  gpuPresent: boolean;
  vaapiDriverFound: boolean;
}
interface GpuBridge {
  get: () => Promise<GpuInfo>;
  set: (settings: GpuSettings) => Promise<void>;
  relaunch: () => Promise<void>;
}

function gpuBridge(): GpuBridge | undefined {
  return (window.jorkonvoDesktop as { gpu?: GpuBridge } | undefined)?.gpu;
}

/**
 * Linux desktop (CEF) only: hardware video decode / encode and a software-render
 * escape hatch. The CEF command line is fixed at process start, so every change
 * is saved right away but only takes effect after a restart. Renders nothing in
 * the browser, on Windows/macOS and in the Android app (no `gpu` bridge there).
 */
export function GpuSettingsSection() {
  const { t } = useTranslation();
  const bridge = gpuBridge();
  const [info, setInfo] = useState<GpuInfo | null>(null);
  const [saved, setSaved] = useState<GpuSettings | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    bridge
      .get()
      .then((i) => {
        setInfo(i);
        setSaved(i.settings);
      })
      .catch(() => setError(true));
  }, [bridge]);

  if (!bridge || error || !info) return null;
  const s = info.settings;
  const restartNeeded = saved !== null && JSON.stringify(saved) !== JSON.stringify(s);
  const noHwVideo = !info.gpuPresent || !info.vaapiDriverFound;

  function update(patch: Partial<GpuSettings>) {
    const next = { ...s, ...patch };
    setInfo((prev) => (prev ? { ...prev, settings: next } : prev));
    bridge!.set(next).catch(() => setError(true));
  }

  const row = "flex items-start justify-between gap-3 text-sm text-normal";
  return (
    <div className="mt-4 border-t border-border pt-3" data-testid="gpu-settings">
      <h4 className="mb-1 text-xs font-bold uppercase text-muted">{t("settings.gpu")}</h4>
      <p className="mb-2 text-xs text-muted">{t("settings.gpuHint")}</p>
      {noHwVideo && <p className="mb-2 text-xs text-amber-500">{t("settings.gpuNoDriver")}</p>}
      <div className="flex flex-col gap-2">
        <label className={row}>
          <span>
            {t("settings.gpuHwDecode")}
            <span className="block text-xs text-muted">{t("settings.gpuHwDecodeHint")}</span>
          </span>
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0"
            checked={s.hwDecode && !s.softwareRender}
            disabled={s.softwareRender}
            onChange={(e) => update({ hwDecode: e.target.checked })}
          />
        </label>
        <label className={row}>
          <span>
            {t("settings.gpuHwEncode")}
            <span className="block text-xs text-muted">{t("settings.gpuHwEncodeHint")}</span>
          </span>
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0"
            checked={s.hwEncode && !s.softwareRender}
            disabled={s.softwareRender}
            onChange={(e) => update({ hwEncode: e.target.checked })}
          />
        </label>
        <label className={row}>
          <span>
            {t("settings.gpuSoftware")}
            <span className="block text-xs text-muted">{t("settings.gpuSoftwareHint")}</span>
          </span>
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0"
            checked={s.softwareRender}
            onChange={(e) => update({ softwareRender: e.target.checked })}
          />
        </label>
      </div>
      {restartNeeded && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <span className="text-muted">{t("settings.gpuRestartNeeded")}</span>
          <button
            type="button"
            onClick={() => void bridge.relaunch()}
            className="rounded bg-brand px-3 py-1 text-sm font-medium text-white hover:bg-brand-hover"
          >
            {t("settings.gpuRestart")}
          </button>
        </div>
      )}
    </div>
  );
}
