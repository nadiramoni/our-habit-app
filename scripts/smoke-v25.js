// v2.5 smoke test — month calendar, custom habits, mosque card, alarms cleanup
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) errors.push("CONSOLE: " + m.text().slice(0, 200));
  });

  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  // skip the auth gate if present
  await page
    .locator("a:has-text('এখন না'), button:has-text('এখন না'), *:has-text('এখন না, পরে করবো')")
    .last()
    .click()
    .catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/v25-home.png" });

  const checks = [];
  const ok = (name, cond) => checks.push(`${cond ? "✓" : "✗"} ${name}`);

  // 1. month calendar exists (মাসের হিসাব)
  ok("Month calendar card", (await page.locator("text=মাসের হিসাব").count()) > 0);
  // 2. mosque card (আজকের রিমাইন্ডার) — no longer the old emoji card
  ok("Mosque daily card", (await page.locator("text=আজকের রিমাইন্ডার").count()) > 0);
  // 3. old 7-days gone
  ok("Old 'শেষ ৭ দিন' removed", (await page.locator("text=শেষ ৭ দিন").count()) === 0);
  // 4. new habit tile
  ok("নতুন হ্যাবিট tile", (await page.locator("text=নতুন হ্যাবিট").count()) > 0);

  // tap a past date in the calendar (day 26) → no record panel
  const day26 = page.locator("button:has-text('২৬')").first();
  if (await day26.count()) {
    await day26.click();
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: "/tmp/v25-month-select.png" });
  const hasDayPanel = (await page.locator("text=এই দিনে কোনো রেকর্ড নেই").count()) > 0 || (await page.locator("text=দিনের হিসাব").count()) > 0;
  ok("Date detail panel opens", hasDayPanel);

  // 5. new habit flow — open the manager (the dashed ＋ tile = last match)
  const nhTile = page.locator("button:has-text('নতুন হ্যাবিট')").last();
  await nhTile.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/v25-newhabit.png" });
  ok("New habit manager opens", (await page.locator("input[placeholder*='হ্যাবিটের নাম']").count()) > 0);
  await page.locator("input[placeholder*='হ্যাবিটের নাম']").fill("বই পড়া");
  await page.locator("button:has-text('যোগ করো')").last().click();
  await page.waitForTimeout(600);
  ok("Custom habit added", (await page.locator("text=বই পড়া").count()) > 0);
  // back to home
  await page.locator("button[aria-label='ফিরে যাও'], button:has-text('←')").first().click();
  await page.waitForTimeout(600);
  ok("Habit tile visible on grid", (await page.locator("text=বই পড়া").count()) > 0);

  // 6. alarms page: notification card REMOVED, auto badge present
  const alarmsTile = page.locator("button:has-text('অ্যালার্ম ও রিমাইন্ডার'), button:has-text('রিমাইন্ডার')").last();
  if (await alarmsTile.count()) {
    await alarmsTile.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: "/tmp/v25-alarms.png" });
    ok("Notification test card REMOVED from alarms", (await page.locator("text=টেস্ট নোটিফিকেশন").count()) === 0);
  }

  // 7. settings — exact alarm row
  await page.locator("button[aria-label='ফিরে যাও'], button:has-text('←')").first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator("nav button:has-text('সেটিংস')").click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "/tmp/v25-settings.png" });
  ok("Exact-alarm permission row", (await page.locator("text=নির্ভুল সময়").count()) > 0);

  console.log(checks.join("\n"));
  console.log("errors:", errors.length ? errors : "none");
  await browser.close();
  if (checks.some((c) => c.startsWith("✗")) || errors.length) process.exit(1);
})();
