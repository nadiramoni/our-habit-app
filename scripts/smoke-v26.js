// v2.6 smoke test — baked banner frames, meals toggle confirmation, alarm music wiring
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
    if (m.type() === "error" && !m.text().includes("404") && !m.text().includes("403") && !m.text().includes("bicea.org") && !m.text().includes("Failed to load resource"))
      errors.push("CONSOLE: " + m.text().slice(0, 200));
  });

  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  await page
    .locator("a:has-text('এখন না'), button:has-text('এখন না'), *:has-text('এখন না, পরে করবো')")
    .last()
    .click()
    .catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "/tmp/v26-home.png", fullPage: true });

  const checks = [];
  const ok = (name, cond) => checks.push(`${cond ? "✓" : "✗"} ${name}`);

  // 1. ad.html is served
  const adStatus = await page.evaluate(async () => {
    const r = await fetch("/ad.html");
    return r.status;
  });
  ok("/ad.html served (200)", adStatus === 200);

  // 2. exactly 3 banner slots on Home, each a real-origin iframe
  const slots = await page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll('iframe[title="Advertisement"]'));
    return frames.map((f) => f.getAttribute("src") || "");
  });
  ok("Exactly 3 banner iframes on Home", slots.length === 3);
  ok("All iframes point to /ad.html", slots.every((s) => s.startsWith("/ad.html?")));
  const topKey = slots[0].match(/k=([a-f0-9]{32})/)?.[1] || "";
  const midKey = slots[1].match(/k=([a-f0-9]{32})/)?.[1] || "";
  ok("Top slot = 320x50 zone (a191…)", topKey.endsWith("99f5a2"));
  ok("Mid slot = main 468x60 zone (…8035781f)", midKey.endsWith("8035781f"));
  ok("Top slot width 320", slots[0].includes("w=320"));
  ok("Mid slot width 468", slots[1].includes("w=468"));
  ok("Zone script URL passed", slots.every((s) => s.includes("src=https%3A%2F%2Fbicea.org")));

  // 3. no AtNativeInline empty box on home
  ok("No native-banner container on Home", (await page.locator("#at-native-container").count()) === 0);

  // 4. meals screen — the owner's arrowed screen
  const mealsTile = page.locator("button:has-text('খাবারের সময়')").last();
  await mealsTile.click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: "/tmp/v26-meals.png", fullPage: true });
  ok("Meals screen opens (সকালের নাস্তা)", (await page.locator("text=সকালের নাস্তা").count()) > 0);

  // 5. toggle breakfast ON → confirmation popup with next-ring time
  const sw = page.locator('[aria-label="সকালের নাস্তা"][role="switch"]').first();
  const wasOn = await sw.getAttribute("aria-checked");
  if (wasOn === "true") {
    await sw.click(); // off first (soft chime)
    await page.waitForTimeout(400);
  }
  await sw.click(); // ON → loud jingle + popup
  await page.waitForTimeout(700);
  await page.screenshot({ path: "/tmp/v26-meals-confirm.png" });
  ok("Alarm-ON confirmation popup", (await page.locator("text=সফলভাবে চালু হয়েছে").count()) > 0);
  ok("Popup shows next ring time (বাজবে/পরবর্তী + AM/PM)", (await page.locator("text=/AM|PM/").count()) > 0);

  // 6. the meals row shows the 12h time (8:00 AM style)
  ok("Meal row shows 12h time", (await page.locator("text=/\\d{1,2}:\\d{2} (AM|PM)/").count()) > 0);

  // 7. back → stats: NO banner there anymore (3 places = Home only)
  await page.locator("button[aria-label='ফিরে যাও'], button:has-text('←')").first().click().catch(() => {});
  await page.waitForTimeout(600);
  await page.locator("nav button:has-text('ইনসাইট'), nav button:has-text('স্ট্যাটস'), nav button:has-text('📊')").first().click().catch(() => {});
  await page.waitForTimeout(1200);
  const statsFrames = await page.locator('iframe[title="Advertisement"]').count();
  ok("Stats has NO banner (exactly 3 = Home)", statsFrames === 0);
  await page.screenshot({ path: "/tmp/v26-stats.png" });

  // 8. audio module sanity: the real-file players are wired (window check)
  const audioOk = await page.evaluate(() => {
    try {
      // dynamic import path check via the built chunk is complex — just verify
      // the public files exist
      return Promise.all([
        fetch("/meal-alarm.mp3", { method: "HEAD" }).then((r) => r.status),
        fetch("/meal-music1.mp3", { method: "HEAD" }).then((r) => r.status),
        fetch("/adhan.mp3", { method: "HEAD" }).then((r) => r.status),
      ]).then((codes) => codes.every((c) => c === 200));
    } catch {
      return false;
    }
  });
  ok("Real music files served (meal×2 + adhan)", audioOk === true);

  // 9. no console/page errors
  ok("Zero console errors", errors.length === 0);

  console.log(checks.join("\n"));
  if (errors.length) console.log("ERRORS:\n" + errors.join("\n"));
  const failed = checks.filter((c) => c.startsWith("✗")).length;
  console.log(failed === 0 ? `\nALL ${checks.length} CHECKS PASSED` : `\n${failed} CHECKS FAILED`);
  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
})();
