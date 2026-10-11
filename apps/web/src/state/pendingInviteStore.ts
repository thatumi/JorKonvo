import { create } from "zustand";

/**
 * Holds an invite-link target caught by lib/inviteLinkHandler.ts before the
 * user is necessarily logged in yet (a cold app start via a link has to
 * wait for auth to settle before it can open the join modal) - App.tsx
 * watches this alongside authStore's status and acts on it once ready.
 */
interface PendingInviteState {
  target: string | null;
  setTarget: (target: string | null) => void;
}

export const usePendingInviteStore = create<PendingInviteState>((set) => ({
  target: null,
  setTarget: (target) => set({ target }),
}));
