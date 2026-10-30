package com.ourhabit.app;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.os.Process;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.Calendar;
import java.util.HashMap;
import java.util.Map;

/**
 * UsageTracker — REAL screen-time for video apps via Android Usage Access
 * (UsageStatsManager). The user cannot lie: the numbers come straight from
 * the OS.
 *
 * v5.0 (owner round-19): the owner's own video-app list, each with its OWN
 * bucket — এক্স (X/Twitter), কুকু টিভি (Kuku/Kuuk TV), মোজ (Moj), চরকি,
 * হইচই, বঙ্গ, বায়োস্কোপ, টফি (packages verified from the Play Store
 * listings). Twitter used to drown in "other" — now it is its own row.
 *
 * v5.0 SECONDS: getVideoUsage() now ALSO returns an `apps` map of per-app
 * SECONDS (and `appsTotal`) so the web layer can show “৪৫ সেকেন্ড / ৫ মিনিট /
 * ১ ঘণ্টা ১০ মিনিট”. The legacy minute keys are kept unchanged (backups,
 * points and the admin tables all still read them).
 *
 * Honest measurement note (the owner's own rule): Android cannot detect each
 * video's playback separately — the usage engine measures the time the app's
 * screen is in the foreground, split by ACTIVITY class for Shorts/Reels where
 * the class names are known. That is the most accurate approximation
 * possible, and the UI labels it as আনুমানিক.
 */
@CapacitorPlugin(name = "UsageTracker")
public class UsageTrackerPlugin extends Plugin {

    private static boolean isShortsActivity(String cls) {
        if (cls == null) return false;
        String c = cls.toLowerCase();
        return c.contains("shorts") || c.contains("reel") || c.contains("tiktok") || c.contains("snack");
    }

    /** v5.0: package → app id. "youtube" is special-cased into ytshorts/ytlong
     *  by the ACTIVITY class (Shorts vs the rest), exactly like before. */
    private static final Map<String, String> PKG_APP = new HashMap<>();
    static {
        // facebook
        PKG_APP.put("com.facebook.katana", "facebook");
        PKG_APP.put("com.facebook.lite", "facebook");
        PKG_APP.put("com.facebook.groups", "facebook");
        PKG_APP.put("com.facebook.orca", "facebook");
        // youtube (long videos; Shorts live in the same package — split by class)
        PKG_APP.put("com.google.android.youtube", "youtube");
        PKG_APP.put("com.google.android.youtube.tv", "youtube");
        // tiktok
        PKG_APP.put("com.zhiliaoapp.musically", "tiktok");
        PKG_APP.put("com.zhiliaoapp.musically.go", "tiktok");
        PKG_APP.put("com.ss.android.ugc.trill", "tiktok");
        // instagram
        PKG_APP.put("com.instagram.android", "instagram");
        PKG_APP.put("com.instagram.lite", "instagram");
        // v5.0: X (Twitter) — used to sit inside "other"; now its own row
        PKG_APP.put("com.twitter.android", "x");
        // v5.0: Kuku TV / Kuuk TV (both spellings of the owner's কুকু টিভি)
        PKG_APP.put("com.bongobd.kuuktv", "kukutv");   // Kuuk TV by Bongo BD
        PKG_APP.put("com.vlv.aravali.reels", "kukutv"); // Kuku TV (short drama)
        // v5.0: Moj (ShareChat's short-video app — the owner's মোস)
        PKG_APP.put("in.mohalla.video", "moj");
        // v5.0: BD drama/OTT apps
        PKG_APP.put("com.prothomalo", "chorki");        // Chorki (Prothom Alo)
        PKG_APP.put("com.viewlift.hoichoi", "hoichoi"); // Hoichoi
        PKG_APP.put("com.bongo.bongobd", "bongo");      // Bongo
        PKG_APP.put("com.bongo.bioscope", "bioscope");  // Bioscope+
        PKG_APP.put("com.banglalink.toffee", "toffee"); // Toffee (Banglalink)
        // other video platforms (unchanged)
        PKG_APP.put("com.vimeo.android.videoapp", "other");
        PKG_APP.put("com.kwai.video", "other");
        PKG_APP.put("video.likee", "other");
        PKG_APP.put("com.reddit.frontpage", "other");
        PKG_APP.put("com.snapchat.android", "other");
        PKG_APP.put("com.pinterest", "other");
        PKG_APP.put("com.uvideo", "other");
    }

    /** v5.0: the FINAL app id of a package+activity (null = not a video app). */
    private static String appIdOf(String pkg, boolean shorts) {
        String app = PKG_APP.get(pkg);
        if (app == null) return null;
        if ("youtube".equals(app)) return shorts ? "ytshorts" : "ytlong";
        return app;
    }

    @PluginMethod
    public void getVideoUsage(PluginCall call) {
        Context ctx = getContext();
        boolean granted = hasUsageAccess(ctx);
        JSObject res = new JSObject();
        res.put("granted", granted);

        // v5.0: ONE source of truth — app id → accumulated MILLISECONDS.
        // Minutes (legacy keys) = ms / 60000; seconds (the new `apps` map) =
        // ms / 1000. Never two separate counters that can drift.
        Map<String, Long> msAcc = new HashMap<>();
        long shortsCount = 0, shortsYt = 0, shortsFb = 0, shortsIg = 0;
        if (granted) {
            UsageStatsManager usm =
                (UsageStatsManager) ctx.getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm != null) {
                Calendar cal = Calendar.getInstance();
                cal.set(Calendar.HOUR_OF_DAY, 0);
                cal.set(Calendar.MINUTE, 0);
                cal.set(Calendar.SECOND, 0);
                cal.set(Calendar.MILLISECOND, 0);
                long start = cal.getTimeInMillis();
                long end = System.currentTimeMillis();

                UsageEvents events = usm.queryEvents(start, end);
                UsageEvents.Event ev = new UsageEvents.Event();
                // open session per package+activity so Shorts/Reels activities
                // are timed separately from long-video activities
                Map<String, Long> open = new HashMap<>();

                while (events.hasNextEvent()) {
                    events.getNextEvent(ev);
                    String pkg = ev.getPackageName();
                    if (!PKG_APP.containsKey(pkg)) continue;
                    int type = ev.getEventType();
                    if (type == UsageEvents.Event.ACTIVITY_RESUMED) {
                        String cls = ev.getClassName();
                        boolean shorts = isShortsActivity(cls);
                        // v2.4: EVERY resume of a shorts-style activity = one
                        // short video/reel opened — REAL count from OS events
                        if (shorts) {
                            shortsCount++;
                            String b = appIdOf(pkg, true);
                            if ("ytshorts".equals(b)) shortsYt++;
                            else if ("facebook".equals(b)) shortsFb++;
                            else if ("instagram".equals(b)) shortsIg++;
                        }
                        open.put(pkg + "|" + (shorts ? "shorts" : "full"), ev.getTimeStamp());
                    } else if (type == UsageEvents.Event.ACTIVITY_PAUSED) {
                        String cls = ev.getClassName();
                        String sessionKey = pkg + "|" + (isShortsActivity(cls) ? "shorts" : "full");
                        Long began = open.remove(sessionKey);
                        if (began != null) {
                            addMs(msAcc, appIdOf(pkg, isShortsActivity(cls)),
                                Math.max(0, ev.getTimeStamp() - began));
                        }
                    }
                }
                // apps still open → close at "now"
                for (Map.Entry<String, Long> e : open.entrySet()) {
                    boolean shortSession = e.getKey().endsWith("|shorts");
                    String pkg = e.getKey().substring(0, e.getKey().indexOf('|'));
                    addMs(msAcc, appIdOf(pkg, shortSession), Math.max(0, end - e.getValue()));
                }
            }
        }

        // ---------- legacy MINUTE keys (unchanged shape — backups, points,
        // admin tables and old web builds all still read these) ----------
        res.put("facebook", min(msAcc, "facebook"));
        res.put("ytshorts", min(msAcc, "ytshorts"));
        res.put("ytlong", min(msAcc, "ytlong"));
        res.put("tiktok", min(msAcc, "tiktok"));
        res.put("instagram", min(msAcc, "instagram"));
        res.put("other", min(msAcc, "other"));
        res.put("shortsCount", shortsCount);
        res.put("shortsYt", shortsYt);
        res.put("shortsFb", shortsFb);
        res.put("shortsIg", shortsIg);
        // v5.0: the new buckets as minutes too (parity for the web layer).
        res.put("x", min(msAcc, "x"));
        res.put("kukutv", min(msAcc, "kukutv"));
        res.put("moj", min(msAcc, "moj"));
        res.put("chorki", min(msAcc, "chorki"));
        res.put("hoichoi", min(msAcc, "hoichoi"));
        res.put("bongo", min(msAcc, "bongo"));
        res.put("bioscope", min(msAcc, "bioscope"));
        res.put("toffee", min(msAcc, "toffee"));

        // ---------- v5.0: the PRECISE per-app SECONDS map ----------
        JSONObject apps = new JSONObject();
        long totalSec = 0;
        for (Map.Entry<String, Long> e : msAcc.entrySet()) {
            long sec = e.getValue() / 1000L;
            if (sec <= 0) continue;
            try {
                apps.put(e.getKey(), sec);
            } catch (Exception ignored) {
            }
            totalSec += sec;
        }
        res.put("apps", apps);
        res.put("appsTotal", totalSec);
        call.resolve(res);
    }

    private static void addMs(Map<String, Long> acc, String appId, long ms) {
        if (appId == null || ms <= 0) return;
        Long prev = acc.get(appId);
        acc.put(appId, (prev == null ? 0L : prev) + ms);
    }

    private static long min(Map<String, Long> acc, String appId) {
        Long v = acc.get(appId);
        return v == null ? 0L : v / 60000L;
    }

    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("cannot_open_settings", e.getMessage());
        }
    }

    /** Open this app's own system settings page (notification toggle, battery, etc.). */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            i.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("cannot_open_app_settings", e.getMessage());
        }
    }

    private boolean hasUsageAccess(Context ctx) {
        AppOpsManager appOps = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
        if (appOps == null) return false;
        int mode = appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    /**
     * v2.9: today's SHORTS/REELS minutes so far — public static so the
     * background OhKeepAliveService can enforce the daily Reels limit EVEN
     * WHILE THE APP IS CLOSED.
     */
    public static long todayReelsMinutes(Context ctx) {
        try {
            AppOpsManager appOps = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
            if (appOps == null) return -1;
            int mode = appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.getPackageName());
            if (mode != AppOpsManager.MODE_ALLOWED) return -1;
            UsageStatsManager usm = (UsageStatsManager) ctx.getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) return -1;
            Calendar cal = Calendar.getInstance();
            cal.set(Calendar.HOUR_OF_DAY, 0);
            cal.set(Calendar.MINUTE, 0);
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            long start = cal.getTimeInMillis();
            long end = System.currentTimeMillis();
            UsageEvents events = usm.queryEvents(start, end);
            UsageEvents.Event ev = new UsageEvents.Event();
            Map<String, Long> open = new HashMap<>();
            long totalMs = 0;
            while (events.hasNextEvent()) {
                events.getNextEvent(ev);
                String pkg = ev.getPackageName();
                if (!PKG_APP.containsKey(pkg)) continue;
                int type = ev.getEventType();
                if (type == UsageEvents.Event.ACTIVITY_RESUMED) {
                    boolean shorts = isShortsActivity(ev.getClassName());
                    open.put(pkg + "|" + (shorts ? "shorts" : "full"), ev.getTimeStamp());
                } else if (type == UsageEvents.Event.ACTIVITY_PAUSED) {
                    boolean shorts = isShortsActivity(ev.getClassName());
                    String key = pkg + "|" + (shorts ? "shorts" : "full");
                    Long began = open.remove(key);
                    if (began != null && shorts) {
                        totalMs += Math.max(0, ev.getTimeStamp() - began);
                    }
                }
            }
            for (Map.Entry<String, Long> e : open.entrySet()) {
                if (e.getKey().endsWith("|shorts")) {
                    totalMs += Math.max(0, end - e.getValue());
                }
            }
            return totalMs / 60000L;
        } catch (Exception e) {
            return -1;
        }
    }
}
