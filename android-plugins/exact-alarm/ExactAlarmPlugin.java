package com.ourhabit.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * ExactAlarmPlugin — v2.8 THE AZAN/ALARM ENGINE (owner: "আজান যে টাইম ফিক্সড
 * করবো ওই টাইমেই দিবে, পরে দিলে হবে না").
 *
 * Why a custom engine on top of @capacitor/local-notifications:
 *  • AlarmManager.setAlarmClock() is the STRONGEST exact trigger on Android —
 *    it fires EXACTLY on time even in Doze and even when aggressive OEM
 *    battery killers (realme/Oppo/Vivo "app killer") defer every other alarm
 *    type. Real alarm-clock and athan apps use exactly this API.
 *  • It also draws the system alarm icon in the status bar → the user SEES
 *    that the alarm is armed.
 *  • Full-screen intent: when the alarm fires with the screen off/locked,
 *    the app LAUNCHES full-screen (the WeMuslim-style azan view); when the
 *    phone is in use, a MAX-priority heads-up notification with the azan
 *    sound plays instead. Tapping it opens the same full-screen azan.
 *
 * JS bridge (window.Capacitor.Plugins.ExactAlarm):
 *   schedule({alarms:[{id, at, title, body, sound, key, time}]})
 *   cancelAll()
 *   pending() → {count, nextAt, nextTitle}
 *   consumeLaunch() → {has,key,title,body,sound,time}
 *   status() → {exactAlarm, fullScreen}
 *   openFullScreenSettings()
 *   rearm() → {armed}
 */
@CapacitorPlugin(name = "ExactAlarm")
public class ExactAlarmPlugin extends Plugin {

  private static final String PREFS = "oh_exact_alarm";
  private static final String KEY_SCHEDULE = "schedule_json"; // full last schedule (boot restore)
  private static final String KEY_LAUNCH = "launch_payload"; // alarm that launched the app

  // ---------------- schedule ----------------
  @PluginMethod
  public void schedule(PluginCall call) {
    JSArray arr = call.getArray("alarms");
    if (arr == null) {
      call.reject("alarms missing");
      return;
    }
    try {
      Context ctx = getContext();
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      // fresh schedule = cancel everything first
      cancelAllInternal(ctx, am);

      JSONArray keep = new JSONArray();
      long now = System.currentTimeMillis();
      int n = arr.length();
      for (int i = 0; i < n; i++) {
        JSONObject o = arr.getJSONObject(i);
        long at = o.optLong("at", 0L);
        if (at <= now + 2000L) continue; // only future alarms
        String id = o.optString("id", "alarm_" + i);
        String title = o.optString("title", "Our Habit");
        String body = o.optString("body", "");
        String sound = o.optString("sound", "adhan.mp3");
        String key = o.optString("key", id);
        String time = o.optString("time", "");

        int reqCode = reqCode(id, i);
        Intent intent = new Intent(ctx, AlarmFireReceiver.class);
        intent.setAction("oh.exact." + reqCode);
        JSONObject payload = new JSONObject();
        payload.put("key", key);
        payload.put("title", title);
        payload.put("body", body);
        payload.put("sound", sound);
        payload.put("time", time);
        intent.putExtra("payload", payload.toString());

        int flags = PendingIntent.FLAG_CANCEL_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent op = PendingIntent.getBroadcast(ctx, reqCode, intent, flags);

        try {
          // The ONE API that OEMs do not dare delay: the alarm-clock alarm.
          PendingIntent showIntent = launchPendingIntent(ctx, 1);
          AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(at, showIntent);
          am.setAlarmClock(info, op);
        } catch (Exception e) {
          // Android 12 without the special access → still as exact as possible
          try {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, op);
          } catch (Exception e2) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, op);
          }
        }
        // remember the request code so cancel/re-arm rebuild the EXACT same
        // PendingIntent (index-based recomputation would mismatch after skips)
        o.put("_req", reqCode);
        keep.put(o);
      }

      // persist for boot-restore + pending()
      prefs(ctx).edit().putString(KEY_SCHEDULE, keep.toString()).apply();

      JSObject ret = new JSObject();
      ret.put("scheduled", keep.length());
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("schedule failed: " + e.getMessage());
    }
  }

  @PluginMethod
  public void cancelAll(PluginCall call) {
    try {
      Context ctx = getContext();
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      cancelAllInternal(ctx, am);
      prefs(ctx).edit().putString(KEY_SCHEDULE, "[]").apply();
      call.resolve();
    } catch (Exception e) {
      call.reject(e.getMessage());
    }
  }

  /** Re-arm from the last persisted schedule (used by the boot receiver too). */
  @PluginMethod
  public void rearm(PluginCall call) {
    try {
      int c = rearmInternal(getContext());
      JSObject ret = new JSObject();
      ret.put("armed", c);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject(e.getMessage());
    }
  }

  @PluginMethod
  public void pending(PluginCall call) {
    try {
      Context ctx = getContext();
      long now = System.currentTimeMillis();
      JSONArray keep = readSchedule(ctx);
      int count = 0;
      long nextAt = 0;
      String nextTitle = "";
      for (int i = 0; i < keep.length(); i++) {
        JSONObject o = keep.optJSONObject(i);
        if (o == null) continue;
        long at = o.optLong("at", 0L);
        if (at > now + 2000L) {
          count++;
          if (nextAt == 0 || at < nextAt) {
            nextAt = at;
            nextTitle = o.optString("title", "");
          }
        }
      }
      JSObject ret = new JSObject();
      ret.put("count", count);
      ret.put("nextAt", nextAt);
      ret.put("nextTitle", nextTitle);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject(e.getMessage());
    }
  }

  // ---------------- the alarm that launched the app ----------------

  /** JS reads (and clears) the alarm payload that opened the app via the
   *  full-screen intent or the notification tap → shows the azan overlay. */
  @PluginMethod
  public void consumeLaunch(PluginCall call) {
    try {
      Context ctx = getContext();
      String raw = prefs(ctx).getString(KEY_LAUNCH, "");
      prefs(ctx).edit().remove(KEY_LAUNCH).apply();
      JSObject ret = new JSObject();
      if (raw == null || raw.isEmpty()) {
        ret.put("has", false);
      } else {
        JSONObject o = new JSONObject(raw);
        // ignore stale launches older than 30 minutes
        long firedAt = o.optLong("firedAt", 0L);
        if (firedAt > 0 && System.currentTimeMillis() - firedAt > 30 * 60 * 1000L) {
          ret.put("has", false);
        } else {
          ret.put("has", true);
          ret.put("key", o.optString("key", ""));
          ret.put("title", o.optString("title", ""));
          ret.put("body", o.optString("body", ""));
          ret.put("sound", o.optString("sound", ""));
          ret.put("time", o.optString("time", ""));
        }
      }
      call.resolve(ret);
    } catch (Exception e) {
      call.reject(e.getMessage());
    }
  }

  // ---------------- permissions / settings ----------------

  @PluginMethod
  public void status(PluginCall call) {
    try {
      Context ctx = getContext();
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
      boolean fullScreen = true;
      if (Build.VERSION.SDK_INT >= 34) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        fullScreen = nm != null && nm.canUseFullScreenIntent();
      }
      JSObject ret = new JSObject();
      ret.put("exactAlarm", exact);
      ret.put("fullScreen", fullScreen);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject(e.getMessage());
    }
  }

  @PluginMethod
  public void openFullScreenSettings(PluginCall call) {
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        Intent i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
            Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
      }
      call.resolve();
    } catch (Exception e) {
      call.reject(e.getMessage());
    }
  }

  // ---------------- helpers ----------------

  static SharedPreferences prefs(Context ctx) {
    return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  static int reqCode(String id, int salt) {
    int h = id == null ? 0 : id.hashCode();
    if (h == Integer.MIN_VALUE) h = 0;
    return Math.abs(h) % 2000000000 + (salt % 100);
  }

  static PendingIntent launchPendingIntent(Context ctx, int req) {
    Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
    if (launch == null) {
      launch = new Intent(ctx, MainActivity.class);
    }
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    return PendingIntent.getActivity(ctx, req, launch, flags);
  }

  static JSONArray readSchedule(Context ctx) {
    try {
      return new JSONArray(prefs(ctx).getString(KEY_SCHEDULE, "[]"));
    } catch (Exception e) {
      return new JSONArray();
    }
  }

  /** Cancel every armed alarm by rebuilding its PendingIntent (intent action
   *  equality — extras are ignored by filterEquals, so this matches). */
  static void cancelAllInternal(Context ctx, AlarmManager am) {
    try {
      JSONArray keep = readSchedule(ctx);
      for (int i = 0; i < keep.length(); i++) {
        JSONObject o = keep.optJSONObject(i);
        if (o == null) continue;
        int reqCode = o.optInt("_req", reqCode(o.optString("id", ""), i));
        Intent intent = new Intent(ctx, AlarmFireReceiver.class);
        intent.setAction("oh.exact." + reqCode);
        int flags = PendingIntent.FLAG_NO_CREATE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getBroadcast(ctx, reqCode, intent, flags);
        if (pi != null) {
          am.cancel(pi);
          pi.cancel();
        }
      }
    } catch (Exception ignored) {
    }
  }

  /** Re-arm everything in the future from the persisted schedule. Returns armed count. */
  static int rearmInternal(Context ctx) {
    try {
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      cancelAllInternal(ctx, am);
      JSONArray keep = readSchedule(ctx);
      long now = System.currentTimeMillis();
      int armed = 0;
      for (int i = 0; i < keep.length(); i++) {
        JSONObject o = keep.optJSONObject(i);
        if (o == null) continue;
        long at = o.optLong("at", 0L);
        if (at <= now + 2000L) continue;
        int reqCode = o.optInt("_req", reqCode(o.optString("id", ""), i));
        Intent intent = new Intent(ctx, AlarmFireReceiver.class);
        intent.setAction("oh.exact." + reqCode);
        intent.putExtra("payload",
            new JSONObject()
                .put("key", o.optString("key", ""))
                .put("title", o.optString("title", ""))
                .put("body", o.optString("body", ""))
                .put("sound", o.optString("sound", "adhan.mp3"))
                .put("time", o.optString("time", ""))
                .toString());
        int flags = PendingIntent.FLAG_CANCEL_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent op = PendingIntent.getBroadcast(ctx, reqCode, intent, flags);
        try {
          am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, launchPendingIntent(ctx, 1)), op);
        } catch (Exception e) {
          try {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, op);
          } catch (Exception e2) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, op);
          }
        }
        armed++;
      }
      return armed;
    } catch (Exception e) {
      return 0;
    }
  }

  /** Channel id for a given raw sound name (one channel per sound). */
  static String channelIdFor(String sound) {
    String s = sound == null ? "" : sound.replaceAll("[^a-zA-Z0-9_]", "").toLowerCase();
    if (s.isEmpty()) s = "adhanmp3";
    return "oh_x_" + s;
  }

  /** Create (once) the vibrating, USAGE_ALARM channel for one sound file. */
  static void ensureChannel(Context ctx, String sound) {
    try {
      NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm == null) return;
      String id = channelIdFor(sound);
      if (nm.getNotificationChannel(id) != null) return;
      NotificationChannel ch = new NotificationChannel(id, channelName(sound),
          NotificationManager.IMPORTANCE_HIGH);
      ch.enableVibration(true);
      ch.setVibrationPattern(new long[]{0, 500, 300, 500, 300, 800});
      Uri uri = soundUri(ctx, sound);
      if (uri != null) {
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        ch.setSound(uri, attrs);
      }
      ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
      nm.createNotificationChannel(ch);
    } catch (Exception ignored) {
    }
  }

  static String channelName(String sound) {
    String s = sound == null ? "" : sound.toLowerCase();
    if (s.contains("azan") || s.contains("adhan")) return "আজান / নামাজের অ্যালার্ম";
    if (s.contains("meal")) return "খাওয়ার অ্যালার্ম";
    if (s.contains("water")) return "পানির রিমাইন্ডার";
    return "Our Habit অ্যালার্ম";
  }

  /** android.resource URI for res/raw/<name without extension>. */
  static Uri soundUri(Context ctx, String sound) {
    try {
      String name = sound == null ? "" : sound;
      int dot = name.lastIndexOf('.');
      if (dot > 0) name = name.substring(0, dot);
      if (name.isEmpty()) return null;
      int resId = ctx.getResources().getIdentifier(name, "raw", ctx.getPackageName());
      if (resId == 0) return null;
      return Uri.parse("android.resource://" + ctx.getPackageName() + "/" + resId);
    } catch (Exception e) {
      return null;
    }
  }
}
