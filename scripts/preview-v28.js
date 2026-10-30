// v2.8 screenshots — new home layout, azan picker, location card, azan overlay
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2200);
  await page.locator("*:has-text('এখন না, পরে করবো')").last().click().catch(() => {});
  await page.waitForTimeout(1800);

  // 1. HOME (compact calendar + thin rows)
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/home/z/my-project/download/preview-v28-home.png" });

  // 2. Alarms detail (azan picker)
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("button")).find((e) => /🔔|অ্যালার/.test(e.textContent || ""));
    if (el) el.click();
  });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: "/home/z/my-project/download/preview-v28-azan-picker.png" });

  // 3. Settings (location card)
  await page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll("nav button")).find((e) => /সেটিং/.test(e.textContent || ""));
    if (nav) nav.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("*")).find((e) => e.children.length === 0 && /অবস্থান ও টাইমজোন/.test(e.textContent || ""));
    if (el) el.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/home/z/my-project/download/preview-v28-location.png" });

  // 4. azan overlay (via the store's alarm event → simulate through React root)
  await page.evaluate(() => {
    // open the prayers detail, tick a prayer to see the row check
    const nav = Array.from(document.querySelectorAll("nav button")).find((e) => /হোম/.test(e.textContent || ""));
    if (nav) nav.click();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("button.habit-row")).find((e) => /নামাজ/.test(e.textContent || ""));
    if (el) el.click();
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "/home/z/my-project/download/preview-v28-prayers.png" });

  await browser.close();
  console.log("✅ v2.8 screenshots saved");
})();
