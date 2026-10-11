import { useModalStore } from "../state/modalStore";
import { AddAccountModal } from "./modals/AddAccountModal";
import { AddWidgetModal } from "./modals/AddWidgetModal";
import { AuditLogModal } from "./modals/AuditLogModal";
import { CallHistoryModal } from "./modals/CallHistoryModal";
import { DiscoverSpacesModal } from "./modals/DiscoverSpacesModal";
import { CloneSpaceModal } from "./modals/CloneSpaceModal";
import { CreateCalendarEventModal } from "./modals/CreateCalendarEventModal";
import { CreateCategoryModal } from "./modals/CreateCategoryModal";
import { CreateForumPostModal } from "./modals/CreateForumPostModal";
import { CreatePollModal } from "./modals/CreatePollModal";
import { CreateRoomModal } from "./modals/CreateRoomModal";
import { CreateSpaceModal } from "./modals/CreateSpaceModal";
import { EditHistoryModal } from "./modals/EditHistoryModal";
import { FirstLoginSecurityModal } from "./modals/FirstLoginSecurityModal";
import { ForwardMessageModal } from "./modals/ForwardMessageModal";
import { JoinRoomModal } from "./modals/JoinRoomModal";
import { PinnedMessagesModal } from "./modals/PinnedMessagesModal";
import { ReactionRoleModal } from "./modals/ReactionRoleModal";
import { RecoveryKeyModal } from "./modals/RecoveryKeyModal";
import { RoomSettingsModal } from "./modals/RoomSettingsModal";
import { ScanQrLoginModal } from "./modals/ScanQrLoginModal";
import { SendGifModal } from "./modals/SendGifModal";
import { SendStickerModal } from "./modals/SendStickerModal";
import { ShareLocationModal } from "./modals/ShareLocationModal";
import { SpaceHierarchyModal } from "./modals/SpaceHierarchyModal";
import { SpaceSettingsModal } from "./modals/SpaceSettingsModal";
import { StartDmModal } from "./modals/StartDmModal";
import { StartWatchTogetherModal } from "./modals/StartWatchTogetherModal";
import { UserSettingsModal } from "./modals/UserSettingsModal";

/**
 * Singleton mount point that renders whichever modal the modalStore has open.
 * Every variant composes the Modal primitive, so focus trapping, Escape
 * handling and focus restore are inherited and need no wiring here.
 */
export function ModalHost() {
  const modal = useModalStore((s) => s.modal);

  if (!modal) return null;

  switch (modal.type) {
    case "createRoom":
      return <CreateRoomModal parentSpaceId={modal.parentSpaceId} />;
    case "createSpace":
      return <CreateSpaceModal />;
    case "joinRoom":
      return <JoinRoomModal initialTarget={modal.initialTarget} />;
    case "startDm":
      return <StartDmModal />;
    case "recoveryKey":
      return <RecoveryKeyModal />;
    case "roomSettings":
      return <RoomSettingsModal roomId={modal.roomId} />;
    case "userSettings":
      return <UserSettingsModal />;
    case "pinnedMessages":
      return <PinnedMessagesModal roomId={modal.roomId} />;
    case "forwardMessage":
      return <ForwardMessageModal roomId={modal.roomId} eventId={modal.eventId} />;
    case "createCategory":
      return <CreateCategoryModal spaceId={modal.spaceId} />;
    case "auditLog":
      return <AuditLogModal roomId={modal.roomId} />;
    case "createPoll":
      return <CreatePollModal roomId={modal.roomId} />;
    case "createCalendarEvent":
      return <CreateCalendarEventModal roomId={modal.roomId} />;
    case "sendSticker":
      return <SendStickerModal roomId={modal.roomId} />;
    case "shareLocation":
      return <ShareLocationModal roomId={modal.roomId} />;
    case "spaceSettings":
      return <SpaceSettingsModal spaceId={modal.spaceId} initialPaneId={modal.initialPaneId} />;
    case "addAccount":
      return <AddAccountModal />;
    case "addWidget":
      return <AddWidgetModal roomId={modal.roomId} />;
    case "createForumPost":
      return <CreateForumPostModal roomId={modal.roomId} />;
    case "scanQrLogin":
      return <ScanQrLoginModal />;
    case "spaceHierarchy":
      return <SpaceHierarchyModal spaceId={modal.spaceId} />;
    case "editHistory":
      return <EditHistoryModal roomId={modal.roomId} eventId={modal.eventId} />;
    case "reactionRoles":
      return <ReactionRoleModal roomId={modal.roomId} eventId={modal.eventId} />;
    case "cloneSpace":
      return <CloneSpaceModal spaceId={modal.spaceId} />;
    case "callHistory":
      return <CallHistoryModal />;
    case "discoverSpaces":
      return <DiscoverSpacesModal />;
    case "sendGif":
      return <SendGifModal roomId={modal.roomId} />;
    case "startWatchTogether":
      return <StartWatchTogetherModal roomId={modal.roomId} />;
    case "firstLoginSecurity":
      return modal.mode === "create" ? (
        <FirstLoginSecurityModal mode="create" knownPassword={modal.knownPassword} />
      ) : (
        <FirstLoginSecurityModal mode="restore" />
      );
    default:
      return null;
  }
}
