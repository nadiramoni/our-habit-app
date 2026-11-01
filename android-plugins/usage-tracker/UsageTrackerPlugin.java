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
 * v2.3 (owner round-5): Shorts vs long is detected per ACTIVITY class
 * name — YouTube Shorts (…shorts…), Instagram/Facebook Reels (…reel…) go to
 * the "ytshorts" bucket; the remaining YouTube time stays "ytlong".
 * Facebook minutes are ALSO reported separately (owner asked for a
 * per-app breakdown incl. minutes watched).
 *
 * v3.3 (owner round-14 — "আগে এগুলো আমার ছিল, তুমি মিসিং করে ফেলছো"):
 *  1. NEW "mobiletv" bucket — মোবাইল টিভি/সিনেমা (লং ভিডিও): Netflix, Prime
 *     Video, Hotstar, Disney+, Hoichoi, Viki, MX Player, Viu, YouTube Kids
 *     + a keyword fallback (toffee/bioscope/chorki/bongo/hotstar/…/"flix"/
 *     "cinema"/"movie"/".tv") so EVERY TV/movie app the user installs is
 *     counted — "যত প্রকার আরো আছে সব কাউন্ট করবা"।
 *  2. TikTok shorts-count FIXED — TikTok's activity class is
 *     com.ss.android.ugc.aweme… (no "tiktok" inside), so the old check
 *     never counted TikTok videos. Now every TikTok/Likee/SnackVideo
 *     activity resume = one short video (pure-shorts apps).
 *  3. Background reels-guard FIXED — todayReelsMinutes() previously
 *     counted only "shorts" activities, so TikTok doom-scrolling never
 *     fired the limit warning. Pure-shorts apps now always count.
 *  4. shortsTt + shortsOther added so the app can show PER-APP shorts
 *     counts (owner: "শর্ট ভিডিও সে কয়টা দেখছে ওইটা দেখা যায়")।
 */
@CapacitorPlugin(name = "UsageTracker")
public class UsageTrackerPlugin extends Plugin {

    /** Shorts-style activity classes (YouTube Shorts / IG-FB Reels / snack). */
    private static boolean isShortsActivity(String cls) {
        if (cls == null) return false;
        String c = cls.toLowerCase();
        return c.contains("shorts") || c.contains("reel") || c.contains("tiktok") || c.contains("snack");
    }

    /** v3.3: pure-shorts apps — EVERY video there is a short video, no
     *  matter what the activity class is called (TikTok class names have
     *  no "tiktok" in them!). Likee + SnackVideo(Kwai) too. */
    private static boolean isPureShortsPkg(String pkg) {
        if (pkg == null) return false;
        String p = pkg.toLowerCase();
        return p.startsWith("com.zhiliaoapp.musically")     // TikTok (+Go)
            || p.startsWith("com.ss.android.ugc.trill")     // TikTok (regional)
            || p.startsWith("com.ss.android.ugc.aweme")     // TikTok activity classes
            || p.startsWith("video.likee")                  // Likee
            || p.startsWith("com.kwai.video")               // SnackVideo / Kwai
            || p.startsWith("com.uvideo");                  // uVideo shorts
    }

    /** v3.3: TV/movie apps NOT in PKG_MAP — Netflix-style keyword fallback so
     *  "যত প্রকার মোবাইল টিভি/সিনেমা অ্যাপ" all land in the long-video bucket. */
    private static boolean isTvOrMovieApp(String pkg) {
        if (pkg == null) return false;
        String p = pkg.toLowerCase();
        return p.contains("netflix") || p.contains("hotstar") || p.contains("hoichoi")
            || p.contains("chorki") || p.contains("bongobd") || p.contains("toffee")
            || p.contains("bioscope") || p.contains("primevideo") || p.contains("amazon.avod")
            || p.contains("disneyplus") || p.contains("iflix") || p.contains("mxtech")
            || p.contains("viu") || p.contains("viki") || p.contains("twitch")
            || p.contains("crunchyroll") || p.contains("plex") || p.contains("kodi")
            || p.contains("flix") || p.contains("cinema") || p.contains("movie")
            || p.contains("tvshow") || p.contains("sonyliv") || p.contains("zee5")
            || p.contains("jiotv") || p.contains("voot") || p.endsWith(".tv")
            || p.contains(".tv.") || p.startsWith("tv.");
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
        PKG_MAP.put("com.google.android.apps.youtube.kids", "ytlong");
        // tiktok
        PKG_MAP.put("com.zhiliaoapp.musically", "tiktok");
        PKG_MAP.put("com.zhiliaoapp.musically.go", "tiktok");
        PKG_MAP.put("com.ss.android.ugc.trill", "tiktok");
        // instagram
        PKG_MAP.put("com.instagram.android", "instagram");
        PKG_MAP.put("com.instagram.lite", "instagram");
        // v3.3: মোবাইল টিভি / সিনেমা (লং ভিডিও) — owner round-14
        PKG_MAP.put("com.netflix.mediaclient", "mobiletv");            // Netflix
        PKG_MAP.put("com.amazon.avod.thirdpartyclient", "mobiletv");   // Prime Video
        PKG_MAP.put("in.startv.hotstar", "mobiletv");                  // Hotstar
        PKG_MAP.put("in.startv.hotstar.dplus", "mobiletv");            // Disney+ Hotstar
        PKG_MAP.put("com.disney.disneyplus", "mobiletv");              // Disney+
        PKG_MAP.put("com.viewlift.hoichoi", "mobiletv");               // Hoichoi
        PKG_MAP.put("com.viki.android", "mobiletv");                   // Viki
        PKG_MAP.put("com.mxtech.videoplayer.ad", "mobiletv");          // MX Player
        PKG_MAP.put("com.mxtech.videoplayer.pro", "mobiletv");         // MX Player Pro
        PKG_MAP.put("com.viu.phone", "mobiletv");                      // Viu (নাটক/সিরিজ)
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

    /** v3.3: bucket of a package — PKG_MAP first, TV/movie keyword fallback
     *  second, null = not a video app (skip entirely). */
    private static String bucketOf(String pkg) {
        String b = PKG_MAP.get(pkg);
        if (b != null) return b;
        return isTvOrMovieApp(pkg) ? "mobiletv" : null;
    }

    @PluginMethod
    public void getVideoUsage(PluginCall call) {
        Context ctx = getContext();
        boolean granted = hasUsageAccess(ctx);
        JSObject res = new JSObject();
        res.put("granted", granted);

        long fb = 0, ytShorts = 0, ytLong = 0, tiktok = 0, ig = 0, mobiletv = 0, other = 0;
        long shortsCount = 0, shortsYt = 0, shortsFb = 0, shortsIg = 0, shortsTt = 0, shortsOther = 0;
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
                    String bucket = bucketOf(pkg);
                    if (bucket == null) continue;
                    int type = ev.getEventType();
                    if (type == UsageEvents.Event.ACTIVITY_RESUMED) {
                        String cls = ev.getClassName();
                        // v3.3: pure-shorts apps (TikTok/Likee/Snack) count on
                        // every resume; others need a shorts/reel activity class
                        boolean shorts = isShortsActivity(cls) || isPureShortsPkg(pkg);
                        // every resume of a shorts-style activity = one
                        // short video/reel opened — REAL count from OS events,
                        // no manual input, no estimation
                        if (shorts) {
                            shortsCount++;
                            if ("ytlong".equals(bucket)) shortsYt++;
                            else if ("facebook".equals(bucket)) shortsFb++;
                            else if ("instagram".equals(bucket)) shortsIg++;
                            else if ("tiktok".equals(bucket)) shortsTt++;
                            else shortsOther++; // other + mobiletv shorts-style
                        }
                        String sessionKey = pkg + "|" + (shorts ? "shorts" : "full");
                        open.put(sessionKey, ev.getTimeStamp());
                    } else if (type == UsageEvents.Event.ACTIVITY_PAUSED) {
                        String cls = ev.getClassName();
                        boolean shorts = isShortsActivity(cls) || isPureShortsPkg(pkg);
                        String sessionKey = pkg + "|" + (shorts ? "shorts" : "full");
                        Long began = open.remove(sessionKey);
                        if (began != null) {
                            long mins = Math.max(0, (ev.getTimeStamp() - began) / 60000L);
                            long[] acc = bucket(fb, ytShorts, ytLong, tiktok, ig, mobiletv, other, bucket, mins, shorts);
                            fb = acc[0]; ytShorts = acc[1]; ytLong = acc[2]; tiktok = acc[3]; ig = acc[4]; mobiletv = acc[5]; other = acc[6];
                        }
                    }
                }
                // apps still open → close at "now"
                for (Map.Entry<String, Long> e : open.entrySet()) {
                    long mins = Math.max(0, (end - e.getValue()) / 60000L);
                    boolean shortSession = e.getKey().endsWith("|shorts");
                    String pkg = e.getKey().substring(0, e.getKey().indexOf('|'));
                    long[] acc = bucket(fb, ytShorts, ytLong, tiktok, ig, mobiletv, other, bucketOf(pkg), mins, shortSession);
                    fb = acc[0]; ytShorts = acc[1]; ytLong = acc[2]; tiktok = acc[3]; ig = acc[4]; mobiletv = acc[5]; other = acc[6];
                }
            }
        }

        res.put("facebook", fb);
        res.put("ytshorts", ytShorts);
        res.put("ytlong", ytLong);
        res.put("tiktok", tiktok);
        res.put("instagram", ig);
        res.put("mobiletv", mobiletv);
        res.put("other", other);
        res.put("shortsCount", shortsCount);
        res.put("shortsYt", shortsYt);
        res.put("shortsFb", shortsFb);
        res.put("shortsIg", shortsIg);
        res.put("shortsTt", shortsTt);
        res.put("shortsOther", shortsOther);
        call.resolve(res);
    }

    /** acc = {facebook, ytShorts, ytLong, tiktok, instagram, mobiletv, other} */
    private long[] bucket(long fb, long ytShorts, long ytLong, long tt, long ig, long mtv, long other, String bucket, long mins, boolean shorts) {
        if (bucket == null) return new long[]{fb, ytShorts, ytLong, tt, ig, mtv, other};
        switch (bucket) {
            case "facebook":  return new long[]{fb + mins, ytShorts, ytLong, tt, ig, mtv, other};
            case "ytlong":
                // v2.3: YouTube Shorts live inside the same package — activities
                // with "shorts/reel/snack" in the class name go to the shorts bucket
                if (shorts) return new long[]{fb, ytShorts + mins, ytLong, tt, ig, mtv, other};
                return new long[]{fb, ytShorts, ytLong + mins, tt, ig, mtv, other};
            case "tiktok":    return new long[]{fb, ytShorts, ytLong, tt + mins, ig, mtv, other};
            case "instagram": return new long[]{fb, ytShorts, ytLong, tt, ig + mins, mtv, other};
            case "mobiletv":  return new long[]{fb, ytShorts, ytLong, tt, ig, mtv + mins, other};
            default:          return new long[]{fb, ytShorts, ytLong, tt, ig, mtv, other + mins};
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

    /**
     * v2.9: today's SHORTS/REELS minutes so far — public static so the
     * background OhKeepAliveService can enforce the daily Reels limit EVEN
     * WHILE THE APP IS CLOSED (owner: "রিলস দেখা বন্ধ করো — চোখের ক্ষতি
     * হবে" warning must arrive while the user is doom-scrolling).
     *
     * v3.3 FIX: pure-shorts apps (TikTok/Likee/Snack) previously slipped
     * through — their activity classes don't contain "shorts"/"reel", so
     * TikTok scrolling NEVER fired the background limit warning. Now the
     * whole session of a pure-shorts app counts as shorts minutes.
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
                if (bucketOf(pkg) == null) continue;
                int type = ev.getEventType();
                if (type == UsageEvents.Event.ACTIVITY_RESUMED) {
                    boolean shorts = isShortsActivity(ev.getClassName()) || isPureShortsPkg(pkg);
                    open.put(pkg + "|" + (shorts ? "shorts" : "full"), ev.getTimeStamp());
                } else if (type == UsageEvents.Event.ACTIVITY_PAUSED) {
                    boolean shorts = isShortsActivity(ev.getClassName()) || isPureShortsPkg(pkg);
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
