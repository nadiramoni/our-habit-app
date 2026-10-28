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

import java.util.Calendar;
import java.util.HashMap;
import java.util.Map;

/**
 * UsageTracker — REAL screen-time for video/Reels apps via Android
 * Usage Access (UsageStatsManager). The user cannot lie: the minutes come
 * straight from the OS.
 *
 * v2.3 (owner round-5): Shorts vs long is now detected per ACTIVITY class
 * name — YouTube Shorts (…shorts…), Instagram/Facebook Reels (…reel…) go to
 * the "ytshorts" bucket; the remaining YouTube time stays "ytlong".
 * Facebook minutes are ALSO reported separately (owner asked for a
 * per-app breakdown incl. minutes watched).
 */
@CapacitorPlugin(name = "UsageTracker")
public class UsageTrackerPlugin extends Plugin {

    private static boolean isShortsActivity(String cls) {
        if (cls == null) return false;
        String c = cls.toLowerCase();
        return c.contains("shorts") || c.contains("reel") || c.contains("tiktok") || c.contains("snack");
    }

    private static final Map<String, String> PKG_MAP = new HashMap<>();
    static {
        // facebook
        PKG_MAP.put("com.facebook.katana", "facebook");
        PKG_MAP.put("com.facebook.lite", "facebook");
        PKG_MAP.put("com.facebook.groups", "facebook");
        PKG_MAP.put("com.facebook.orca", "facebook");
        // youtube (long videos; Shorts live in the same package)
        PKG_MAP.put("com.google.android.youtube", "ytlong");
        PKG_MAP.put("com.google.android.youtube.tv", "ytlong");
        // tiktok
        PKG_MAP.put("com.zhiliaoapp.musically", "tiktok");
        PKG_MAP.put("com.zhiliaoapp.musically.go", "tiktok");
        PKG_MAP.put("com.ss.android.ugc.trill", "tiktok");
        // instagram
        PKG_MAP.put("com.instagram.android", "instagram");
        PKG_MAP.put("com.instagram.lite", "instagram");
        // other video platforms
        PKG_MAP.put("com.vimeo.android.videoapp", "other");
        PKG_MAP.put("com.kwai.video", "other");
        PKG_MAP.put("video.likee", "other");
        PKG_MAP.put("com.twitter.android", "other");
        PKG_MAP.put("com.reddit.frontpage", "other");
        PKG_MAP.put("com.snapchat.android", "other");
        PKG_MAP.put("com.pinterest", "other");
        PKG_MAP.put("com.uvideo", "other");
    }

    @PluginMethod
    public void getVideoUsage(PluginCall call) {
        Context ctx = getContext();
        boolean granted = hasUsageAccess(ctx);
        JSObject res = new JSObject();
        res.put("granted", granted);

        long fb = 0, ytShorts = 0, ytLong = 0, tiktok = 0, ig = 0, other = 0;
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
                    if (!PKG_MAP.containsKey(pkg)) continue;
                    int type = ev.getEventType();
                    if (type == UsageEvents.Event.ACTIVITY_RESUMED) {
                        String cls = ev.getClassName();
                        String sessionKey = pkg + "|" + (isShortsActivity(cls) ? "shorts" : "full");
                        open.put(sessionKey, ev.getTimeStamp());
                    } else if (type == UsageEvents.Event.ACTIVITY_PAUSED) {
                        String cls = ev.getClassName();
                        String sessionKey = pkg + "|" + (isShortsActivity(cls) ? "shorts" : "full");
                        Long began = open.remove(sessionKey);
                        if (began != null) {
                            long mins = Math.max(0, (ev.getTimeStamp() - began) / 60000L);
                            long[] acc = bucket(fb, ytShorts, ytLong, tiktok, ig, other, pkg, mins, isShortsActivity(cls));
                            fb = acc[0]; ytShorts = acc[1]; ytLong = acc[2]; tiktok = acc[3]; ig = acc[4]; other = acc[5];
                        }
                    }
                }
                // apps still open → close at "now"
                for (Map.Entry<String, Long> e : open.entrySet()) {
                    long mins = Math.max(0, (end - e.getValue()) / 60000L);
                    boolean shortSession = e.getKey().endsWith("|shorts");
                    String pkg = e.getKey().substring(0, e.getKey().indexOf('|'));
                    long[] acc = bucket(fb, ytShorts, ytLong, tiktok, ig, other, pkg, mins, shortSession);
                    fb = acc[0]; ytShorts = acc[1]; ytLong = acc[2]; tiktok = acc[3]; ig = acc[4]; other = acc[5];
                }
            }
        }

        res.put("facebook", fb);
        res.put("ytshorts", ytShorts);
        res.put("ytlong", ytLong);
        res.put("tiktok", tiktok);
        res.put("instagram", ig);
        res.put("other", other);
        call.resolve(res);
    }

    /** acc = {facebook, ytShorts, ytLong, tiktok, instagram, other} */
    private long[] bucket(long fb, long ytShorts, long ytLong, long tt, long ig, long other, String pkg, long mins, boolean shorts) {
        switch (PKG_MAP.get(pkg)) {
            case "facebook":  return new long[]{fb + mins, ytShorts, ytLong, tt, ig, other};
            case "ytlong":
                // v2.3: YouTube Shorts live inside the same package — activities
                // with "shorts/reel/snack" in the class name go to the shorts bucket
                if (shorts) return new long[]{fb, ytShorts + mins, ytLong, tt, ig, other};
                return new long[]{fb, ytShorts, ytLong + mins, tt, ig, other};
            case "tiktok":    return new long[]{fb, ytShorts, ytLong, tt + mins, ig, other};
            case "instagram": return new long[]{fb, ytShorts, ytLong, tt, ig + mins, other};
            default:          return new long[]{fb, ytShorts, ytLong, tt, ig, other + mins};
        }
    }

    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("cannot_open_settings", e);
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
            call.reject("cannot_open_app_settings", e);
        }
    }

    private boolean hasUsageAccess(Context ctx) {
        AppOpsManager appOps = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
        if (appOps == null) return false;
        int mode = appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }
}
