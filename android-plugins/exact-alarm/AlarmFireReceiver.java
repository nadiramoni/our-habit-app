package com.ourhabit.app;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

/**
 * AlarmFireReceiver — v2.8/v2.9: fires when an EXACT alarm (azan / Fajr /
 * meal / water / sleep) goes off.
 *
 *  v2.9 NAMED ALERTS (owner: "আমার নাম দিয়ে একটা রিংটোন ক্রিয়েট করবা —
 *  আমাকে ডাকবে"): when the alarm payload carries `speak`, the receiver
 *  starts AlarmSpeakService FIRST — the phone CALLS the user by their
 *  registered full name through the TTS engine on the ALARM stream, and the
 *  moment the voice finishes the real alarm notification fires with its own
 *  channel sound (water music / meal music / chime). The experience:
 *  the app speaks "আনোয়ারুল সন সাকিব, তোমার পানি খাওয়ার সময় হইছে…" and
 *  THEN the alarm rings. Adhan alarms NEVER speak (owner: "আজানের ক্ষেত্রে
 *  না ভাই — আজানটা আজানি দিবে").
 *
 *  Adhan path (no speak): MAX-priority notification on the azan channel
 *  (azan sound + vibration, USAGE_ALARM stream) + FULL-SCREEN intent →
 *  screen off/locked = the app LAUNCHES full-screen instantly (the
 *  WeMuslim-style azan view); phone in use = heads-up notification + sound.
 */
public class AlarmFireReceiver extends BroadcastReceiver {

  public static final String EXTRA_PAYLOAD = "payload";

  @Override
  public void onReceive(Context context, Intent intent) {
    try {
      String raw = intent.getStringExtra(EXTRA_PAYLOAD);
      if (raw == null || raw.isEmpty()) return;
      JSONObject o = new JSONObject(raw);

      String key = o.optString("key", "");
      String title = o.optString("title", "Our Habit");
      String body = o.optString("body", "");
      String sound = o.optString("sound", "adhan.mp3");
      String time = o.optString("time", "");
      String speak = o.optString("speak", "");
      String lang = o.optString("lang", "bn");

      // 1) remember the launch payload (the app may cold-start from the
      //    full-screen intent — JS picks it up with consumeLaunch())
      try {
        JSONObject launch = new JSONObject(raw);
        launch.put("firedAt", System.currentTimeMillis());
        SharedPreferences sp = ExactAlarmPlugin.prefs(context);
        sp.edit().putString("launch_payload", launch.toString()).apply();
      } catch (Exception ignored) {
      }

      // 2) v2.9 NAMED ALERT — speak the user's name first, the alarm sound
      //    follows right after the voice (sequenced inside AlarmSpeakService)
      if (speak != null && !speak.trim().isEmpty()) {
        AlarmSpeakService.startForAlarm(context, speak, lang, title, body, sound, key, time);
        return;
      }

      // 3) the channel (per-sound, vibrating, USAGE_ALARM loudness)
      ExactAlarmPlugin.ensureChannel(context, sound);
      String channelId = ExactAlarmPlugin.channelIdFor(sound);

      // 4) full-screen intent = open the app (azan view) directly when locked
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
    } catch (Exception ignored) {
    }
  }
}
