import type { MatrixClient } from "@jorkonvo/matrix-core";
import { create } from "zustand";

/**
 * The account's authoritative global displayname/avatar, fetched from
 * /profile/{userId} rather than trusted from client.getUser(userId).
 *
 * Found live: matrix-js-sdk's in-memory `User` object updates its
 * displayName/avatarUrl opportunistically from ANY m.room.member event it
 * sees for that user - including a per-room nickname/avatar override set in
 * just one room (see roomProfile.ts). That's fine for RoomMember.name (which
 * is supposed to reflect the room-specific value), but client.getUser(...)
 * is meant to represent the ACCOUNT-wide identity, and picks up the same
 * contamination - so the moment a room-specific nickname is set anywhere,
 * every other place reading client.getUser(...).displayName (the bottom-left
 * UserPanel, the "global" name field in UserSettingsModal) started showing
 * the wrong, room-scoped name. This store sidesteps that entirely by asking
 * the server directly.
 */
interface ProfileState {
  displayName: string | null;
  avatarUrl: string | null;
  refresh: (client: MatrixClient) => Promise<void>;
}

export const useProfileStore = create<ProfileState>((set) => ({
  displayName: null,
  avatarUrl: null,
  refresh: async (client) => {
    const userId = client.getUserId();
    if (!userId) return;
    try {
      const info = await client.getProfileInfo(userId);
      set({ displayName: info.displayname ?? null, avatarUrl: info.avatar_url ?? null });
    } catch {
      // Keep whatever we had (or the client.getUser(...) fallback used by callers) - not worth surfacing an error for this.
    }
  },
}));
