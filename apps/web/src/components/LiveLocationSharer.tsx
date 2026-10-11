import { sendLiveLocationUpdate } from "@jorkonvo/matrix-core";
import { useEffect } from "react";
import { useMatrixStore } from "../state/matrixStore";
import { useLocationShareStore } from "../state/locationShareStore";

const MIN_SEND_INTERVAL_MS = 15000;

/**
 * Invisible component, mounted once globally (alongside NotificationManager/
 * EventReminders): owns the browser geolocation watch and periodic m.beacon
 * pings for whatever live share is currently active (see
 * locationShareStore.ts - at most one at a time). Started/stopped
 * declaratively by writing to the store rather than owning the watch itself,
 * so it survives the ShareLocationModal that kicked it off closing.
 *
 * Same honest limitation as auto-away: this only runs while the tab is open
 * and the store is in memory - a reload stops fresh pings from this session
 * (the beacon itself still naturally expires via its own timeout server-side,
 * it just won't get updated further).
 */
export function LiveLocationSharer() {
  const client = useMatrixStore((s) => s.client);
  const active = useLocationShareStore((s) => s.active);
  const stop = useLocationShareStore((s) => s.stop);

  useEffect(() => {
    if (!active || !client) return;
    const activeClient = client;
    const activeShare = active;
    let lastSentAt = 0;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSentAt < MIN_SEND_INTERVAL_MS) return;
        lastSentAt = now;
        void sendLiveLocationUpdate(activeClient, activeShare.roomId, activeShare.beaconInfoEventId, {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy,
        });
      },
      () => {
        // A GPS hiccup shouldn't kill the whole share - the next watchPosition
        // callback (or the expiry timer below) will resolve it either way.
      },
      { enableHighAccuracy: true },
    );

    const expiryTimer = setTimeout(() => stop(), Math.max(0, activeShare.expiresAt - Date.now()));

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(expiryTimer);
    };
  }, [active?.roomId, active?.beaconInfoEventId, active?.expiresAt, client, stop]);

  return null;
}
