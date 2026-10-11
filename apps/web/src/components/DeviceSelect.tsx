import { useEffect, useState } from "react";
import { useTranslation } from "../i18n";
import { modalInputClass } from "./Modal";

function deviceKindLabel(kind: "audioinput" | "videoinput" | "audiooutput", t: (key: string) => string): string {
  if (kind === "audioinput") return t("settings.microphone");
  if (kind === "videoinput") return t("settings.camera");
  return t("settings.speaker");
}

/**
 * Camera/microphone picker, shared by the Voice & Video settings pane and
 * the in-call settings panel so both read/write the same localStorage
 * preference (see mediaDevicePrefs.ts) and stay in sync with each other.
 */
export function DeviceSelect({
  kind,
  value,
  onChange,
  label,
}: {
  kind: "audioinput" | "videoinput" | "audiooutput";
  value: string | undefined;
  onChange: (deviceId: string | null) => void;
  label: string;
}) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        let all = await navigator.mediaDevices.enumerateDevices();
        // Chromium-family browsers return every device UNLABELLED ("Speaker
        // 1", "Microphone 1", ...) until SOME getUserMedia grant exists on
        // this origin - real bug hit live: opening the device picker before
        // ever joining a call (or on a fresh profile) showed only generic
        // names for mic/camera/speaker alike, because nothing had ever
        // unlocked them. A one-off throwaway grant, stopped immediately,
        // unlocks real labels for every kind at once (including
        // audiooutput, which has no permission gate of its own).
        const noneLabelled = all.length > 0 && all.every((d) => !d.label);
        if (noneLabelled && navigator.mediaDevices.getUserMedia) {
          try {
            const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            for (const track of probe.getTracks()) track.stop();
            all = await navigator.mediaDevices.enumerateDevices();
          } catch {
            // Permission denied/no devices - fall back to the generic labels.
          }
        }
        if (!cancelled) setDevices(all.filter((d) => d.kind === kind));
      } catch {
        // No mediaDevices support (insecure context, etc.) - the list just
        // stays empty and the "system default" option still works fine.
      }
    }
    void load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", load);
    };
  }, [kind]);

  return (
    <label className="block text-sm text-normal">
      <span>{label}</span>
      <select className={modalInputClass()} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t("settings.deviceDefault")}</option>
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${deviceKindLabel(kind, t)} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
