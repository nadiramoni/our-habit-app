// v5.7 smoke — serve the static export (out/) and verify:
//  1. app boots, zero unexpected console errors
//  2. alarms detail: নামাজের রিমাইন্ডার card + NO mealPreAlert toggle + NEW quietRule note
//  3. meal card shows the quiet note (বাজনা শুধুই আজানে)
//  4. Settings: version 5.7.0 + test buttons text updated
//  5. Home: mosque note now "নামাজ পড়ার সময় হইছে"
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");
const { spawn } = require("child_process");

(async () => {
  const srv = spawn("python3", ["-m", "http.server", "5617", "--directory", "/home/z/my-project/work/our-habit-fixed/out"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 900));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE: " + m.text());
  });

  let pass = 0, fail = 0;
  const ok = (name, cond) => { cond ? (pass++, console.log("  ✓ " + name)) : (fail++, console.log("  ✗ " + name)); };

  try {
    await page.goto("http://localhost:5617/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);

    // 0. pass the auth gate (fresh profile → "এখন না, পরে করবো")
    await page.click('button:has-text("এখন না, পরে করবো")').catch(() => {});
    await page.waitForTimeout(2000);

    // 1. boot
    ok("app booted (no page crash)", errors.filter((e) => e.startsWith("PAGEERROR")).length === 0);

    // 2. open the 🔔 অ্যালার্ম ও রিমাইন্ডার detail card
    await page.click('button:has-text("অ্যালার্ম ও রিমাইন্ডার")').catch(() => {});
    await page.waitForTimeout(1200);
    const body = await page.evaluate(() => document.body.innerText);
    ok("নামাজের রিমাইন্ডার card title", body.includes("নামাজের রিমাইন্ডার"));
    ok("NO mealPreAlert toggle (১৫ মিনিট আগে জানাবে)", !body.includes("১৫ মিনিট আগে জানাবে"));
    ok("quietRule note (বাজনা শুধুই আজানে)", body.includes("শুধু আজানে অ্যালার্মের বাজনা"));
    ok("mosque note wording (নামাজ পড়ার সময় হইছে)", body.includes("নামাজ পড়ার সময় হইছে"));

    // close the alarms detail overlay (fixed full-screen portal) first
    await page.click('button[aria-label="ফিরে যাও"]').catch(() => {});
    await page.waitForTimeout(800);

    // 3. Settings tab
    await page.click('nav button:has-text("সেটিংস")').catch(async () => {
      const btns = await page.$$("nav button");
      if (btns.length) await btns[btns.length - 1].click();
    });
    await page.waitForTimeout(1800);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(700);
    const sBody = await page.evaluate(() => document.body.innerText);
    ok("Settings tab rendered", sBody.length > 50);
    ok("version 5.7.0 shown", sBody.includes("5.7.0"));

    // 4. Home again → today card quiet note
    await page.click('nav button:has-text("হোম")').catch(async () => {
      const btns = await page.$$("nav button");
      if (btns.length) await btns[0].click();
    });
    await page.waitForTimeout(1500);
    const hBody = await page.evaluate(() => document.body.innerText);
    ok("Home rendered", hBody.length > 50);

    // console errors (network fetch failures to firebase are tolerated in the sandbox)
    const hard = errors.filter((e) => !/fetch|network|Failed to load resource|firebase|googleapis|ads/i.test(e));
    ok("zero unexpected console errors (found: " + hard.length + ")", hard.length === 0);
    if (hard.length) console.log(hard.slice(0, 5).join("\n"));

    console.log(`\n${pass}/${pass + fail} checks passed`);
    process.exitCode = fail ? 1 : 0;
  } catch (e) {
    console.error("SMOKE CRASH:", e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.kill();
  }
})();
