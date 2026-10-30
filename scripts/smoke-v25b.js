// v2.5b — month calendar selection + done/not-done day record with injected data
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

const STATE = {
  settings: {
    name: "Sakib", language: "bn", theme: "dark", waterGoalMl: 3000,
    checkinTime: "21:00", fajrAlarm: { on: true, time: "04:45" },
    adhanAlerts: { fajr: { on: false, time: "05:00" }, dhuhr: { on: false, time: "12:30" }, asr: { on: false, time: "16:15" }, maghrib: { on: false, time: "17:45" }, isha: { on: false, time: "19:00" } },
    mealAlarms: { breakfast: { on: true, time: "08:00" }, lunch: { on: true, time: "14:00" }, dinner: { on: true, time: "21:00" } },
    hourlyWater: false, ayatNotif: { on: true, time: "07:00" }, reelsLimitMin: 60,
    prayerTimes: { fajr: "04:46", dhuhr: "11:42", asr: "15:46", maghrib: "17:21", isha: "18:38" },
    prayerTimesDate: "2026-10-29", location: null,
  },
  logs: {
    "2026-10-28": {
      prayers: { fajr: true, dhuhr: true, asr: false, maghrib: false, isha: false },
      prayerWater: [true, true, false, false, false], waterMl: 1000,
      reelsMin: 45, reels: { facebook: 20, ytshorts: 25, ytlong: 0, tiktok: 0, instagram: 0, other: 0 },
      dhikr: { subhanallah: 33 }, meditationMin: 0, focusMin: 0, mood: null,
      sleepBed: "23:30", sleepWake: "05:30", gratitudes: ["", "", ""], note: "আজকের নোট", customDone: {},
    },
    "2026-10-29": {
      prayers: { fajr: true, dhuhr: false, asr: false, maghrib: false, isha: false },
      prayerWater: [true, false, false, false, false], waterMl: 500,
      reelsMin: null, reels: { facebook: 0, ytshorts: 0, ytlong: 0, tiktok: 0, instagram: 0, other: 0 },
      dhikr: {}, meditationMin: 0, focusMin: 0, mood: null, sleepBed: null, sleepWake: null,
      gratitudes: ["", "", ""], note: "", customDone: { h1: true },
    },
  },
  account: null,
  personalNotes: [],
  customHabits: [{ id: "h1", name: "বই পড়া", icon: "📖" }],
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.evaluate((s) => localStorage.setItem("ourhabit_v1", JSON.stringify(s)), STATE);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  await page.locator("*:has-text('এখন না, পরে করবো')").last().click().catch(() => {});
  await page.waitForTimeout(1200);

  const checks = [];
  const ok = (n, c) => checks.push(`${c ? "✓" : "✗"} ${n}`);

  // click Oct 28 (Western digits)
  await page.locator("button:has-text('28')").first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/v25b-day28.png" });
  ok("28 selected → panel title", (await page.locator("text=সোমবার, ২৮ অক্টোবর").count()) > 0 || (await page.locator("div:has-text('২৮ অক্টোবর')").count()) > 0);
  ok("points chip shows", (await page.locator("text=পয়েন্ট").count()) > 0);
  // not-done marks visible (reels 45min destructive + not-done rows)
  ok("prayers 2/5 shown", (await page.locator("text=2/5").count()) > 0);
  ok("reels minutes shown", (await page.locator("text=৪৫ মিনিট").count()) > 0 || (await page.locator("text=45 মিনিট").count()) > 0 || (await page.locator("text=45min").count()) > 0);
  ok("note shown", (await page.locator("text=আজকের নোট").count()) > 0);
  ok("custom habit row on day28 (not done)", (await page.locator("text=বই পড়া").count()) > 0);

  // today (29) has custom habit done
  await page.locator("button:has-text('29')").first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/v25b-day29.png" });
  ok("custom habit done ✓ today", (await page.locator("text=আজ হয়েছে").count()) > 0);

  console.log(checks.join("\n"));
  console.log("errors:", errors.length ? errors : "none");
  await browser.close();
  if (checks.some((c) => c.startsWith("✗")) || errors.length) process.exit(1);
})();
