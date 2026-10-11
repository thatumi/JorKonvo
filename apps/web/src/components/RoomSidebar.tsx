import {
  acceptInvite,
  applyCategoryAccess,
  type Category,
  canInviteToRoom,
  canManageCategories,
  canSetChannelStatus,
  CHANNEL_STATUS_DURATION_PRESETS,
  clearChannelStatus,
  getCategoryAccess,
  canManageSpaceSettings,
  getChannelStatus,
  getSoundboardSounds,
  getSpaceBannerMxc,
  canModerateStage,
  deleteCategory,
  getActiveVoiceMemberIds,
  getCategoryAssignments,
  getDirectRooms,
  getFriendRequests,
  getInvitedRooms,
  getLocalUnread,
  getOwningSpace,
  getRoomInviteLink,
  getRoomNotificationMode,
  getRoomOrder,
  getRoomsInSpace,
  getRoomUnreadState,
  getSpaceCategories,
  getSpaceRoles,
  getMyPendingKnocks,
  getUngroupedRooms,
  getUpcomingCalendarEvents,
  isFavourite,
  isLowPriority,
  isRoomMarkedUnread,
  isStageChannel,
  isVoiceChannel,
  leaveRoom,
  markRoomRead,
  moveCategory,
  moveRoomTo,
  rejectInvite,
  renameCategory,
  type Room,
  setChannelStatus,
  setFavourite,
  setLowPriority,
  setRoomMarkedUnread,
  setRoomNotificationMode,
  sortRoomsByOrder,
  withdrawKnock,
} from "@jorkonvo/matrix-core";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useCallUiStore } from "../lib/callUi";
import { useAuthedMedia } from "../lib/authedMedia";
import { useTranslation } from "../i18n";
import { isDeveloperMode } from "../lib/displayPrefs";
import { uiAlert, uiConfirm, uiPrompt } from "../lib/dialogs";
import { getEntranceSoundId, setEntranceSoundId, suppressNextEntranceSound } from "../lib/entranceSound";
import { isPrivateReadReceiptsEnabled } from "../lib/readReceiptPrivacy";
import { useAuthStore } from "../state/authStore";
import { useCallStore } from "../state/callStore";
import { useGroupCallStore } from "../state/groupCallStore";
import { useMatrixStore } from "../state/matrixStore";
import { useModalStore } from "../state/modalStore";
import { useUiStore } from "../state/uiStore";
import { Avatar } from "./Avatar";
import { type MenuItem, useContextMenu } from "./ContextMenu";
import { useMemberMenu } from "./memberMenu";
import { UserPanel } from "./UserPanel";

const ic = "h-3.5 w-3.5";
const IconCheck = () => <svg viewBox="0 0 24 24" className={ic} fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" /></svg>;
const IconBell = () => <svg viewBox="0 0 24 24" className={ic} fill="currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2Zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2Z" /></svg>;
const IconStar = () => <svg viewBox="0 0 24 24" className={ic} fill="currentColor"><path d="m12 17.27 6.18 3.73-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>;
const IconDown = () => <svg viewBox="0 0 24 24" className={ic} fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>;
const IconDot = () => <svg viewBox="0 0 24 24" className={ic} fill="currentColor"><circle cx="12" cy="12" r="5" /></svg>;
const IconPersonAdd = () => <svg viewBox="0 0 24 24" className={ic} fill="currentColor"><path d="M15 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-9-1V8H4v3H1v2h3v3h2v-3h3v-2H6Zm9 2c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4Z" /></svg>;
const IconGear = () => <svg viewBox="0 0 24 24" className={ic} fill="currentColor"><path d="M19.14 12.94a7.14 7.14 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.24-1.12.55-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.14 7.14 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.24.42.32.6.22l2.39-.96c.5.39 1.04.7 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.58-.24 1.12-.55 1.62-.94l2.39.96c.18.1.47.02.6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" /></svg>;
const IconCopy = () => <svg viewBox="0 0 24 24" className={ic} fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Zm0 16H8V7h11v14Z" /></svg>;
const IconLeave = () => <svg viewBox="0 0 24 24" className={ic} fill="currentColor"><path d="M16 17v-3H9v-4h7V7l5 5-5 5ZM14 2a2 2 0 0 1 2 2v2h-2V4H5v16h9v-2h2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9Z" /></svg>;

/** The right-click menu items for a room row (channels + DMs). */
function useRoomMenu() {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const bumpTick = useMatrixStore((s) => s.bumpTick);
  const openModal = useModalStore((s) => s.open);

  return (room: Room): MenuItem[] => {
    const roomId = room.roomId;
    const mode = getRoomNotificationMode(client, roomId);
    const markedUnread = isRoomMarkedUnread(room);
    const unread =
      markedUnread || getLocalUnread(roomId).total > 0 || room.getUnreadNotificationCount() > 0;
    const fav = isFavourite(room);
    const low = isLowPriority(room);
    const priv = isPrivateReadReceiptsEnabled();
    const after = (p: Promise<unknown>) => void p.then(() => bumpTick());
    // Space channels: membership (i.e. which rooms a user sees) is the space
    // admins' call, not something a member leaves on their own - so no "Leave"
    // for those. DMs and standalone rooms keep it.
    const inSpace = getOwningSpace(client, roomId) !== null;
    const mayStatus = canSetChannelStatus(room, client.getUserId() ?? "");
    const currentStatus = getChannelStatus(room);
    const soundboardSounds = isVoiceChannel(room) ? getSoundboardSounds(room) : [];
    const entranceSoundId = getEntranceSoundId(roomId);

    return [
      ...(soundboardSounds.length > 0
        ? [
            {
              label: t("entranceSound.menu"),
              icon: <IconDot />,
              submenu: [
                {
                  label: t("entranceSound.none"),
                  checked: !entranceSoundId,
                  onClick: () => {
                    setEntranceSoundId(roomId, null);
                    bumpTick();
                  },
                },
                ...soundboardSounds.map((s) => ({
                  label: s.name,
                  checked: entranceSoundId === s.id,
                  onClick: () => {
                    setEntranceSoundId(roomId, s.id);
                    bumpTick();
                  },
                })),
              ],
            },
            ...(entranceSoundId && useGroupCallStore.getState().matrixRoomId !== roomId
              ? [
                  {
                    label: t("entranceSound.joinSilently"),
                    icon: <IconDot />,
                    onClick: () => {
                      suppressNextEntranceSound();
                      void useGroupCallStore.getState().join(client, roomId, { startWithVideo: false });
                    },
                  },
                ]
              : []),
          ]
        : []),
      ...(mayStatus
        ? [
            {
              label: currentStatus ? t("channelStatus.edit") : t("channelStatus.set"),
              icon: <IconDot />,
              submenu: CHANNEL_STATUS_DURATION_PRESETS.map((preset) => ({
                label: t(preset.labelKey),
                onClick: () =>
                  void (async () => {
                    const text = await uiPrompt(t("channelStatus.prompt"), currentStatus?.text ?? "");
                    if (text?.trim()) after(setChannelStatus(client, roomId, text, preset.ms));
                  })(),
              })),
            },
            ...(currentStatus
              ? [
                  {
                    label: t("channelStatus.clear"),
                    icon: <IconDot />,
                    onClick: () => after(clearChannelStatus(client, roomId)),
                  },
                ]
              : []),
          ]
        : []),
      {
        label: t("roomMenu.markRead"),
        disabled: !unread,
        icon: <IconCheck />,
        onClick: () => after(markRoomRead(client, roomId, priv)),
      },
      {
        label: t("roomMenu.markUnread"),
        disabled: markedUnread,
        icon: <IconDot />,
        onClick: () => after(setRoomMarkedUnread(client, roomId, true)),
      },
      {
        label: t("chat.notifications"),
        icon: <IconBell />,
        submenu: [
          { label: t("chat.notifyAll"), checked: mode === "all", onClick: () => after(setRoomNotificationMode(client, roomId, "all")) },
          { label: t("chat.notifyMentions"), checked: mode === "mentions", onClick: () => after(setRoomNotificationMode(client, roomId, "mentions")) },
          { label: t("chat.notifyMuted"), checked: mode === "muted", onClick: () => after(setRoomNotificationMode(client, roomId, "muted")) },
        ],
      },
      {
        label: t("roomMenu.favourite"),
        separator: true,
        checked: fav,
        icon: <IconStar />,
        onClick: () => after(setFavourite(client, roomId, !fav)),
      },
      {
        label: t("roomMenu.lowPriority"),
        checked: low,
        icon: <IconDown />,
        onClick: () => after(setLowPriority(client, roomId, !low)),
      },
      ...(canInviteToRoom(room, client.getUserId() ?? "")
        ? [
            {
              label: t("spaceSettings.inviteLinkCopy"),
              separator: true,
              icon: <IconPersonAdd />,
              onClick: () => {
                void navigator.clipboard.writeText(getRoomInviteLink(client, room));
                void uiAlert(t("spaceSettings.inviteLinkCopied"));
              },
            },
            {
              label: t("roomMenu.invite"),
              icon: <IconPersonAdd />,
              onClick: () =>
                void (async () => {
                  const id = await uiPrompt(t("roomMenu.invitePrompt"));
                  if (id?.trim()) after(client.invite(roomId, id.trim()));
                })(),
            },
          ]
        : []),
      {
        label: t("chat.roomSettings"),
        icon: <IconGear />,
        onClick: () => openModal({ type: "roomSettings", roomId }),
      },
      ...(isDeveloperMode()
        ? [{ label: t("common.copyId"), icon: <IconCopy />, onClick: () => void navigator.clipboard.writeText(roomId) }]
        : []),
      ...(inSpace
        ? []
        : [
            {
              label: t("roomMenu.leave"),
              separator: true,
              danger: true,
              icon: <IconLeave />,
              onClick: () =>
                void (async () => {
                  if (await uiConfirm(t("roomMenu.leaveConfirm", { name: room.name || roomId }), { danger: true })) {
                    after(leaveRoom(client, roomId));
                  }
                })(),
            },
          ]),
    ];
  };
}


function RoomRow({ room, active, onClick, onContextMenu }: { room: Room; active: boolean; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  // Mention counts only exist client-side (E2EE hides m.mentions from the
  // server), so the local counters are the source of truth; the server's
  // coarser "some message arrived" count fills in anything missed offline.
  // getRoomUnreadState is the shared source of truth (also used by the
  // space-rail aggregate) - a muted room contributes neither the unread dot
  // nor its badge, mentions included.
  const mode = getRoomNotificationMode(client, room.roomId);
  const { unread, badge } = getRoomUnreadState(client, room);

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-testid="room-row"
      data-room-name={room.name || ""}
      data-room-id={room.roomId}
      className={clsx(
        "jk-ctx-target relative flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition",
        active
          ? "bg-bg-modifier-selected text-header before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-brand before:content-['']"
          : "text-muted hover:bg-bg-modifier-hover hover:text-normal",
        mode === "muted" && !active && "opacity-60",
      )}
    >
      {unread && !active && (
        <span
          className="absolute -left-2 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-white"
          title={t("sidebar.unreadTitle")}
        />
      )}
      <Avatar
        url={room.getAvatarUrl(client.baseUrl, 32, 32, "crop", false)}
        name={room.name || "?"}
        size={32}
      />
      <span
        className={clsx(
          "flex-1 truncate text-sm",
          unread && "font-semibold text-header",
          mode === "muted" && !active && "text-muted",
        )}
      >
        {room.name || t("sidebar.unnamedRoom")}
      </span>
      {badge > 0 && (
        <span className="rounded-full bg-dnd px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

function VoiceChannelRow({ room, active, onClick, onContextMenu }: { room: Room; active: boolean; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  useMatrixStore((s) => s.syncTick);
  const groupCallMatrixRoomId = useGroupCallStore((s) => s.matrixRoomId);
  useGroupCallStore((s) => s.tick);
  const connectedHere = groupCallMatrixRoomId === room.roomId;
  const memberIds = getActiveVoiceMemberIds(room);
  const isStage = isStageChannel(room);
  const memberMenu = useMemberMenu(room);
  const { open: openMemberCtx, menu: memberCtxMenu } = useContextMenu();
  const channelStatus = getChannelStatus(room);

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        className={clsx(
          "jk-ctx-target relative flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition",
          active
            ? "bg-bg-modifier-selected text-header before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-brand before:content-['']"
            : "text-muted hover:bg-bg-modifier-hover hover:text-normal",
        )}
      >
        {isStage ? (
          <svg
            viewBox="0 0 24 24"
            className={clsx("h-[18px] w-[18px] shrink-0", connectedHere && "text-online")}
            fill="currentColor"
          >
            <path d="M12 2 3 7v2h18V7l-9-5Zm-7 8v9h4v-7h6v7h4v-9H5Z" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            className={clsx("h-[18px] w-[18px] shrink-0", connectedHere && "text-online")}
            fill="currentColor"
          >
            <path d="M12 3 7 7H3v10h4l5 4V3Zm4.5 9a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12ZM14 2.23v2.06A7 7 0 0 1 19 12a7 7 0 0 1-5 6.71v2.06A9 9 0 0 0 21 12a9 9 0 0 0-7-9.77Z" />
          </svg>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{room.name || t("sidebar.unnamed")}</span>
          {channelStatus && <span className="truncate text-[11px] italic text-muted">{channelStatus.text}</span>}
        </span>
        {connectedHere && (
          <span className="shrink-0 rounded-full bg-online/20 px-1.5 py-0.5 text-[10px] font-bold text-online">
            {t("sidebar.connected")}
          </span>
        )}
      </button>
      {memberIds.length > 0 && (
        <div className="ml-6 flex flex-col gap-0.5 pb-1">
          {memberIds.map((userId) => {
            const member = room.getMember(userId);
            return (
              <div
                key={userId}
                className="jk-ctx-target flex items-center gap-2 rounded px-2 py-0.5 hover:bg-bg-modifier-hover"
                onContextMenu={(e) => openMemberCtx(e, memberMenu(userId))}
              >
                <Avatar
                  url={member?.getAvatarUrl(client.baseUrl, 20, 20, "crop", false, false) ?? null}
                  name={member?.name ?? userId}
                  size={20}
                />
                <span className="truncate text-xs text-muted">{member?.name ?? userId}</span>
              </div>
            );
          })}
        </div>
      )}
      {memberCtxMenu}
    </div>
  );
}

/** Thin highlighted line marking exactly where a dragged channel will land - without this the reorder worked but gave no visual indication of the outcome, only a snap once dropped. */
function ChannelDropLine({ visible }: { visible: boolean }) {
  return (
    <div className="relative h-0 w-full">
      {visible && <div className="absolute inset-x-2 -top-1 z-10 h-0.5 rounded-full bg-brand" />}
    </div>
  );
}

function ChannelRow({
  room,
  active,
  onSelect,
  onVoiceJoin,
  onContextMenu,
  draggable,
  dragging,
  onDragPointerDown,
  dropCategoryId,
  showDropLineBefore,
}: {
  room: Room;
  active: boolean;
  onSelect: () => void;
  onVoiceJoin: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  draggable?: boolean;
  dragging?: boolean;
  onDragPointerDown?: (e: React.PointerEvent) => void;
  /** This row also acts as a "drop before me" target within this category. */
  dropCategoryId?: string | null;
  /** True while a dragged channel is hovering right above this row. */
  showDropLineBefore?: boolean;
}) {
  return (
    <>
      <ChannelDropLine visible={!!showDropLineBefore} />
      <div
        onPointerDown={draggable ? onDragPointerDown : undefined}
        data-drop-category={dropCategoryId ?? ""}
        data-drop-before={room.roomId}
        className={clsx(dragging && "opacity-40")}
      >
        {isVoiceChannel(room) ? (
          <VoiceChannelRow room={room} active={active} onClick={onVoiceJoin} onContextMenu={onContextMenu} />
        ) : (
          <RoomRow room={room} active={active} onClick={onSelect} onContextMenu={onContextMenu} />
        )}
      </div>
    </>
  );
}

const COLLAPSED_CATEGORIES_KEY = "jorkonvo-collapsed-categories";

function loadCollapsedCategories(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_CATEGORIES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function CategoryHeader({
  category,
  space,
  collapsed,
  onToggle,
  canManage,
  isFirst,
  isLast,
  dropBeforeRoomId,
}: {
  category: Category;
  space: Room;
  collapsed: boolean;
  onToggle: () => void;
  canManage: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** Dropping onto the header inserts before this category's first room (null = category is empty). */
  dropBeforeRoomId: string | null;
}) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const { open: openCtx, menu: ctxMenu } = useContextMenu();

  const categoryMenu = (): MenuItem[] => {
    const roles = getSpaceRoles(space);
    const current = getCategoryAccess(client, space.roomId, category.id);
    const apply = (access: { mode: "open" | "restricted"; roleIds: string[] }) =>
      void applyCategoryAccess(client, space.roomId, category.id, access);
    return [
      {
        label: t("channelAccess.title"),
        icon: (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            <path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Z" />
          </svg>
        ),
        submenu: [
          {
            label: t("channelAccess.open"),
            checked: current?.mode === "open",
            onClick: () => apply({ mode: "open", roleIds: [] }),
          },
          ...roles.map((r) => ({
            label: r.name,
            checked: current?.mode === "restricted" && current.roleIds.includes(r.id),
            onClick: () => {
              const base = current?.mode === "restricted" ? current.roleIds : [];
              const has = base.includes(r.id);
              apply({
                mode: "restricted",
                roleIds: has ? base.filter((id) => id !== r.id) : [...base, r.id],
              });
            },
          })),
        ],
      },
      {
        label: t("common.rename"),
        separator: true,
        onClick: () =>
          void (async () => {
            const name = await uiPrompt(t("sidebar.categoryNewName"), category.name);
            if (name && name.trim()) await renameCategory(client, space.roomId, category.id, name.trim());
          })(),
      },
      {
        label: t("common.delete"),
        danger: true,
        onClick: () =>
          void (async () => {
            if (await uiConfirm(t("sidebar.categoryDeleteConfirm", { name: category.name }), { danger: true })) {
              await deleteCategory(client, space.roomId, category.id);
            }
          })(),
      },
    ];
  };

  return (
    <div
      className="jk-ctx-target group/cat mt-3 flex items-center gap-1 px-2 first:mt-2"
      onContextMenu={canManage ? (e) => openCtx(e, categoryMenu()) : undefined}
      data-drop-category={category.id}
      data-drop-before={dropBeforeRoomId ?? ""}
    >
      {ctxMenu}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={`jk-cat-${category.id}`}
        className="flex flex-1 items-center gap-1 text-left text-xs font-bold uppercase tracking-wide text-muted hover:text-normal"
      >
        <svg
          viewBox="0 0 24 24"
          className={clsx("h-3 w-3 shrink-0 transition-transform", !collapsed && "rotate-90")}
          fill="currentColor"
        >
          <path d="M8 5v14l11-7Z" />
        </svg>
        <span className="truncate">{category.name}</span>
      </button>
      {canManage && (
        <div className="hidden shrink-0 items-center gap-0.5 group-hover/cat:flex">
          {!isFirst && (
            <button
              type="button"
              title={t("sidebar.moveUp")}
              aria-label={t("sidebar.moveUp")}
              onClick={() => void moveCategory(client, space.roomId, category.id, "up")}
              className="rounded p-0.5 text-muted hover:text-normal"
            >
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
                <path d="M7 14l5-5 5 5H7Z" />
              </svg>
            </button>
          )}
          {!isLast && (
            <button
              type="button"
              title={t("sidebar.moveDown")}
              aria-label={t("sidebar.moveDown")}
              onClick={() => void moveCategory(client, space.roomId, category.id, "down")}
              className="rounded p-0.5 text-muted hover:text-normal"
            >
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
                <path d="M7 10l5 5 5-5H7Z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            title={t("common.rename")}
            aria-label={t("common.rename")}
            onClick={() =>
              void (async () => {
                const name = await uiPrompt(t("sidebar.categoryNewName"), category.name);
                if (name && name.trim()) await renameCategory(client, space.roomId, category.id, name.trim());
              })()
            }
            className="rounded p-0.5 text-muted hover:text-normal"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
              <path d="m3 17.25 11.06-11.06 3.75 3.75L6.75 21H3v-3.75Zm14.85-13.5 1.4-1.4a1 1 0 0 1 1.42 0l2.33 2.33a1 1 0 0 1 0 1.42l-1.4 1.4-3.75-3.75Z" />
            </svg>
          </button>
          <button
            type="button"
            title={t("common.delete")}
            aria-label={t("common.delete")}
            onClick={() =>
              void (async () => {
                if (await uiConfirm(t("sidebar.categoryDeleteConfirm", { name: category.name }), { danger: true })) {
                  await deleteCategory(client, space.roomId, category.id);
                }
              })()
            }
            className="rounded p-0.5 text-muted hover:text-dnd"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
              <path d="M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H4V5h4l1-2Z" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

function InviteRow({ room }: { room: Room }) {
  const client = useMatrixStore((s) => s.client)!;
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-2.5 rounded px-2 py-1.5" data-testid="invite-row" data-room-name={room.name || ""}>
      <Avatar url={room.getAvatarUrl(client.baseUrl, 32, 32, "crop", false)} name={room.name || "?"} size={32} />
      <span className="flex-1 truncate text-sm text-normal">{room.name || t("sidebar.unnamedRoom")}</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await acceptInvite(client, room.roomId).finally(() => setBusy(false));
        }}
        title={t("sidebar.acceptInvite")}
        aria-label={t("sidebar.acceptInvite")}
        data-testid="invite-accept"
        className="rounded p-1 text-online hover:bg-bg-modifier-hover disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
        </svg>
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await rejectInvite(client, room.roomId).finally(() => setBusy(false));
        }}
        title={t("sidebar.rejectInvite")}
        aria-label={t("sidebar.rejectInvite")}
        className="rounded p-1 text-dnd hover:bg-bg-modifier-hover disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
        </svg>
      </button>
    </div>
  );
}

function PendingKnockRow({ room }: { room: Room }) {
  const client = useMatrixStore((s) => s.client)!;
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-2.5 rounded px-2 py-1.5">
      <Avatar url={room.getAvatarUrl(client.baseUrl, 32, 32, "crop", false)} name={room.name || "?"} size={32} />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm text-normal">{room.name || t("sidebar.unnamedRoom")}</span>
        <span className="block text-xs text-muted">{t("sidebar.waitingApproval")}</span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await withdrawKnock(client, room.roomId).finally(() => setBusy(false));
        }}
        title={t("sidebar.withdrawKnock")}
        aria-label={t("sidebar.withdrawKnock")}
        className="rounded p-1 text-dnd hover:bg-bg-modifier-hover disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M18.3 5.71 12 12l6.3 6.29-1.42 1.42L10.59 13.4 4.3 19.7 2.88 18.3 9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.29-6.3Z" />
        </svg>
      </button>
    </div>
  );
}

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-1 mt-4 flex items-center justify-between px-2 first:mt-2">
      <span className="text-xs font-bold uppercase tracking-wide text-muted">{children}</span>
      {action}
    </div>
  );
}

function SmallIconButton({
  onClick,
  title,
  testId,
  children,
}: {
  onClick: () => void;
  title: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      data-testid={testId}
      className="rounded text-muted hover:text-normal"
    >
      {children}
    </button>
  );
}

const PlusIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
    <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
  </svg>
);

/**
 * Channel/DM sidebar: space banner, search, friends/events/inbox entries,
 * invites and knocks, favourite/low-priority tags, DMs and channels grouped
 * into collapsible categories (with drag-and-drop reordering), plus the
 * user panel at the bottom.
 */
export function RoomSidebar() {
  const { t } = useTranslation();
  const { open: openCtx, menu: ctxMenu } = useContextMenu();
  const roomMenu = useRoomMenu();
  const ctx = (room: Room) => (e: React.MouseEvent) => openCtx(e, roomMenu(room));
  const client = useMatrixStore((s) => s.client);
  useMatrixStore((s) => s.syncTick);
  const selectedSpaceId = useUiStore((s) => s.selectedSpaceId);
  const selectedRoomId = useUiStore((s) => s.selectedRoomId);
  const selectRoom = useUiStore((s) => s.selectRoom);
  const friendsViewOpen = useUiStore((s) => s.friendsViewOpen);
  const openFriends = useUiStore((s) => s.openFriends);
  const eventsViewOpen = useUiStore((s) => s.eventsViewOpen);
  const openEvents = useUiStore((s) => s.openEvents);
  const inboxViewOpen = useUiStore((s) => s.inboxViewOpen);
  const openInbox = useUiStore((s) => s.openInbox);
  const status = useAuthStore((s) => s.status);
  const openModal = useModalStore((s) => s.open);
  const [filter, setFilter] = useState("");
  const activeCall = useCallStore((s) => s.call);
  const groupCallRoom = useGroupCallStore((s) => s.room);
  const groupCallMatrixRoomId = useGroupCallStore((s) => s.matrixRoomId);
  const joinGroupCall = useGroupCallStore((s) => s.join);
  const leaveGroupCall = useGroupCallStore((s) => s.leave);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(loadCollapsedCategories);
  const [draggingRoomId, setDraggingRoomId] = useState<string | null>(null);
  // Reordering uses pointer events, not native HTML5 drag-and-drop - see the
  // matching comment in SpaceRail.tsx for why (a permanent not-allowed
  // cursor inside Tauri's CEF webview, plus native DnD state read from React
  // state closures being timing-fragile in general).
  const draggingRoomIdRef = useRef<string | null>(null);
  const dragCandidateRef = useRef<{ roomId: string; pointerId: number; startX: number; startY: number } | null>(null);
  const justDraggedRoomRef = useRef(false);
  const roomDropTargetRef = useRef<{ categoryId: string | null; beforeRoomId: string | null } | null>(null);
  // Mirrors roomDropTargetRef purely so its changes trigger a re-render (the
  // ref alone is read synchronously at pointerup but never repaints the
  // drop-line indicator - see ChannelDropLine).
  const [roomDropTarget, setRoomDropTarget] = useState<{ categoryId: string | null; beforeRoomId: string | null } | null>(
    null,
  );
  const DRAG_ROOM_THRESHOLD_PX = 4;

  const spaceForBanner = selectedSpaceId ? (client?.getRoom(selectedSpaceId) ?? null) : null;
  const spaceBannerMxc = spaceForBanner ? getSpaceBannerMxc(spaceForBanner) : null;
  const spaceBannerUrl = useAuthedMedia(spaceBannerMxc, {
    width: 480,
    height: 160,
    method: "scale",
    animated: true,
  });

  useEffect(() => {
    localStorage.setItem(COLLAPSED_CATEGORIES_KEY, JSON.stringify([...collapsedCategories]));
  }, [collapsedCategories]);

  function toggleCategory(id: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!client) return null;

  async function handleVoiceChannelClick(room: Room) {
    // Discord-style: a voice channel is *only* a call - clicking it connects
    // you and shows the call screen, never a text timeline.
    if (groupCallMatrixRoomId === room.roomId) {
      useCallUiStore.getState().setMinimized(false);
      return;
    }
    if (activeCall) return; // already in a 1:1 call
    if (groupCallRoom) await leaveGroupCall();
    const asAudience = isStageChannel(room) && !canModerateStage(room, client!.getUserId() ?? "");
    await joinGroupCall(client!, room.roomId, { startWithVideo: false, asAudience });
  }

  const space = selectedSpaceId ? client.getRoom(selectedSpaceId) : null;
  const title = space?.name ?? (selectedSpaceId ? "Space" : "JorKonvo");

  const allChannels = selectedSpaceId
    ? getRoomsInSpace(client, selectedSpaceId)
    : getUngroupedRooms(client);
  const allDms = selectedSpaceId ? [] : getDirectRooms(client);
  const invites = selectedSpaceId ? [] : getInvitedRooms(client);
  const pendingKnocks = selectedSpaceId ? [] : getMyPendingKnocks(client);
  const incomingFriendRequests = selectedSpaceId ? 0 : getFriendRequests(client).incoming.length;
  const upcomingEventCount = selectedSpaceId ? 0 : getUpcomingCalendarEvents(client).length;

  const query = filter.trim().toLowerCase();
  const matches = (room: Room) => (room.name || "").toLowerCase().includes(query);
  const channelsAll = query ? allChannels.filter(matches) : allChannels;
  const dmsAll = query ? allDms.filter(matches) : allDms;
  const noMatches = query && channelsAll.length === 0 && dmsAll.length === 0;

  // Element-style tag sections (m.favourite/m.lowpriority), spanning DMs and
  // channels alike, pulled out of their normal spot the same way Element
  // does - a favourited/low-priority room only ever appears once. Skipped
  // while searching, same reasoning as the category grouping below (a
  // filtered view stays flat so results aren't split/hidden across groups).
  const allRooms = [...dmsAll, ...channelsAll];
  const favouriteRooms = query ? [] : allRooms.filter(isFavourite);
  const lowPriorityRooms = query ? [] : allRooms.filter(isLowPriority);
  const taggedIds = new Set([...favouriteRooms, ...lowPriorityRooms].map((r) => r.roomId));
  const channels = query ? channelsAll : channelsAll.filter((r) => !taggedIds.has(r.roomId));
  const dms = query ? dmsAll : dmsAll.filter((r) => !taggedIds.has(r.roomId));

  // Group channels by category (space-scoped, only meaningful when not searching -
  // a filtered view stays flat so results aren't split/hidden across collapsed groups).
  const categories = space && !query ? getSpaceCategories(space) : [];
  const assignments = space ? getCategoryAssignments(space) : {};
  const mayManageCategories = space ? canManageCategories(space, client.getUserId() ?? "") : false;
  // Drag-and-drop reorder persists a flat room-id order on the space; rooms
  // never dragged yet just keep the order the SDK already gave them.
  const orderedChannels = space ? sortRoomsByOrder(channels, getRoomOrder(space)) : channels;
  const fullRoomOrder = orderedChannels.map((r) => r.roomId);
  const categorized = categories.map((cat) => ({
    category: cat,
    rooms: orderedChannels.filter((r) => assignments[r.roomId] === cat.id),
  }));
  const uncategorized =
    categories.length > 0 ? orderedChannels.filter((r) => !assignments[r.roomId]) : orderedChannels;

  const beginRoomDragCandidate = (roomId: string, e: React.PointerEvent) => {
    if (!mayManageCategories || e.button !== 0) return;
    // No setPointerCapture here - capturing on pointerdown suppresses the
    // synthesized `click` on the inner channel <button> (pointerup gets
    // redirected off it), which would break plain channel-switch clicks.
    // Capture is taken only once a real drag starts, below.
    dragCandidateRef.current = { roomId, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
  };
  const handleRoomRailPointerMove = (e: React.PointerEvent) => {
    const candidate = dragCandidateRef.current;
    if (candidate && !draggingRoomIdRef.current) {
      const dx = e.clientX - candidate.startX;
      const dy = e.clientY - candidate.startY;
      if (Math.hypot(dx, dy) < DRAG_ROOM_THRESHOLD_PX) return;
      try {
        (e.currentTarget as Element).setPointerCapture(candidate.pointerId);
      } catch {
        /* pointer already released / invalid id */
      }
      justDraggedRoomRef.current = true;
      draggingRoomIdRef.current = candidate.roomId;
      setDraggingRoomId(candidate.roomId);
    }
    if (!draggingRoomIdRef.current) return;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-drop-category]");
    const next = target
      ? { categoryId: target.dataset.dropCategory || null, beforeRoomId: target.dataset.dropBefore || null }
      : null;
    roomDropTargetRef.current = next;
    setRoomDropTarget((prev) =>
      prev?.categoryId === next?.categoryId && prev?.beforeRoomId === next?.beforeRoomId ? prev : next,
    );
  };
  const handleRoomRailPointerUp = () => {
    dragCandidateRef.current = null;
    const roomId = draggingRoomIdRef.current;
    const dropTarget = roomDropTargetRef.current;
    draggingRoomIdRef.current = null;
    roomDropTargetRef.current = null;
    setDraggingRoomId(null);
    setRoomDropTarget(null);
    if (roomId && dropTarget && space) {
      void moveRoomTo(client, space.roomId, roomId, dropTarget.categoryId, dropTarget.beforeRoomId, fullRoomOrder);
    }
  };
  const handleRoomRailPointerCancel = () => {
    dragCandidateRef.current = null;
    draggingRoomIdRef.current = null;
    roomDropTargetRef.current = null;
    setDraggingRoomId(null);
    setRoomDropTarget(null);
  };

  return (
    <nav
      aria-label={t("a11y.channelNav")}
      className="flex h-full w-60 max-md:w-auto max-md:flex-1 flex-col overflow-hidden rounded-[20px] max-md:rounded-none bg-bg-dark"
    >
      {selectedSpaceId && space && (
        <button
          type="button"
          onClick={() =>
            canManageSpaceSettings(space, client.getUserId() ?? "") &&
            openModal({ type: "spaceSettings", spaceId: selectedSpaceId })
          }
          className="relative flex h-16 shrink-0 items-end overflow-hidden bg-gradient-to-br from-brand/40 to-brand-hover/20 px-4 pb-2 text-left"
          style={
            spaceBannerUrl
              ? { backgroundImage: `linear-gradient(to top, rgba(0,0,0,.7), rgba(0,0,0,.15)), url(${spaceBannerUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
              : undefined
          }
        >
          <span className="truncate text-sm font-bold text-white drop-shadow">{space.name}</span>
        </button>
      )}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 shadow-sm">
        <h2 className="truncate text-[15px] font-semibold text-header">{title}</h2>
        {selectedSpaceId && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              data-testid="discover-rooms-button"
              onClick={() => openModal({ type: "spaceHierarchy", spaceId: selectedSpaceId })}
              title={t("sidebar.newChannel")}
              aria-label={t("sidebar.newChannel")}
              className="rounded p-1 text-muted hover:text-normal"
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => openModal({ type: "spaceSettings", spaceId: selectedSpaceId, initialPaneId: "roles" })}
              title={t("sidebar.spaceRoles")}
              aria-label={t("sidebar.spaceRoles")}
              data-testid="sidebar-space-roles"
              className="rounded p-1 text-muted hover:text-normal"
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => openModal({ type: "cloneSpace", spaceId: selectedSpaceId })}
              title={t("sidebar.spaceClone")}
              aria-label={t("sidebar.spaceClone")}
              className="rounded p-1 text-muted hover:text-normal"
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Zm0 16H8V7h11v14Z" />
              </svg>
            </button>
            {space && canManageSpaceSettings(space, client.getUserId() ?? "") && (
              <button
                type="button"
                onClick={() => openModal({ type: "spaceSettings", spaceId: selectedSpaceId })}
                title={t("sidebar.spaceSettings")}
                aria-label={t("sidebar.spaceSettings")}
                className="rounded p-1 text-muted hover:text-normal"
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor">
                  <path d="M19.14 12.94a7.14 7.14 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.24-1.12.55-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.14 7.14 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.24.42.32.6.22l2.39-.96c.5.39 1.04.7 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.58-.24 1.12-.55 1.62-.94l2.39.96c.18.1.47.02.6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-2 pt-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("common.search")}
          aria-label={t("common.search")}
          className="w-full rounded bg-bg-darkest px-2.5 py-1.5 text-sm text-normal placeholder:text-muted outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      <div
        className="flex-1 overflow-y-auto px-2 py-2"
        onPointerMove={handleRoomRailPointerMove}
        onPointerUp={handleRoomRailPointerUp}
        onPointerCancel={handleRoomRailPointerCancel}
        onClickCapture={(e) => {
          if (justDraggedRoomRef.current) {
            e.preventDefault();
            e.stopPropagation();
            justDraggedRoomRef.current = false;
          }
        }}
      >
        {!selectedSpaceId && !query && (
          <button
            type="button"
            onClick={openFriends}
            className={clsx(
              "relative mb-2 flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition",
              friendsViewOpen
                ? "bg-bg-modifier-selected text-header before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-brand before:content-['']"
                : "text-muted hover:bg-bg-modifier-hover hover:text-normal",
            )}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z" />
            </svg>
            <span className="flex-1 text-sm font-medium">{t("sidebar.friends")}</span>
            {incomingFriendRequests > 0 && (
              <span className="rounded-full bg-dnd px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
                {incomingFriendRequests}
              </span>
            )}
          </button>
        )}
        {!selectedSpaceId && !query && (
          <button
            type="button"
            onClick={openEvents}
            className={clsx(
              "relative mb-2 flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition",
              eventsViewOpen
                ? "bg-bg-modifier-selected text-header before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-brand before:content-['']"
                : "text-muted hover:bg-bg-modifier-hover hover:text-normal",
            )}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor">
              <path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 16H5V10h14v10ZM5 8V6h14v2H5Z" />
            </svg>
            <span className="flex-1 text-sm font-medium">{t("sidebar.events")}</span>
            {upcomingEventCount > 0 && (
              <span className="rounded-full bg-bg-modifier-hover px-1.5 py-0.5 text-[11px] font-bold leading-none text-normal">
                {upcomingEventCount}
              </span>
            )}
          </button>
        )}
        {!selectedSpaceId && !query && (
          <button
            type="button"
            onClick={openInbox}
            className={clsx(
              "relative mb-2 flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition",
              inboxViewOpen
                ? "bg-bg-modifier-selected text-header before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-brand before:content-['']"
                : "text-muted hover:bg-bg-modifier-hover hover:text-normal",
            )}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="currentColor">
              <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16H5v-3h14v3Zm0-5H5V5h14v9Z" />
            </svg>
            <span className="flex-1 text-sm font-medium">{t("inbox.title")}</span>
          </button>
        )}
        {noMatches && <p className="px-2 py-4 text-sm text-muted">{t("sidebar.noResults")}</p>}
        {!query && invites.length > 0 && (
          <>
            <SectionLabel>{t("sidebar.invites")}</SectionLabel>
            <div className="flex flex-col gap-0.5">
              {invites.map((room) => (
                <InviteRow key={room.roomId} room={room} />
              ))}
            </div>
          </>
        )}
        {!query && pendingKnocks.length > 0 && (
          <>
            <SectionLabel>{t("sidebar.knocks")}</SectionLabel>
            <div className="flex flex-col gap-0.5">
              {pendingKnocks.map((room) => (
                <PendingKnockRow key={room.roomId} room={room} />
              ))}
            </div>
          </>
        )}
        {!query && favouriteRooms.length > 0 && (
          <>
            <SectionLabel>{t("sidebar.favourites")}</SectionLabel>
            <div className="flex flex-col gap-0.5">
              {favouriteRooms.map((room) => (
                <ChannelRow
                  key={room.roomId}
                  room={room}
                  active={room.roomId === selectedRoomId}
                  onSelect={() => selectRoom(room.roomId)}
                  onVoiceJoin={() => void handleVoiceChannelClick(room)}
                  onContextMenu={ctx(room)}
                />
              ))}
            </div>
          </>
        )}

        {!noMatches && !selectedSpaceId && (dms.length > 0 || !query) && (
          <>
            <SectionLabel action={<SmallIconButton testId="sidebar-start-dm" onClick={() => openModal({ type: "startDm" })} title={t("sidebar.startDm")}>{PlusIcon}</SmallIconButton>}>
              {t("sidebar.messages")}
            </SectionLabel>
            <div className="flex flex-col gap-0.5">
              {dms.map((room) => (
                <RoomRow
                  key={room.roomId}
                  room={room}
                  active={room.roomId === selectedRoomId}
                  onClick={() => selectRoom(room.roomId)}
                  onContextMenu={ctx(room)}
                />
              ))}
              {dms.length === 0 && <p className="px-2 py-1 text-xs text-muted">{t("sidebar.noDms")}</p>}
            </div>
          </>
        )}

        {!noMatches && (channels.length > 0 || !query) && (
          <>
            <SectionLabel
              action={
                <div className="flex items-center gap-1.5">
                  {space && mayManageCategories && (
                    <SmallIconButton
                      onClick={() => openModal({ type: "createCategory", spaceId: space.roomId })}
                      title={t("sidebar.newCategory")}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                        <path d="M3 5h18v2H3V5Zm0 6h10v2H3v-2Zm0 6h10v2H3v-2Zm14-4h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3Z" />
                      </svg>
                    </SmallIconButton>
                  )}
                  <SmallIconButton
                    onClick={() => openModal({ type: "createRoom", parentSpaceId: selectedSpaceId })}
                    title={t("sidebar.newRoom")}
                    testId="sidebar-new-room"
                  >
                    {PlusIcon}
                  </SmallIconButton>
                </div>
              }
            >
              {selectedSpaceId ? t("sidebar.channels") : t("sidebar.rooms")}
            </SectionLabel>

            {/* Uncategorized channels sit above the categories, same as Discord. */}
            <div className="flex flex-col gap-0.5" data-drop-category="" data-drop-before="">
              {uncategorized.map((room) => (
                <ChannelRow
                  key={room.roomId}
                  room={room}
                  active={room.roomId === selectedRoomId}
                  onSelect={() => selectRoom(room.roomId)}
                  onVoiceJoin={() => void handleVoiceChannelClick(room)}
                  onContextMenu={ctx(room)}
                  draggable={mayManageCategories}
                  dragging={draggingRoomId === room.roomId}
                  onDragPointerDown={(e) => beginRoomDragCandidate(room.roomId, e)}
                  dropCategoryId={null}
                  showDropLineBefore={roomDropTarget?.categoryId === null && roomDropTarget?.beforeRoomId === room.roomId}
                />
              ))}
              <ChannelDropLine
                visible={draggingRoomId !== null && roomDropTarget?.categoryId === null && roomDropTarget?.beforeRoomId === null}
              />
              {channels.length === 0 && (
                <p className="px-2 py-4 text-sm text-muted">
                  {status === "ready" ? t("sidebar.noRooms") : t("common.loading")}
                </p>
              )}
            </div>

            {categorized.map(({ category, rooms }, i) => (
              <div key={category.id}>
                <CategoryHeader
                  category={category}
                  space={space!}
                  collapsed={collapsedCategories.has(category.id)}
                  onToggle={() => toggleCategory(category.id)}
                  canManage={mayManageCategories}
                  isFirst={i === 0}
                  isLast={i === categorized.length - 1}
                  dropBeforeRoomId={rooms[0]?.roomId ?? null}
                />
                {!collapsedCategories.has(category.id) && (
                  <div id={`jk-cat-${category.id}`} className="flex flex-col gap-0.5" data-drop-category={category.id} data-drop-before="">
                    {rooms.map((room) => (
                      <ChannelRow
                        key={room.roomId}
                        room={room}
                        active={room.roomId === selectedRoomId}
                        onSelect={() => selectRoom(room.roomId)}
                        onVoiceJoin={() => void handleVoiceChannelClick(room)}
                        onContextMenu={ctx(room)}
                        draggable={mayManageCategories}
                        dragging={draggingRoomId === room.roomId}
                        onDragPointerDown={(e) => beginRoomDragCandidate(room.roomId, e)}
                        dropCategoryId={category.id}
                        showDropLineBefore={
                          roomDropTarget?.categoryId === category.id && roomDropTarget?.beforeRoomId === room.roomId
                        }
                      />
                    ))}
                    <ChannelDropLine
                      visible={
                        draggingRoomId !== null &&
                        roomDropTarget?.categoryId === category.id &&
                        roomDropTarget?.beforeRoomId === null
                      }
                    />
                    {rooms.length === 0 && (
                      <p className="px-2 py-1 text-xs italic text-muted">Nincs ide sorolt szoba.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
        {!query && lowPriorityRooms.length > 0 && (
          <>
            <SectionLabel>{t("sidebar.lowPriority")}</SectionLabel>
            <div className="flex flex-col gap-0.5">
              {lowPriorityRooms.map((room) => (
                <ChannelRow
                  key={room.roomId}
                  room={room}
                  active={room.roomId === selectedRoomId}
                  onSelect={() => selectRoom(room.roomId)}
                  onVoiceJoin={() => void handleVoiceChannelClick(room)}
                  onContextMenu={ctx(room)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <UserPanel />
      {ctxMenu}
    </nav>
  );
}
