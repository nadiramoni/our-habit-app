// App version — bump this when you ship an update.
// The admin panel's "latest version" is compared against this to trigger auto-update.
// v5.3.0 — owner round ("এই দুইটা ফিক্স করে দাও, বাকি সব ঠিক আছে"):
//           (1) REAL MESSAGE PUSH NOTIFICATIONS — when I message a friend,
//           THEIR phone now gets a true FCM push notification with my name
//           + the message text, EVEN WITH THE APP CLOSED (the v5.1 keep-alive
//           service was being killed by Bangladeshi ROMs — Walton/Symphony/
//           Xiaomi — so nothing ever arrived; FCM is Google's own wake
//           channel, like Messenger). Tapping it opens straight into that
//           chat to reply. Added @capacitor/push-notifications + this
//           device's token saved to usersIndex/{uid}.fcmToken + the sender
//           pushes the partner's phone directly (legacy FCM API, key set by
//           the owner in the panel — no server, no monthly cost).
//           (2) INSTANT UPDATE BROADCAST — new 📢 card in the admin panel:
//           one tap sends "নতুন আপডেট চলে আসছে — অ্যাপটি আপডেট করে নতুন
//           ফিচারগুলো উপভোগ করুন" to EVERY registered phone at once
//           (multicast), and saving a newer latestVersion auto-broadcasts
//           too. The old background-listener path stays as a fallback when
//           the key is not configured (no gap, no double notifications —
//           chat-listener.html stands down via the oh_chat_state.fcm flag).
//           (3) VERSION FIX — the admin panel's version field placeholder
//           said "যেমন 1.1.0" which read like the app was on v1.1; every
//           version surface (here, package.json, APK versionName) is now
//           consistently 5.3.0. Also fixed: the background service never
//           started for email-unverified accounts (the last acc.verified
//           gate — friend-notification root cause #4).
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
// v5.1.0 — owner final round ("এই দুইটা ফিক্স করে দাও, বাকি সব ঠিক আছে"):
//           (1) REAL MESSAGE NOTIFICATIONS — when I message a friend, THEIR
//           phone shows a real system notification with my message (app
//           closed included), tapping it opens OUR chat so they can reply.
//           Root causes fixed: Android 13+ POST_NOTIFICATIONS was silently
//           swallowed (now checked + logged + fixable from the panel), the
//           emailVerified gate kept whole accounts from ever starting the
//           background service, and the foreground-mute flag could stick.
//           The notification tap now routes STRAIGHT into that chat
//           (oh_open_chat handoff through shared localStorage).
//           (2) INSTANT UPDATE NOTIFICATIONS — the moment the owner bumps
//           latestVersion in the panel, every connected phone gets
//           "নতুন আপডেট চলে আসছে — অ্যাপটি আপডেট করে নতুন ফিচারগুলো
//           উপভোগ করুন" — now via a realtime onSnapshot on app/meta (was a
//           5-min poll), so it lands in seconds, even with apps closed.
//           (3) ADMIN PANEL: system status (service/listener/permission/
//           battery + test notification), Refresh Now, and the 3 account
//           boxes the owner asked for: ইমেইল (Google), মেইল (manual email),
//           আনকনাউন (no email) — tap a box to view its accounts.
//           (4) LANGUAGE: default বাংলা everywhere (one-time reset for
//           devices stuck on English), bn/en choice in Settings, no more
//           side-by-side English — English speakers opt in themselves.
//           (5) REMINDERS fully বাংলা: every spoken (TTS) reminder is locked
//           to the Bengali text + bn voice regardless of the UI language;
//           the name is always read as-is. Maghrib rings 3 minutes after
//           the azan time (owner's 2-3-minute special case).
//           Also: message deletion rules (own = delete for everyone,
//           friend's = hide from me only via hiddenBy), real online status
//           (🟢/🔴 presence via lastAt heartbeat), 12-hour AM/PM clocks
//           (Bangladesh format) on every time display, and the GitHub Pages
//           panel + /admin website are GONE — the in-app panel (long-press
//           3s → PIN) is now the ONLY admin world.
// v5.4.0 — owner round-15 (2026-10-31): (1) FRIENDS REMOVE WIPE BUG FIXED —
//           removing ONE friend erased EVERY friend (the panel passed a stub
//           profile with an empty friends[] and removeFriend wrote it back);
//           both sides are now re-read FRESH from Firestore and exactly ONE
//           uid is removed (addFriendByCode got the same hardening);
//           (2) ADMIN PANEL: the 📊 স্ট্যাটাস / ⚙️ সেটিংস two-tab layout is
//           BACK (it was lost in an earlier file paste) — stat tiles (মোট/
//           গুগল/ইমেইল/ব্যান/আজ সক্রিয়/এখন অনলাইন), the 3 account boxes and
//           EVERY user's 🔑 INVITE CODE next to their name (tap = copy), plus
//           per-user আজকের ভিডিও + নামাজ/পানি/যিকির/স্ট্রিক/পয়েন্ট ticks read
//           from backups in ONE query (fbListUserDays); settings tab keeps
//           ALL the extra cards (sys diag, ads, firebase, push, update, PIN);
//           (3) UPDATE PUSH GOES OUT WITH EACH USER'S OWN NAME + VOICE —
//           "আনোয়ারুল সন সাকিব, অ্যাপসে নতুন আপডেট চলে এসেছে…" per-phone via
//           a new per-token FCM path (deliverMany), and the receiving phone
//           SPEAKS it (foreground receipt, notification tap, or first open —
//           once per version via UpdateBar);
//           (4) NAMED REMINDERS RESTORED FOR FRESH INSTALLS — alarms now
//           fall back to the registered ACCOUNT name when settings.name is
//           empty (a fresh APK used to lose the voice completely);
//           (5) প্রোফাইলে ছেলে/মেয়ে সিলেক্ট is BACK (Settings → Profile).
// v5.5.0 — owner round-16 (2026-10-31): (1) THE UPDATE ANNOUNCEMENT NOW
//           SPEAKS THE MOMENT IT ARRIVES — a new native PushSpeakService
//           (FirebaseMessagingService) receives the update broadcast as a
//           DATA message even when the app is CLOSED, posts the notification
//           AND the phone immediately CALLS the user by name: "নাদিরা মনি,
//           অ্যাপসে নতুন আপডেট চলে এসেছে। দয়া করে অ্যাপটা আপডেট করে নিন।"
//           (owner: "নোটিফিকেশন যাবে, সাথে সাথে পড়ে শোনাবে — অ্যাপসের ভিতর
//           ঢুকে পড়ে শোনাতে হবে না")। The broadcast therefore goes DATA-ONLY
//           so onMessageReceived fires with the app killed; foreground phones
//           keep the JS path (no double voice — MainActivity's mute flag is
//           the source of truth); ts-based dedup kills every double.
//           (2) NEW FEATURE "মসজিদে যাওয়ার জন্য" — a separate layout in
//           Alarm & Reminder with FIVE MANUAL prayer times (ফজর/যোহর/আসর/
//           মাগরিব/ইশা) the owner sets himself; at each set time the alarm
//           rings and the phone calls by name — boy: "নামাজের সময় হইছে,
//           মসজিদে যাও" / girl: "নামাজের সময় হইছে, নামাজ পড়ো" (gender from
//           the restored ছেলে/মেয়ে profile pick; changing gender re-syncs).
//           (3) NO azan+15-minute namaz reminder exists anywhere (verified
//           line by line) — the azan alerts stay exact waqt times; the only
//           15-minute shifts are the MEAL pre-alerts (food, not namaz).
//           (4) scripts/our-habit-push-relay.gs — the relay reference file
//           ships in the repo so the deployed Apps Script can be re-pasted
//           any time without losing the protocol.
export const APP_VERSION = "5.5.0";
