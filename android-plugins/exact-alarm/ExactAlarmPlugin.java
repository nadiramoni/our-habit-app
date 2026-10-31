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
 *   schedule({alarms:[{id, at, title, body, sound, key, time, speak, lang, mode}]})
 *   cancelAll()
 *   pending() → {count, nextAt, nextTitle}
 *   consumeLaunch() → {has,key,title,body,sound,time}
 *   status() → {exactAlarm, fullScreen}
 *   openFullScreenSettings()
 *   rearm() → {armed}
 *   speakOnce({key, text, lang, throttleMin}) → v2.9: speak NOW with the
 *       user's registered name (Reels-limit warning etc.), throttled per key
 *
 * v5.7 SOUND POLICY (owner: "শুধু আজানের ক্ষেত্রে শুধু আজান দিবে… বাকি যেগুলো
 * আছে এগুলো জাস্ট নোটিফিকেশন… কোনো অ্যালার্ম আসবে না"):
 *   • mode="azan"   → LOUD alarm channel (azan sound) + full-screen intent —
 *                     the WeMuslim-style azan experience, UNCHANGED.
 *   • mode="remind" → the QUIET channel (oh_reminder — NO sound, NO
 *                     vibration) + the TTS name-call. No alarm, no popup.
 *   Legacy payloads (no mode) are classified by sound/key (see isAzanAlarm).
 *
 * v5.7 DAILY-FOREVER (owner: "ডেইলি টু ডেইলি বলতে হবে — আজ বলবে, কাল বলবে,
 * পরের মাসেও বলবে"): rollForward() — every alarm that FIRES re-arms itself
 * to the day after the last scheduled day of its key, so the 4-day rolling
 * window keeps advancing one day at a time EVEN IF THE APP IS NEVER OPENED
 * again. Boot restore + app-open re-sync still refresh the whole window.
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
        String speak = o.optString("speak", ""); // v2.9: named-alert voice
        String lang = o.optString("lang", "bn");
        String mode = o.optString("mode", ""); // v5.7: "azan" | "remind"

        int reqCode = reqCode(id, i);
        Intent intent = new Intent(ctx, AlarmFireReceiver.class);
        intent.setAction("oh.exact." + reqCode);
        JSONObject payload = new JSONObject();
        payload.put("id", id);
        payload.put("key", key);
        payload.put("title", title);
        payload.put("body", body);
        payload.put("sound", sound);
        payload.put("time", time);
        payload.put("speak", speak);
        payload.put("lang", lang);
        payload.put("mode", mode);
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

      // v5.6: a still-pending TEST alarm survives the full re-sync — the
      // owner taps "⏰ টেস্ট" and may background/re-open the app inside its
      // 1-minute window; wiping it there would make the test look broken.
      try {
        JSONArray oldSched = readSchedule(ctx);
        for (int i = 0; i < oldSched.length(); i++) {
          JSONObject o = oldSched.optJSONObject(i);
          if (o == null) continue;
          if (!"test_alarm".equals(o.optString("id", ""))) continue;
          if (o.optLong("at", 0L) > now + 2000L) {
            armOne(ctx, am, o);
            keep.put(o);
          }
        }
      } catch (Exception ignored) {
      }

      // persist for boot-restore + pending()
      prefs(ctx).edit().putString(KEY_SCHEDULE, keep.toString()).apply();

      // v5.7: phones upgraded from v5.6- still carry the old LOUD per-sound
      // channels (water music / meal music / chime). Reminders are silent
      // now — delete every oh_x_* channel that is not the current azan one,
      // so nothing can ever ring for a reminder again.
      try {
        java.util.Set<String> keepSounds = new java.util.HashSet<>();
        for (int i = 0; i < keep.length(); i++) {
          JSONObject o = keep.optJSONObject(i);
          if (o == null) continue;
          if (isAzanAlarm(o.optString("key", ""), o.optString("sound", ""),
              o.optString("mode", ""), o.optString("speak", ""))) {
            keepSounds.add(channelIdFor(o.optString("sound", "adhan.mp3")));
          }
        }
        pruneLoudChannels(ctx, keepSounds);
      } catch (Exception ignored) {
      }

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

  /**
   * v5.6: schedule ONE extra alarm WITHOUT touching the existing schedule —
   * the "⏰ টেস্ট অ্যালার্ম" button in Settings uses it so the owner can
   * verify the exact-time ring + the name-call in about a minute. The test
   * entry joins the persisted schedule (so boot-restore/cancelAll/cancelAllInternal
   * keep working and it never duplicates on repeat taps — FLAG_CANCEL_CURRENT
   * re-arms the same id).
   */
  @PluginMethod
  public void scheduleOne(PluginCall call) {
    try {
      long at = 0L;
      try {
        Object raw = call.getData().opt("at"); // JS numbers arrive as Double
        if (raw instanceof Number) at = ((Number) raw).longValue();
      } catch (Exception ignored) {
      }
      Context ctx = getContext();
      if (ctx == null || at <= System.currentTimeMillis() + 1000L) {
        call.reject("at must be in the future");
        return;
      }
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      JSONObject o = new JSONObject();
      o.put("id", call.getString("id", "test"));
      o.put("at", at);
      o.put("key", call.getString("key", "test"));
      o.put("time", call.getString("time", ""));
      o.put("title", call.getString("title", "Our Habit"));
      o.put("body", call.getString("body", ""));
      o.put("sound", call.getString("sound", "alarm.wav"));
      o.put("speak", call.getString("speak", ""));
      o.put("lang", call.getString("lang", "bn"));
      o.put("mode", call.getString("mode", "remind")); // v5.7: tests are quiet
      armOne(ctx, am, o);
      // persist into the schedule so a later cancelAll()/rearm() cleans it up
      JSONArray keep = readSchedule(ctx);
      keep.put(o);
      prefs(ctx).edit().putString(KEY_SCHEDULE, keep.toString()).apply();
      JSObject ret = new JSObject();
      ret.put("scheduled", 1);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("scheduleOne failed: " + e.getMessage());
    }
  }

  /** Arm a single alarm entry (v5.6 — shared by scheduleOne). */
  private static void armOne(Context ctx, AlarmManager am, JSONObject o) throws Exception {
    long at = o.optLong("at", 0L);
    int reqCode = reqCode(o.optString("id", "test"), 7);
    o.put("_req", reqCode);
    Intent intent = new Intent(ctx, AlarmFireReceiver.class);
    intent.setAction("oh.exact." + reqCode);
    intent.putExtra("payload",
        new JSONObject()
            .put("id", o.optString("id", "test"))
            .put("key", o.optString("key", ""))
            .put("title", o.optString("title", ""))
            .put("body", o.optString("body", ""))
            .put("sound", o.optString("sound", "alarm.wav"))
            .put("time", o.optString("time", ""))
            .put("speak", o.optString("speak", ""))
            .put("lang", o.optString("lang", "bn"))
            .put("mode", o.optString("mode", ""))
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
  }

  /** v5.7 DAILY-FOREVER: called by AlarmFireReceiver right after an alarm
   *  fires. The fired entry (same id) is moved to ONE DAY AFTER the latest
   *  scheduled day of the SAME key and re-armed with its own request code —
   *  so the rolling window advances by one day every single day, forever,
   *  even if the user never opens the app again (owner: "আজ ৩০ তারিখ বলবে,
   *  কাল ১ তারিখ বলবে, নভেম্বরের ১ তারিখেও বলবে")। One-shot alarms (the
   *  ⏰ test) never roll. */
  static void rollForward(Context ctx, String id) {
    try {
      if (id == null || id.isEmpty() || "test_alarm".equals(id) || "test".equals(id)) return;
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      JSONArray sched = readSchedule(ctx);
      long now = System.currentTimeMillis();
      // 1) find this entry + the latest future `at` of the same key
      JSONObject mine = null;
      String key = "";
      long maxAt = 0;
      for (int i = 0; i < sched.length(); i++) {
        JSONObject o = sched.optJSONObject(i);
        if (o == null) continue;
        if (id.equals(o.optString("id", ""))) {
          if (mine == null) {
            mine = o;
            key = o.optString("key", "");
          }
        }
      }
      if (mine == null) return; // not in the persisted schedule (one-off)
      for (int i = 0; i < sched.length(); i++) {
        JSONObject o = sched.optJSONObject(i);
        if (o == null) continue;
        if (key.equals(o.optString("key", "")) && !id.equals(o.optString("id", ""))) {
          long at = o.optLong("at", 0L);
          if (at > maxAt) maxAt = at;
        }
      }
      long myAt = mine.optLong("at", 0L);
      long next = (maxAt > 0 ? maxAt : (myAt > 0 ? myAt : now));
      // roll to one day after the last covered day (skip anything already past)
      do {
        next += 24L * 3600_000L;
      } while (next <= now + 2000L);
      mine.put("at", next);
      // re-arm FIRST (armOne stamps the fresh _req into `mine`), THEN persist —
      // cancelAllInternal() rebuilds PendingIntents from the stored _req, so
      // the persisted copy MUST carry the same code the alarm was armed with.
      armOne(ctx, am, mine);
      prefs(ctx).edit().putString(KEY_SCHEDULE, sched.toString()).apply();
    } catch (Exception ignored) {
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

  /**
   * v2.9: SPEAK an alert right now (the user's registered name + message) —
   * used for the Reels-limit warning while the app is open, and available to
   * any future in-app voice reminder. Throttled per key (default 30 min) so
   * it never becomes spammy.
   */
  @PluginMethod
  public void speakOnce(PluginCall call) {
    try {
      Context ctx = getContext() != null ? getContext() : getActivity();
      String key = call.getString("key", "generic");
      String text = call.getString("text", "");
      String lang = call.getString("lang", "bn");
      Integer throttleMin = call.getInt("throttleMin", 30);
      long throttleMs = (throttleMin == null ? 30 : throttleMin) * 60_000L;
      // JS numbers may arrive as Double (bridge quirk) — clamp defensively
      try {
        Object raw = call.getData().opt("throttleMin");
        if (raw instanceof Number) throttleMs = ((Number) raw).longValue() * 60_000L;
      } catch (Exception ignored) {
      }
      if (ctx == null || text == null || text.trim().isEmpty()) {
        call.resolve();
        return;
      }
      SharedPreferences sp = prefs(ctx);
      String throttleKey = "speak_once_" + key;
      long last = sp.getLong(throttleKey, 0L);
      if (last > 0 && System.currentTimeMillis() - last < throttleMs) {
        JSObject r = new JSObject();
        r.put("spoken", false);
        r.put("reason", "throttled");
        call.resolve(r);
        return;
      }
      sp.edit().putLong(throttleKey, System.currentTimeMillis()).apply();
      AlarmSpeakService.startSpeakOnly(ctx, text, lang);
      JSObject r = new JSObject();
      r.put("spoken", true);
      call.resolve(r);
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

  /** Re-arm everything in the future from the persisted schedule. Returns armed count.
   *  v5.7 DAILY-FOREVER: entries that went STALE while the phone was off (or
   *  after a reboot — their time simply passed) are REVIVED, not dropped —
   *  each stale entry of a key is re-dated ONE DAY PAST the last live day of
   *  that key, so the rolling window is whole again the moment the phone
   *  wakes (owner: "ডেইলি টু ডেইলি — একদিনও বাদ যাবে না")। */
  static int rearmInternal(Context ctx) {
    try {
      AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
      cancelAllInternal(ctx, am);
      JSONArray keep = readSchedule(ctx);
      long now = System.currentTimeMillis();
      // 1) revive stale entries (their time passed while the phone was off):
      //    each one rolls FORWARD from its OWN time-of-day to the first FREE
      //    future day of its key (a day no live entry of that key holds) —
      //    the HH:MM never changes, no two entries ever share a day, and the
      //    rolling window is whole again the moment the phone wakes.
      try {
        java.util.Set<Long> taken = new java.util.HashSet<>();
        for (int i = 0; i < keep.length(); i++) {
          JSONObject o = keep.optJSONObject(i);
          if (o == null) continue;
          long at = o.optLong("at", 0L);
          if (at > now + 2000L) taken.add(at);
        }
        for (int i = 0; i < keep.length(); i++) {
          JSONObject o = keep.optJSONObject(i);
          if (o == null) continue;
          long at = o.optLong("at", 0L);
          String k = o.optString("key", "");
          if (at > now + 2000L || k.isEmpty() || "test".equals(k)
              || "test_alarm".equals(o.optString("id", ""))) {
            continue;
          }
          long cand = at > 0 ? at : now;
          while (cand <= now + 2000L || taken.contains(cand)) {
            cand += 24L * 3600_000L;
          }
          o.put("at", cand);
          taken.add(cand);
        }
        prefs(ctx).edit().putString(KEY_SCHEDULE, keep.toString()).apply();
      } catch (Exception ignored) {
      }
      // 2) arm every future entry (stale ones now carry revived dates)
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
                .put("id", o.optString("id", ""))
                .put("key", o.optString("key", ""))
                .put("title", o.optString("title", ""))
                .put("body", o.optString("body", ""))
                .put("sound", o.optString("sound", "adhan.mp3"))
                .put("time", o.optString("time", ""))
                .put("speak", o.optString("speak", ""))
                .put("lang", o.optString("lang", "bn"))
                .put("mode", o.optString("mode", ""))
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

  // ---------------- v5.7: sound policy helpers ----------------

  /** The QUIET channel every non-azan reminder is posted on — NO sound, NO
   *  vibration (owner: "বাকি যেগুলো আছে এগুলো জাস্ট নোটিফিকেশন… কোনো অ্যালার্ম
   *  আসবে না"). The TTS name-call is the only sound a reminder makes. */
  static final String QUIET_CHANNEL = "oh_reminder";

  static void ensureQuietChannel(Context ctx) {
    try {
      NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm == null) return;
      if (nm.getNotificationChannel(QUIET_CHANNEL) != null) return;
      NotificationChannel ch = new NotificationChannel(QUIET_CHANNEL,
          "রিমাইন্ডার (নোটিফিকেশন)", NotificationManager.IMPORTANCE_DEFAULT);
      ch.setSound(null, null); // silent — no alarm ring, ever
      ch.enableVibration(false);
      ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
      nm.createNotificationChannel(ch);
    } catch (Exception ignored) {
    }
  }

  /** True when this alarm must ring as an AZAN (loud sound + full-screen).
   *  v5.7: explicit mode wins; legacy payloads (no mode) fall back to the
   *  v5.6 shape — speak-less alarms with an azan sound / fajr-adhan key. */
  static boolean isAzanAlarm(String key, String sound, String mode, String speak) {
    if ("azan".equals(mode)) return true;
    if ("remind".equals(mode)) return false;
    // legacy (v5.6- schedule persisted before an OTA-less reboot restore):
    if (speak != null && !speak.trim().isEmpty()) return false;
    String k = key == null ? "" : key;
    if (k.equals("fajr") || k.startsWith("adhan_")) return true;
    String s = sound == null ? "" : sound.toLowerCase();
    return s.contains("azan") || s.contains("adhan");
  }

  /** v5.7: delete stale LOUD oh_x_* channels (water/meal music etc.) so an
   *  upgraded phone can never ring them again. Channels for the azan sounds
   *  that are still scheduled are kept. */
  static void pruneLoudChannels(Context ctx, java.util.Set<String> keepChannelIds) {
    try {
      NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm == null) return;
      for (NotificationChannel ch : nm.getNotificationChannels()) {
        String cid = ch.getId();
        if (cid != null && cid.startsWith("oh_x_")
            && (keepChannelIds == null || !keepChannelIds.contains(cid))) {
          nm.deleteNotificationChannel(cid);
        }
      }
    } catch (Exception ignored) {
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
