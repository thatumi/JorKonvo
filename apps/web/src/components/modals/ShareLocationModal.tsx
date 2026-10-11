import { sendLiveLocationUpdate, sendStaticLocation, startLiveLocationShare } from "@jorkonvo/matrix-core";
import { useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useLocationShareStore } from "../../state/locationShareStore";
import { useModalStore } from "../../state/modalStore";
import { Modal, ModalPrimaryButton } from "../Modal";

const LIVE_DURATIONS = [
  { labelKey: "shareLoc.min15", ms: 15 * 60 * 1000 },
  { labelKey: "shareLoc.hour1", ms: 60 * 60 * 1000 },
  { labelKey: "shareLoc.hour8", ms: 8 * 60 * 60 * 1000 },
];

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("geolocation-unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 });
  });
}

/**
 * Share the device's geolocation into a room: either a one-off static pin or
 * a live share that keeps updating for a chosen duration (15 min / 1 h / 8 h).
 *
 * @param roomId - ID of the room the location is shared into.
 */
export function ShareLocationModal({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const startShare = useLocationShareStore((s) => s.start);
  const [busy, setBusy] = useState<"once" | "live" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleOnce() {
    setBusy("once");
    setError(null);
    try {
      const pos = await getPosition();
      await sendStaticLocation(client, roomId, {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy,
      });
      close();
    } catch (err) {
      setError(mapErr((err as Error).message));
    } finally {
      setBusy(null);
    }
  }

  async function handleLive(durationMs: number) {
    setBusy("live");
    setError(null);
    try {
      const pos = await getPosition();
      const beaconInfoEventId = await startLiveLocationShare(client, roomId, durationMs);
      // A dummy watchId placeholder is fine here - LiveLocationSharer starts
      // its own real watchPosition subscription off the store's `active`
      // field and immediately replaces whatever watch id is here.
      startShare({ roomId, beaconInfoEventId, expiresAt: Date.now() + durationMs }, -1);
      // Send the position we already have as the very first ping, so the
      // card shows a location right away instead of waiting on the
      // sharer's own watchPosition to fire.
      await sendLiveLocationUpdate(client, roomId, beaconInfoEventId, {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy,
      });
      close();
    } catch (err) {
      setError(mapErr((err as Error).message));
    } finally {
      setBusy(null);
    }
  }

  const mapErr = (m: string) => (m === "geolocation-unsupported" ? t("shareLoc.unsupported") : m);

  return (
    <Modal title={t("shareLoc.title")} onClose={close}>
      <p className="mb-3 text-xs text-muted">{t("shareLoc.permissionNote")}</p>

      <div className="mb-4">
        <ModalPrimaryButton type="button" disabled={busy !== null} onClick={() => void handleOnce()}>
          {busy === "once" ? t("shareLoc.sharingOnce") : t("shareLoc.shareOnce")}
        </ModalPrimaryButton>
      </div>

      <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("shareLoc.liveTitle")}</span>
      <div className="flex gap-1.5">
        {LIVE_DURATIONS.map((d) => (
          <button
            key={d.labelKey}
            type="button"
            disabled={busy !== null}
            onClick={() => void handleLive(d.ms)}
            className="flex-1 rounded border border-border py-2 text-sm font-medium text-normal transition hover:border-brand hover:text-header disabled:opacity-50"
          >
            {busy === "live" ? "…" : t(d.labelKey)}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mt-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
    </Modal>
  );
}
