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
 * straight from the OS. Shorts vs long: known shorts platforms (Facebook,
 * TikTok, Instagram) count as shorts; the YouTube app counts as long
 * (YouTube Shorts are inside the same package, split precisely is not
 * possible from usage events alone).
 */
@CapacitorPlugin(name = "UsageTracker")
public class UsageTrackerPlugin extends Plugin {

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

        long fb = 0, ytLong = 0, tiktok = 0, ig = 0, other = 0;
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
                Map<String, Long> open = new HashMap<>();

                while (events.hasNextEvent()) {
                    events.getNextEvent(ev);
                    String pkg = ev.getPackageName();
                    if (!PKG_MAP.containsKey(pkg)) continue;
                    int type = ev.getEventType();
                    if (type == UsageEvents.Event.ACTIVITY_RESUMED) {
                        open.put(pkg, ev.getTimeStamp());
                    } else if (type == UsageEvents.Event.ACTIVITY_PAUSED) {
                        Long began = open.remove(pkg);
                        if (began != null) {
                            long mins = Math.max(0, (ev.getTimeStamp() - began) / 60000L);
                            long[] acc = bucket(fb, ytLong, tiktok, ig, other, pkg, mins);
                            fb = acc[0]; ytLong = acc[1]; tiktok = acc[2]; ig = acc[3]; other = acc[4];
                        }
                    }
                }
                // apps still open → close at "now"
                for (Map.Entry<String, Long> e : open.entrySet()) {
                    long mins = Math.max(0, (end - e.getValue()) / 60000L);
                    long[] acc = bucket(fb, ytLong, tiktok, ig, other, e.getKey(), mins);
                    fb = acc[0]; ytLong = acc[1]; tiktok = acc[2]; ig = acc[3]; other = acc[4];
                }
            }
        }

        res.put("facebook", fb);
        res.put("ytshorts", 0L);
        res.put("ytlong", ytLong);
        res.put("tiktok", tiktok);
        res.put("instagram", ig);
        res.put("other", other);
        call.resolve(res);
    }

    private long[] bucket(long fb, long yt, long tt, long ig, long other, String pkg, long mins) {
        switch (PKG_MAP.get(pkg)) {
            case "facebook":  return new long[]{fb + mins, yt, tt, ig, other};
            case "ytlong":    return new long[]{fb, yt + mins, tt, ig, other};
            case "tiktok":    return new long[]{fb, yt, tt + mins, ig, other};
            case "instagram": return new long[]{fb, yt, tt, ig + mins, other};
            default:          return new long[]{fb, yt, tt, ig, other + mins};
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
