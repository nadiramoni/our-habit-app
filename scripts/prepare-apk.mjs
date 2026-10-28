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

// 2. copy native plugins (UsageTracker + AppPermissions + NearbySync)
const appPkgDir = path.join(ROOT, "android", "app", "src", "main", "java", "com", "ourhabit", "app");
fs.mkdirSync(appPkgDir, { recursive: true });
const PLUGINS = [
  "usage-tracker/UsageTrackerPlugin.java",
  "app-permissions/AppPermissionsPlugin.java",
  "nearby-sync/NearbySyncPlugin.java",
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
  '<uses-permission android:name="android.app.usage.PACKAGE_USAGE_STATS" tools:ignore="ProtectedPermissions" />',
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />',
  '<uses-permission android:name="android.permission.VIBRATE" />',
  '<uses-permission android:name="android.permission.WAKE_LOCK" />',
  // battery: "Unrestricted" via the real system allow-dialog
  '<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />',
  // device-to-device note sync via Google Nearby (Bluetooth + Wi-Fi Direct)
  '<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" tools:targetApi="s" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />',
  // location is only needed for Bluetooth discovery on Android 11 and older —
  // modern phones (12+) keep their App Info clean without it
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />',
  '<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />',
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

// 4.5. Google Play Services Nearby dependency (device-to-device note sync)
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

// 4.6. notification sounds → res/raw/ (scheduled alarms play these even when
// the app is closed). alarm.wav is generated (soft two-tone bell);
// owner-provided recordings are bundled from public/ when present:
//   adhan.mp3 → prayer/adhan alarms · meal-alarm.mp3 → meal alarms
//   water-alarm.mp3 → water reminders (all round-4/5 owner files)
const rawDir = path.join(ROOT, "android", "app", "src", "main", "res", "raw");
fs.mkdirSync(rawDir, { recursive: true });
const RAW_MAP = [
  ["public/adhan.mp3", "adhan.mp3", "REAL adhan for prayer reminders"],
  ["public/meal-alarm.mp3", "mealalarm.mp3", "owner's alarm-clock sound for meal alarms"],
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
