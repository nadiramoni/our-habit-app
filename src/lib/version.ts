// App version — bump this when you ship an update.
// The admin panel's "latest version" is compared against this to trigger auto-update.
// v5.2.0 (owner round-22 — ভাষা ডিফল্ট বাংলা + অ্যাডমিন ৩-বক্স + ইংলিশ নামেই ডাক):
//           (1) ভাষার ম্যানুয়াল পিকার ফিরে এসেছে (Settings → থিম ও ভাষা) —
//           owner: "আগে কিন্তু বাংলা ইংলিশ দুটাই ভাষা ছিল… বাট ডিফল্ট হিসেবে
//           বাংলাটাই থাকবে"। সবার জন্য ডিফল্ট 🇧🇩 বাংলা; যারা চায় তারা 🇬🇧
//           English সিলেক্ট করবে (langPicked)। ফোনের ভাষা আর কিছু ঠিক করে
//           না — v5.0-এর device-follow ব্যবস্থাটা বাদ।
//           (2) অ্যাডমিন প্যানেলের স্ট্যাটাস ট্যাবে রিফ্রেশ বাটনের নিচে ৩টা
//           ছোট বক্স — 🔵 গুগল (গুগল দিয়ে অ্যাকাউন্ট) / ✉️ ইমেইল (ম্যানুয়ালি
//           মেইল দিয়ে) / ❓ আননোন (ইমেইল ফাঁকা)। বক্সে চাপ দিলে শুধু ওই দলের
//           অ্যাকাউন্ট দেখায়, আবার চাপ দিলে সবাই। Owner: "এর নিচে তিনটা
//           লেআউট বানাবা ছোট ছোট বক্সের মধ্যে।"
//           (3) অ্যালার্মের ডাক — নাম বলবে যেভাবে লেখা আছে (ইংলিশ নামই),
//           আর পাশের কথাগুলা (পানি/ঘুম/খাওয়া/সুস্থ থাকো) আগের মতোই বাংলায়।
//           Owner: "নামও বলবে — তোমার যে ইংলিশ নামটা ঐটা বলবে… ঐটা টোটালি
//           বাংলাতে বলবে"। বাংলা-বানান (nameBn) আর অটো-ট্রান্সলিটারেশন বাদ —
//           সাইন-আপ ফর্মের বাংলা-বানান ঘরটাও গেছে।
// v5.1.0 (owner round-21 — admin panel এখন পুরোটা অ্যাপের ভেতরে):
//           GitHub Pages-এর আলাদা স্ট্যাটাস প্যানেল সম্পূর্ণ বাদ — owner:
//           “আলাদাভাবে করার প্রয়োজন নাই, অ্যাপসেই সব সিস্টেম দিয়ে দাও”।
//           (1) হোম-স্ক্রিনের উপরের নাম/অ্যাভাটার ৩ সেকেন্ড চেপে ধরলেই অ্যাডমিন
//           প্যানেল খোলে → PIN → অ্যাডমিন যাচাই → আলাদা ফুল-স্ক্রিন লেয়াউট।
//           (2) প্যানেলের ভেতরে দুই ট্যাব: 📊 স্ট্যাটাস (সব ইউজারের নাম/অ্যাকাউন্ট/
//           অনলাইন ডট/বন্ধু/আজকের ভিডিও/আজকের কাজ — আগের GitHub-Pages প্যানেলের
//           সফলা, এখন অ্যাপেই) + ⚙️ সেটিংস (বিজ্ঞাপন + Firebase + অ্যাপ আপডেট +
//           PIN বদল — আগের সবকিছু)।
//           (3) ডেটা সোর্স: নিজের Firebase-ই (usersIndex + backups) — কোনো
//           সার্ভার বা admin-sdk-key লাগে না, তাই APK-তে যেকোনো ফোন থেকেই চলে।
//           ৩০ সেকেন্ড পরপর নিজে নিজে রিফ্রেশ হয়।
//           (4) সব GitHub-Pages ফাইল (admin-panel.html, admin-panel.zip, গাইড)
//           আর /api/admin/status সার্ভার রুট মুছে দেওয়া হয়েছে।
// v5.0 (owner round-19 — the full-round release):
//           (1) MESSAGE DELETE, TWO MODES — hold a bubble → একটা শিট:
//           “আমার কাছ থেকে” (hiddenBy me — বন্ধুর ফোনে মেসেজটা থেকে যায়)
//           আর “উভয় পক্ষ থেকে” (শুধু নিজের পাঠানো মেসেজে — দুই ফোন থেকেই
//           মুছে যায়)। অন্যের পাঠানো মেসেজে শুধু নিজের কাছ থেকেই ডিলিট
//           করা যায়। পুরো চ্যাট মুছলেও একই নিয়ম কাজ করে।
//           (2) CLOSED-APP NOTIFICATIONS FIXED + DEEP LINK — the background
//           listener no longer swallows messages older than 2 min (the
//           offline-arrival case); per-pair last-seen baselines are shared
//           with the main app through localStorage. Tapping a notification
//           now opens that EXACT chat (PendingIntent extras → MainActivity →
//           pendingOpenChat → oh:open-chat). The watchdog also defers to
//           the service whenever it is alive — no more double notifications.
//           (3) PRESENCE — green/red dots on Friends + chat headers. A 45s
//           heartbeat (app open OR the headless service while closed) writes
//           usersIndex.lastSeen; the dot goes red ≤2 min after the real
//           connection dies — internet-on alone never shows online.
//           (4) VIDEO TIME — the owner's own app list with separate buckets
//           (X, Kuku TV, Moj, Chorki, Hoichoi, Bongo, Bioscope, Toffee),
//           PRECISE per-app seconds + the “৪৫ সেকেন্ড / ৫ মিনিট / ১ ঘণ্টা
//           ১০ মিনিট” format + a real countdown (used/left/over-limit),
//           honestly labeled আনুমানিক (Android cannot detect each playback).
//           (5) BANGLA 12-HOUR CLOCKS — রাত ১২:৩০, সকাল ১:৩০ (মধ্যরাতের পর
//           সকাল!), দুপুর ১২:৩০, বিকাল ৪:৩০ — Bengali digits everywhere a
//           time is shown; English devices get AM/PM; every country keeps
//           its own local time.
//           (6) MAGHRIB +3 — মাগরিবের নামাজের ডাক আজানের ~৩ মিনিট পরে;
//           বাকি সব নামাজ ~১৫ মিনিট পরে। Plus the owner's exact Bengali
//           sentences for পানি/খাবার/ঘুম/রিলস/নামাজ।
//           (7) LANGUAGE FOLLOWS THE DEVICE — the manual picker is GONE;
//           bn* → বাংলা, else English. New installs' voice language starts
//           on the device language too.
//           (8) ADMIN — the GitHub-Pages panel is back as a READ-ONLY status
//           panel (pin 72542, no email login, /api/admin/status); the FULL
//           panel (in-app) now does SERVER-LEVEL admin verification after
//           the PIN (app/meta.adminUid claim + inline admin sign-in — works
//           from any phone, exactly like the owner asked).
// v4.3.0 — owner round-18: TWO chat powers (everything else untouched):
//           (1) MESSAGE DELETE — press-and-HOLD any chat bubble (or
//           right-click on a computer) → confirm → the message disappears
//           from BOTH phones in real time (owner: "এতগুলো মেসেজ আছে — চাইলে
//           ডিলিট করতে পারো")। The header 🗑️ button wipes the WHOLE
//           conversation in one tap (shared notes in the same Firestore
//           collection are never touched).
//           (2) MESSENGER-STYLE HEADS-UP POPUP — when a message arrives while
//           the app is open, a banner slides down from the top with the
//           sender's name + message preview + a short "টুট" pop sound +
//           vibration (owner: "মেসেঞ্জারে দেখো না টুট করে একটা পপ আপ এসে
//           মেসেজটা সিন হয়")। Tap it → straight into the chat. App closed →
//           the background service still fires the system notification.
// v4.2.0 — owner round-17 (the "totally fix it" release):
//           (1) THE BANGLA VOICE CALL IS THE DEFAULT AGAIN — the ORIGINAL
//           system (owner: "আগের সিস্টেম — ঐরকম নাম ধরে ডাকবে কিন্তু কথাটা
//           বলবে বাংলায়। ম্যানুয়ালে সিলেক্ট না থাকলেও বাংলায়ই বলবে")। No
//           settings needed; the no-bn-TTS-voice → English fallback stays, so
//           the call is never silent. English remains an option in Settings.
//           (2) EVERY REMINDER NOW SPEAKS — namaz (NEW: ~15 min AFTER each
//           azan, never long after it: "নামাজ পড়ার সময় হয়েছে, নামাজে যান"),
//           water (the old FULL sentence), sleep ("ঘুমাও + সময়মতো উঠো —
//           বেশি ঘুমালে শরীরের ক্ষতি"), daily habits ("রিমাইন্ডার চালু হয়েছে,
//           কাজ কমপ্লিট করো, জিকির করে নাও"), reels ("চোখ + শরীর ক্ষতি").
//           Azan time still plays ONLY the azan (never a voice call).
//           (3) THE UPDATE-SAVE ROOT-CAUSE FIX — the in-app admin panel's Save
//           was silently permission-denied under the v4.0 Firestore rules (it
//           never claimed adminUid), which is exactly why the owner saw
//           "সমস্যা হয়েছে — আবার চেষ্টা করো" and why NO user ever received
//           the update. The panel now writes the adminUid claim with the cfg
//           and shows a precise, actionable Bengali error for every failure.
// v4.1.0 — owner round-16: English default call + build numbers + manual-only
//           builds (superseded by v4.2's Bangla default; the rest stays).
//           (1) THE ENGLISH VOICE CALL IS BACK AS THE DEFAULT — the phone
//           calls the English name in English ("Sakib, it's your time to
//           drink water…") exactly like before, works on EVERY phone with
//           zero setup. The Bangla call (v4.0) stays as an OPTION in Settings
//           → প্রোফাইল → ডাকটা কোন ভাষায় হবে? — and when the phone has no
//           Bangla TTS voice installed the app AUTO-FALLS BACK to English so
//           the call is never silent (owner: "অনেকে বাংলা ভয়েসের সেটিং
//           করতে পারবে না — আগের ইংলিশটা থাকবে").
//           (2) EVERY BUILD NOW CARRIES A BUILD NUMBER — the CI stamps
//           APP_BUILD below with the workflow run number. It shows up in the
//           APK FILE NAME (OurHabit-v4.1.0-b27.apk), the release title
//           ("Our Habit v4.1.0 · Build 27") and Settings → About — so no one
//           can ever confuse two APKs again, even when the MB size looks
//           similar.
//           (3) MANUAL-ONLY BUILDS — the workflow no longer auto-builds on
//           every upload; the owner clicks "Run workflow" when they want a
//           new APK (owner: "আমি নিজে থেকে ম্যানুয়ালি বিল্ড করব — ওইটাই
//           সবথেকে বেস্ট").
//           (4) FIXED a v4.0 crash: the reels warning used
//           banglaNameFromEnglish without importing it (the build had
//           ignoreBuildErrors on, so it slipped through).
// v4.0.0 — owner round-15 (the "one-shot total fix" release):
//           (1) THE NAME CALL IS NOW FULLY BANGLA — the name STAYS English in
//           every display, but the voice says it with BANGLADESHI
//           pronunciation: the English spelling is auto-transliterated to
//           Bangla script for the SPOKEN sentence only (Nadiramoni →
//           "নাদিরামনি", তোমার পানি খাওয়ার সময় হয়েছে…). No more foreign
//           English pronunciation of Bangladeshi names.
//           (2) VOICE GENDER — a new Settings → প্রোফাইল picker (মেয়ে কণ্ঠ /
//           ছেলে কণ্ঠ): female names get a female voice, male names a male
//           voice (engine voice pick + pitch shift, best-effort).
//           (3) THE "Our Habit" STATUS-BAR NOTIFICATION IS GONE COMPLETELY —
//           OhKeepAliveService no longer calls startForeground at all (zero
//           notifications, inside or outside the app); it keeps listening
//           headless and is muted while the app is in the foreground.
//           (4) CHAT "Firestore অনুমতি নেই" ROOT CAUSE — the old rules only
//           matched pairs/{pairKey} documents, NOT the pairs/{key}/notes
//           SUBCOLLECTION the chat writes to; v4 rules use {x=**} recursive
//           wildcards (pairs + backups day reads) — chat sends + friend
//           day-status now work.
//           (5) NOTES SHARE TAB REMOVED (v3.3) — personal notes only; the
//           messenger chat in the Friends tab is the only sharing channel.
//           (6) ADMIN — updates are controlled ONLY from the in-app panel
//           (long-press + PIN); the separate GitHub-Pages panel is retired
//           (owner: "আমি কাউকে কন্ট্রোল করার দরকার নাই").
// v3.3.0 — silent keep-alive + bn-BD TTS locale groundwork + listener fixes.
// v3.2.0 — owner round-13 (2 requests in one): (1) APK BUILD FIXED — the two
//           Java compile errors (duplicate throttleMs in ExactAlarmPlugin,
//           wrong android.s.tts package in AlarmSpeakService) that broke the
//           GitHub Actions build are gone — CI builds the APK again;
//           (2) CLOUD ADMIN PANEL (NO PC!) — the GitHub-Pages panel now talks
//           STRAIGHT to Firestore: login with your own email+password (first
//           login claims admin with the PIN), see every account + 14-day
//           reports, BAN/UNBAN via usersIndex.banned (the app checks it on
//           boot + every 5 min + on resume), reset-password mails, ads +
//           auto-update control — all from the phone, no server, forever.
//           Provider (Google/Email) now recorded in usersIndex on every login.
// v3.0.0 — owner round-12 (4 requests in one): (1) GOOGLE LOGIN HARDENED —
//           web now falls back popup → FULL-PAGE redirect automatically
//           (survives every mobile browser), unauthorized-domain is caught
//           and shown as a CLEAR Bengali step-by-step fix (Firebase Console →
//           Authentication → Authorized domains — the #1 cause of "Google
//           লগইনে সমস্যা" on the preview website); APK keeps the native account
//           picker (needs the one-time SHA-1 registration); (2) NAME FIX —
//           the greeting now uses the REGISTERED full name first
//           (settings.name BEFORE account.name — the Gmail display name can
//           never win); signup first+last, per-account names (v2.9) and the
//           ✏️ নাম বদলাও editor all flow into greeting + TTS + chat + share;
//           (3) FORGOT PASSWORD — "পাসওয়ার্ড ভুলে গেছো?" on the login card →
//           Firebase emails a secure reset link → user clicks it and sets a
//           new password (works for every email account, zero setup);
//           (4) ADMIN CONTROL ROOM — localhost/admin website + Firebase
//           Admin SDK: see EVERY account (who used Google, who used email),
//           each user's REAL 14-day status (নামাজ/পানি/রিলস/যিকির/ঘুম/
//           স্ট্রিক), change anyone's password, send reset mails, BAN /
//           UNBAN / DELETE accounts, and control ALL ads (Adsterra 6 zones +
//           AdMob + auto-update) — saves go live to every install in ≤5 min.
//           Needs one-time admin-sdk-key.json (guide: ADMIN-GUIDE-bn.md).
//           Banned users see "অ্যাকাউন্ট ব্যান করা হয়েছে" on sign-in.
// v2.9.0 — owner round-11: login white-screen root cause + per-account names + named TTS alerts + messenger chat + reels guard
// v2.8.0 — owner round-10: ads everywhere + usage-access root cause + worldwide tz + EXACT azan + registered name + thin home rows
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
export const APP_VERSION = "5.2.0";

// v4.1: BUILD NUMBER — 0 in the repo; GitHub CI overwrites it with the
// workflow run number (27, 28, 29…) before every APK build. It lands in the
// APK file name, the release title, Android's versionName and Settings →
// About, so every build is uniquely identifiable even when the size is same.
export const APP_BUILD = 0;
