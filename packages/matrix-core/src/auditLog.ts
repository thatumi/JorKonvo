import { EventType, type MatrixEvent, type Room } from "matrix-js-sdk";

/**
 * A searchable moderation/change log, built by scanning the room's already-
 * loaded live timeline for state events (membership changes, power level
 * changes, name/topic/avatar/pin changes) - same manual-scan pattern as
 * reactions/threads/voice-presence elsewhere in this package. Matrix keeps
 * this data natively (every state change is itself an event in the room),
 * there's just no dedicated "audit log" API to fetch it separately - what's
 * in the timeline (including anything paginated back into it) is what's
 * available here.
 */

export interface AuditEntry {
  id: string;
  ts: number;
  description: string;
}

function nameOf(room: Room, userId: string): string {
  return room.getMember(userId)?.name ?? userId;
}

function describeMembershipChange(room: Room, ev: MatrixEvent): string | null {
  const sender = ev.getSender();
  const target = ev.getStateKey();
  if (!sender || !target) return null;

  const content = ev.getContent();
  const prevContent = ev.getPrevContent();
  const membership = content.membership as string | undefined;
  const prevMembership = prevContent.membership as string | undefined;
  if (membership === prevMembership && content.displayname === prevContent.displayname) return null;

  const senderName = nameOf(room, sender);
  const targetName = (prevContent.displayname as string) || nameOf(room, target);
  const reason = content.reason ? ` - indoklás: "${content.reason}"` : "";

  if (membership === "ban") return `${senderName} kitiltotta: ${targetName}${reason}`;
  if (membership === "leave" && prevMembership === "ban") return `${senderName} feloldotta a kitiltást: ${targetName}`;
  if (membership === "leave" && prevMembership === "invite") {
    return sender === target ? `${targetName} elutasította a meghívást` : `${senderName} visszavonta a meghívást: ${targetName}`;
  }
  if (membership === "leave" && prevMembership === "join") {
    return sender === target ? `${targetName} elhagyta a szobát` : `${senderName} kirúgta: ${targetName}${reason}`;
  }
  if (membership === "invite") return `${senderName} meghívta: ${targetName}`;
  if (membership === "join" && prevMembership !== "join") return `${targetName} csatlakozott`;
  if (membership === "join" && prevMembership === "join" && content.displayname !== prevContent.displayname) {
    return `${targetName} módosította a saját nevét ebben a szobában`;
  }
  return null;
}

export function getRoomAuditLog(room: Room): AuditEntry[] {
  const entries: AuditEntry[] = [];

  for (const ev of room.getLiveTimeline().getEvents()) {
    const type = ev.getType();
    const sender = ev.getSender();
    const senderName = sender ? nameOf(room, sender) : "?";
    let description: string | null = null;

    switch (type) {
      case EventType.RoomMember:
        description = describeMembershipChange(room, ev);
        break;
      case EventType.RoomPowerLevels:
        description = `${senderName} módosította a jogosultsági szinteket`;
        break;
      case EventType.RoomName: {
        const name = ev.getContent().name as string | undefined;
        description = name ? `${senderName} átnevezte a szobát: "${name}"` : `${senderName} törölte a szoba nevét`;
        break;
      }
      case EventType.RoomTopic:
        description = `${senderName} módosította a szoba témáját`;
        break;
      case EventType.RoomAvatar:
        description = `${senderName} módosította a szoba képét`;
        break;
      case EventType.RoomPinnedEvents: {
        const now = (ev.getContent().pinned as string[] | undefined)?.length ?? 0;
        const before = (ev.getPrevContent().pinned as string[] | undefined)?.length ?? 0;
        description =
          now > before ? `${senderName} kitűzött egy üzenetet` : `${senderName} visszavont egy kitűzést`;
        break;
      }
      default:
        break;
    }

    if (description) {
      entries.push({ id: ev.getId() ?? `${ev.getTs()}-${entries.length}`, ts: ev.getTs(), description });
    }
  }

  return entries.reverse();
}
