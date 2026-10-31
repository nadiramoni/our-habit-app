package com.ourhabit.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

/**
 * AlarmFireReceiver — v2.8/v2.9/v5.7: fires when an EXACT alarm goes off.
 *
 *  v5.7 SOUND POLICY (owner: "শুধু আজানের ক্ষেত্রে শুধু আজান দিবে… বাকি
 *  সবগুলো জাস্ট নোটিফিকেশন, কোনো অ্যালার্ম আসবে না, অ্যানিমেশনও আসবে না"):
 *   • AZAN alarms (mode="azan" / fajr / adhan_*): UNCHANGED — MAX-priority
 *     notification on the azan channel (azan sound + vibration) + FULL-SCREEN
 *     intent → screen off/locked = the app LAUNCHES full-screen (the azan
 *     popup the owner said to keep exactly as it is).
 *   • EVERYTHING ELSE (mode="remind" — নামাজ/পানি/খাবার/ঘুম/হ্যাবিট/রিলস…):
 *     the QUIET channel (oh_reminder) — a silent notification, NO alarm
 *     sound, NO vibration, NO full-screen popup — plus the TTS name-call
 *     (AlarmSpeakService speaks "ইয়াসিন, পানি খাওয়ার সময় হইছে…", then the
 *     silent notification lands). Tapping it just opens the app — the
 *     launch payload (which used to trigger the full-screen alarm overlay,
 *     the "animation" everyone had to close manually) is now written ONLY
 *     for azan alarms.
 *
 *  v5.7 DAILY-FOREVER: after handling, every recurring alarm calls
 *  ExactAlarmPlugin.rollForward() — the fired entry re-arms itself for the
 *  day after the last scheduled day of its key, so the reminder chain never
 *  dies even if the app is never opened again (owner: "ডেইলি টু ডেইলি
 *  বলতে হবে — আজ বলবে, কাল বলবে, পরের মাসেও বলবে").
 */
public class AlarmFireReceiver extends BroadcastReceiver {

  public static final String EXTRA_PAYLOAD = "payload";

  @Override
  public void onReceive(Context context, Intent intent) {
    try {
      String raw = intent.getStringExtra(EXTRA_PAYLOAD);
      if (raw == null || raw.isEmpty()) return;
      JSONObject o = new JSONObject(raw);

      String id = o.optString("id", "");
      String key = o.optString("key", "");
      String title = o.optString("title", "Our Habit");
      String body = o.optString("body", "");
      String sound = o.optString("sound", "adhan.mp3");
      String time = o.optString("time", "");
      String speak = o.optString("speak", "");
      String lang = o.optString("lang", "bn");
      String mode = o.optString("mode", "");

      // v5.7: keep the daily chain alive FIRST (even if the rest hiccups,
      // tomorrow's reminder must exist — owner: "কালকো বলবে")
      ExactAlarmPlugin.rollForward(context, id);

      boolean azan = ExactAlarmPlugin.isAzanAlarm(key, sound, mode, speak);

      if (azan) {
        // ---------------- AZAN PATH (unchanged — loud + full-screen) ----------------
        // remember the launch payload — the app may cold-start from the
        // full-screen intent; JS picks it up with consumeLaunch() and shows
        // the full-screen azan view.
        try {
          JSONObject launch = new JSONObject(raw);
          launch.put("firedAt", System.currentTimeMillis());
          ExactAlarmPlugin.prefs(context)
              .edit().putString("launch_payload", launch.toString()).apply();
        } catch (Exception ignored) {
        }

        // the channel (per-sound, vibrating, USAGE_ALARM loudness)
        ExactAlarmPlugin.ensureChannel(context, sound);
        String channelId = ExactAlarmPlugin.channelIdFor(sound);

        // full-screen intent = open the app (azan view) directly when locked
        PendingIntent fullScreen = ExactAlarmPlugin.launchPendingIntent(context, 2);
        PendingIntent content = ExactAlarmPlugin.launchPendingIntent(context, 3);

        int notifId = (int) (System.currentTimeMillis() % 2100000000);

        NotificationCompat.Builder b = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setOngoing(false)
            .setContentIntent(content)
            .setFullScreenIntent(fullScreen, true /* show even when screen is on */)
            .setVibrate(new long[]{0, 500, 300, 500, 300, 800});

        // POST_NOTIFICATIONS check (Android 13+)
        NotificationManagerCompat nm = NotificationManagerCompat.from(context);
        boolean allowed = true;
        try {
          allowed = nm.areNotificationsEnabled();
        } catch (Exception ignored) {
        }
        if (!allowed) {
          // permission revoked → the full-screen intent can still launch the app
          // (it does not need the notification itself), so arm it directly.
          try {
            fullScreen.send();
          } catch (Exception ignored) {
          }
          return;
        }
        try {
          nm.notify(notifId, b.build());
        } catch (SecurityException ignored) {
          try {
            fullScreen.send();
          } catch (Exception ignored2) {
          }
        }
        return;
      }

      // ---------------- REMIND PATH (v5.7: quiet notification + name-call) ----------------
      // NO alarm sound, NO vibration, NO full-screen popup — just the
      // notification + the spoken name-call (owner: "জাস্ট নোটিফিকেশন… জাস্ট বলবে").
      if (speak != null && !speak.trim().isEmpty()) {
        // voice first; the silent notification lands right after the sentence
        AlarmSpeakService.startForAlarm(context, speak, lang, title, body, sound, key, time);
        return;
      }
      postQuietNotification(context, title, body);
    } catch (Exception ignored) {
    }
  }

  /** v5.7: the SILENT reminder notification — quiet channel, no sound, no
   *  vibration, no full-screen intent, no alarm category. Tapping simply
   *  opens the app (NO launch payload → no alarm-overlay "animation"). */
  private static void postQuietNotification(Context context, String title, String body) {
    try {
      ExactAlarmPlugin.ensureQuietChannel(context);
      PendingIntent content = ExactAlarmPlugin.launchPendingIntent(context, 3);
      int notifId = (int) (System.currentTimeMillis() % 2100000000);
      NotificationCompat.Builder b = new NotificationCompat.Builder(context, ExactAlarmPlugin.QUIET_CHANNEL)
          .setSmallIcon(android.R.drawable.ic_dialog_info)
          .setContentTitle(title == null || title.isEmpty() ? "Our Habit" : title)
          .setContentText(body == null ? "" : body)
          .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body))
          .setPriority(NotificationCompat.PRIORITY_DEFAULT)
          .setCategory(NotificationCompat.CATEGORY_REMINDER)
          .setAutoCancel(true)
          .setContentIntent(content);
      NotificationManagerCompat nm = NotificationManagerCompat.from(context);
      boolean allowed = true;
      try {
        allowed = nm.areNotificationsEnabled();
      } catch (Exception ignored) {
      }
      if (allowed) {
        try {
          nm.notify(notifId, b.build());
        } catch (SecurityException ignored) {
        }
      }
    } catch (Exception ignored) {
    }
  }
}
