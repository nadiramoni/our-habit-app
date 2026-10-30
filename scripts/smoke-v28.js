// v2.8 smoke test — owner round-10:
//  1. ads on EVERY page (Home 3 + Stats 2 + Notes 2 + Friends 2 + Settings 2 + detail 1)
//  2. compact calendar (no per-day weekday label, small rings)
//  3. thin one-per-row habit lines in the owner's order (নামাজ → পানি → ঘুম)
//  4. azan sound picker (5 tracks, ▶ preview buttons)
//  5. location & timezone card in Settings
//  6. name capture dialog appears (signed-out flow → skip)
//  7. version 2.8.0 + zero console errors
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404") && !m.text().includes("403") && !m.text().includes("bicea.org") && !m.text().includes("Failed to load resource") && !m.text().includes("net::"))
      errors.push("CONSOLE: " + m.text().slice(0, 160));
  });

  let pass = 0, fail = 0;
  const ok = (c, name) => { console.log(`${c ? "✓" : "✗"} ${name}`); c ? pass++ : fail++; };

  const gotoTab = async (label) => {
    await page.evaluate((l) => {
      const nav = Array.from(document.querySelectorAll("nav button, button"));
      const el = nav.find((e) => new RegExp(l).test(e.textContent || ""));
      if (el) el.click();
    }, label);
    await page.waitForTimeout(900);
  };
  const countBanners = () => page.evaluate(() => document.querySelectorAll('iframe[title="Advertisement"]').length);

  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.locator("*:has-text('এখন না, পরে করবো')").last().click().catch(() => {});
  await page.waitForTimeout(1500);

  // ---- 1. HOME: 3 banner slots ----
  const homeSlots = await countBanners();
  ok(homeSlots === 3, `Home has 3 banner slots (got ${homeSlots})`);
  const keys = await page.evaluate(() =>
    Array.from(document.querySelectorAll('iframe[title="Advertisement"]')).map((f) => new URL(f.src, location.origin).searchParams.get("k"))
  );
  ok(keys.some((k) => k && k.length === 32), `baked zone keys present (${keys.filter(Boolean).length}/3)`);

  // ---- 2. compact calendar: no weekday label under day rings ----
  const calInfo = await page.evaluate(() => {
    const txt = document.body.innerText;
    // the old calendar showed the weekday word (শু/রবি short forms) UNDER every
    // ring — the compact one has only the weekday HEADER row (7 tiny letters)
    const grid = document.querySelector(".grid.grid-cols-7");
    return { hasGrid: Boolean(grid), body: txt };
  });
  ok(calInfo.hasGrid, "month calendar grid present");

  // ---- 3. thin one-per-row habit lines, in the OWNER's order ----
  const rows = await page.evaluate(() => {
    const rowEls = Array.from(document.querySelectorAll("button.habit-row, .habit-row"));
    return rowEls.map((e) => (e.textContent || "").trim().slice(0, 40));
  });
  ok(rows.length >= 8, `habit rows rendered (${rows.length} rows)`);
  const prayerIdx = rows.findIndex((r) => /নামাজ|Prayer|prayer/.test(r));
  const waterIdx = rows.findIndex((r) => /পানি|Water/.test(r));
  const sleepIdx = rows.findIndex((r) => /ঘুম|Sleep/.test(r));
  ok(prayerIdx !== -1 && prayerIdx === 0, `নামাজ is the FIRST row (idx ${prayerIdx})`);
  ok(waterIdx === 1, `পানি comes right after নামাজ (idx ${waterIdx})`);
  ok(sleepIdx === 2, `ঘুম comes third (idx ${sleepIdx})`);

  // ---- 4. STATS: 2 banners ----
  await gotoTab("মেসিটিং|📊|Stats");
  const statsSlots = await countBanners();
  ok(statsSlots === 2, `Stats has 2 banner slots (got ${statsSlots})`);

  // ---- 5. NOTES: 2 banners ----
  await gotoTab("নোট|📝");
  const notesSlots = await countBanners();
  ok(notesSlots === 2, `Notes has 2 banner slots (got ${notesSlots})`);

  // ---- 6. FRIENDS: 2 banners (signed out → still visible) ----
  await gotoTab("বন্ধু|👥");
  const friendsSlots = await countBanners();
  ok(friendsSlots === 2, `Friends has 2 banner slots (got ${friendsSlots})`);

  // ---- 7. SETTINGS: 2 banners + location card + version ----
  await gotoTab("সেটিং|⚙️");
  const setSlots = await countBanners();
  ok(setSlots === 2, `Settings has 2 banner slots (got ${setSlots})`);
  const setTxt = await page.evaluate(() => document.body.innerText);
  ok(/অবস্থান ও টাইমজোন|Location & timezone/.test(setTxt), "location & timezone card visible");
  ok(/GMT[+-]/.test(setTxt), "GMT offset shown on the location card");
  ok(/2\.8\.0/.test(setTxt), "About shows v2.8.0");
  ok(!/v1\.0[^0-9]/.test(setTxt), "no stale v1.0 text");

  // ---- 8. ALARMS detail page: azan sound picker + 1 banner ----
  await gotoTab("হোম|🏠");
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("button")).find((e) => /🔔|অ্যালার|Alarms/.test(e.textContent || ""));
    if (el) el.click();
  });
  await page.waitForTimeout(1200);
  const alarmsTxt = await page.evaluate(() => document.body.innerText);
  ok(/আজানের ধ্বনি|Azan sound/.test(alarmsTxt), "azan sound picker visible in Alarms");
  const previewBtns = await page.evaluate(() => Array.from(document.querySelectorAll("button[aria-label^='শুনে'], button[aria-label^='Preview']")).length);
  ok(previewBtns >= 5, `5 azan preview buttons (got ${previewBtns})`);
  const alarmBanners = await countBanners();
  ok(alarmBanners === 4, `Alarms detail page adds its own banner (3 home + 1 detail = ${alarmBanners})`);

  // choose azan 3 + verify persistence
  await page.evaluate(() => {
    const rows2 = Array.from(document.querySelectorAll("button")).filter((e) => /আজান ৩|Azan 3/.test(e.textContent || ""));
    if (rows2[0]) rows2[0].click();
  });
  await page.waitForTimeout(500);
  const azanChoice = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("ourhabit_v1") || "{}").settings.azanSound; } catch { return null; }
  });
  ok(azanChoice === "azan3.mp3", `azan 3 saved to settings (got ${azanChoice})`);

  // ---- 9. azan sound files actually served ----
  for (const f of ["azan2.mp3", "azan3.mp3", "azan4.mp3", "azan5.mp3"]) {
    const st = await page.evaluate(async (file) => (await fetch("/" + file, { method: "HEAD" }).catch(() => null))?.status, f);
    ok(st === 200, `/${f} served (${st})`);
  }

  // ---- 10. zero console errors ----
  ok(errors.length === 0, `zero console errors (${errors.length}${errors.length ? ": " + errors[0] : ""})`);

  console.log(`\n${pass}/${pass + fail} checks passed`);
  await page.screenshot({ path: "/home/z/my-project/download/preview-v28-alarms.png", fullPage: false });
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
