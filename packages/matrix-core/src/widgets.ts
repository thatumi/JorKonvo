import type { MatrixClient, MatrixEvent, Room } from "matrix-js-sdk";

/**
 * Room widgets (m.widget, MSC1236/2764) - embedding an arbitrary web app
 * (Etherpad, a whiteboard, a custom internal tool, a "calendar room"
 * webapp) inside a room, the same mechanism Element uses for its widget
 * sidebar. A widget is just a room state event; adding/removing/listing
 * them is fully real, spec-compliant Matrix state that any other Matrix
 * client (Element included) will also see and can render.
 *
 * What's DELIBERATELY NOT implemented here: the full widget postMessage
 * capability-negotiation API (MSC2762) - letting a widget request to read/
 * send room events, screen-share, act on the user's behalf, etc., each
 * gated behind an explicit permission prompt. That's a substantial API
 * surface of its own. What IS implemented is the far more common case for
 * a simple embed (an Etherpad, a dashboard, a form, exactly the kind of
 * "calendar room webapp" that prompted this feature): the iframe loads with
 * the spec's $matrix_* URL template variables substituted, and gets just
 * enough of a postMessage handshake to report "no capabilities requested"
 * so widgets that check for API readiness (rather than assuming a bare
 * iframe) don't hang waiting for a response that never comes.
 */

export const WIDGET_EVENT_TYPE = "m.widget";

export interface RoomWidget {
  id: string;
  type: string;
  url: string;
  name: string;
  creatorUserId?: string;
}

export function getRoomWidgets(room: Room): RoomWidget[] {
  const events = room.currentState.getStateEvents(WIDGET_EVENT_TYPE) as MatrixEvent[];
  return events
    .map((ev): RoomWidget | null => {
      const content = ev.getContent();
      // An empty content object is how a widget is "removed" (state events
      // can't be deleted, only overwritten) - skip those.
      if (!content || typeof content.url !== "string" || !content.url) return null;
      return {
        id: ev.getStateKey() ?? "",
        type: typeof content.type === "string" ? content.type : "customwidget",
        url: content.url,
        name: typeof content.name === "string" && content.name ? content.name : (typeof content.type === "string" ? content.type : "Widget"),
        creatorUserId: typeof content.creatorUserId === "string" ? content.creatorUserId : undefined,
      };
    })
    .filter((w): w is RoomWidget => w !== null);
}

export function canManageWidgets(room: Room, userId: string): boolean {
  return room.currentState.maySendStateEvent(WIDGET_EVENT_TYPE, userId);
}

type LooseSendStateEvent = (roomId: string, eventType: string, content: unknown, stateKey?: string) => Promise<unknown>;

function randomWidgetId(): string {
  return `jorkonvo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function addWidget(
  client: MatrixClient,
  roomId: string,
  options: { name: string; url: string; type?: string },
): Promise<void> {
  const content = {
    type: options.type?.trim() || "customwidget",
    url: options.url.trim(),
    name: options.name.trim(),
    creatorUserId: client.getUserId() ?? undefined,
  };
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, WIDGET_EVENT_TYPE, content, randomWidgetId());
}

/** Widgets can't be deleted, only overwritten with empty content (the spec's convention). */
export async function removeWidget(client: MatrixClient, roomId: string, widgetId: string): Promise<void> {
  await (client.sendStateEvent as unknown as LooseSendStateEvent)(roomId, WIDGET_EVENT_TYPE, {}, widgetId);
}

/**
 * Substitutes the spec's $matrix_* URL template variables
 * (https://spec.matrix.org/latest/client-server-api/#url-templating-for-widgets).
 * `theme` is passed in rather than read from anywhere in here since this
 * package has no notion of the app's UI theme - the caller (widget-hosting
 * component) supplies its own current theme.
 */
export function buildWidgetUrl(widget: RoomWidget, client: MatrixClient, room: Room, theme: string): string {
  const userId = client.getUserId() ?? "";
  const member = room.getMember(userId);
  const vars: Record<string, string> = {
    $matrix_user_id: userId,
    $matrix_room_id: room.roomId,
    $matrix_display_name: member?.name ?? userId,
    $matrix_avatar_url: member?.getMxcAvatarUrl() ?? "",
    $matrix_widget_id: widget.id,
    $theme: theme,
  };
  let url = widget.url;
  for (const [key, value] of Object.entries(vars)) {
    url = url.split(key).join(encodeURIComponent(value));
  }
  return url;
}
