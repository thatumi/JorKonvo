/* JorKonvo service worker — background push notifications only.
 *
 * The payload comes from Sygnal's webpush pushkin (services/sygnal,
 * webpushpushkin._build_payload): room_id, room_name, event_id, sender,
 * sender_display_name, type, content {msgtype, body, ...}, unread.
 * We deliberately keep this tiny and offline-agnostic: no asset caching,
 * no fetch handler — just show/dismiss notifications and open the room on
 * click (src/lib/push/webPush.ts initWebPushClickHandling). */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const HU = (self.navigator.language || "").toLowerCase().startsWith("hu");
const STRINGS = HU
  ? { encrypted: "Titkosított üzenet", image: "Kép", message: "Új üzenet", invite: "meghívott", call: "Bejövő hívás" }
  : { encrypted: "Encrypted message", image: "Image", message: "New message", invite: "invited you", call: "Incoming call" };

/** Drops a reply's "> <@user> quoted text" fallback block. */
function stripReplyFallback(body) {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].startsWith("> ")) i++;
  if (i === 0) return body;
  while (i < lines.length && lines[i] === "") i++;
  return lines.slice(i).join("\n") || body;
}

function describe(data) {
  const sender = data.sender_display_name || data.sender || "";
  const content = data.content || {};
  if (data.type === "m.room.encrypted") return { sender, text: STRINGS.encrypted };
  if (data.type === "m.room.member" && data.membership === "invite") return { sender, text: STRINGS.invite };
  if (/call/.test(data.type || "") || /rtc\.notification$/.test(data.type || "")) return { sender, text: `📞 ${STRINGS.call}` };
  if (data.type === "m.room.message" && typeof content.body === "string") {
    const body = stripReplyFallback(content.body);
    if (content.msgtype === "m.emote") return { sender: "", text: `* ${sender} ${body}` };
    if (content.msgtype === "m.image") return { sender, text: `🖼 ${STRINGS.image}` };
    return { sender, text: body };
  }
  return { sender, text: STRINGS.message };
}

async function appIsVisible() {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return all.some((c) => c.visibilityState === "visible");
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON payload — ignore */
  }

  event.waitUntil(
    (async () => {
      if ("setAppBadge" in self.navigator) {
        try {
          await self.navigator.setAppBadge(data.unread || 0);
        } catch {
          /* not supported */
        }
      }
      // A badge-only push (no event) — the pusher sets events_only, so
      // this is rare; drop stale notifications once everything is read.
      if (!data.event_id) {
        if (!data.unread) (await self.registration.getNotifications()).forEach((n) => n.close());
        return;
      }
      // The open tab already notifies in-page (NotificationManager). A
      // visible client exempts us from the userVisibleOnly rule.
      if (await appIsVisible()) return;

      const { sender, text } = describe(data);
      const roomName = data.room_name || data.room_alias || "";
      // DMs: Synapse names the room after the other person - don't repeat it.
      const title = roomName && roomName !== sender ? roomName : sender || "JorKonvo";
      const body = sender && title !== sender ? `${sender}: ${text}` : text;

      await self.registration.showNotification(title, {
        body,
        tag: data.room_id || data.event_id,
        renotify: true,
        icon: "/favicon.svg",
        badge: "/favicon.svg",
        data: { room_id: data.room_id, event_id: data.event_id },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const roomId = event.notification.data && event.notification.data.room_id;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if (roomId) client.postMessage({ type: "jk-open-room", roomId });
          return;
        }
      }
      await self.clients.openWindow(roomId ? `/?room=${encodeURIComponent(roomId)}` : "/");
    })(),
  );
});
