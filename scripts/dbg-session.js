// Extract a REAL firebase localStorage session from the app (sign in like smoke-v29)
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");
const fs = require("fs");

const TEST_EMAIL = process.argv[2];
const TEST_PASS = process.argv[3];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2200);
  // switch to login mode + sign in
  await page.locator("text=লগইন").last().click().catch(() => {});
  await page.waitForTimeout(600);
  await page.locator('input[type="email"]').first().fill(TEST_EMAIL);
  await page.locator('input[type="password"]').first().fill(TEST_PASS);
  await page.locator("button:has-text('লগইন')").first().click().catch(() => {});
  await page.waitForTimeout(6000);
  const session = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("firebase:authUser"));
    return key ? { key, val: localStorage.getItem(key) } : null;
  });
  if (!session) {
    console.log("✗ no session captured (sign-in failed?)");
    process.exit(1);
  }
  fs.writeFileSync("/tmp/fb-session.json", JSON.stringify(session));
  console.log("✓ real session captured:", session.key, "len", session.val.length);
  await browser.close();
})();
