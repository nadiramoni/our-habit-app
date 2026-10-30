// Builds the GitHub-upload ZIP: exactly the files CI needs, nothing else.
// Output: /home/z/my-project/download/our-habit-github-upload.zip
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = "/home/z/my-project";
const OUT = path.join(ROOT, "download", "our-habit-github-upload.zip");
const STAGE = "/tmp/our-habit-repo";

// 1. clean stage
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

// 2. top-level files to include
const FILES = [
  "package.json",
  "bun.lock",
  "next.config.ts",
  "tsconfig.json",
  "tailwind.config.ts",
  "postcss.config.mjs",
  "eslint.config.mjs",
  "components.json",
  "capacitor.config.ts",
  "google-services.json",
  ".gitignore",
];
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { console.error("✗ missing required file:", f); process.exit(1); }
  fs.copyFileSync(src, path.join(STAGE, f));
}

// 3. directories to include (whole trees)
// v2.4: android-res/ carries the custom app icon + splash — prepare-apk copies
// it over the Capacitor template (otherwise the DEFAULT blue icon ships!)
// v2.9: android-keystore/ = the FIXED debug signing key (stable SHA-1 for
// native Google login — without it every CI build gets a new SHA-1 and
// Google rejects the idToken exchange)
const DIRS = ["src", "public", "prisma", "android-plugins", "android-res", "android-keystore", ".github"];
for (const d of DIRS) {
  const src = path.join(ROOT, d);
  if (!fs.existsSync(src)) { console.error("✗ missing required dir:", d); process.exit(1); }
  fs.cpSync(src, path.join(STAGE, d), { recursive: true });
}

// 4. only the script CI actually runs
fs.mkdirSync(path.join(STAGE, "scripts"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "scripts", "prepare-apk.mjs"), path.join(STAGE, "scripts", "prepare-apk.mjs"));
fs.copyFileSync(path.join(ROOT, "scripts", "bake-cfg.mjs"), path.join(STAGE, "scripts", "bake-cfg.mjs"));

// 5. sanity — the workflow requires these to exist
const must = [
  "src/app/page.tsx",
  "src/lib/firebase-baked.ts",
  "src/lib/baked-cfg.ts",
  "src/lib/cloud.ts",
  "scripts/prepare-apk.mjs",
  "scripts/bake-cfg.mjs",
  "android-plugins/usage-tracker/UsageTrackerPlugin.java",
  "android-plugins/exact-alarm/ExactAlarmPlugin.java", // v2.8: exact azan engine
  "android-plugins/exact-alarm/AlarmFireReceiver.java",
  "android-plugins/exact-alarm/ExactBootReceiver.java",
  "android-plugins/exact-alarm/AlarmSpeakService.java", // v2.9: TTS named alerts
  "android-plugins/google-auth/GoogleAuthPlugin.java", // v2.9: native Google login
  "android-plugins/keep-alive/OhKeepAliveService.java", // v2.9: background chat notifs + reels guard
  "android-plugins/keep-alive/ChatServicePlugin.java",
  "android-keystore/ourhabit-debug.keystore", // v2.9: stable SHA-1 (Google login)
  "public/chat-listener.html", // v2.9: the background chat listener page
  ".github/workflows/android-apk.yml",
  "google-services.json",
  "src/lib/version.ts",
  "public/adhan.mp3", // REAL adhan recording — bundled to res/raw by prepare-apk
  "public/azan2.mp3", // v2.8: 4 more azan tracks (in-app azan-sound picker)
  "public/azan3.mp3",
  "public/azan4.mp3",
  "public/azan5.mp3",
  "public/ad.html", // v2.6: real-origin Adsterra banner loader (the banner FIX)
  "src/lib/ad-zones.ts", // v2.6: the owner's 3 baked banner zones
  "public/meal-alarm.mp3", // owner's alarm-clock sound (meal alarms)
  "public/meal-music1.mp3", // v2.5: owner's 2nd music track — meal alarms alternate RANDOMLY
  "public/water-alarm.mp3", // owner's music loop (water reminders)
  // v2.4: custom app icon must reach the APK — the launcher can never again
  // show the default Capacitor icon
  "android-res/mipmap-xxxhdpi/ic_launcher.png",
  "android-res/mipmap-anydpi-v26/ic_launcher.xml",
  "android-res/values/ic_launcher_background.xml",
  "android-res/drawable/splash.png",
];
for (const m of must) {
  if (!fs.existsSync(path.join(STAGE, m))) { console.error("✗ STAGE missing:", m); process.exit(1); }
}

// 6. zip it (flat at root so the owner extracts and drags the CONTENTS)
fs.rmSync(OUT, { force: true });
execSync(`cd "${STAGE}" && zip -qr "${OUT}" . -x ".*.DS_Store*"`, { stdio: "inherit" });

const count = execSync(`find "${STAGE}" -type f | wc -l`).toString().trim();
const size = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`✅ ${OUT}`);
console.log(`   ${count} files, ${size} MB`);
