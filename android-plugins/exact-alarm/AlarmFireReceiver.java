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
 * AlarmFireReceiver — v2.8: fires when an EXACT alarm (azan / Fajr / meal /
 * sleep) goes off.
 *
 *  1. builds a MAX-priority notification on the alarm's own channel
 *     (azan sound + vibration, USAGE_ALARM stream)
 *  2. attaches a FULL-SCREEN intent → screen off/locked = the app LAUNCHES
 *     full-screen instantly (the WeMuslim-style azan view); phone in use =
 *     heads-up notification + sound
 *  3. saves the payload to SharedPreferences → the WebView reads it via
 *     ExactAlarmPlugin.consumeLaunch() and shows the full-screen azan UI
 *     with the real adhan audio.
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

      // 1) remember the launch payload (the app may cold-start from the
      //    full-screen intent — JS picks it up with consumeLaunch())
      try {
        JSONObject launch = new JSONObject(raw);
        launch.put("firedAt", System.currentTimeMillis());
        SharedPreferences sp = ExactAlarmPlugin.prefs(context);
        sp.edit().putString("launch_payload", launch.toString()).apply();
      } catch (Exception ignored) {
      }

      // 2) the channel (per-sound, vibrating, USAGE_ALARM loudness)
      ExactAlarmPlugin.ensureChannel(context, sound);
      String channelId = ExactAlarmPlugin.channelIdFor(sound);

      // 3) full-screen intent = open the app (azan view) directly when locked
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

      // 4) dismiss any older alarm notifications so the shade stays clean
      try {
        NotificationManager realNm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (realNm != null && Build.VERSION.SDK_INT >= 23) {
          // nothing aggressive — newest is on top anyway
        }
      } catch (Exception ignored) {
      }
    } catch (Exception ignored) {
    }
  }
}
