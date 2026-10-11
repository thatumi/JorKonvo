import { getBeaconForEvent, getMapLink, stopLiveLocationShare, type Room } from "@jorkonvo/matrix-core";
import { type MatrixEvent } from "matrix-js-sdk";
import { useEffect, useState } from "react";
import { t as translate, useTranslation } from "../i18n";
import { useLocationShareStore } from "../state/locationShareStore";
import { useMatrixStore } from "../state/matrixStore";

function relativeTime(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return translate("liveLoc.secondsAgo", { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return translate("liveLoc.minutesAgo", { count: minutes });
  return translate("liveLoc.hoursAgo", { count: Math.round(minutes / 60) });
}

const LiveDotIcon = (
  <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 shrink-0 text-dnd" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="12" r="12" />
  </svg>
);

const PinIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-brand" fill="currentColor" aria-hidden="true">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
  </svg>
);

/**
 * Timeline card for a live location share (beacon info event): a live/ended
 * status line, optional description, a map link for the latest ping, a
 * relative "updated X ago" time, and a stop-sharing control for the owner.
 *
 * @param ev - The beacon info matrix event this card represents.
 * @param room - The room the share lives in (resolves the beacon and its points).
 */
export function LiveLocationCard({ ev, room }: { ev: MatrixEvent; room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const stopShareLocally = useLocationShareStore((s) => s.stop);
  const [busy, setBusy] = useState(false);
  // Ticks once a second so "X másodperce" stays fresh even when nothing else
  // triggers a re-render.
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const beacon = getBeaconForEvent(room, ev);
  if (!beacon) return null;

  const isOwner = beacon.ownerId === client.getUserId();

  async function handleStop() {
    setBusy(true);
    try {
      await stopLiveLocationShare(client, room.roomId);
      stopShareLocally();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 max-w-xs rounded-lg border border-border bg-bg-secondary p-3">
      <div className="mb-1 flex items-center gap-1.5" aria-live="polite">
        {beacon.isLive ? (
          <>
            {LiveDotIcon}
            <span className="text-sm font-medium text-header">{t("liveLoc.title")}</span>
          </>
        ) : (
          <>
            {PinIcon}
            <span className="text-sm font-medium text-muted">{t("liveLoc.ended")}</span>
          </>
        )}
      </div>
      {beacon.description && <p className="mb-1 text-xs text-muted">{beacon.description}</p>}
      {beacon.lastPoint ? (
        <a href={getMapLink(beacon.lastPoint)} target="_blank" rel="noreferrer" className="text-xs text-link hover:underline">
          {t("liveLoc.openMap")}
        </a>
      ) : (
        <p className="text-xs text-muted">{t("liveLoc.waiting")}</p>
      )}
      {beacon.lastUpdateTs && (
        <p className="mt-1 text-[11px] text-muted">{t("liveLoc.updated", { time: relativeTime(beacon.lastUpdateTs) })}</p>
      )}
      {isOwner && beacon.isLive && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleStop()}
          className="mt-2 text-xs font-medium text-dnd hover:underline disabled:opacity-50"
        >
          {t("liveLoc.stop")}
        </button>
      )}
    </div>
  );
}
