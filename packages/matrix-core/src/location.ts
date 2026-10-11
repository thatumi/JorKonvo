import {
  ContentHelpers,
  getBeaconInfoIdentifier,
  LocationAssetType,
  M_BEACON,
  M_BEACON_INFO,
  type MatrixClient,
  type MatrixEvent,
  MsgType,
  type Room,
} from "matrix-js-sdk";
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";

type LooseSendEvent = (roomId: string, eventType: string, content: unknown) => Promise<unknown>;

/**
 * Location sharing, both one-off (m.location, sent as a plain m.room.message
 * with msgtype "m.location") and live (MSC3672 beacons - a Matrix-exclusive
 * feature with no Discord equivalent at all). matrix-js-sdk has first-class,
 * fairly complete support for both already (content-helpers for building/
 * parsing the content, a `Beacon` model kept live and current automatically
 * by normal sync processing on `room.currentState.beacons`, and dedicated
 * client methods for the state-event upsert dance) - this module is a thin
 * wrapper, same spirit as joinRules.ts.
 *
 * No map-tile rendering is included on purpose (no bundled mapping library,
 * no third-party tile server dependency) - a location card links out to
 * OpenStreetMap instead, keeping this dependency-free and robust to test.
 *
 * A live beacon is a single state event per (room, user) - re-sharing just
 * upserts the same (type, state_key) pair rather than creating a new one, so
 * this only ever tracks ONE active outgoing live share per room per user,
 * matching how the "stop sharing" transition works (it updates that same
 * event to live:false rather than superseding it with something new).
 */

export function isLocationMessage(ev: MatrixEvent): boolean {
  return ev.getContent()?.msgtype === MsgType.Location;
}

export function isBeaconInfoEvent(ev: MatrixEvent): boolean {
  return M_BEACON_INFO.matches(ev.getType());
}

/** True only for the revision that STARTS a share (live:true), not later updates/the stop transition - used to avoid double-counting one share's lifecycle as two separate unread "messages". */
export function isLiveLocationStartEvent(ev: MatrixEvent): boolean {
  return isBeaconInfoEvent(ev) && ContentHelpers.parseBeaconInfoContent(ev.getContent() as never).live === true;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  accuracyMeters: number | null;
}

/** Parses a `geo:lat,lon;u=accuracy` URI, per RFC 5870 (the subset the Matrix spec uses). */
export function parseGeoUri(uri: string): GeoPoint | null {
  const match = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:;u=(\d+(?:\.\d+)?))?/.exec(uri);
  if (!match) return null;
  return {
    lat: Number(match[1]),
    lon: Number(match[2]),
    accuracyMeters: match[3] ? Number(match[3]) : null,
  };
}

export function toGeoUri(point: { lat: number; lon: number; accuracyMeters?: number | null }): string {
  const base = `geo:${point.lat},${point.lon}`;
  return point.accuracyMeters != null ? `${base};u=${Math.round(point.accuracyMeters)}` : base;
}

export function getMapLink(point: { lat: number; lon: number }): string {
  return `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lon}#map=16/${point.lat}/${point.lon}`;
}

/** Sends the user's current position once, as a plain message. */
export async function sendStaticLocation(
  client: MatrixClient,
  roomId: string,
  point: { lat: number; lon: number; accuracyMeters?: number | null },
  description?: string,
): Promise<void> {
  const content = ContentHelpers.makeLocationContent(
    undefined,
    toGeoUri(point),
    Date.now(),
    description || undefined,
    LocationAssetType.Self,
  );
  await client.sendMessage(roomId, content as unknown as RoomMessageEventContent);
}

/** Starts (or restarts) sharing this user's live location in a room for `timeoutMs`. Returns the beacon_info event id, needed to relate location pings to it. */
export async function startLiveLocationShare(
  client: MatrixClient,
  roomId: string,
  timeoutMs: number,
  description?: string,
): Promise<string> {
  const content = ContentHelpers.makeBeaconInfoContent(timeoutMs, true, description, LocationAssetType.Self);
  const res = await client.unstable_createLiveBeacon(roomId, content);
  return res.event_id;
}

/** Stops a live share the user started in this room (upserts the same beacon_info event to live:false). */
export async function stopLiveLocationShare(client: MatrixClient, roomId: string, description?: string): Promise<void> {
  const content = ContentHelpers.makeBeaconInfoContent(0, false, description, LocationAssetType.Self);
  await client.unstable_setLiveBeacon(roomId, content);
}

/** Sends one location update (m.beacon) related to an active live share. */
export async function sendLiveLocationUpdate(
  client: MatrixClient,
  roomId: string,
  beaconInfoEventId: string,
  point: { lat: number; lon: number; accuracyMeters?: number | null },
): Promise<void> {
  const content = ContentHelpers.makeBeaconContent(toGeoUri(point), Date.now(), beaconInfoEventId);
  await (client.sendEvent as unknown as LooseSendEvent)(roomId, M_BEACON.name, content);
}

export interface BeaconSummary {
  identifier: string;
  ownerId: string;
  isLive: boolean;
  description: string | null;
  timeoutMs: number;
  lastPoint: GeoPoint | null;
  lastUpdateTs: number | null;
}

/** Reads the current, always-up-to-date state of the beacon a given m.beacon_info event belongs to (identified by room+owner, not by this specific event revision - see the module comment on why re-sharing upserts rather than creates a new beacon). */
export function getBeaconForEvent(room: Room, ev: MatrixEvent): BeaconSummary | null {
  const identifier = getBeaconInfoIdentifier(ev);
  const beacon = room.currentState.beacons.get(identifier);
  if (!beacon) return null;
  const loc = beacon.latestLocationState;
  return {
    identifier,
    ownerId: beacon.beaconInfoOwner,
    isLive: beacon.isLive,
    description: beacon.beaconInfo.description ?? null,
    timeoutMs: beacon.beaconInfo.timeout,
    lastPoint: loc?.uri ? parseGeoUri(loc.uri) : null,
    lastUpdateTs: loc?.timestamp ?? null,
  };
}
