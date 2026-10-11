import {
  banMember,
  canBan,
  canKick,
  canManageRoles,
  canSetMemberPowerLevel,
  canTimeOut,
  clearUserTimeout,
  getFriendRequests,
  getFriends,
  getMemberPowerLevel,
  getMemberRoleIds,
  getOwningSpace,
  getSpaceRoles,
  getUserCallPrefs,
  getUserNote,
  getUserTimeout,
  isUserIgnored,
  kickMember,
  type MatrixClient,
  POWER_LEVEL_PRESETS,
  type Room,
  removeFriend,
  sendFriendRequest,
  setMemberPowerLevel,
  setMemberRoleAssigned,
  setUserCallPrefs,
  setUserIgnored,
  setUserNote,
  setUserTimeout,
  startDirectMessage,
  TIMEOUT_PRESETS,
  USER_VOLUME_MAX,
  USER_VOLUME_MIN,
} from "@jorkonvo/matrix-core";
import { useState } from "react";
import { useTranslation } from "../i18n";
import { uiConfirm, uiPrompt } from "../lib/dialogs";
import { useMatrixStore } from "../state/matrixStore";
import { isDeveloperMode } from "../lib/displayPrefs";
import { reapplyUserCallPrefsIfInCall } from "../state/groupCallStore";
import { useModalStore } from "../state/modalStore";
import { useUiStore } from "../state/uiStore";
import { useVerificationStore } from "../state/verificationStore";
import type { MenuItem } from "./ContextMenu";

const icon = (path: string) => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
    <path d={path} />
  </svg>
);

/**
 * The per-user call volume control, shown as a MenuItem.panel (a real
 * slider, not a fixed list of percentages) - Discord's own "User Volume"
 * popover. Keeps its own state so the displayed value tracks the drag live;
 * `onChange` fires (fire-and-forget) on every move, same pattern as the
 * mic/speaker volume sliders in UserSettingsModal.
 */
function UserVolumeSlider({
  volume,
  muted,
  onChange,
}: {
  volume: number;
  muted: boolean;
  onChange: (patch: { volume?: number; muted?: boolean }) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(volume);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs font-bold uppercase text-muted">
        <span>{t("profile.volume")}</span>
        <span>{muted ? t("profile.muteForMe") : `${value}%`}</span>
      </div>
      <input
        type="range"
        min={USER_VOLUME_MIN}
        max={USER_VOLUME_MAX}
        value={value}
        disabled={muted}
        aria-label={t("profile.volume")}
        onChange={(e) => {
          const v = Number(e.target.value);
          setValue(v);
          onChange({ volume: v, muted: false });
        }}
        className="w-full disabled:opacity-40"
      />
    </div>
  );
}

const POWER_LABEL_KEY: Record<number, string> = {
  100: "power.owner",
  50: "power.admin",
  25: "power.moderator",
  0: "power.member",
};

/**
 * Right-click menu for a room/space member - the profile popover's actions in
 * a form that fits a native-feeling context menu. Shared between the member
 * list and message authors so both entry points behave identically.
 */
export function useMemberMenu(room: Room) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client) as MatrixClient;
  const selectSpace = useUiStore((s) => s.selectSpace);
  const startVerification = useVerificationStore((s) => s.start);
  const openModal = useModalStore((s) => s.open);

  return (userId: string): MenuItem[] => {
    const ownUserId = client.getUserId() ?? "";
    if (userId === ownUserId) {
      const selfOwningSpace = getOwningSpace(client, room.roomId);
      const selfItems: MenuItem[] = [
        {
          label: t("profile.copyId"),
          icon: icon("M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8v16h11V5Z"),
          onClick: () => void navigator.clipboard.writeText(userId),
        },
      ];
      if (selfOwningSpace) {
        selfItems.push({
          label: t("spaceSettings.myProfile"),
          icon: icon("M12 12c2.7 0 8 1.34 8 4v2H4v-2c0-2.66 5.3-4 8-4Zm0-2a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z"),
          onClick: () => openModal({ type: "spaceSettings", spaceId: selfOwningSpace.roomId }),
        });
      }
      return selfItems;
    }

    const name = room.getMember(userId)?.name ?? userId;
    const isFriend = getFriends(client).includes(userId);
    const requestOutgoing = getFriendRequests(client).outgoing.some((r) => r.userId === userId);
    const ignored = isUserIgnored(client, userId);
    const callPrefs = getUserCallPrefs(client, userId);
    const note = getUserNote(client, userId);
    const setCallPrefs = (patch: Parameters<typeof setUserCallPrefs>[2]) => {
      void setUserCallPrefs(client, userId, patch).then(() => reapplyUserCallPrefsIfInCall(client, userId));
    };
    const owningSpace = getOwningSpace(client, room.roomId);
    const mayManageRoles = owningSpace ? canManageRoles(owningSpace, ownUserId) : false;
    const roleIds = owningSpace ? new Set(getMemberRoleIds(owningSpace, userId)) : new Set<string>();

    const items: MenuItem[] = [
      {
        label: t("profile.dm"),
        icon: icon("M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Z"),
        onClick: () => {
          // A DM isn't "in" the server you opened it from - selectRoom() alone
          // left selectedSpaceId pointing at that server, so the main pane
          // switched to the DM but the left sidebar kept showing the server's
          // channel list instead of the Home/DM section. selectSpace(null, id)
          // is the same navigation DMs elsewhere in the app already use.
          void startDirectMessage(client, userId).then((id) => selectSpace(null, id));
        },
      },
      {
        label: t("profile.verify"),
        icon: icon("M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm-1 15-4-4 1.4-1.4 2.6 2.6 5.6-5.6L19 9l-8 7Z"),
        onClick: () => void startVerification(client, userId),
      },
      {
        label: isFriend
          ? t("profile.removeFriend")
          : requestOutgoing
            ? t("profile.friendRequestSent")
            : t("profile.addFriend"),
        icon: icon("M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6Zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z"),
        disabled: requestOutgoing && !isFriend,
        danger: isFriend,
        onClick: () =>
          void (async () => {
            if (isFriend) {
              if (await uiConfirm(t("friends.removeConfirm", { name }), { danger: true })) {
                await removeFriend(client, userId);
              }
            } else {
              await sendFriendRequest(client, userId);
            }
          })(),
      },
      {
        label: ignored ? t("profile.unignore") : t("profile.ignore"),
        separator: true,
        danger: !ignored,
        icon: icon("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM4 12a8 8 0 0 1 12.9-6.3L5.7 16.9A7.96 7.96 0 0 1 4 12Zm8 8a7.96 7.96 0 0 1-4.9-1.7L18.3 7.1A8 8 0 0 1 12 20Z"),
        onClick: () => void setUserIgnored(client, userId, !ignored),
      },
      {
        label: t("profile.volume"),
        separator: true,
        icon: icon("M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.48 4.48 0 0 0 16.5 12Z"),
        panel: () => (
          <UserVolumeSlider volume={callPrefs.volume} muted={callPrefs.muted} onChange={setCallPrefs} />
        ),
      },
      {
        label: t("profile.muteForMe"),
        checked: callPrefs.muted,
        icon: icon("M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2Z"),
        onClick: () => setCallPrefs({ muted: !callPrefs.muted }),
      },
      {
        label: t("profile.muteSoundboardForMe"),
        checked: callPrefs.mutedSoundboard,
        icon: icon("M12 3 4 9v6h4l5 5V4L9.5 7.5 12 3ZM19 9l-4 4m0-4 4 4"),
        onClick: () => setCallPrefs({ mutedSoundboard: !callPrefs.mutedSoundboard }),
      },
      {
        label: note ? t("profile.editNote") : t("profile.addNote"),
        separator: true,
        icon: icon("M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"),
        onClick: () =>
          void (async () => {
            const next = await uiPrompt(t("profile.notePrompt", { name }), note);
            if (next !== null) await setUserNote(client, userId, next);
          })(),
      },
    ];

    if (owningSpace) {
      const roles = getSpaceRoles(owningSpace).filter((r) => mayManageRoles || roleIds.has(r.id));
      if (roles.length > 0) {
        items.push({
          label: t("profile.roles"),
          separator: true,
          icon: icon("M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Z"),
          submenu: roles.map((r) => ({
            label: r.name,
            checked: roleIds.has(r.id),
            disabled: !mayManageRoles,
            onClick: () =>
              void setMemberRoleAssigned(
                client,
                owningSpace.roomId,
                userId,
                r.id,
                !roleIds.has(r.id),
              ),
          })),
        });
      }
    }

    const currentLevel = getMemberPowerLevel(room, userId);
    const powerOptions = POWER_LEVEL_PRESETS.filter((p) =>
      canSetMemberPowerLevel(room, ownUserId, userId, p.value),
    );
    if (powerOptions.length > 0) {
      items.push({
        label: t("modMenu.permissionLevel"),
        separator: true,
        icon: icon("M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8Z"),
        submenu: powerOptions.map((p) => ({
          label: t(POWER_LABEL_KEY[p.value] ?? "power.custom", { level: p.value }),
          checked: currentLevel === p.value,
          onClick: () => void setMemberPowerLevel(client, room.roomId, userId, p.value),
        })),
      });
    }

    const timeout = getUserTimeout(room, userId);
    if (canTimeOut(room, ownUserId, userId)) {
      if (timeout) {
        items.push({
          label: t("modMenu.timeoutClear"),
          separator: powerOptions.length === 0,
          icon: icon("M11 8v5l4 2 .75-1.23-3.25-1.92V8H11Zm1-6a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z"),
          onClick: () => void clearUserTimeout(client, room.roomId, userId),
        });
      } else {
        items.push({
          label: t("modMenu.timeout"),
          separator: powerOptions.length === 0,
          danger: true,
          icon: icon("M11 8v5l4 2 .75-1.23-3.25-1.92V8H11Zm1-6a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z"),
          submenu: TIMEOUT_PRESETS.map((p) => ({
            label: t(p.labelKey),
            onClick: () => void setUserTimeout(client, room.roomId, userId, p.ms),
          })),
        });
      }
    }

    if (canKick(room, ownUserId, userId)) {
      items.push({
        label: t("profile.kick"),
        separator: true,
        danger: true,
        icon: icon("M10 9v2h8V9h-8Zm0 4v2h5v-2h-5ZM3 3h7v2H5v14h5v2H3V3Zm14.5 4L22 12l-4.5 5-1.4-1.4 2.6-2.6H10v-2h8.7l-2.6-2.6L17.5 7Z"),
        onClick: () =>
          void (async () => {
            if (await uiConfirm(t("profile.kickConfirm", { name }), { danger: true })) {
              await kickMember(client, room.roomId, userId);
            }
          })(),
      });
    }
    if (canBan(room, ownUserId, userId)) {
      items.push({
        label: t("profile.ban"),
        danger: true,
        icon: icon("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM4 12a8 8 0 0 1 12.9-6.3L5.7 16.9A7.96 7.96 0 0 1 4 12Zm8 8a7.96 7.96 0 0 1-4.9-1.7L18.3 7.1A8 8 0 0 1 12 20Z"),
        onClick: () =>
          void (async () => {
            if (await uiConfirm(t("profile.banConfirm", { name }), { danger: true })) {
              await banMember(client, room.roomId, userId);
            }
          })(),
      });
    }

    if (isDeveloperMode()) {
      items.push({
        label: t("profile.copyId"),
        separator: true,
        icon: icon("M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8v16h11V5Z"),
        onClick: () => void navigator.clipboard.writeText(userId),
      });
    }

    return items;
  };
}
