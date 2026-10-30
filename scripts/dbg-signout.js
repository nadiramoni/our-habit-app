// debug the sign-out flow step by step with screenshots
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text().slice(0, 120)}`));

  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);

  const TEST_EMAIL = `dbg.v29.${Date.now()}@example.com`;
  await page.locator('input[autocomplete="given-name"]').first().fill("ডিবাগ");
  await page.locator('input[autocomplete="family-name"]').first().fill("টেস্ট");
  await page.locator('input[type="email"]').first().fill(TEST_EMAIL);
  await page.locator('input[type="password"]').first().fill("dbgpass123");
  await page.locator("button:has-text('অ্যাকাউন্ট')").first().click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: "/tmp/dbg-1-verify-gate.png" });

  // what's on screen now?
  const body1 = await page.evaluate(() => (document.body.innerText || "").slice(0, 400));
  console.log("=== after signup ===\n", body1);

  // find + click the sign-out button
  const so = page.locator("text=সাইন আউট").last();
  console.log("signOut button count:", await so.count());
  if (await so.count()) {
    await so.click();
    console.log("clicked sign out");
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "/tmp/dbg-2-after-signout.png" });

  const state1 = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("ourhabit_v1") || "{}");
    return { account: st.account, name: st.settings && st.settings.name, nameSet: st.settings && st.settings.nameSet };
  });
  console.log("=== state after sign-out ===", JSON.stringify(state1));

  const body2 = await page.evaluate(() => (document.body.innerText || "").slice(0, 250));
  console.log("=== screen after signout ===\n", body2);

  console.log("=== console logs (last 15) ===");
  logs.slice(-15).forEach((l) => console.log(" ", l));

  await browser.close();
})();
