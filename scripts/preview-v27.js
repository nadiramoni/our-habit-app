// v2.7 preview screenshots — home (3 banner slots) + admin panel (restore card)
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2200);
  await page.locator("*:has-text('এখন না, পরে করবো')").last().click().catch(() => {});
  await page.waitForTimeout(1800);
  await page.screenshot({ path: "/home/z/my-project/download/preview-v27-home.png" });

  // admin panel via PIN gate
  await page.evaluate(() => {
    const hash = "72542"; // owner PIN -> unlock path is via input; type it
  });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => /সেটিং|Settings/.test(b.textContent || ""));
    if (btn) btn.click();
  });
  await page.waitForTimeout(900);
  // open secret admin (7 taps on version row is the usual pattern — use direct hash route if any)
  await page.goto("http://localhost:4173/#admin", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(800);
  const pinVisible = await page.evaluate(() => !!document.querySelector("input[type='password'], input[type='tel']"));
  if (pinVisible) {
    await page.keyboard.type("72542");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: "/home/z/my-project/download/preview-v27-admin.png" });
  console.log("previews saved");
  await browser.close();
})();
