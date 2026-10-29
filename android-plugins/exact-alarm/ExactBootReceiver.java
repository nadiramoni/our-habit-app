package com.ourhabit.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * ExactBootReceiver — v2.8: after a phone REBOOT, Android wipes every
 * scheduled alarm. This receiver re-arms the whole exact-alarm schedule
 * (azan / Fajr / meals / sleep) from the last persisted schedule — so the
 * azan still rings at the exact time even if the user never opens the app
 * after restarting the phone.
 */
public class ExactBootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    try {
      if (intent == null) return;
      String action = intent.getAction();
      if (action == null) return;
      if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
          && !"android.intent.action.QUICKBOOT_POWERON".equals(action)
          && !"com.htc.intent.action.QUICKBOOT_POWERON".equals(action)) {
        return;
      }
      ExactAlarmPlugin.rearmInternal(context);
      // v2.9: restart the chat-notification / reels-guard service too (it was
      // running before the reboot → bring it back so chat notifications keep
      // arriving like Messenger without opening the app)
      try {
        android.content.SharedPreferences sp =
            context.getSharedPreferences(OhKeepAliveService.PREFS, android.content.Context.MODE_PRIVATE);
        if (sp.getBoolean(OhKeepAliveService.KEY_ON, false)) {
          OhKeepAliveService.start(context);
        }
      } catch (Exception ignored) {
      }
    } catch (Exception ignored) {
    }
  }
}
