package com.ourhabit.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.SharedPreferences;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * PushSpeakService — v5.6 (ALL-VERSION UPDATE DELIVERY): THE UPDATE
 * ANNOUNCEMENT THAT REACHES EVERY PHONE (owner: "আগের যারা 5.30 অথবা 5.20
 * অথবা 5.40 ওদের ঐখানে ওই সাউন্ডটা আসতেছে না — ওদের ঐখানে যাতে যায়")।
 *
 * v5.6 ROOT CAUSE: v5.5 sent the update as a DATA-ONLY message. Old app
 * versions (5.2–5.5.0) have NO PushSpeakService — with the app closed their
 * Capacitor MessagingService had no bridge → the message was received by
 * NOBODY → the phone showed nothing. Only the newest version spoke.
 *
 * THE FIX (src/lib/push.ts sends TWO messages per phone):
 *   📢 MESSAGE A (notification+data, sysTray=1) — the SYSTEM tray displays
 *      it on EVERY version when the app is closed/backgrounded (the same
 *      shape chat pushes use — always visible). Old phones get banner+sound.
 *   🗣 MESSAGE B (data-only, sysTray=0) — wakes this service so v5.6+ phones
 *      SPEAK the user's name the moment it lands.
 * Both carry the same `ts` → the DOUBLE-FREE GUARD below collapses them
 * into ONE announcement.
 *
 * TRAY RULE (never a double notification): message A is shown by the SYSTEM
 * whenever the app is closed or backgrounded — so this service posts its own
 * tray entry ONLY while the app is in the FOREGROUND (the system does NOT
 * display notification messages for foreground apps). Foreground state comes
 * from the v5.1 lifecycle truth in SharedPreferences ("oh_keepalive"/muted,
 * written by MainActivity.onResume/onPause — reliable even if the WebView
 * died). While the app is open the in-app UpdateBar shows too, so the user
 * sees the update in every state.
 *
 * ⚠️ WHY THIS SERVICE EXTENDS THE PLUGIN'S ONE (v5.5.1): Firebase's
 * ServiceStarter resolves the MESSAGING_EVENT intent to EXACTLY ONE service
 * (PackageManager.resolveService — singular — and it CACHES the choice).
 * So this class extends com.capacitorjs.plugins.pushnotifications.
 * MessagingService and prepare-apk.mjs removes the plugin's own service
 * (tools:node="remove") → ONE deterministic handler that keeps EVERYTHING:
 *   • super.onMessageReceived() → the JS pushNotificationReceived event
 *     (the in-app UpdateBar refresh still fires while the app is open),
 *   • inherited onNewToken() → the JS registration event (token rotation).
 *
 * DOUBLE-FREE GUARD: every broadcast carries a ts (epoch ms). The last
 * announced ts is persisted; a repeated delivery of the same ts is dropped
 * (covers FCM retries + the A/B pair sharing one ts). The tap-on-notification
 * path in push.ts still speaks on PURPOSE (the owner may tap an old entry
 * hours later to hear it again).
 *
 * Chat messages (ohChat) keep their notification payload — the system shows
 * them exactly as before; this service forwards them via super() unchanged.
 */
public class PushSpeakService extends MessagingService {

  private static final String PREFS = "oh_push_speak";
  private static final String KEY_LAST_TS = "last_update_ts";
  private static final String CHANNEL_ID = "oh_fcm_update";
  private static final int NOTIF_ID = 43912;

  @Override
  public void onMessageReceived(RemoteMessage remoteMessage) {
    // 1. Capacitor's logic ALWAYS runs first: app open → fires the JS
    //    pushNotificationReceived event (cfg refresh → UpdateBar appears);
    //    app killed → the plugin has no bridge → harmless no-op.
    try {
      super.onMessageReceived(remoteMessage);
    } catch (Exception ignored) {
    }

    // 2. OUR update announcement — tray notification + the name-call voice,
    //    the moment the DATA-ONLY message lands, whatever the app state.
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

      String title = d.get("title");
      String body = d.get("body");
      String speak = d.get("speakText");
      if (title == null || title.trim().isEmpty()) title = "🔄 নতুন আপডেট চলে আসছে!";
      if (body == null || body.trim().isEmpty()) body = title;

      // v5.6 TRAY RULE: the companion notification message (sysTray=1) is
      // displayed by the SYSTEM on every phone while the app is closed or
      // backgrounded — posting our own entry too would DOUBLE it. Our own
      // entry is needed ONLY in the FOREGROUND, where the system does not
      // display notification messages ("oh_keepalive"/muted is written by
      // MainActivity.onResume=true / onPause=false — the v5.1 lifecycle truth).
      boolean foreground = false;
      try {
        foreground = getSharedPreferences("oh_keepalive", Context.MODE_PRIVATE)
            .getBoolean("muted", false);
      } catch (Exception ignored) {
      }
      if (foreground) postUpdateNotification(title, body);
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
