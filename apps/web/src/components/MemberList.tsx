import {
  type ActivityStatus,
  getActivity,
  getMemberRoleColor,
  getMemberRoles,
  getOwningSpace,
  isRoleHoisted,
  type MatrixClient,
  type Room,
  type RoomMember,
} from "@jorkonvo/matrix-core";
import { useTranslation } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";
import { Avatar } from "./Avatar";
import { useProfileFlair } from "../lib/profileFlair";
import { RoleBadges } from "./RoleBadges";
import { VerifiedBadge } from "./VerifiedBadge";
import { useContextMenu } from "./ContextMenu";
import { UserProfilePopover } from "./UserProfilePopover";
import { useMemberMenu } from "./memberMenu";

function presence(member: RoomMember): string | undefined {
  return member.user?.presence;
}

function isOnline(member: RoomMember): boolean {
  const p = presence(member);
  return p === "online" || p === "unavailable";
}

function presenceColor(member: RoomMember): string {
  switch (presence(member)) {
    case "online":
      return "var(--color-online)";
    case "unavailable":
      return "var(--color-idle)";
    default:
      return "var(--color-offline)";
  }
}

/** Same fetch-and-display pattern as UserProfilePopover.tsx's activity card, just condensed to one line for the member list row. */
function useMemberActivity(client: MatrixClient, userId: string): ActivityStatus | null {
  const [activity, setActivity] = useState<ActivityStatus | null>(null);
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
  return activity;
}

function MemberRow({
  member,
  room,
  client,
  nameColor,
  onContextMenu,
  onMiddleClick,
}: {
  member: RoomMember;
  room: Room;
  client: MatrixClient;
  nameColor: string | null;
  onContextMenu: (e: React.MouseEvent) => void;
  onMiddleClick: () => void;
}) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const flair = useProfileFlair(member.userId);
  const owningSpace = getOwningSpace(client, room.roomId);
  const online = isOnline(member);
  const activity = useMemberActivity(client, member.userId);

  return (
    <>
      <button
        ref={rowRef}
        type="button"
        data-testid="member-row"
        data-user-id={member.userId}
        onClick={() => setOpen(true)}
        onContextMenu={onContextMenu}
        onMouseDown={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            onMiddleClick();
          }
        }}
        className={`jk-ctx-target flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left hover:bg-bg-modifier-hover ${online ? "" : "opacity-50"}`}
      >
        <Avatar
          url={member.getAvatarUrl(client.baseUrl, 32, 32, "crop", false, false)}
          name={member.name}
          size={32}
          statusColor={presenceColor(member)}
          decorationMxc={flair.decorationMxc}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center truncate text-sm" style={{ color: nameColor ?? "var(--color-muted)" }}>
            <span className="truncate">{member.name}</span>
            <RoleBadges space={owningSpace} userId={member.userId} size={13} />
            <VerifiedBadge client={client} userId={member.userId} />
          </span>
          {activity && (
            <span className="truncate text-xs text-muted">
              {activity.details || t("profile.activityPlaying", { app: activity.appName ?? t("profile.unknownApp") })}
            </span>
          )}
        </span>
      </button>
      {open && rowRef.current && (
        <UserProfilePopover
          userId={member.userId}
          client={client}
          room={room}
          anchorEl={rowRef.current}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Right-hand member list for a room: search filter, grouping by hoisted role
 * (Discord-style) with an offline bucket last, and per-member rows that open
 * a profile popover on click or the member context menu on right-click.
 *
 * @param room - the room whose joined members are listed.
 */
export function MemberList({ room }: { room: Room }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const { open: openCtx, menu: ctxMenu } = useContextMenu();
  const memberMenu = useMemberMenu(room);
  const requestMention = useUiStore((s) => s.requestMention);
  const setMemberListOpen = useUiStore((s) => s.setMemberListOpen);
  const [filter, setFilter] = useState("");

  const allMembers = room.getMembersWithMembership("join").sort((a, b) => a.name.localeCompare(b.name));
  const query = filter.trim().toLowerCase();
  const members = query ? allMembers.filter((m) => m.name.toLowerCase().includes(query)) : allMembers;
  const onlineMembers = members.filter(isOnline);
  const offlineMembers = members.filter((m) => !isOnline(m));

  const owningSpace = getOwningSpace(client, room.roomId);

  // Discord-style grouping by the member's highest *hoisted* role ("Display
  // role members separately from online members" in the role editor), when
  // this room belongs to a space that has such roles. Members with no
  // hoisted role fall into a plain "Members" bucket. Offline members (any
  // role) are pulled into their own bucket at the very end instead, same as
  // Discord - who's actually around right now matters more than role for a
  // member you can't currently talk to.
  const groups: { label: string; color: string | null; members: RoomMember[] }[] = [];
  if (owningSpace) {
    const withoutRole: RoomMember[] = [];
    for (const member of onlineMembers) {
      const topRole = getMemberRoles(owningSpace, member.userId).find(isRoleHoisted);
      if (!topRole) {
        withoutRole.push(member);
        continue;
      }
      let group = groups.find((g) => g.label === topRole.name);
      if (!group) {
        group = { label: topRole.name, color: topRole.color, members: [] };
        groups.push(group);
      }
      group.members.push(member);
    }
    if (withoutRole.length > 0) {
      // No count here: the render below already appends `— ${group.members.length}`
      // to every group's label whenever owningSpace is set (this branch always
      // has one) - baking it in here too doubled it ("Members — 1 — 1").
      groups.push({ label: t("chat.members"), color: null, members: withoutRole });
    }
  } else if (onlineMembers.length > 0) {
    groups.push({ label: `${t("chat.members")} — ${onlineMembers.length}`, color: null, members: onlineMembers });
  }
  if (offlineMembers.length > 0) {
    groups.push({ label: t("chat.offline"), color: null, members: offlineMembers });
  }

  return (
    <div className="flex h-full w-60 max-md:w-full flex-col border-l border-border bg-bg-dark">
      {/* Mobile: while this list is the pane on screen, the chat header that
          carries the members toggle is slid off to the left, so without a
          control of its own there is no visible way back to the chat - the
          rightward swipe that closes the pane would be the only exit. At md+
          the list is a passive third column whose toggle lives in the chat
          header, so the button is hidden there. */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5 md:hidden">
        <button
          type="button"
          onClick={() => setMemberListOpen(false)}
          title={t("common.back")}
          aria-label={t("common.back")}
          data-testid="member-list-back"
          className="-ml-1 rounded p-1 text-muted hover:bg-bg-modifier-hover hover:text-normal"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z" />
          </svg>
        </button>
        <h2 className="text-sm font-semibold text-header">{t("chat.members")}</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-4">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("common.search")}
          aria-label={t("common.search")}
          className="mb-3 w-full shrink-0 rounded bg-bg-darkest px-2.5 py-1.5 text-sm text-normal placeholder:text-muted outline-none focus:ring-1 focus:ring-brand"
        />
        {groups.map((group) => (
          <div key={group.label} className="mb-3">
            <div
              className="mb-1 px-2 text-xs font-bold uppercase tracking-wide text-muted"
              style={group.color ? { color: group.color } : undefined}
            >
              {owningSpace ? `${group.label} — ${group.members.length}` : group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.members.map((member) => (
                <MemberRow
                  key={member.userId}
                  member={member}
                  room={room}
                  client={client}
                  nameColor={owningSpace ? getMemberRoleColor(owningSpace, member.userId) : null}
                  onContextMenu={(e) => openCtx(e, memberMenu(member.userId))}
                  onMiddleClick={() => requestMention(member.userId, member.name)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {ctxMenu}
    </div>
  );
}
