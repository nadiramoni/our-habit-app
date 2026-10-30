// v2.6 admin panel check — with Capacitor mock (APK mode → Firestore PIN path)
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404") && !m.text().includes("403") && !m.text().includes("bicea.org") && !m.text().includes("Failed to load resource") && !m.text().includes("firestore") && !m.text().includes("capacitor"))
      errors.push("CONSOLE: " + m.text().slice(0, 160));
  });

  await page.goto("http://localhost:3000/#owner", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.locator("*:has-text('এখন না, পরে করবো')").last().click().catch(() => {});
  await page.waitForTimeout(2500);

  const checks = [];
  const ok = (name, cond) => checks.push(`${cond ? "✓" : "✗"} ${name}`);

  const pinInput = page.locator("input[type='password']").first();
  ok("PIN gate appears", (await pinInput.count()) > 0);
  if (await pinInput.count()) {
    await pinInput.fill("72542");
    await page.locator("button:has-text('খোলো'), button:has-text('Unlock')").first().click();
    await page.waitForTimeout(7000); // Firestore round-trip (read + unlock + config load)
    await page.screenshot({ path: "/tmp/v26-admin-panel.png", fullPage: true });

    ok("Panel unlocks with owner PIN", (await page.locator("text=ব্যানার অ্যাড").count()) > 0);
    ok("AUTO banner card shown (অটো চালু)", (await page.locator("text=অটো চালু").count()) > 0);
    const taCount = await page.locator("textarea").count();
    // live config: native+social+smartlink ON (3 textareas), popunder OFF (hidden) + Firebase JSON = 4
    ok("No extra textareas (3 zones ON + Firebase = 4)", taCount === 4);
    ok("Old 'Banner 468×60' paste row GONE", (await page.locator("text=Banner 468×60").count()) === 0);
    ok("Old 'Banner 300×250' paste row GONE", (await page.locator("text=Banner 300×250").count()) === 0);
    ok("Old 'Banner 728×90' paste row GONE", (await page.locator("text=Banner 728×90").count()) === 0);
    ok("AdMob section GONE", (await page.locator("text=AdMob").count()) === 0);
    ok("AdSense section GONE", (await page.locator("text=AdSense").count()) === 0);
    ok("Social Bar row KEPT", (await page.locator("text=Social Bar").count()) > 0);
    ok("Popunder row KEPT", (await page.locator("text=Popunder").count()) > 0);
    ok("Smartlink row KEPT", (await page.locator("text=Smartlink").count()) > 0);
    ok("Master toggle KEPT", (await page.locator("text=মাস্টার").count()) > 0);
  }

  ok("Zero console errors", errors.length === 0);
  console.log(checks.join("\n"));
  if (errors.length) console.log("ERRORS:\n" + errors.join("\n"));
  await browser.close();
  const failed = checks.filter((c) => c.startsWith("✗")).length;
  process.exit(failed === 0 ? 0 : 1);
})();
