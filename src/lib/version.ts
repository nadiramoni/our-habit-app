// App version — bump this when you ship an update.
// The admin panel's "latest version" is compared against this to trigger auto-update.
// v2.8.0 — owner round-10 (4 screenshots + voice): (1) ADS ON EVERY PAGE —
//           Home 3 + Stats/Notes/Friends/Settings 2 each + every detail page
//           1 bottom banner (owner: "প্রত্যেকটা পেজে যেখানে যেখানে অ্যাড
//           বসানো যায়"); (2) USAGE ACCESS ROOT-CAUSE FIX — the manifest
//           requested a WRONG permission string (android.app.usage.… instead
//           of android.permission.PACKAGE_USAGE_STATS) so Our Habit never
//           appeared in the Android Usage Access list at all — fixed in
//           prepare-apk + committed manifest; (3) WORLDWIDE AUTO TIMEZONE —
//           GPS → IP-geolocation fallback, re-detects on timezone change
//           (travel), Settings shows location + timezone card with refresh;
//           (4) AZAN AT THE EXACT TIME + FULL-SCREEN — new native
//           ExactAlarmPlugin: AlarmManager.setAlarmClock (OEMs never defer
//           it) + full-screen-intent notification (screen off/locked → the
//           app LAUNCHES into the WeMuslim-style azan view: mosque dome sky,
//           glass clock, live next-prayer countdown) + ExactBootReceiver
//           re-arms after reboot + 5 bundled azan recitations with an
//           in-app picker (▶ 8s preview) — the chosen azan plays in the
//           native alarm channel AND the overlay; (5) REGISTERED NAME — the
//           first+last name from registration is now the single source of
//           truth everywhere (header, profile, shared notes, share footer);
//           the Gmail display name can NEVER overwrite it; one-time name
//           capture after Google sign-in + ✏️ name editor in Settings;
//           (6) HOME LAYOUT — compact month calendar (small rings, no
//           per-day weekday label) + every habit is now ONE thin long row
//           in the owner's order: নামাজ → পানি → ঘুম → বাকিগুলো
// v2.7.0 — owner's video round 9: BANNER ENGINE v3 — LEARNED rotation (each zone keeps
//           a per-device fail score in localStorage; dead zones sink to the
//           end of the ladder automatically, live zones win every slot), ONE
//           owner zone UPGRADE paste (admin → cfg.at.bannerUpgrade → leads
//           every ladder = uses the dashboard's ACTIVE zones), urgent Social
//           Bar restore card in the admin panel (the proven-fill code was
//           wiped by the old save bug; one GET CODE paste brings it back on
//           every device), stale "v1.0" About text fixed
// v2.6.0 — owner's real-device round 8: BANNERS THAT ACTUALLY SHOW — 3 real
//           Adsterra zones baked into the app (no manual config, admin paste
//           rows closed), rendered in normal same-origin iframes (/ad.html)
//           instead of sandboxed srcdoc (the sandbox's opaque origin blocked
//           cookies/creatives = invisible banners), auto-rotation when a zone
//           has no fill; MEAL ALARMS + every alarm: OS-verified scheduling
//           (getPending read-back + status bar "Nটি সক্রিয় · পরবর্তী HH:MM"),
//           permission gate + red warning when notifications are off,
//           AUDIBLE toggle confirmation (loud jingle + REAL Android
//           notification sound + next-ring time in the popup), in-app alarm
//           music now plays the OWNER'S OWN FILES (meals = random of the 2
//           tracks, azan = real adhan recording), alarms re-sync on every app
//           resume; banners removed from Stats (exactly 3 places on Home)
// v2.5.0 — owner's real-device round 7: FULL MONTH calendar (tap any date →
//           that day's done/not-done record, "no record" days marked),
//           নতুন হ্যাবিট (user-created habits, one-tap done), mosque-style
//           daily card, meal alarms with RANDOM 2-track music, alarm-ON
//           success SOUND, adhan reminders AUTO-SET from location prayer
//           times, daily app-open nudges (10:00/16:00), exact-alarm
//           permission (USE_EXACT_ALARM) — the REAL Fajr fix, notification
//           card removed from Alarm & Reminder, admin save-wipe guard +
//           banner-zone activation guide
// v2.4.0 — owner's real-device round 6: WATER ALARM with interval + Done/Snooze
//           buttons, Our Habit daily reminder, alarm-ON confirmation popup,
//           RECURRING alarm fix (Fajr now rings EVERY DAY — root cause fixed),
//           first-open location → auto prayer times, azan mosque full-screen
//           view, mood options removed, water glasses tracking, Reels/Shorts
//           100% auto (real shorts count, no manual input), beautiful note
//           share (Title→Body) + native share sheet, banner direct-inject
//           fallback + admin banner health, NEW app icon + splash (the
//           default Capacitor icon is gone for good), 15-min meal pre-alerts
// v2.3.0 — owner's real-device round 5: meal alarm clock sound + water music
//           loop, vibrating alarm channels, back button never exits the app,
//           admin panel works INSIDE the APK (Firestore PIN + save), prayer
//           water glasses on home, tasbih = vibration, meditation/focus custom
//           minutes + start sound, sleep tracker + bedtime alert, points moved
//           to Settings profile (full name), YouTube Shorts vs Long split
// v2.2.1 — REAL Adsterra banners + REAL adhan recording wired end-to-end
export const APP_VERSION = "2.8.0";
