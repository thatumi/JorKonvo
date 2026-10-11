package dev.szabotar.jorkonvo.push;

import android.content.Context;
import android.util.Log;
import dev.szabotar.jorkonvo.R;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;

/**
 * Turns one Sygnal FCM push into what the notification shows.
 *
 * The pusher is event_id_only (src/lib/push/pusher.ts), so the push itself
 * carries only room_id, event_id, the unread count and `jk_uid` (which of the
 * device's accounts it's for, from the pusher's default_payload). Everything
 * else is resolved here, on the device, per the account's preview mode:
 *
 *   full    fetch the event with the stored access token, decrypt it with
 *           the stored Megolm keys if it's encrypted -> sender + text
 *   sender  fetch the event for its sender only -> "Sofia: New message"
 *   (none)  nothing stored ("hidden" mode) -> "New message"
 *
 * Any failure (offline, token expired, key not exported yet) degrades to the
 * next best text, never to no notification. A push from an older full-format
 * pusher (content in the payload) is still understood.
 */
public final class PushContent {

    private static final String TAG = "JorKonvoPush";
    private static final int TIMEOUT_MS = 5000;

    public final String roomId;
    public final String eventId;
    /** Display name of the sender, "" if unknown. */
    public final String senderName;
    /** Matrix id of the sender, "" if unknown. */
    public final String senderId;
    /** Room name to show as the conversation title, "" for a DM / unknown. */
    public final String roomName;
    public final boolean isGroup;
    public final String text;
    /** Large icon: the DM partner's or the room's space's avatar, null if none cached. */
    public final File conversationAvatar;
    /** The sender's avatar for MessagingStyle, null if none cached. */
    public final File senderAvatar;

    private PushContent(
        String roomId,
        String eventId,
        String senderName,
        String senderId,
        String roomName,
        boolean isGroup,
        String text,
        File conversationAvatar,
        File senderAvatar
    ) {
        this.roomId = roomId;
        this.eventId = eventId;
        this.senderName = senderName;
        this.senderId = senderId;
        this.roomName = roomName;
        this.isGroup = isGroup;
        this.text = text;
        this.conversationAvatar = conversationAvatar;
        this.senderAvatar = senderAvatar;
    }

    public static PushContent resolve(Context ctx, Map<String, String> data) {
        String roomId = str(data.get("room_id"));
        String eventId = str(data.get("event_id"));
        PushStore store = new PushStore(ctx);

        String userId = str(data.get("jk_uid"));
        if (userId.isEmpty()) {
            List<String> accounts = store.listAccounts();
            if (accounts.size() == 1) userId = accounts.get(0);
        }
        JSONObject account = userId.isEmpty() ? null : store.getAccount(userId);
        JSONObject dir = userId.isEmpty() ? new JSONObject() : store.getDirectory(userId);
        JSONObject roomInfo = dir.optJSONObject("rooms") != null ? dir.optJSONObject("rooms").optJSONObject(roomId) : null;
        JSONObject users = dir.optJSONObject("users") != null ? dir.optJSONObject("users") : new JSONObject();

        // Legacy full-format push: the content is in the payload.
        if (data.containsKey("type") && account == null) {
            String sender = str(data.get("sender"));
            String name = firstNonEmpty(data.get("sender_display_name"), sender);
            String room = firstNonEmpty(data.get("room_name"), data.get("room_alias"));
            JSONObject content = new JSONObject();
            try {
                content.put("msgtype", str(data.get("content_msgtype")));
                content.put("body", str(data.get("content_body")));
            } catch (Exception ignored) {}
            String text = describe(ctx, str(data.get("type")), content, str(data.get("membership")), name);
            boolean group = !room.isEmpty() && !room.equals(name);
            return new PushContent(roomId, eventId, name, sender, group ? room : "", group, text, null, null);
        }

        String roomName = roomInfo != null ? roomInfo.optString("n") : "";
        boolean dm = roomInfo != null && roomInfo.optBoolean("dm");
        String newMessage = ctx.getString(R.string.push_new_message);

        if (account == null) {
            // "Hidden" preview: say nothing beyond "new message".
            return new PushContent(roomId, eventId, "", "", "", false, newMessage, null, null);
        }

        String mode = account.optString("mode", PushStore.MODE_FULL);
        String hs = account.optString("homeserverUrl").replaceAll("/+$", "");
        String token = account.optString("accessToken");

        JSONObject event = null;
        if (!roomId.isEmpty() && !eventId.isEmpty()) {
            event = getJson(hs + "/_matrix/client/v3/rooms/" + enc(roomId) + "/event/" + enc(eventId), token);
        }
        String sender = event != null ? event.optString("sender") : "";
        String senderName = sender.isEmpty() ? "" : users.optString(sender, "");
        if (senderName.isEmpty() && !sender.isEmpty()) {
            JSONObject member = getJson(
                hs + "/_matrix/client/v3/rooms/" + enc(roomId) + "/state/m.room.member/" + enc(sender),
                token
            );
            senderName = member != null ? member.optString("displayname", "") : "";
            if (senderName.isEmpty()) senderName = localpart(sender);
        }
        if (roomName.isEmpty() && roomInfo == null && !roomId.isEmpty()) {
            JSONObject nameEvent = getJson(hs + "/_matrix/client/v3/rooms/" + enc(roomId) + "/state/m.room.name/", token);
            roomName = nameEvent != null ? nameEvent.optString("name", "") : "";
        }

        String text = newMessage;
        if (event != null && PushStore.MODE_FULL.equals(mode)) {
            String type = event.optString("type");
            JSONObject content = event.optJSONObject("content");
            if (content == null) content = new JSONObject();
            if ("m.room.encrypted".equals(type)) {
                JSONObject inner = decrypt(store, userId, roomId, content);
                if (inner != null) {
                    type = inner.optString("type");
                    content = inner.optJSONObject("content") != null ? inner.optJSONObject("content") : new JSONObject();
                    text = describe(ctx, type, content, "", senderName);
                } else {
                    text = ctx.getString(R.string.push_encrypted_message);
                }
            } else {
                String membership = "m.room.member".equals(type) ? content.optString("membership") : "";
                text = describe(ctx, type, content, membership, senderName);
            }
        }

        boolean group = !dm && !roomName.isEmpty() && !roomName.equals(senderName);
        String space = roomInfo != null ? roomInfo.optString("s", "") : "";
        File senderAvatar = sender.isEmpty() ? null : store.avatarFile(userId, "u:" + sender);
        // DM: the other person. Channel: its space's picture, else the room's,
        // else (a room without any picture) the sender's.
        File conversationAvatar = dm
            ? senderAvatar
            : firstFile(
                firstFile(space.isEmpty() ? null : store.avatarFile(userId, "r:" + space), store.avatarFile(userId, "r:" + roomId)),
                senderAvatar
            );
        return new PushContent(roomId, eventId, senderName, sender, group ? roomName : "", group, text, conversationAvatar, senderAvatar);
    }

    private static JSONObject decrypt(PushStore store, String userId, String roomId, JSONObject content) {
        if (!"m.megolm.v1.aes-sha2".equals(content.optString("algorithm"))) return null;
        String key = store.getSessionKey(userId, roomId, content.optString("session_id"));
        if (key == null) return null; // Key arrived after the app last ran - documented limitation.
        try {
            JSONObject inner = new JSONObject(Megolm.decrypt(key, content.optString("ciphertext")));
            // The plaintext names its room; a mismatch means a replayed message.
            if (!roomId.equals(inner.optString("room_id"))) return null;
            return inner;
        } catch (Exception e) {
            Log.w(TAG, "decrypt failed: " + e.getMessage());
            return null;
        }
    }

    /** One-line text for an event; mirrors apps/web/public/sw.js describe(). */
    static String describe(Context ctx, String type, JSONObject content, String membership, String senderName) {
        String msgtype = content.optString("msgtype");
        String body = content.optString("body");
        if ("m.room.encrypted".equals(type)) return ctx.getString(R.string.push_encrypted_message);
        if ("m.room.member".equals(type) && "invite".equals(membership)) return ctx.getString(R.string.push_invite);
        if (type.contains("call") || type.endsWith("rtc.notification")) return ctx.getString(R.string.push_call);
        if ("m.room.message".equals(type) && !body.isEmpty()) {
            body = stripReplyFallback(body);
            if ("m.emote".equals(msgtype)) return "* " + senderName + " " + body;
            if ("m.image".equals(msgtype)) return "🖼 " + ctx.getString(R.string.push_image);
            return body;
        }
        if ("m.sticker".equals(type)) return ctx.getString(R.string.push_sticker);
        if (type.endsWith("poll.start")) return ctx.getString(R.string.push_poll);
        return ctx.getString(R.string.push_new_message);
    }

    /** Drops a reply's "> <@user> quoted text" fallback block. */
    static String stripReplyFallback(String body) {
        String[] lines = body.split("\n", -1);
        int i = 0;
        while (i < lines.length && lines[i].startsWith("> ")) i++;
        if (i == 0) return body;
        while (i < lines.length && lines[i].isEmpty()) i++;
        StringBuilder rest = new StringBuilder();
        for (int j = i; j < lines.length; j++) {
            if (rest.length() > 0) rest.append('\n');
            rest.append(lines[j]);
        }
        return rest.length() > 0 ? rest.toString() : body;
    }

    private static JSONObject getJson(String url, String token) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Accept", "application/json");
            int code = conn.getResponseCode();
            if (code != 200) {
                Log.w(TAG, "GET " + url.replaceAll("\\?.*", "") + " -> " + code);
                return null;
            }
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            Log.w(TAG, "GET failed: " + e.getClass().getSimpleName());
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            return s;
        }
    }

    private static String localpart(String userId) {
        int colon = userId.indexOf(':');
        return userId.startsWith("@") && colon > 1 ? userId.substring(1, colon) : userId;
    }

    private static File firstFile(File a, File b) {
        return a != null ? a : b;
    }

    static String str(String s) {
        return s == null || "None".equals(s) ? "" : s;
    }

    static String firstNonEmpty(String... values) {
        for (String v : values) {
            String s = str(v);
            if (!s.isEmpty()) return s;
        }
        return "";
    }
}
