package dev.szabotar.jorkonvo;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import dev.szabotar.jorkonvo.push.PushContent;
import java.io.File;
import java.util.List;
import java.util.Map;

/**
 * Background push for the Android app (services/sygnal → FCM → here).
 *
 * Sygnal's FCM pushkin sends DATA-only messages; the pusher is event_id_only,
 * so a push carries just room_id, event_id, the unread count and jk_uid.
 * Android never displays a data message by itself, and the Capacitor plugin
 * only forwards it to JS - which isn't running when the app is closed. So
 * this service builds the notification, with the sender, text and avatars
 * resolved on the device by PushContent (fetch + Megolm decrypt, per the
 * account's preview mode). It replaces the plugin's own MessagingService in the
 * manifest (only one service can receive MESSAGING_EVENT) and still hands
 * tokens + messages to the plugin, so the JS side keeps working.
 *
 * One notification per room (tag = room id), MessagingStyle so several
 * messages stack. A tap opens MainActivity with "google.message_id" in the
 * extras - PushNotificationsPlugin.handleOnNewIntent turns exactly that into
 * the JS `pushNotificationActionPerformed` event (cold start included,
 * BridgeActivity replays the launch intent), and src/lib/push opens the room.
 *
 * Runs on FCM's background thread, which may do network I/O (PushContent
 * caps each request at 5 s).
 */
public class JorKonvoMessagingService extends FirebaseMessagingService {

    static final String CHANNEL_ID = "messages";
    private static final int NOTIFICATION_ID = 1;
    /** Messages kept in one room's stacked notification. */
    private static final int MAX_LINES = 8;

    /** Set by MainActivity while it's resumed: the app is on screen, JS notifies in-app. */
    static volatile boolean appInForeground = false;

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        PushNotificationsPlugin.onNewToken(token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message);
        PushNotificationsPlugin.sendRemoteMessage(message);

        Map<String, String> data = message.getData();
        String roomId = str(data.get("room_id"));
        String eventId = str(data.get("event_id"));

        if (eventId.isEmpty()) {
            // Badge-only push: Synapse's unread count changed (read on another
            // device). Everything read → drop what we're still showing.
            if ("0".equals(data.get("unread"))) cancelAllMessageNotifications();
            return;
        }
        if (appInForeground || roomId.isEmpty()) return;

        showMessage(PushContent.resolve(this, data), message.getMessageId());
    }

    private void showMessage(PushContent push, String messageId) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(this);
        if (!nm.areNotificationsEnabled()) return;
        ensureChannel(this);

        String senderName = push.senderName.isEmpty() ? getString(R.string.app_name) : push.senderName;
        String roomId = push.roomId;

        Person me = new Person.Builder().setName(getString(R.string.push_you)).build();
        Person.Builder senderBuilder = new Person.Builder().setName(senderName).setKey(push.senderId);
        Bitmap senderAvatar = loadBitmap(push.senderAvatar);
        if (senderAvatar != null) senderBuilder.setIcon(IconCompat.createWithBitmap(senderAvatar));
        Person sender = senderBuilder.build();

        NotificationCompat.MessagingStyle style = null;
        Notification existing = activeNotification(roomId);
        if (existing != null) {
            style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(existing);
        }
        if (style == null) style = new NotificationCompat.MessagingStyle(me);
        style.setConversationTitle(push.isGroup ? push.roomName : null);
        style.setGroupConversation(push.isGroup);
        style.addMessage(push.text, System.currentTimeMillis(), sender);
        List<NotificationCompat.MessagingStyle.Message> messages = style.getMessages();
        while (messages.size() > MAX_LINES) messages.remove(0);

        // Opens MainActivity; the extras are what the Capacitor plugin forwards to JS.
        Intent tap = new Intent(this, MainActivity.class);
        tap.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        tap.putExtra("google.message_id", messageId != null ? messageId : push.eventId);
        tap.putExtra("room_id", roomId);
        tap.putExtra("event_id", push.eventId);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            roomId.hashCode(),
            tap,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        // Lets JS find (and clear) this room's notification via getDeliveredNotifications.
        Bundle extras = new Bundle();
        extras.putString("room_id", roomId);

        Notification publicVersion = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.push_new_message))
            .build();

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setColor(0xFF8B5CF6)
            .setStyle(style)
            .setContentTitle(push.isGroup ? push.roomName : senderName)
            .setContentText(push.isGroup ? senderName + ": " + push.text : push.text)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .addExtras(extras);
        Bitmap large = loadBitmap(push.conversationAvatar);
        if (large != null) builder.setLargeIcon(large);

        try {
            nm.notify(roomId, NOTIFICATION_ID, builder.build());
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS revoked between the check above and now.
        }
    }

    private static Bitmap loadBitmap(File f) {
        if (f == null) return null;
        try {
            return BitmapFactory.decodeFile(f.getPath());
        } catch (Exception e) {
            return null;
        }
    }

    private Notification activeNotification(String roomId) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return null;
        for (StatusBarNotification sbn : nm.getActiveNotifications()) {
            if (sbn.getId() == NOTIFICATION_ID && roomId.equals(sbn.getTag())) return sbn.getNotification();
        }
        return null;
    }

    private void cancelAllMessageNotifications() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        for (StatusBarNotification sbn : nm.getActiveNotifications()) {
            if (sbn.getId() == NOTIFICATION_ID && sbn.getTag() != null) nm.cancel(sbn.getTag(), NOTIFICATION_ID);
        }
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            ctx.getString(R.string.push_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(ctx.getString(R.string.push_channel_desc));
        nm.createNotificationChannel(channel);
    }

    private static String str(String s) {
        return s == null || "None".equals(s) ? "" : s;
    }
}
