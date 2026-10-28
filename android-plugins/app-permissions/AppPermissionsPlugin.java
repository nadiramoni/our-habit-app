package com.ourhabit.app;

import android.Manifest;
import android.app.AppOpsManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * AppPermissions — the native half of the v2.0 permission setup flow.
 * Lets the web app fire the REAL Android system dialogs and read the live
 * status of each special permission, exactly like mainstream apps do:
 *
 *   status()                        → { notifications, battery, usageAccess, sdk }
 *   requestNotifications()          → POST_NOTIFICATIONS runtime dialog (13+)
 *   requestBatteryExemption()       → "Allow ignoring battery optimizations?" dialog
 *   openBatteryOptimizationList()   → full list fallback
 *   openUsageAccessSettings()       → Usage Access list (Reels auto-tracking)
 *   openNotificationSettings()      → this app's system notification page
 *   openAppInfo()                   → this app's App Info page
 *   openUrl(url)                    → ACTION_VIEW (download new APK etc.)
 */
@CapacitorPlugin(name = "AppPermissions", permissions = {
    @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
})
public class AppPermissionsPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("notifications", notificationsEnabled(ctx) ? "granted" : "denied");
        r.put("battery", batteryIgnored(ctx) ? "granted" : "denied");
        r.put("usageAccess", usageAccessGranted(ctx) ? "granted" : "denied");
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    /** Real Android 13+ notification permission dialog (idempotent on older). */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 33 && !notificationsEnabled(ctx)) {
            requestPermissionForAlias("notifications", call, "notifCallback");
        } else {
            JSObject r = new JSObject();
            r.put("granted", notificationsEnabled(ctx));
            call.resolve(r);
        }
    }

    @PermissionCallback
    private void notifCallback(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", notificationsEnabled(getContext()));
        call.resolve(r);
    }

    /**
     * The REAL system dialog "Allow Our Habit to always run in the background?" —
     * (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS). Falls back to the full
     * battery-optimization list on devices that block the direct dialog.
     */
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        try {
            Intent i = new Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivityForResult(call, i, "batteryCallback");
        } catch (Exception direct) {
            try {
                Intent list = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                list.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(list);
                JSObject r = new JSObject();
                r.put("granted", batteryIgnored(getContext()));
                r.put("viaList", true);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("battery_settings_failed", e);
            }
        }
    }

    @ActivityCallback
    private void batteryCallback(PluginCall call, Intent data, int resultCode) {
        JSObject r = new JSObject();
        r.put("granted", batteryIgnored(getContext()));
        r.put("viaList", false);
        call.resolve(r);
    }

    @PluginMethod
    public void openBatteryOptimizationList(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("battery_settings_failed", e);
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
            call.reject("usage_settings_failed", e);
        }
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        try {
            Intent i;
            if (Build.VERSION.SDK_INT >= 26) {
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else {
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                i.setData(Uri.parse("package:" + getContext().getPackageName()));
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("notif_settings_failed", e);
        }
    }

    @PluginMethod
    public void openAppInfo(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            i.setData(Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("app_info_failed", e);
        }
    }

    /** Open any https URL outside the app (download link, update APK, etc.). */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            call.reject("bad_url");
            return;
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("open_failed", e);
        }
    }

    // ---------- helpers ----------

    private boolean notificationsEnabled(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.areNotificationsEnabled();
    }

    private boolean batteryIgnored(Context ctx) {
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
    }

    private boolean usageAccessGranted(Context ctx) {
        AppOpsManager ops = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
        if (ops == null) return false;
        int mode = ops.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), ctx.getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }
}
