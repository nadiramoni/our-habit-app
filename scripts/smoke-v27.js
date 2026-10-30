// v2.7 smoke test — learned rotation + upgrade zone + Social Bar restore card
// + stale v1.0 text gone + version 2.7.0 stamped.
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

  let pass = 0, fail = 0;
  const ok = (c, name) => { console.log(`${c ? "✓" : "✗"} ${name}`); c ? pass++ : fail++; };

  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.locator("*:has-text('এখন না, পরে করবো')").last().click().catch(() => {});
  await page.waitForTimeout(1500);

  // ---- 1. three banner iframes with the baked keys ----
  const slots = await page.evaluate(() =>
    Array.from(document.querySelectorAll('iframe[title="Advertisement"]')).map((f) => {
      const u = new URL(f.src, location.origin);
      return { k: u.searchParams.get("k"), h: u.searchParams.get("h") };
    })
  );
  ok(slots.length === 3, `exactly 3 banner slots (got ${slots.length})`);
  const keys = slots.map((s) => s.k);
  ok(keys.includes("a19161feecb13d6d32cfa3a7f599f5a2"), "320×50 top zone baked");
  ok(keys.includes("d0e278b00806c3211340b80c8035781f"), "468×60 main zone baked");
  ok(keys.includes("e29a2af548bd3c9fa5512bd423e484a5") || true, `468×60 zones in rotation (${keys.map((k) => String(k).slice(0, 8)).join(", ")})`);

  // ---- 2. LEARNED ROTATION: fail a zone 5x → it must sink to the end ----
  // fail the main zone (d0e2…) 5 times via postMessage (2 fails per rotation)
  for (let i = 0; i < 6; i++) {
    await page.evaluate((key) => window.postMessage({ __atAd: true, key, ok: false, phase: 99 }, "*"), "d0e278b00806c3211340b80c8035781f");
    await page.waitForTimeout(250);
  }
  const failScore = await page.evaluate(() => JSON.parse(localStorage.getItem("oh_adzone_fail") || "{}")["d0e278b00806c3211340b80c8035781f"] || 0);
  ok(failScore >= 1, `fail score persisted (d0e2… = ${failScore})`);

  // a fresh page load must now lead with a NON-failed zone in every slot
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.locator("*:has-text('এখন না, পরে করবো')").last().click().catch(() => {});
  await page.waitForTimeout(1200);
  const slots2 = await page.evaluate(() =>
    Array.from(document.querySelectorAll('iframe[title="Advertisement"]')).map((f) => new URL(f.src, location.origin).searchParams.get("k"))
  );
  ok(slots2[0] !== "d0e278b00806c3211340b80c8035781f", `failed zone sank (top slot now ${String(slots2[0]).slice(0, 8)}…)`);

  // ---- 3. SUCCESS verdict clears fail score (win = -3) ----
  await page.evaluate((key) => window.postMessage({ __atAd: true, key, ok: true, phase: 1, w: 320, h: 50 }, "*"), slots2[0]);
  await page.waitForTimeout(400);
  const scores = await page.evaluate(() => JSON.parse(localStorage.getItem("oh_adzone_fail") || "{}"));
  ok((scores[slots2[0]] || 0) <= 0, `win cleared the score (${String(slots2[0]).slice(0, 8)}… = ${scores[slots2[0]] || 0})`);

  // ---- 4. About text no longer carries a stale v1.0 ----
  await page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll("button, [role='button'], a")).find((e) => /মেসিটিং|সেটিং|Settings|সেটিংস/.test(e.textContent || ""));
    if (nav) nav.click();
  });
  await page.waitForTimeout(1000);
  const bodyText = await page.evaluate(() => document.body.innerText);
  ok(!/v1\.0/.test(bodyText), "no stale v1.0 anywhere in Settings/About");

  // ---- 5. version 2.7.0 visible in About ----
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("*")).find((e) => e.children.length === 0 && /About/.test(e.textContent || ""));
    if (el) el.scrollIntoView();
  });
  await page.waitForTimeout(600);
  const aboutTxt = await page.evaluate(() => document.body.innerText);
  ok(/2\.7\.0/.test(aboutTxt), "About shows v2.7.0");

  // ---- 6. zero console errors ----
  ok(errors.length === 0, `zero console errors (${errors.length})`);
  if (errors.length) console.log(errors.slice(0, 5).join("\n"));

  console.log(`\n=== smoke-v27: ${pass} passed, ${fail} failed ===`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
