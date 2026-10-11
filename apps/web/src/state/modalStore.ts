import { create } from "zustand";

export type ModalState =
  | { type: "createRoom"; parentSpaceId: string | null }
  | { type: "createSpace" }
  | { type: "joinRoom"; initialTarget?: string }
  | { type: "startDm" }
  | { type: "recoveryKey" }
  | { type: "roomSettings"; roomId: string }
  | { type: "userSettings" }
  | { type: "pinnedMessages"; roomId: string }
  | { type: "forwardMessage"; roomId: string; eventId: string }
  | { type: "createCategory"; spaceId: string }
  | { type: "auditLog"; roomId: string }
  | { type: "createPoll"; roomId: string }
  | { type: "createCalendarEvent"; roomId: string }
  | { type: "sendSticker"; roomId: string }
  | { type: "shareLocation"; roomId: string }
  | { type: "spaceSettings"; spaceId: string; initialPaneId?: string }
  | { type: "addAccount" }
  | { type: "addWidget"; roomId: string }
  | { type: "createForumPost"; roomId: string }
  | { type: "scanQrLogin" }
  | { type: "spaceHierarchy"; spaceId: string }
  | { type: "editHistory"; roomId: string; eventId: string }
  | { type: "reactionRoles"; roomId: string; eventId: string }
  | { type: "cloneSpace"; spaceId: string }
  | { type: "callHistory" }
  | { type: "discoverSpaces" }
  | { type: "sendGif"; roomId: string }
  | { type: "startWatchTogether"; roomId: string }
  | { type: "firstLoginSecurity"; mode: "create"; knownPassword?: string }
  | { type: "firstLoginSecurity"; mode: "restore" }
  | null;

interface ModalStoreState {
  modal: ModalState;
  open: (modal: NonNullable<ModalState>) => void;
  close: () => void;
}

export const useModalStore = create<ModalStoreState>((set) => ({
  modal: null,
  open: (modal) => set({ modal }),
  close: () => set({ modal: null }),
}));
