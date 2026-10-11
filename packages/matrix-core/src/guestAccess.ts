import { EventType, type MatrixClient, type Room } from "matrix-js-sdk";

/**
 * Guest access (`m.room.guest_access`). When a room allows guests, the
 * homeserver's `/register?kind=guest` hands out a password-less, throwaway
 * account that can join and read (and, if history is world_readable, even
 * preview without joining). Guests can't be invited, can't set a profile,
 * and are wiped when they log out.
 *
 * This module is a thin typed wrapper around the two state events involved;
 * the actual guest *session* is created by the app (registerGuest below).
 * The homeserver must also have `allow_guest_access: true` configured -
 * there's no client-side way around that.
 */

export type GuestAccessValue = "can_join" | "forbidden";

export function getGuestAccess(room: Room): GuestAccessValue {
  const content = room.currentState.getStateEvents(EventType.RoomGuestAccess, "")?.getContent() as
    | { guest_access?: string }
    | undefined;
  return content?.guest_access === "can_join" ? "can_join" : "forbidden";
}

export function canManageGuestAccess(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(EventType.RoomGuestAccess, userId);
}

/**
 * Enables/disables guest join for a room. Enabling also opens history to
 * `world_readable` (so a guest can preview before joining, matching what
 * "public + guests" means everywhere else) unless `keepHistory` is set.
 */
export async function setGuestAccess(
  client: MatrixClient,
  roomId: string,
  allow: boolean,
  keepHistory = false,
): Promise<void> {
  const send = client.sendStateEvent as unknown as (
    roomId: string,
    type: string,
    content: unknown,
    stateKey?: string,
  ) => Promise<unknown>;
  await send(roomId, EventType.RoomGuestAccess, { guest_access: allow ? "can_join" : "forbidden" }, "");
  if (allow && !keepHistory) {
    await send(
      roomId,
      EventType.RoomHistoryVisibility,
      { history_visibility: "world_readable" },
      "",
    ).catch(() => undefined);
  }
}

export interface GuestSession {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
}

/**
 * Registers a fresh guest account on the homeserver. Rejects clearly when
 * the server has guest registration turned off (M_FORBIDDEN / M_GUEST_ACCESS_FORBIDDEN).
 */
export async function registerGuest(homeserverUrl: string): Promise<GuestSession> {
  const base = homeserverUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/_matrix/client/v3/register?kind=guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initial_device_display_name: "JorKonvo (guest)" }),
  });
  const data = (await res.json()) as {
    errcode?: string;
    error?: string;
    user_id?: string;
    access_token?: string;
    device_id?: string;
  };
  if (!res.ok || !data.access_token || !data.user_id) {
    throw new Error(
      data.errcode === "M_FORBIDDEN" || data.errcode === "M_GUEST_ACCESS_FORBIDDEN"
        ? "This homeserver does not allow guest sign-in."
        : (data.error ?? `Guest registration failed (${res.status})`),
    );
  }
  return {
    homeserverUrl: base,
    accessToken: data.access_token,
    userId: data.user_id,
    deviceId: data.device_id ?? "",
  };
}
