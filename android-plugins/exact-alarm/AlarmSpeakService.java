package com.ourhabit.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * AlarmSpeakService — v2.9: THE NAMED ALERT (owner: "আমার নাম আনোয়ারুল সন
 * সাকিব... আমাকে ডাকবে — আনোয়ারুল সন সাকিব, তোমার পানি খাওয়ার সময় হইছে,
 * পানি খাও, স্বাস্থ্য ঠিক থাকবে").
 *
 * A foreground service (mediaPlayback) that SPEAKS the alert with the user's
 * REGISTERED FULL NAME through the Android TextToSpeech engine on the ALARM
 * audio stream — so the phone literally calls the user by name, exactly like
 * a person would. Right after the voice finishes, the real alarm notification
 * fires with its own channel sound (water music / meal music / chime) →
 * the experience is: the app CALLS you, THEN the alarm rings.
 *
 * Adhan alarms NEVER use this (owner: "আজানের ক্ষেত্রে না ভাই — আজানটা আজানি
 * দিবে") — they go straight to the full-screen azan + adhan audio.
 *
 * Started by AlarmFireReceiver (alarm time) or by ExactAlarmPlugin.speakOnce
 * (in-app / background warnings e.g. Reels limit).
 */
public class AlarmSpeakService extends Service {

  public static final String EXTRA_SPEAK = "speak";
  public static final String EXTRA_LANG = "lang";
  public static final String EXTRA_TITLE = "title";
  public static final String EXTRA_BODY = "body";
  public static final String EXTRA_SOUND = "sound";
  public static final String EXTRA_KEY = "key";
  public static final String EXTRA_TIME = "time";
  public static final String EXTRA_NOTIFY = "notify"; // post the alarm notification after speaking
  public static final String EXTRA_FIRED_AT = "firedAt";

  private static final String CHANNEL_ID = "oh_speak";
  private static final int FGS_ID = 43901;

  private TextToSpeech tts;
  private boolean ttsReady = false;
  private boolean finished = false;
  private String pendingPayload = null;
  private String lang = "bn";

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    try {
      final String speak = intent.getStringExtra(EXTRA_SPEAK);
      lang = intent.getStringExtra(EXTRA_LANG);
      if (lang == null || lang.isEmpty()) lang = "bn";
      final String title = intent.getStringExtra(EXTRA_TITLE);
      final String body = intent.getStringExtra(EXTRA_BODY);
      final String sound = intent.getStringExtra(EXTRA_SOUND);
      final String key = intent.getStringExtra(EXTRA_KEY);
      final String time = intent.getStringExtra(EXTRA_TIME);
      final boolean notify = intent.getBooleanExtra(EXTRA_NOTIFY, false);
      final long firedAt = intent.getLongExtra(EXTRA_FIRED_AT, 0L);

      startForegroundSafely(title == null ? "Our Habit" : title);

      if (speak == null || speak.trim().isEmpty()) {
        if (notify) postAlarmNotification(title, body, sound, key, time, firedAt);
        stopSelfSafely();
        return START_NOT_STICKY;
      }

      // remember what to notify AFTER the voice finishes
      if (notify) {
        try {
          org.json.JSONObject o = new org.json.JSONObject();
          o.put("title", title);
          o.put("body", body);
          o.put("sound", sound);
          o.put("key", key);
          o.put("time", time);
          o.put("firedAt", firedAt);
          pendingPayload = o.toString();
        } catch (Exception ignored) {
          pendingPayload = null;
        }
      }

      tts = new TextToSpeech(getApplicationContext(), status -> {
        try {
          if (status == TextToSpeech.SUCCESS && tts != null) {
            ttsReady = true;
            configureVoiceAndSpeak(speak);
          } else {
            // no TTS engine → go straight to the alarm sound
            ttsReady = false;
            onSpeakDone();
          }
        } catch (Exception e) {
          onSpeakDone();
        }
      });
      // hard safety: never stay alive longer than 45s
      new android.os.Handler(getMainLooper()).postDelayed(() -> onSpeakDone(), 45000);
      return START_NOT_STICKY;
    } catch (Exception e) {
      stopSelfSafely();
      return START_NOT_STICKY;
    }
  }

  private void configureVoiceAndSpeak(String speak) {
    try {
      // Bengali voice when the app language is Bangla (Google TTS ships bn-BD /
      // bn-IN on virtually every phone sold in Bangladesh); fall back to the
      // device default otherwise (English app language).
      Locale target = "bn".equals(lang)
          ? pickLocale("bn", "BD", "bn", "IN")
          : new Locale("en", "US");
      int r = tts.setLanguage(target);
      if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
        tts.setLanguage(new Locale("en", "US"));
      }
      tts.setAudioAttributes(new AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build());
      tts.setSpeechRate(0.95f);
      tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
        @Override
        public void onStart(String utteranceId) {
        }

        @Override
        public void onDone(String utteranceId) {
          onSpeakDone();
        }

        @Override
        public void onError(String utteranceId) {
          onSpeakDone();
        }
      });
      tts.speak(speak, TextToSpeech.QUEUE_FLUSH, null, "ohAlert");
      // if the engine never calls back (some OEMs), the voice still ends →
      // estimate the duration and continue
      long est = estimateSpeechMs(speak);
      new android.os.Handler(getMainLooper()).postDelayed(() -> onSpeakDone(), est + 6000);
    } catch (Exception e) {
      onSpeakDone();
    }
  }

  private static long estimateSpeechMs(String text) {
    try {
      int words = text.trim().split("\\s+").length;
      return Math.min(20000, Math.max(3000, words * 420L));
    } catch (Exception e) {
      return 8000;
    }
  }

  private static Locale pickLocale(String l1, String c1, String l2, String c2) {
    try {
      Locale a = new Locale(l1, c1);
      if (ttsSupports(a)) return a;
      Locale b = new Locale(l2, c2);
      if (ttsSupports(b)) return b;
    } catch (Exception ignored) {
    }
    return new Locale("bn");
  }

  private static boolean ttsSupports(Locale l) {
    try {
      return !l.toString().isEmpty(); // language data check happens in setLanguage result
    } catch (Exception e) {
      return false;
    }
  }

  /** Voice finished (or failed) → post the real alarm notification, then die. */
  private synchronized void onSpeakDone() {
    if (finished) return;
    finished = true;
    try {
      if (pendingPayload != null) {
        org.json.JSONObject o = new org.json.JSONObject(pendingPayload);
        postAlarmNotification(
            o.optString("title", "Our Habit"),
            o.optString("body", ""),
            o.optString("sound", "alarm.wav"),
            o.optString("key", ""),
            o.optString("time", ""),
            o.optLong("firedAt", 0L));
      }
    } catch (Exception ignored) {
    }
    stopSelfSafely();
  }

  private void postAlarmNotification(String title, String body, String sound, String key, String time, long firedAt) {
    try {
      Context ctx = getApplicationContext();
      // remember the launch payload → the WebView opens the right overlay
      if (key != null && !key.isEmpty()) {
        try {
          org.json.JSONObject launch = new org.json.JSONObject();
          launch.put("key", key);
          launch.put("title", title);
          launch.put("body", body);
          launch.put("sound", sound);
          launch.put("time", time);
          launch.put("firedAt", firedAt > 0 ? firedAt : System.currentTimeMillis());
          SharedPreferences sp = ExactAlarmPlugin.prefs(ctx);
          sp.edit().putString("launch_payload", launch.toString()).apply();
        } catch (Exception ignored) {
        }
      }
      ExactAlarmPlugin.ensureChannel(ctx, sound == null || sound.isEmpty() ? "alarm.wav" : sound);
      String channelId = ExactAlarmPlugin.channelIdFor(sound == null || sound.isEmpty() ? "alarm.wav" : sound);

      PendingIntent content = ExactAlarmPlugin.launchPendingIntent(ctx, 3);
      int notifId = (int) (System.currentTimeMillis() % 2100000000);

      NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channelId)
          .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
          .setContentTitle(title == null || title.isEmpty() ? "Our Habit" : title)
          .setContentText(body == null ? "" : body)
          .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body))
          .setPriority(NotificationCompat.PRIORITY_MAX)
          .setCategory(NotificationCompat.CATEGORY_ALARM)
          .setAutoCancel(true)
          .setContentIntent(content)
          .setVibrate(new long[]{0, 400, 250, 400, 250, 600});

      NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
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

  private void startForegroundSafely(String title) {
    try {
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "কথা বলা রিমাইন্ডার",
            NotificationManager.IMPORTANCE_LOW);
        ch.setSound(null, null);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
      }
      Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
          .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
          .setContentTitle(title)
          .setContentText("আপনাকে ডাকা হচ্ছে…")
          .setPriority(NotificationCompat.PRIORITY_LOW)
          .setOngoing(true)
          .build();
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(FGS_ID, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
      } else {
        startForeground(FGS_ID, n);
      }
    } catch (Exception ignored) {
    }
  }

  private void stopSelfSafely() {
    try {
      if (tts != null) {
        try {
          tts.stop();
        } catch (Exception ignored) {
        }
        try {
          tts.shutdown();
        } catch (Exception ignored) {
        }
        tts = null;
      }
    } catch (Exception ignored) {
    }
    stopForeground(true);
    stopSelf();
  }

  @Override
  public void onDestroy() {
    try {
      if (tts != null) tts.shutdown();
    } catch (Exception ignored) {
    }
    super.onDestroy();
  }

  // ---------------- entry points ----------------

  /** Speak + then post the alarm notification (used by AlarmFireReceiver). */
  static void startForAlarm(Context ctx, String speak, String lang, String title, String body,
                            String sound, String key, String time) {
    try {
      Intent i = new Intent(ctx, AlarmSpeakService.class);
      i.putExtra(EXTRA_SPEAK, speak);
      i.putExtra(EXTRA_LANG, lang);
      i.putExtra(EXTRA_TITLE, title);
      i.putExtra(EXTRA_BODY, body);
      i.putExtra(EXTRA_SOUND, sound);
      i.putExtra(EXTRA_KEY, key);
      i.putExtra(EXTRA_TIME, time);
      i.putExtra(EXTRA_NOTIFY, true);
      i.putExtra(EXTRA_FIRED_AT, System.currentTimeMillis());
      if (Build.VERSION.SDK_INT >= 26) {
        ctx.startForegroundService(i);
      } else {
        ctx.startService(i);
      }
    } catch (Exception ignored) {
      // fall back to a plain notification so the alarm is never lost
      try {
        ExactAlarmPlugin.ensureChannel(ctx, sound);
        android.app.PendingIntent pi = ExactAlarmPlugin.launchPendingIntent(ctx, 3);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, ExactAlarmPlugin.channelIdFor(sound))
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(pi);
        NotificationManagerCompat.from(ctx).notify((int) (System.currentTimeMillis() % 2100000000), b.build());
      } catch (Exception ignored2) {
      }
    }
  }

  /** Speak only — no notification (in-app / Reels-limit warnings). */
  static void startSpeakOnly(Context ctx, String speak, String lang) {
    try {
      Intent i = new Intent(ctx, AlarmSpeakService.class);
      i.putExtra(EXTRA_SPEAK, speak);
      i.putExtra(EXTRA_LANG, lang);
      i.putExtra(EXTRA_NOTIFY, false);
      if (Build.VERSION.SDK_INT >= 26) {
        ctx.startForegroundService(i);
      } else {
        ctx.startService(i);
      }
    } catch (Exception ignored) {
    }
  }
}
