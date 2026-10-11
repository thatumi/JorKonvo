import { getChannelContentRating, type Room } from "@jorkonvo/matrix-core";
import { useState } from "react";
import { useTranslation } from "../i18n";
import {
  ackAgeGate,
  dismissSpoilerChannel,
  hasAckedAgeGate,
  hasDismissedSpoilerChannel,
} from "../lib/channelGateAck";

/**
 * Wraps a channel's message area with Discord's age-restricted confirmation
 * gate (a full block until the viewer confirms) and spoiler-channel warning
 * (a dismissible banner above the messages). A "default" channel renders its
 * children untouched.
 */
export function ChannelContentGate({ room, children }: { room: Room; children: React.ReactNode }) {
  const { t } = useTranslation();
  const rating = getChannelContentRating(room);

  // Keyed on room.roomId by the caller, so this mounts fresh per channel and
  // the initial-state reads below always reflect the current channel.
  const [ageOk, setAgeOk] = useState(() => hasAckedAgeGate(room.roomId));
  const [spoilerDismissed, setSpoilerDismissed] = useState(() => hasDismissedSpoilerChannel(room.roomId));

  if (rating === "age_restricted" && !ageOk) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <svg viewBox="0 0 24 24" className="h-14 w-14 text-muted" fill="currentColor" aria-hidden="true">
          <path d="M12 2 1 21h22L12 2Zm0 4.53L19.53 19H4.47L12 6.53ZM11 10v4h2v-4h-2Zm0 6v2h2v-2h-2Z" />
        </svg>
        <h2 className="text-lg font-bold text-header">{t("channelContent.ageGateTitle")}</h2>
        <p className="max-w-sm text-sm text-muted">{t("channelContent.ageGateBody")}</p>
        <button
          type="button"
          onClick={() => {
            ackAgeGate(room.roomId);
            setAgeOk(true);
          }}
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
        >
          {t("channelContent.ageGateConfirm")}
        </button>
      </div>
    );
  }

  return (
    <>
      {rating === "spoiler" && !spoilerDismissed && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-bg-secondary px-4 py-2 text-sm">
          <span className="text-muted">{t("channelContent.spoilerBanner")}</span>
          <button
            type="button"
            onClick={() => {
              dismissSpoilerChannel(room.roomId);
              setSpoilerDismissed(true);
            }}
            className="shrink-0 rounded bg-bg-modifier-hover px-3 py-1 text-xs font-medium text-normal hover:bg-bg-modifier-active"
          >
            {t("channelContent.spoilerDismiss")}
          </button>
        </div>
      )}
      {children}
    </>
  );
}
