package com.ourhabit.app;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * ChatServicePlugin — v2.9: JS bridge to OhKeepAliveService (the background
 * chat-notification + Reels-guard foreground service).
 *
 * JS bridge (window.Capacitor.Plugins.ChatService):
 *   start()                    → keep-alive service ON (chat + reels guard)
 *   stop()                     → service OFF (signed out / user toggle off)
 *   setMuted({muted})          → mute chat notifications while the app is
 *                                in the FOREGROUND (no double notifications)
 *   setReelsLimit({limitMin, warnText, lang}) → the daily Reels limit the
 *                                background guard enforces + the spoken warning
 *   status() → {running}
 */
@CapacitorPlugin(name = "ChatService")
public class ChatServicePlugin extends Plugin {

  @PluginMethod
  public void start(PluginCall call) {
    try {
      Context ctx = getContext() != null ? getContext() : getActivity();
      if (ctx == null) {
        call.reject("no_context");
        return;
      }
      OhKeepAliveService.start(ctx);
      JSObject r = new JSObject();
      r.put("running", true);
      call.resolve(r);
    } catch (Exception e) {
      call.reject("start_failed", e.getMessage());
    }
  }

  @PluginMethod
  public void stop(PluginCall call) {
    try {
      Context ctx = getContext() != null ? getContext() : getActivity();
      if (ctx != null) OhKeepAliveService.stop(ctx);
      call.resolve();
    } catch (Exception e) {
      call.resolve();
    }
  }

  @PluginMethod
  public void setMuted(PluginCall call) {
    try {
      Context ctx = getContext() != null ? getContext() : getActivity();
      Boolean muted = call.getBoolean("muted", Boolean.TRUE);
      if (ctx != null) {
        ctx.getSharedPreferences(OhKeepAliveService.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(OhKeepAliveService.KEY_MUTED, Boolean.TRUE.equals(muted))
            .apply();
      }
      call.resolve();
    } catch (Exception e) {
      call.resolve();
    }
  }

  @PluginMethod
  public void setReelsLimit(PluginCall call) {
    try {
      Context ctx = getContext() != null ? getContext() : getActivity();
      if (ctx != null) {
        long limit = readLong(call, "limitMin", 0L);
        String warn = call.getString("warnText", "");
        String warnEn = call.getString("warnTextEn", "");
        String lang = call.getString("lang", "en");
        ctx.getSharedPreferences(OhKeepAliveService.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong(OhKeepAliveService.KEY_REELS_LIMIT, limit)
            .putString(OhKeepAliveService.KEY_REELS_WARN, warn == null ? "" : warn)
            .putString(OhKeepAliveService.KEY_REELS_WARN_EN, warnEn == null ? "" : warnEn)
            .putString(OhKeepAliveService.KEY_REELS_LANG, lang == null ? "en" : lang)
            .apply();
      }
      call.resolve();
    } catch (Exception e) {
      call.resolve();
    }
  }

  /** JS numbers arrive as Integer/Long/Double depending on size — read any of them. */
  private static long readLong(PluginCall call, String name, long def) {
    try {
      Object v = call.getData().opt(name);
      if (v instanceof Number) return ((Number) v).longValue();
    } catch (Exception ignored) {
    }
    return def;
  }

  @PluginMethod
  public void status(PluginCall call) {
    try {
      Context ctx = getContext() != null ? getContext() : getActivity();
      boolean on = false;
      if (ctx != null) {
        on = ctx.getSharedPreferences(OhKeepAliveService.PREFS, Context.MODE_PRIVATE)
            .getBoolean(OhKeepAliveService.KEY_ON, false);
      }
      JSObject r = new JSObject();
      r.put("running", on);
      call.resolve(r);
    } catch (Exception e) {
      call.reject("status_failed", e.getMessage());
    }
  }
}
