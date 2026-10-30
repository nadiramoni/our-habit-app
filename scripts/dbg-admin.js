// debug admin unlock with current code
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text().slice(0, 150)}`));
  page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message.slice(0, 200)));

  await page.goto("http://localhost:3000/#owner", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.locator("*:has-text('এখন না, পরে করবো')").last().click().catch(() => {});
  await page.waitForTimeout(2500);

  const pinInput = page.locator("input[type='password']").first();
  console.log("pin input count:", await pinInput.count());
  if (await pinInput.count()) {
    await pinInput.fill("72542");
    await page.locator("button:has-text('খোলো'), button:has-text('Unlock')").first().click();
    await page.waitForTimeout(9000);
  }
  const body = await page.evaluate(() => (document.body.innerText || "").slice(0, 700));
  console.log("=== panel body ===\n", body);
  console.log("=== relevant console logs ===");
  logs.filter((l) => !l.includes("aladhan") && !l.includes("404")).slice(-20).forEach((l) => console.log(" ", l));
  await browser.close();
})();
