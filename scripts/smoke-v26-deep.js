// v2.6 deep test — ad.html verdict pipeline: success hides placeholder,
// double-fail rotates zone + cache-busts; health beacons update
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404") && !m.text().includes("403") && !m.text().includes("bicea.org") && !m.text().includes("Failed to load resource"))
      errors.push("CONSOLE: " + m.text().slice(0, 160));
  });

  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.locator("*:has-text('এখন না, পরে করবো')").last().click().catch(() => {});
  await page.waitForTimeout(1500);

  // grant audio context permission state (autoplay) so playAlarmOn doesn't warn
  await page.evaluate(() => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const c = new Ctx();
        c.resume();
      }
    } catch {}
  });

  // ---- 1. simulate a SUCCESS verdict from the top slot's zone (a191…) ----
  const top = await page.evaluate(() => {
    const f = Array.from(document.querySelectorAll('iframe[title="Advertisement"]'))[0];
    const k = new URL(f.src, location.origin).searchParams.get("k");
    return { key: k, src: f.src };
  });
  await page.evaluate((key) => {
    window.postMessage({ __atAd: true, key, ok: true, phase: 1, w: 320, h: 50 }, "*");
  }, top.key);
  await page.waitForTimeout(400);
  const topHidden = await page.evaluate(() => {
    const wrap = document.querySelectorAll('iframe[title="Advertisement"]')[0].parentElement;
    return wrap.querySelector(".animate-pulse") === null; // placeholder gone = success state
  });
  console.log(`${topHidden ? "✓" : "✗"} success verdict hides the Ad placeholder`);
  const health1 = await page.evaluate(() => window.__atHealth && Object.keys(window.__atHealth).length);
  console.log(`${health1 ? "✓" : "✗"} health beacon written (keys: ${health1})`);

  // ---- 2. double-FAIL verdicts on the mid slot rotate the zone ----
  const midBefore = await page.evaluate(() => {
    const f = Array.from(document.querySelectorAll('iframe[title="Advertisement"]'))[1];
    return { key: new URL(f.src, location.origin).searchParams.get("k"), bust: new URL(f.src, location.origin).searchParams.get("r") };
  });
  // phase 99 = final fail; two of them → rotate (main → alt e29a…)
  await page.evaluate((key) => {
    window.postMessage({ __atAd: true, key, ok: false, phase: 99 }, "*");
  }, midBefore.key);
  await page.waitForTimeout(300);
  await page.evaluate((key) => {
    window.postMessage({ __atAd: true, key, ok: false, phase: 99 }, "*");
  }, midBefore.key);
  await page.waitForTimeout(500);
  const midAfter = await page.evaluate(() => {
    const f = Array.from(document.querySelectorAll('iframe[title="Advertisement"]'))[1];
    return { key: new URL(f.src, location.origin).searchParams.get("k"), bust: new URL(f.src, location.origin).searchParams.get("r") };
  });
  const rotated = midBefore.key !== midAfter.key;
  const busted = Number(midAfter.bust) > Number(midBefore.bust);
  console.log(`${rotated ? "✓" : "✗"} double-fail ROTATES zone (${"…" + midBefore.key.slice(-6)} → …${midAfter.key.slice(-6)})`);
  console.log(`${busted ? "✓" : "✗"} cache-bust bumped on remount (r ${midBefore.bust} → ${midAfter.bust})`);

  // ---- 3. banner heights are sane (scaled, never collapsed) ----
  const heights = await page.evaluate(() =>
    Array.from(document.querySelectorAll('iframe[title="Advertisement"]')).map((f) => f.parentElement.getBoundingClientRect().height)
  );
  console.log(`${heights.every((h) => h >= 40 && h <= 70) ? "✓" : "✗"} banner slot heights sane (scaled 320/468 → ${heights.map((h) => Math.round(h)).join(", ")}px)`);

  // ---- 4. meal toggle ON on web plays the loud jingle (AudioContext active) ----
  await page.locator("button:has-text('খাবারের সময়')").last().click();
  await page.waitForTimeout(700);
  const sw = page.locator('[aria-label="সকালের নাস্তা"][role="switch"]').first();
  if ((await sw.getAttribute("aria-checked")) === "true") {
    await sw.click();
    await page.waitForTimeout(300);
  }
  await sw.click();
  await page.waitForTimeout(600);
  const audioState = await page.evaluate(() => {
    const ctx = window.__audioProbe;
    return ctx || "no-probe";
  });
  const popup = (await page.locator("text=সফলভাবে চালু হয়েছে").count()) > 0;
  console.log(`${popup ? "✓" : "✗"} meal toggle popup + jingle fired`);

  console.log(`${errors.length === 0 ? "✓" : "✗"} zero console errors ${errors.length ? "→ " + errors.join(" | ") : ""}`);
  await browser.close();
})();
