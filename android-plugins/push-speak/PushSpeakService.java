package com.ourhabit.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.SharedPreferences;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * PushSpeakService — v5.5: THE UPDATE ANNOUNCEMENT THAT SPEAKS THE MOMENT IT
 * LANDS (owner: "নোটিফিকেশন যাবে, সাথে সাথে পড়ে শোনাবে — নাদিরা মনি। অ্যাপসে
 * নতুন আপডেট এসেছে, অ্যাপসটা আপনি ইনস্টল করুন... অ্যাপসের ভিতর ঢুকে পড়ে
 * শোনাতে হবে না")।
 *
 * WHY A SECOND FirebaseMessagingService: the update broadcast now arrives as
 * a DATA-ONLY FCM message, so onMessageReceived fires even when the process
 * is dead (notification-payload messages never reach a killed app). This
 * service then:
 *   1. posts the update notification itself (data messages are NOT shown by
 *      the system — the tray entry would otherwise never appear),
 *   2. starts AlarmSpeakService so the phone immediately CALLS the user by
 *      their registered name through the TTS engine (the same voice that
 *      calls the alarms) — no app open required.
 *
 * DOUBLE-FREE GUARDS:
 *   • FOREGROUND: MainActivity.onResume writes muted=true into the
 *     oh_keepalive prefs; when muted this service does NOTHING — the JS
 *     layer (Capacitor pushNotificationReceived) already announces it inside
 *     the app. When the app is closed/backgrounded the flag is false and the
 *     native announcement happens.
 *   • DUPLICATE DELIVERY: every broadcast carries a ts (epoch ms). The last
 *     announced ts is persisted; a repeated delivery of the same ts is
 *     dropped (covers FCM retries + the Capacitor plugin's saved-message
 *     replay on next open — the JS side keeps the same dedup in localStorage).
 *
 * Chat messages (ohChat) keep their notification payload — the system shows
 * them exactly as before; this service ignores them.
 */
public class PushSpeakService extends FirebaseMessagingService {

  private static final String PREFS = "oh_push_speak";
  private static final String KEY_LAST_TS = "last_update_ts";
  private static final String CHANNEL_ID = "oh_fcm_update";
  private static final String MUTE_PREFS = "oh_keepalive";
  private static final String MUTE_KEY = "muted";
  private static final int NOTIF_ID = 43912;

  @Override
  public void onMessageReceived(RemoteMessage remoteMessage) {
    try {
      if (remoteMessage == null || remoteMessage.getData() == null) return;
      Map<String, String> d = remoteMessage.getData();
      if (!"1".equals(d.get("ohUpdate"))) return;

      long ts = 0L;
      try {
        ts = Long.parseLong(String.valueOf(d.get("ts")));
      } catch (Exception ignored) {
      }
      SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      if (ts > 0) {
        if (sp.getLong(KEY_LAST_TS, 0L) == ts) return; // duplicate delivery
        sp.edit().putLong(KEY_LAST_TS, ts).apply();
      }

      // App in the foreground → MainActivity.onResume set muted=true and the
      // JS listener is announcing it in-app. Never speak twice.
      try {
        SharedPreferences mute = getSharedPreferences(MUTE_PREFS, Context.MODE_PRIVATE);
        if (mute.getBoolean(MUTE_KEY, false)) return;
      } catch (Exception ignored) {
      }

      String title = d.get("title");
      String body = d.get("body");
      String speak = d.get("speakText");
      if (title == null || title.trim().isEmpty()) title = "🔄 নতুন আপডেট চলে আসছে!";
      if (body == null || body.trim().isEmpty()) body = title;

      postUpdateNotification(title, body);
      if (speak != null && !speak.trim().isEmpty()) {
        AlarmSpeakService.startSpeakOnly(getApplicationContext(), speak, "bn");
      }
    } catch (Exception ignored) {
    }
  }

  /** The tray entry for the update announcement (data messages never show
   *  themselves — we build it with the same alarm-grade attention style). */
  private void postUpdateNotification(String title, String body) {
    try {
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "অ্যাপ আপডেট",
            NotificationManager.IMPORTANCE_HIGH);
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 300, 200, 300});
        try {
          ch.setSound(
              android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION),
              new android.media.AudioAttributes.Builder()
                  .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                  .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                  .build());
        } catch (Exception ignored) {
        }
        nm.createNotificationChannel(ch);
      }
      PendingIntent pi = ExactAlarmPlugin.launchPendingIntent(getApplicationContext(), 9);
      NotificationCompat.Builder b = new NotificationCompat.Builder(getApplicationContext(), CHANNEL_ID)
          .setSmallIcon(android.R.drawable.stat_sys_download_done)
          .setContentTitle(title)
          .setContentText(body)
          .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
          .setPriority(NotificationCompat.PRIORITY_HIGH)
          .setCategory(NotificationCompat.CATEGORY_MESSAGE)
          .setAutoCancel(true)
          .setContentIntent(pi)
          .setVibrate(new long[]{0, 300, 200, 300});
      NotificationManagerCompat nm2 = NotificationManagerCompat.from(getApplicationContext());
      boolean allowed = true;
      try {
        allowed = nm2.areNotificationsEnabled();
      } catch (Exception ignored) {
      }
      if (allowed) {
        try {
          nm2.notify(NOTIF_ID, b.build());
        } catch (SecurityException ignored) {
        }
      }
    } catch (Exception ignored) {
    }
  }
}
