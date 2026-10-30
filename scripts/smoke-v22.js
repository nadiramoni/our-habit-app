// Quick runtime smoke test for v2.2 fixes (mobile viewport, chromium)
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
    if (m.type() === "error") errors.push("CONSOLE: " + m.text().slice(0, 200));
  });

  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  // skip the auth gate
  await page.locator("a:has-text('এখন না'), button:has-text('এখন না'), *:has-text('এখন না, পরে করবো')").last().click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "/tmp/smoke-home.png" });

  // open the prayers detail page (portal + compass)
  const tile = page.locator("button:has-text('নামাজ')").first();
  if (await tile.count()) {
    await tile.click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: "/tmp/smoke-prayers.png" });
    // back
    const back = page.locator("button[aria-label]").first();
  } else {
    console.log("prayer tile not found by text — trying first tile");
    await page.locator(".habit-tile").first().click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: "/tmp/smoke-prayers.png" });
  }

  // water page + plus glass (sound path exercised via JS only)
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const waterTile = page.locator(".habit-tile").nth(1);
  await waterTile.click();
  await page.waitForTimeout(700);
  const plus = page.locator("button:has-text('+')").first();
  if (await plus.count()) {
    await plus.click();
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: "/tmp/smoke-water.png" });

  // is the detail overlay actually above the bottom nav? measure bounding boxes
  const overlay = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("body > div"));
    let found = null;
    for (const el of els) {
      const st = getComputedStyle(el);
      if (st.position === "fixed" && st.zIndex === "80") {
        const r = el.getBoundingClientRect();
        found = { w: r.width, h: r.height, z: st.zIndex };
      }
    }
    return found;
  });
  console.log("detail overlay (body child):", JSON.stringify(overlay));

  console.log("console/page errors:", errors.length ? errors.slice(0, 6) : "NONE");
  await browser.close();
})().catch((e) => {
  console.error("SMOKE FAILED:", e.message);
  process.exit(1);
});
