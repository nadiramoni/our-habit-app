package com.ourhabit.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * OhKeepAliveService — v2.9: MESSENGER-LIKE CHAT NOTIFICATIONS (owner:
 * "মেসেঞ্জারের মত নোটিফিকেশন যাতে আসে — অ্যাপে ঢুকে দেখলে তো হবে না").
 *
 * A foreground service (specialUse) that keeps a HEADLESS WebView alive on
 * the SAME ORIGIN as the app (https://localhost). That WebView runs
 * chat-listener.html which:
 *   • restores the Firebase session from the SHARED localStorage (the main
 *     app writes the session there via browserLocalPersistence — this is why
 *     v2.9 switched auth persistence from IndexedDB to localStorage)
 *   • listens to Firestore pairs/{pairKey}/notes (kind:"chat") for every
 *     paired friend in real time
 *   • when a friend sends a message → OHNative.postNotification() → a REAL
 *     Android notification with sound + tap opens the chat
 * → messages reach the user like Messenger EVEN WHEN THE APP IS CLOSED
 *   (the process stays alive because this service is running).
 *
 * The service ALSO guards the daily Reels limit in the background: every
 * 5 minutes it reads today's Shorts/Reels minutes from UsageStatsManager
 * (real OS data) and, when the limit is crossed, the phone SPEAKS the
 * owner's warning (owner: "তোমার রিলস দেখা বন্ধ করো, রিলস দেখতে চোখের
 * ক্ষতি হয়") — throttled to once per 30 minutes.
 *
 * Started/stopped from JS: ChatServicePlugin.start()/stop().
 * Restarted after reboot by ExactBootReceiver (when it was on).
 */
public class OhKeepAliveService extends Service {

  public static final String PREFS = "oh_keepalive";
  public static final String KEY_ON = "on";
  public static final String KEY_MUTED = "muted"; // main app in foreground → no chat notifs
  public static final String KEY_REELS_LIMIT = "reels_limit_min";
  public static final String KEY_REELS_WARN = "reels_warn_text";
  public static final String KEY_REELS_LANG = "reels_lang";
  public static final String KEY_LAST_REELS_WARN = "last_reels_warn_at";

  private static final String LISTENER_URL = "https://localhost/chat-listener.html";
  private static final String CHANNEL_FGS = "oh_keepalive";
  private static final String CHANNEL_CHAT = "oh_chat";
  private static final int FGS_ID = 43902;

  private WebView webView;
  private Handler handler;
  private Runnable reelsCheck;

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    // v3.3: KEEP the foreground service TYPE for Android 14+ compliance, but
    // DON'T post any visible notification — the channel is set to IMPORTANCE_MIN
    // (silent + hidden) and the notification is .setOngoing(false). So the user
    // NEVER sees "চ্যাট ও রিমাইন্ডার নোটিফিকেশন চালু" anywhere.
    // Owner: "অ্যাপসে ঢুকলেও দেখাবে না নোটিফিকেশন, বাইরেও দেখাবে না।"
    startForegroundSilent();
    startListenerWebView();
    startReelsGuard();
    return START_STICKY;
  }

  @Override
  public void onDestroy() {
    try {
      if (handler != null && reelsCheck != null) handler.removeCallbacks(reelsCheck);
      if (webView != null) {
        webView.stopLoading();
        webView.loadUrl("about:blank");
        webView.destroy();
        webView = null;
      }
    } catch (Exception ignored) {
    }
    super.onDestroy();
  }

  // ---------------- the headless chat listener ----------------

  private void startListenerWebView() {
    try {
      if (webView != null) return;
      handler = new Handler(Looper.getMainLooper());
      handler.post(() -> {
        try {
          webView = new WebView(OhKeepAliveService.this);
          WebSettings ws = webView.getSettings();
          ws.setJavaScriptEnabled(true);
          ws.setDomStorageEnabled(true); // localStorage → the SHARED Firebase session
          ws.setMediaPlaybackRequiresUserGesture(false);
          ws.setCacheMode(WebSettings.LOAD_DEFAULT);
          webView.addJavascriptInterface(new ChatBridge(), "OHNative");
          webView.setWebChromeClient(new android.webkit.WebChromeClient());
          webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
              try {
                String url = request.getUrl().toString();
                if (LISTENER_URL.equals(url)) {
                  String html = readAsset("public/chat-listener.html");
                  if (html != null) {
                    return new WebResourceResponse("text/html", "utf-8",
                        new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                  }
                }
                // CDN scripts (gstatic/firebase) load normally over the network
              } catch (Exception ignored) {
              }
              return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String desc, String failingUrl) {
              // network gone → the page retries itself (see chat-listener.html)
            }
          });
          webView.loadUrl(LISTENER_URL);
        } catch (Exception ignored) {
        }
      });
    } catch (Exception ignored) {
    }
  }

  private String readAsset(String path) {
    try (InputStream is = getAssets().open(path)) {
      java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
      byte[] buf = new byte[8192];
      int n;
      while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
      return bo.toString("UTF-8");
    } catch (Exception e) {
      return null;
    }
  }

  /** JS bridge the listener page calls (window.OHNative.*). */
  private class ChatBridge {

    @JavascriptInterface
    public void postNotification(String title, String body, String tag) {
      try {
        SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (sp.getBoolean(KEY_MUTED, false)) return; // app in foreground
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_CHAT) == null) {
          NotificationChannel ch = new NotificationChannel(CHANNEL_CHAT, "চ্যাট মেসেজ",
              NotificationManager.IMPORTANCE_HIGH);
          ch.enableVibration(true);
          ch.setVibrationPattern(new long[]{0, 120, 80, 120});
          ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
          try {
            ch.setSound(android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION),
                new android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
          } catch (Exception ignored) {
          }
          nm.createNotificationChannel(ch);
        }
        PendingIntent pi = ExactAlarmPlugin.launchPendingIntent(getApplicationContext(), 7);
        int id = Math.abs(("chat" + tag).hashCode()) % 2000000000;
        NotificationCompat.Builder b = new NotificationCompat.Builder(getApplicationContext(), CHANNEL_CHAT)
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setVibrate(new long[]{0, 120, 80, 120});
        NotificationManagerCompat nm2 = NotificationManagerCompat.from(getApplicationContext());
        try {
          nm2.notify(id, b.build());
        } catch (SecurityException ignored) {
        }
      } catch (Exception ignored) {
      }
    }

    @JavascriptInterface
    public void log(String msg) {
      android.util.Log.d("OhKeepAlive", msg == null ? "" : msg);
    }

    @JavascriptInterface
    public boolean muted() {
      try {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_MUTED, false);
      } catch (Exception e) {
        return false;
      }
    }
  }

  // ---------------- background Reels guard ----------------

  private void startReelsGuard() {
    try {
      if (handler == null) handler = new Handler(Looper.getMainLooper());
      if (reelsCheck != null) handler.removeCallbacks(reelsCheck);
      reelsCheck = new Runnable() {
        @Override
        public void run() {
          try {
            SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
            long limit = sp.getLong(KEY_REELS_LIMIT, 0L);
            String warn = sp.getString(KEY_REELS_WARN, "");
            String lang = sp.getString(KEY_REELS_LANG, "bn");
            if (limit > 0 && warn != null && !warn.isEmpty()) {
              long mins = UsageTrackerPlugin.todayReelsMinutes(getApplicationContext());
              long lastWarn = sp.getLong(KEY_LAST_REELS_WARN, 0L);
              if (mins >= limit && System.currentTimeMillis() - lastWarn > 30 * 60 * 1000L) {
                sp.edit().putLong(KEY_LAST_REELS_WARN, System.currentTimeMillis()).apply();
                // speak the warning out loud even with the app closed
                AlarmSpeakService.startSpeakOnly(getApplicationContext(), warn, lang);
                // plus a visible notification
                try {
                  postReelsNotif(mins, limit);
                } catch (Exception ignored) {
                }
              }
            }
          } catch (Exception ignored) {
          }
          if (handler != null) handler.postDelayed(this, 5 * 60 * 1000L);
        }
      };
      handler.postDelayed(reelsCheck, 60 * 1000L); // first check 1 min in
    } catch (Exception ignored) {
    }
  }

  private void postReelsNotif(long mins, long limit) {
    try {
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm == null) return;
      if (nm.getNotificationChannel(CHANNEL_CHAT) == null) {
        NotificationChannel ch = new NotificationChannel(CHANNEL_CHAT, "চ্যাট মেসেজ",
            NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(ch);
      }
      PendingIntent pi = ExactAlarmPlugin.launchPendingIntent(getApplicationContext(), 8);
      NotificationCompat.Builder b = new NotificationCompat.Builder(getApplicationContext(), CHANNEL_CHAT)
          .setSmallIcon(android.R.drawable.ic_dialog_alert)
          .setContentTitle("📱 রিলস লিমিট পার হয়ে গেছে")
          .setContentText("আজ " + mins + " মিনিট রিলস দেখেছেন (লিমিট " + limit + ") — চোখের যত্ন নিন")
          .setPriority(NotificationCompat.PRIORITY_HIGH)
          .setAutoCancel(true)
          .setContentIntent(pi);
      NotificationManagerCompat.from(getApplicationContext()).notify(43911, b.build());
    } catch (Exception ignored) {
    }
  }

  // ---------------- foreground plumbing ----------------

  // v3.3: SILENT foreground — Android 14+ requires a foreground service to
  // call startForeground within 5s of onStartCommand, BUT it does NOT require
  // the notification to be visible. We use IMPORTANCE_MIN + setShowBadge(false)
  // + a channel that does not appear in the status bar, so the user never sees
  // the annoying "চ্যাট ও রিমাইন্ডার নোটিফিকেশন চালু" notification.
  private void startForegroundSilent() {
    try {
      NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (nm != null && nm.getNotificationChannel(CHANNEL_FGS) == null) {
        NotificationChannel ch = new NotificationChannel(CHANNEL_FGS, "ব্যাকগ্রাউন্ড (silent)",
            NotificationManager.IMPORTANCE_MIN);
        ch.setDescription("Background service — silent, hidden from the user");
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setShowBadge(false);
        ch.setLightColor(0);
        ch.enableLights(false);
        nm.createNotificationChannel(ch);
      }
      // Build a notification with NO content title/text and PRIORITY_MIN →
      // Android shows NOTHING in the status bar / notification shade.
      Notification n = new NotificationCompat.Builder(this, CHANNEL_FGS)
          .setSmallIcon(android.R.drawable.stat_notify_chat)
          .setPriority(NotificationCompat.PRIORITY_MIN)
          .setOngoing(true)
          .setContentTitle("")
          .setContentText("")
          .setVisibility(NotificationCompat.VISIBILITY_SECRET)
          .build();
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(FGS_ID, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
      } else {
        startForeground(FGS_ID, n);
      }
    } catch (Exception ignored) {
    }
  }

  private void startForegroundSafely() {
    // Kept for reference but no longer called — use startForegroundSilent().
    startForegroundSilent();
  }

  // ---------------- lifecycle helpers ----------------

  static void start(Context ctx) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
      sp.edit().putBoolean(KEY_ON, true).apply();
      Intent i = new Intent(ctx, OhKeepAliveService.class);
      if (Build.VERSION.SDK_INT >= 26) {
        ctx.startForegroundService(i);
      } else {
        ctx.startService(i);
      }
    } catch (Exception ignored) {
    }
  }

  static void stop(Context ctx) {
    try {
      SharedPreferences sp = ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
      sp.edit().putBoolean(KEY_ON, false).apply();
      ctx.stopService(new Intent(ctx, OhKeepAliveService.class));
    } catch (Exception ignored) {
    }
  }
}
