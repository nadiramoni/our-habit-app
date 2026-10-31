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
 * PushSpeakService — v5.5.1 (BUILD-FIXED): THE UPDATE ANNOUNCEMENT THAT SPEAKS
 * THE MOMENT IT LANDS (owner: "নোটিফিকেশন যাবে, সাথে সাথে পড়ে শোনাবে — নাদিরা
 * মনি। অ্যাপসে নতুন আপডেট এসেছে, অ্যাপসটা আপনি ইনস্টল করুন... অ্যাপসের ভিতর
 * ঢুকে পড়ে শোনাতে হবে না")।
 *
 * ⚠️ v5.5.1 FIX 1 — WHY THE APK BUILD FAILED (12 javac errors): this class
 * used to extend com.google.firebase.messaging.FirebaseMessagingService, but
 * the firebase-messaging library is only an `implementation` dependency of
 * the @capacitor/push-notifications MODULE — never exposed to the app module's
 * compile classpath. prepare-apk.mjs now declares
 * com.google.firebase:firebase-messaging:25.0.1 in app/build.gradle itself.
 *
 * ⚠️ v5.5.1 FIX 2 — WHY THIS SERVICE NOW EXTENDS THE PLUGIN'S ONE: Firebase's
 * ServiceStarter picks EXACTLY ONE service for the MESSAGING_EVENT intent
 * (PackageManager.resolveService — singular — and it CACHES the choice). With
 * two candidate services (the plugin's MessagingService + this one) delivery
 * was a silent coin flip. So this class extends
 * com.capacitorjs.plugins.pushnotifications.MessagingService and
 * prepare-apk.mjs removes the plugin's own service from the merged manifest
 * (tools:node="remove") → ONE deterministic handler that keeps EVERYTHING:
 *   • super.onMessageReceived() → the JS pushNotificationReceived event
 *     (the in-app UpdateBar refresh still fires while the app is open),
 *   • inherited onNewToken() → the JS registration event (token rotation).
 *
 * WHAT THIS SERVICE DOES with the DATA-ONLY update broadcast (data messages
 * wake a KILLED process; the payload carries NO notification block —
 * deliverMany() in src/lib/push.ts sends it data-only on purpose):
 *   1. posts the update notification itself (data messages are NOT shown by
 *      the system — the tray entry would otherwise never appear),
 *   2. starts AlarmSpeakService so the phone immediately CALLS the user by
 *      their registered name through the TTS engine (the same voice that
 *      calls the alarms) — no app open required.
 * v5.5.1: NATIVE owns the arrival voice in EVERY state (app open, background
 * or killed). The JS layer no longer speaks on receive — exactly ONE
 * announcement per broadcast, no doubled name-calls.
 *
 * DOUBLE-FREE GUARD: every broadcast carries a ts (epoch ms). The last
 * announced ts is persisted; a repeated delivery of the same ts is dropped
 * (covers FCM retries). The tap-on-notification path in push.ts still speaks
 * on PURPOSE (the owner may tap an old entry hours later to hear it again).
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
