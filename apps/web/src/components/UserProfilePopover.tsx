import {
  type ActivityStatus,
  banMember,
  canBan,
  canKick,
  canManageRoles,
  getActivity,
  getBanner,
  getBio,
  getFriendRequests,
  getFriends,
  getMemberRoleColor,
  getMemberRoleIds,
  getOwningSpace,
  getSpaceRoles,
  isUserIgnored,
  kickMember,
  type MatrixClient,
  removeFriend,
  type Room,
  sendFriendRequest,
  setMemberRoleAssigned,
  setUserIgnored,
  startDirectMessage,
} from "@jorkonvo/matrix-core";
import { formatDistanceToNow } from "date-fns";
import { dfLocale } from "../lib/dateLocale";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../i18n";
import { useAuthedMedia } from "../lib/authedMedia";
import { uiConfirm } from "../lib/dialogs";
import { useProfileFlair } from "../lib/profileFlair";
import { RoleBadges } from "./RoleBadges";
import { VerifiedBadge } from "./VerifiedBadge";
import { useDisplayPrefsStore } from "../lib/displayPrefs";
import { useUiStore } from "../state/uiStore";
import { useVerificationStore } from "../state/verificationStore";
import { Avatar } from "./Avatar";

const POPOVER_WIDTH = 280;
const POPOVER_MAX_HEIGHT = 360;

function presenceLabelKey(presence: string | undefined): string {
  switch (presence) {
    case "online":
      return "profile.presenceOnline";
    case "unavailable":
      return "profile.presenceIdle";
    default:
      return "profile.presenceOffline";
  }
}

function presenceColor(presence: string | undefined): string {
  switch (presence) {
    case "online":
      return "var(--color-online)";
    case "unavailable":
      return "var(--color-idle)";
    default:
      return "var(--color-offline)";
  }
}

/**
 * Discord-style profile card rendered in a portal when a member's name or
 * avatar is clicked: presence, bio, activity, space roles, plus friend/E2EE
 * and moderation actions. Deliberately a NON-modal popover - it closes on Esc
 * or an outside click (listeners below) but doesn't trap focus or block the
 * rest of the UI.
 *
 * @param userId - Matrix ID of the user whose profile is shown.
 * @param client - Signed-in Matrix client used for all data and actions.
 * @param room - Optional room; when given, room-scoped actions (kick/ban) are offered if permitted.
 * @param anchorEl - Element the popover is positioned against (also exempt from outside-click closing).
 * @param onClose - Callback that dismisses the popover.
 */
export function UserProfilePopover({
  userId,
  client,
  room,
  anchorEl,
  onClose,
}: {
  userId: string;
  client: MatrixClient;
  /** When provided, room-scoped actions (kick/ban) are offered if permitted. */
  room?: Room | null;
  anchorEl: HTMLElement;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const [busy, setBusy] = useState(false);
  const selectRoom = useUiStore((s) => s.selectRoom);
  const developerMode = useDisplayPrefsStore((s) => s.developerMode);
  const startVerification = useVerificationStore((s) => s.start);
  const verificationRequest = useVerificationStore((s) => s.request);

  useEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    const spaceAbove = rect.top;
    const openUpward = spaceAbove > POPOVER_MAX_HEIGHT || spaceAbove > window.innerHeight - rect.bottom;

    let left = rect.right;
    left = Math.max(8, Math.min(left, window.innerWidth - POPOVER_WIDTH - 8));

    const top = openUpward
      ? Math.max(8, rect.top - 8)
      : Math.min(rect.bottom + 8, window.innerHeight - 8);

    setStyle({
      position: "fixed",
      left,
      top,
      transform: openUpward ? "translateY(-100%)" : undefined,
      maxHeight: POPOVER_MAX_HEIGHT,
    });
  }, [anchorEl]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node) && e.target !== anchorEl) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, anchorEl]);

  const ownUserId = client.getUserId() ?? "";
  const isSelf = userId === ownUserId;
  const user = client.getUser(userId);
  const member = room?.getMember(userId) ?? null;
  const name = member?.name || user?.displayName || userId;
  const avatarUrl = member
    ? member.getAvatarUrl(client.baseUrl, 64, 64, "crop", false, false)
    : (user?.avatarUrl ? client.mxcUrlToHttp(user.avatarUrl, 64, 64, "crop") : null);
  const statusMsg = user?.presenceStatusMsg;

  const mayKick = room && !isSelf && canKick(room, ownUserId, userId);
  const mayBan = room && !isSelf && canBan(room, ownUserId, userId);
  const owningSpace = room ? getOwningSpace(client, room.roomId) : null;
  const spaceRoles = owningSpace ? getSpaceRoles(owningSpace) : [];
  const memberRoleIds = owningSpace ? new Set(getMemberRoleIds(owningSpace, userId)) : new Set<string>();
  const mayManageRoles = owningSpace ? canManageRoles(owningSpace, ownUserId) : false;
  const nameColor = owningSpace ? getMemberRoleColor(owningSpace, userId) : null;
  const [ignored, setIgnored] = useState(() => isUserIgnored(client, userId));
  const isFriend = getFriends(client).includes(userId);
  const requestOutgoing = getFriendRequests(client).outgoing.some((r) => r.userId === userId);
  const [friendBusy, setFriendBusy] = useState(false);
  const [bio, setBio] = useState<string | null>(null);
  const [bannerMxc, setBannerMxc] = useState<string | null>(null);
  const bannerUrl = useAuthedMedia(bannerMxc, { width: POPOVER_WIDTH * 2, height: 112, method: "scale", animated: true });
  const flair = useProfileFlair(userId);
  const [activity, setActivity] = useState<ActivityStatus | null>(null);

  useEffect(() => {
    setBio(null);
    void getBio(client, userId).then(setBio);
  }, [client, userId]);

  useEffect(() => {
    setActivity(null);
    let cancelled = false;
    void getActivity(client, userId).then((a) => {
      if (!cancelled) setActivity(a);
    });
    return () => {
      cancelled = true;
    };
  }, [client, userId]);

  // Live "X perce" elapsed-time ticker for the activity card, same pattern as MessageComposer.tsx's slowmode countdown.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!activity?.startedAt) return;
    const interval = setInterval(() => forceTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, [activity?.startedAt]);

  useEffect(() => {
    setBannerMxc(null);
    void getBanner(client, userId).then(setBannerMxc);
  }, [client, userId]);

  async function handleFriendAction() {
    setFriendBusy(true);
    try {
      if (isFriend) {
        if (await uiConfirm(t("friends.removeConfirm", { name }), { danger: true })) await removeFriend(client, userId);
      } else if (!requestOutgoing) {
        await sendFriendRequest(client, userId);
      }
    } catch (err) {
      console.error("friend action failed", err);
    } finally {
      setFriendBusy(false);
    }
  }

  async function handleDm() {
    setBusy(true);
    try {
      const roomId = await startDirectMessage(client, userId);
      selectRoom(roomId);
      onClose();
    } catch (err) {
      console.error("failed to start DM", err);
      setBusy(false);
    }
  }

  async function handleToggleIgnore() {
    setBusy(true);
    try {
      await setUserIgnored(client, userId, !ignored);
      setIgnored((v) => !v);
    } catch (err) {
      console.error("failed to toggle block", err);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      ref={ref}
      style={style}
      role="dialog"
      aria-label={t("profile.popoverLabel", { name })}
      className="animate-fade-in z-50 w-[280px] overflow-y-auto rounded-lg border border-border bg-bg-secondary shadow-xl ring-1 ring-white/5"
    >
      <div
        className="h-14 bg-cover bg-center"
        style={
          bannerUrl
            ? { backgroundImage: `url(${bannerUrl})` }
            : { backgroundColor: flair.accent ?? "var(--color-brand)", opacity: flair.accent ? 1 : 0.3 }
        }
      />
      <div className="px-4 pb-4">
        <div className="-mt-8 mb-2">
          <Avatar url={avatarUrl} name={name} size={64} statusColor={presenceColor(user?.presence)} decorationMxc={flair.decorationMxc} />
        </div>
        <div className="flex items-center text-base font-semibold" style={nameColor ? { color: nameColor } : { color: "var(--color-header)" }}>
          <span className="truncate">{name}</span>
          <RoleBadges space={owningSpace} userId={userId} size={16} />
          <VerifiedBadge client={client} userId={userId} size={15} />
        </div>
        <button
          type="button"
          onClick={() => {
            if (developerMode) void navigator.clipboard.writeText(userId);
          }}
          title={developerMode ? t("profile.copyId") : undefined}
          className={`block max-w-full truncate text-left text-xs text-muted ${developerMode ? "hover:text-normal" : "cursor-text"}`}
        >
          {userId}
        </button>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: presenceColor(user?.presence) }}
          />
          <span>{t(presenceLabelKey(user?.presence))}</span>
        </div>
        {statusMsg && (
          <p className="mt-1 truncate text-xs italic text-muted" title={statusMsg}>
            {statusMsg}
          </p>
        )}

        {bio && (
          <p className="mt-2 whitespace-pre-wrap text-xs text-normal">{bio}</p>
        )}

        {activity && (
          <div className="mt-2 flex items-center gap-2 rounded bg-bg-darkest px-2.5 py-2">
            <span className="shrink-0 text-lg leading-none" aria-hidden>
              🎮
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-normal">
                {activity.appName ?? t("profile.unknownApp")}
              </div>
              {activity.details && <div className="truncate text-xs text-muted">{activity.details}</div>}
              {activity.state && <div className="truncate text-xs text-muted">{activity.state}</div>}
              {typeof activity.partyCurrent === "number" && typeof activity.partyMax === "number" && (
                <div className="truncate text-xs text-muted">
                  {t("profile.partyCount", { current: activity.partyCurrent, max: activity.partyMax })}
                </div>
              )}
              {activity.startedAt && (
                <div className="truncate text-[10px] text-muted">
                  {t("profile.activityStarted", {
                    time: formatDistanceToNow(activity.startedAt, { addSuffix: true, locale: dfLocale() }),
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {spaceRoles.length > 0 && (
          <div className="mt-2">
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted">{t("profile.roles")}</span>
            <div className="flex flex-wrap gap-1">
              {spaceRoles.map((r) => {
                const has = memberRoleIds.has(r.id);
                if (!mayManageRoles && !has) return null;
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={!mayManageRoles}
                    onClick={() =>
                      owningSpace && void setMemberRoleAssigned(client, owningSpace.roomId, userId, r.id, !has)
                    }
                    className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition disabled:cursor-default"
                    style={{
                      borderColor: r.color,
                      color: has ? "#fff" : r.color,
                      backgroundColor: has ? r.color : "transparent",
                    }}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!isSelf && (
          <div className="mt-3 flex flex-col gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDm()}
              className="w-full rounded bg-brand py-1.5 text-sm font-medium text-white transition hover:bg-brand-hover disabled:opacity-60"
            >
              {t("profile.dm")}
            </button>
            <button
              type="button"
              disabled={!!verificationRequest}
              onClick={() => {
                void startVerification(client, userId);
                onClose();
              }}
              className="w-full rounded border border-border py-1.5 text-sm font-medium text-normal transition hover:bg-bg-modifier-hover disabled:opacity-60"
            >
              {t("profile.verify")}
            </button>
            <button
              type="button"
              disabled={friendBusy || (requestOutgoing && !isFriend)}
              onClick={() => void handleFriendAction()}
              className={`w-full rounded border py-1.5 text-sm font-medium transition disabled:opacity-60 ${
                isFriend
                  ? "border-dnd bg-dnd/10 text-dnd hover:bg-dnd/20"
                  : "border-border text-normal hover:bg-bg-modifier-hover"
              }`}
            >
              {isFriend
                ? t("profile.removeFriend")
                : requestOutgoing
                  ? t("profile.friendRequestSent")
                  : t("profile.addFriend")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleToggleIgnore()}
              className={`w-full rounded border py-1.5 text-sm font-medium transition disabled:opacity-60 ${
                ignored
                  ? "border-dnd bg-dnd/10 text-dnd hover:bg-dnd/20"
                  : "border-border text-normal hover:bg-bg-modifier-hover"
              }`}
            >
              {ignored ? t("profile.unignore") : t("profile.ignore")}
            </button>
            {(mayKick || mayBan) && (
              <div className="mt-1 flex gap-1.5 border-t border-border pt-1.5">
                {mayKick && (
                  <button
                    type="button"
                    onClick={() =>
                      void (async () => {
                        if (room && (await uiConfirm(t("profile.kickConfirm", { name }), { danger: true }))) {
                          await kickMember(client, room.roomId, userId);
                          onClose();
                        }
                      })()
                    }
                    className="flex-1 rounded border border-border py-1.5 text-xs font-medium text-normal transition hover:bg-bg-modifier-hover"
                  >
                    {t("profile.kickShort")}
                  </button>
                )}
                {mayBan && (
                  <button
                    type="button"
                    onClick={() =>
                      void (async () => {
                        if (room && (await uiConfirm(t("profile.banConfirm", { name }), { danger: true }))) {
                          await banMember(client, room.roomId, userId);
                          onClose();
                        }
                      })()
                    }
                    className="flex-1 rounded border border-dnd py-1.5 text-xs font-medium text-dnd transition hover:bg-dnd/10"
                  >
                    {t("profile.banShort")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
