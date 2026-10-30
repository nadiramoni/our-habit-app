#!/usr/bin/env node
/**
 * prepare-apk.mjs — turns the static export (out/) into a ready-to-build
 * Capacitor Android project:
 *   1. fresh `npx cap add android`
 *   2. copy the UsageTracker plugin (Usage Access auto-tracking for Reels)
 *   3. register the plugin in MainActivity
 *   4. add AndroidManifest permissions (usage stats, exact alarms, notifications)
 *   5. stamp versionName/versionCode from src/lib/version.ts
 *   6. `npx cap sync android`
 * Run AFTER `NEXT_EXPORT=1 npx next build`. (CI does exactly that.)
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const log = (m) => console.log(`[prepare-apk] ${m}`);

function sh(cmd, opts = {}) {
  log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

// 0. sanity
if (!fs.existsSync(path.join(ROOT, "out", "index.html"))) {
  console.error("✗ out/index.html missing — run `NEXT_EXPORT=1 npx next build` first");
  process.exit(1);
}

// 1. fresh android project
if (fs.existsSync(path.join(ROOT, "android"))) {
  log("removing old android/ dir");
  fs.rmSync(path.join(ROOT, "android"), { recursive: true, force: true });
}
sh("npx cap add android");
sh("npx cap update android");

// 1.5. google-services.json (owner's REAL Firebase Android config, project our-habit-61587)
// Capacitor 8's app/build.gradle auto-applies the google-services plugin when this file exists.
const gsSrc = path.join(ROOT, "google-services.json");
if (fs.existsSync(gsSrc)) {
  fs.copyFileSync(gsSrc, path.join(ROOT, "android", "app", "google-services.json"));
  log("google-services.json → android/app/ (Firebase Android wired)");
} else {
  log("no google-services.json at repo root — skipping (cloud still works via JS SDK)");
}

// 2. copy native plugins (UsageTracker + AppPermissions + NearbySync +
//    ExactAlarm engine + GoogleAuth + KeepAlive chat service)
const appPkgDir = path.join(ROOT, "android", "app", "src", "main", "java", "com", "ourhabit", "app");
fs.mkdirSync(appPkgDir, { recursive: true });
const PLUGINS = [
  "usage-tracker/UsageTrackerPlugin.java",
  "app-permissions/AppPermissionsPlugin.java",
  "nearby-sync/NearbySyncPlugin.java",
  // v2.8: the EXACT azan engine (setAlarmClock + full-screen azan intent)
  "exact-alarm/ExactAlarmPlugin.java",
  "exact-alarm/AlarmFireReceiver.java",
  "exact-alarm/ExactBootReceiver.java",
  // v2.9: TTS named alerts (the phone CALLS the user by name) — foreground
  // service that speaks, then rings the real alarm sound
  "exact-alarm/AlarmSpeakService.java",
  // v2.9: NATIVE Google sign-in (fixes the white-screen login — no browser,
  // no popup; Google Play account picker inside the app)
  "google-auth/GoogleAuthPlugin.java",
  // v2.9: background chat notifications (headless WebView on the same
  // origin → Firestore listener → real notifications even app closed) +
  // background Reels-limit guard
  "keep-alive/OhKeepAliveService.java",
  "keep-alive/ChatServicePlugin.java",
];
for (const rel of PLUGINS) {
  fs.copyFileSync(path.join(ROOT, "android-plugins", rel), path.join(appPkgDir, path.basename(rel)));
  log(`copied ${path.basename(rel)}`);
}

// 3. register all plugins in MainActivity
// ⚠️⚠️ CRITICAL (v2.2 root-cause fix): in Capacitor 5+, super.onCreate() ALREADY
// builds the bridge (BridgeActivity.onCreate → load() → bridgeBuilder.create()).
// registerPlugin() only queues into the builder — so the calls MUST run BEFORE
// super.onCreate(). Registering AFTER (the old v2.1 code) silently added the
// plugins to an already-built bridge → window.Capacitor.Plugins.{UsageTracker,
// AppPermissions,NearbySync} were MISSING on real phones → every permission
// dialog, usage-access link and the notification test did NOTHING.
const mainActivityPath = path.join(appPkgDir, "MainActivity.java");
let ma = fs.readFileSync(mainActivityPath, "utf8");
const REG_CALLS = [
  "UsageTrackerPlugin.class",
  "AppPermissionsPlugin.class",
  "NearbySyncPlugin.class",
  "ExactAlarmPlugin.class",
  "GoogleAuthPlugin.class",
  "ChatServicePlugin.class",
]
  .map((c) => `    registerPlugin(${c});`)
  .join("\n");
if (!ma.includes("registerPlugin(UsageTrackerPlugin.class)")) {
  ma = ma
    .replace(
      "import com.getcapacitor.BridgeActivity;",
      "import com.getcapacitor.BridgeActivity;\nimport android.os.Bundle;"
    )
    .replace(
      /public class MainActivity extends BridgeActivity\s*\{/,
      `public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
${REG_CALLS}
    super.onCreate(savedInstanceState);
  }
`
    );
  fs.writeFileSync(mainActivityPath, ma);
}
// v5.1 FOREGROUND-MUTE TRUTH (friend-notification root cause #3): the JS
// appStateChange listener that muted/unmuted OhKeepAliveService lives in the
// web layer — if the WebView dies or the event never fires, the service
// stayed MUTED forever and closed-app notifications never arrived. The
// Activity's own lifecycle is the reliable source: onResume → muted=true
// (the in-app popup handles messages instead), onPause → muted=false
// (notifications flow again even if the JS never wakes).
if (!ma.includes("oh_mute_lifecycle_v51")) {
  ma = ma
    .replace(
      "import com.getcapacitor.BridgeActivity;",
      "import com.getcapacitor.BridgeActivity;\nimport android.content.SharedPreferences; // oh_mute_lifecycle_v51"
    )
    .replace(
      /public class MainActivity extends BridgeActivity\s*\{/,
      `public class MainActivity extends BridgeActivity {
  // v5.1 oh_mute_lifecycle_v51 — foreground-mute truth for OhKeepAliveService:
  // the user is INSIDE the app while resumed, and OUT the moment it pauses.
  @Override
  protected void onResume() {
    super.onResume();
    try {
      getSharedPreferences("oh_keepalive", MODE_PRIVATE)
          .edit().putBoolean("muted", true).apply();
    } catch (Exception ignored) {
    }
  }

  @Override
  protected void onPause() {
    super.onPause();
    try {
      getSharedPreferences("oh_keepalive", MODE_PRIVATE)
          .edit().putBoolean("muted", false).apply();
    } catch (Exception ignored) {
    }
  }
`
    );
  fs.writeFileSync(mainActivityPath, ma);
  log("MainActivity v5.1 mute-lifecycle patched ✓");
}
{
  const idxReg = ma.indexOf("registerPlugin(UsageTrackerPlugin.class)");
  const idxSuper = ma.indexOf("super.onCreate(savedInstanceState);");
  if (idxReg === -1 || idxSuper === -1 || idxReg > idxSuper) {
    console.error("[prepare-apk] ✗ plugin registerPlugin() calls are missing or AFTER super.onCreate — aborting");
    process.exit(1);
  }
  log("plugins registered BEFORE super.onCreate ✓ (all 3 live in the JS bridge)");
}

// 4. manifest permissions
const manifestPath = path.join(ROOT, "android", "app", "src", "main", "AndroidManifest.xml");
let mf = fs.readFileSync(manifestPath, "utf8");
if (!mf.includes("xmlns:tools")) {
  mf = mf.replace("<manifest ", '<manifest xmlns:tools="http://schemas.android.com/tools" ');
}
const PERMS = [
  // ⚠️ v2.8 ROOT-CAUSE FIX (owner: "Usage Access লিস্টে Our Habit দেখায় না"):
  // the v1 string "android.app.usage.PACKAGE_USAGE_STATS" was WRONG — Android
  // only lists apps that request "android.permission.PACKAGE_USAGE_STATS"
  // under Settings → Usage access. With the wrong string the app NEVER
  // appeared in the list → the user could not grant it → Reels tracking dead.
  '<uses-permission android:name="android.permission.PACKAGE_USAGE_STATS" tools:ignore="ProtectedPermissions" />',
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />',
  // v2.5 Fajr REAL FIX: on Android 12/13/14 SCHEDULE_EXACT_ALARM alone is NOT
  // enough — Android 14 denies it until the user flips a hidden special access,
  // and without it every alarm silently becomes INEXACT (Fajr late/skipped).
  // USE_EXACT_ALARM is AUTO-GRANTED on Android 13+ for alarm-clock apps and
  // makes exact alarms work with zero user steps (sideloaded APK — fine).
  '<uses-permission android:name="android.permission.USE_EXACT_ALARM" />',
  '<uses-permission android:name="android.permission.VIBRATE" />',
  '<uses-permission android:name="android.permission.WAKE_LOCK" />',
  // battery: "Unrestricted" via the real system allow-dialog
  '<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />',
  // device-to-device note sync via Google Nearby (Bluetooth + Wi-Fi Direct)
  '<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" tools:targetApi="s" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />',
  // v2.4 FIX: AUTO PRAYER TIMES need location on EVERY Android version — the
  // old maxSdkVersion=30 cap silently removed it on Android 12+ so the
  // geolocation prompt never appeared (owner round-6 #4)
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />',
  '<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />',
  // v2.4: full-screen alarm intent — azan/meal alarms may show over the
  // lock screen when the exact-alarm notification arrives
  '<uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />',
  // v2.8: re-arm the exact azan schedule after a phone reboot
  '<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />',
  // v2.9: foreground services — AlarmSpeakService (TTS named alerts) and
  // OhKeepAliveService (chat notifications + reels guard)
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />',
];
let changed = false;
for (const p of PERMS) {
  if (!mf.includes(p)) {
    // Capacitor 8 template writes `<application` followed by a NEWLINE —
    // match the word boundary, not a literal space
    mf = mf.replace(/<application\b/, `${p}\n    <application`);
    changed = true;
  }
}

// v2.8: alarm receivers — AlarmFireReceiver (notification + full-screen
// azan launch) + ExactBootReceiver (re-arm the schedule after reboot)
const RX_FIRE = '<receiver android:name="com.ourhabit.app.AlarmFireReceiver" android:exported="false" />';
const RX_BOOT = [
  '<receiver android:name="com.ourhabit.app.ExactBootReceiver" android:exported="true">',
  '  <intent-filter>',
  '    <action android:name="android.intent.action.BOOT_COMPLETED" />',
  '    <action android:name="android.intent.action.QUICKBOOT_POWERON" />',
  '  </intent-filter>',
  '</receiver>',
].join("\n    ");
if (!mf.includes("AlarmFireReceiver")) {
  mf = mf.replace(/<\/application>/, `    ${RX_FIRE}\n    ${RX_BOOT}\n  </application>`);
  changed = true;
}

// v2.9: foreground services — AlarmSpeakService (TTS voice alerts, speaks
// the user's registered name) + OhKeepAliveService (chat notifications +
// background reels guard). On Android 14+ every FGS must declare its type
// (specialUse needs the PROPERTY_SPECIAL_USE_FGS_SUBTYPE explanation).
const SVC_SPEAK = [
  '<service android:name="com.ourhabit.app.AlarmSpeakService" android:exported="false" android:foregroundServiceType="mediaPlayback" />',
].join("\n    ");
const SVC_KEEP = [
  '<service android:name="com.ourhabit.app.OhKeepAliveService" android:exported="false" android:foregroundServiceType="specialUse">',
  '  <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="Real-time chat message notifications and habit reminders via a persistent local listener" />',
  '</service>',
].join("\n    ");
if (!mf.includes("AlarmSpeakService")) {
  mf = mf.replace(/<\/application>/, `    ${SVC_SPEAK}\n    ${SVC_KEEP}\n  </application>`);
  changed = true;
}
if (changed) {
  fs.writeFileSync(manifestPath, mf);
}
const allIn = PERMS.every((p) => mf.includes(p));
if (allIn) {
  log(`manifest permissions verified ✓ (${PERMS.length} entries)`);
} else {
  console.error("[prepare-apk] ✗ manifest permissions MISSING — aborting");
  process.exit(1);
}

// 4.5. Google Play Services dependencies
//  - play-services-nearby: device-to-device note sync
//  - play-services-auth (v2.9): NATIVE Google sign-in — the account picker
//    sheet + idToken for signInWithCredential. This is the core of the
//    login-white-screen fix (signInWithPopup can never work in a WebView).
const gradlePath0 = path.join(ROOT, "android", "app", "build.gradle");
let gradle0 = fs.readFileSync(gradlePath0, "utf8");
if (!gradle0.includes("play-services-nearby")) {
  gradle0 = gradle0.replace(
    /dependencies\s*\{/,
    "dependencies {\n    implementation 'com.google.android.gms:play-services-nearby:19.3.0'"
  );
  fs.writeFileSync(gradlePath0, gradle0);
  log("play-services-nearby:19.3.0 added to app/build.gradle");
}
if (!gradle0.includes("play-services-auth")) {
  gradle0 = fs.readFileSync(gradlePath0, "utf8");
  gradle0 = gradle0.replace(
    /dependencies\s*\{/,
    "dependencies {\n    implementation 'com.google.android.gms:play-services-auth:21.1.1'\n    // v2.9: GoogleAuthPlugin's @ActivityCallback uses androidx.activity.result.ActivityResult\n    // (Capacitor holds it as implementation — NOT exposed to our module) → declare it ourselves\n    implementation 'androidx.activity:activity:1.9.3'"
  );
  fs.writeFileSync(gradlePath0, gradle0);
  log("play-services-auth:21.1.1 + androidx.activity:1.9.3 added to app/build.gradle (native Google login)");
}

// 4.5b. v2.9 FIXED DEBUG KEYSTORE (Google Sign-In REQUIRES a stable SHA-1).
// The GitHub runner generates a RANDOM debug.keystore on every build → the
// APK's SHA-1 changes each run → Google rejects the idToken exchange with
// DEVELOPER_ERROR (code 10). Fix: every build is signed with the SAME
// committed keystore (android-keystore/ourhabit-debug.keystore) whose SHA-1
// the owner registers ONCE in Firebase Console:
//   SHA-1: 14:60:22:E8:17:39:C5:38:0E:6C:E6:A4:36:FC:1B:33:4E:BA:92:16
// (A debug keystore for a sideloaded free app — the password is public and
//  that is fine; Google only verifies the certificate fingerprint.)
{
  const ksSrc = path.join(ROOT, "android-keystore", "ourhabit-debug.keystore");
  // v2.9.2 FIX: if the owner forgot to upload the keystore folder (very common
  // — GitHub's web drag-drop sometimes skips binary files / empty-looking
  // folders), DON'T fail the build. Generate a fresh keystore on the runner
  // with keytool (Java is already installed by setup-java step). The APK will
  // still build and install; only Google Sign-In's SHA-1 will differ from the
  // one in Firebase Console — the owner can register the new SHA-1 (printed
  // below) in Firebase Console → Settings → SHA-1 certificate fingerprints,
  // OR re-upload the committed keystore file to make it stable forever.
  if (!fs.existsSync(ksSrc)) {
    console.warn("⚠ [prepare-apk] android-keystore/ourhabit-debug.keystore MISSING — generating a fresh one on the runner");
    fs.mkdirSync(path.dirname(ksSrc), { recursive: true });
    try {
      execSync(
        `keytool -genkeypair -v -keystore "${ksSrc}" ` +
        `-storepass ourhabit2026 -keypass ourhabit2026 ` +
        `-alias ourhabit -keyalg RSA -keysize 2048 -validity 10000 ` +
        `-dname "CN=OurHabit, OU=App, O=OurHabit, L=Dhaka, ST=Dhaka, C=BD"`,
        { stdio: "inherit" }
      );
      // print the new SHA-1 so the owner can register it once in Firebase
      try {
        const sha = execSync(
          `keytool -list -v -keystore "${ksSrc}" -storepass ourhabit2026 -alias ourhabit`
        ).toString();
        const m = sha.match(/SHA1:\s*([0-9A-F:]+)/i);
        if (m) console.warn("📌 New SHA-1 to register in Firebase Console → " + m[1]);
      } catch (_) {}
    } catch (e) {
      console.error("[prepare-apk] ✗ keytool failed to generate keystore — is Java installed?");
      process.exit(1);
    }
  }
  let g = fs.readFileSync(gradlePath0, "utf8");
  if (!g.includes("ourhabit-debug.keystore")) {
    // insert signingConfigs + make the debug build type use it
    const signCfg = [
      "    signingConfigs {",
      "        ourdebug {",
      "            storeFile file('../../android-keystore/ourhabit-debug.keystore')",
      "            storePassword 'ourhabit2026'",
      "            keyAlias 'ourhabit'",
      "            keyPassword 'ourhabit2026'",
      "        }",
      "    }",
    ].join("\n");
    g = g.replace(/android\s*\{/, `android {\n${signCfg}`);
    // the template has NO debug block (only release) → insert one that uses
    // our stable keystore
    if (/buildTypes\s*\{\s*debug/.test(g)) {
      g = g.replace(
        /buildTypes\s*\{\s*debug\s*\{/,
        "buildTypes {\n        debug {\n            signingConfig signingConfigs.ourdebug"
      );
    } else {
      g = g.replace(
        /buildTypes\s*\{/,
        "buildTypes {\n        debug {\n            signingConfig signingConfigs.ourdebug\n        }"
      );
    }
    fs.writeFileSync(gradlePath0, g);
    log("debug keystore wired → APK will be signed and installable");
  }
}

// 4.6. notification sounds → res/raw/ (scheduled alarms play these even when
// the app is closed). alarm.wav is generated (soft two-tone bell);
// owner-provided recordings are bundled from public/ when present:
//   adhan.mp3 → prayer/adhan alarms · meal-alarm.mp3 → meal alarms
//   water-alarm.mp3 → water reminders (all round-4/5 owner files)
const rawDir = path.join(ROOT, "android", "app", "src", "main", "res", "raw");
fs.mkdirSync(rawDir, { recursive: true });
const RAW_MAP = [
  ["public/adhan.mp3", "adhan.mp3", "REAL adhan (owner's recording) — azan default, key 'adhan.mp3'"],
  // v2.8: 4 MORE real azan recitations (owner: "অনেকগুলা মিউজিক অ্যাড করাও") —
  // picked with the in-app azan-sound picker (আজানের ধ্বনি)
  ["public/azan2.mp3", "azan2.mp3", "azan track 2 — Very Beautiful Azan"],
  ["public/azan3.mp3", "azan3.mp3", "azan track 3"],
  ["public/azan4.mp3", "azan4.mp3", "azan track 4 — Dhuhr recitation"],
  ["public/azan5.mp3", "azan5.mp3", "azan track 5 — Dhuhr recitation 2"],
  ["public/meal-alarm.mp3", "mealalarm.mp3", "owner's alarm-clock sound for meal alarms"],
  ["public/meal-music1.mp3", "mealmusic1.mp3", "owner's 2nd music track — meal alarms play the two tracks RANDOMLY (v2.5)"],
  ["public/water-alarm.mp3", "wateralarm.mp3", "owner's music loop for water reminders"],
];
for (const [srcRel, rawName, why] of RAW_MAP) {
  const src = path.join(ROOT, srcRel);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(rawDir, rawName));
    log(`res/raw/${rawName} ← ${srcRel} (${why})`);
  } else {
    log(`no ${srcRel} — ${rawName} not bundled`);
  }
}
if (!fs.existsSync(path.join(rawDir, "alarm.wav"))) {
  const sr = 44100;
  const n = Math.floor(sr * 1.2);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.02) * Math.exp(-t * 3);
    const f = t < 0.5 ? 880 : 1174.66; // A5 → D6 soft bell
    const s = Math.round(Math.sin(2 * Math.PI * f * t) * env * 32000 * 0.6);
    buf.writeInt16LE(s, 44 + i * 2);
  }
  fs.writeFileSync(path.join(rawDir, "alarm.wav"), buf);
  log("res/raw/alarm.wav generated (reminder/adhan notification sound)");
}

// 4.7 v2.4 APP ICON + SPLASH (owner round-6 #2: কভার ডিজাইন) — CRITICAL FIX:
// `npx cap add android` writes the DEFAULT blue Capacitor launcher icon and
// splash into res/, and until now NOTHING replaced them → every installed
// build showed the wrong icon. The committed android-res/ tree (generated
// once by scripts/make-icon-set.cjs from the owner's design) is now copied
// OVER the template — launcher icon, adaptive icon, round icon, splash.
const resSrc = path.join(ROOT, "android-res");
const resDst = path.join(ROOT, "android", "app", "src", "main", "res");
if (fs.existsSync(resSrc)) {
  let iconCount = 0;
  const copyTree = (from, to) => {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const srcP = path.join(from, entry.name);
      const dstP = path.join(to, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(dstP, { recursive: true });
        copyTree(srcP, dstP);
      } else {
        fs.copyFileSync(srcP, dstP);
        iconCount++;
      }
    }
  };
  copyTree(resSrc, resDst);
  log(`custom app icon + splash applied ✓ (${iconCount} files from android-res/ → res/)`);
} else {
  log("no android-res/ folder — skipping custom icons (DEFAULT capacitor icon would be used!)");
}

// 5. version stamp
const versionTs = fs.readFileSync(path.join(ROOT, "src", "lib", "version.ts"), "utf8");
const version = (versionTs.match(/APP_VERSION\s*=\s*"([^"]+)"/) || [])[1] || "1.0.0";
const versionCode = version.split(".").map((n) => String(parseInt(n, 10) || 0)).join("");
const gradlePath = path.join(ROOT, "android", "app", "build.gradle");
let gradle = fs.readFileSync(gradlePath, "utf8");
gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
fs.writeFileSync(gradlePath, gradle);
log(`version ${version} (code ${versionCode}) stamped`);

// 6. sync
sh("npx cap sync android");
log("✅ android project ready → cd android && ./gradlew assembleDebug");
