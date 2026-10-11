import { getWatchTogetherSession, parseWatchTogetherInvite, type Room } from "@jorkonvo/matrix-core";
import { type MatrixEvent } from "matrix-js-sdk";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";

const PlayIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7L8 5Z" />
  </svg>
);

/**
 * The clickable, permanent trace of a watch-together session in the
 * timeline - see watchTogether.ts for why this exists alongside the
 * room-state session. Still-live sessions get a working "Join" button;
 * once the session has moved on (stopped, or replaced by a newer one) the
 * card just shows as ended, the same treatment CalendarEventCard gives a
 * past event.
 */
export function WatchTogetherInviteCard({ ev, room }: { ev: MatrixEvent; room: Room }) {
  const { t } = useTranslation();
  useMatrixStore((s) => s.syncTick);
  const requestJoin = useUiStore((s) => s.requestWatchTogetherJoin);

  const invite = parseWatchTogetherInvite(ev);
  if (!invite) return null;

  const session = getWatchTogetherSession(room);
  const isLive = session?.videoId === invite.videoId && session?.hostUserId === invite.hostUserId;
  const hostName = room.getMember(invite.hostUserId)?.name ?? invite.hostUserId;

  return (
    <div className="mt-1 flex max-w-md items-center gap-3 rounded-lg border border-border bg-bg-secondary p-3">
      <img
        src={`https://i.ytimg.com/vi/${invite.videoId}/mqdefault.jpg`}
        alt=""
        className="h-12 w-20 shrink-0 rounded object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-brand">
          {PlayIcon}
          <span className="text-sm font-medium text-header">{t("watchTogether.inviteTitle")}</span>
        </div>
        <p className="truncate text-xs text-muted">{t("watchTogether.hostedBy", { name: hostName })}</p>
      </div>
      {isLive ? (
        <button
          type="button"
          onClick={() => requestJoin(room.roomId)}
          className="shrink-0 rounded bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover"
        >
          {t("watchTogether.join")}
        </button>
      ) : (
        <span className="shrink-0 text-xs text-muted">{t("watchTogether.ended")}</span>
      )}
    </div>
  );
}
