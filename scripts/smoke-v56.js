// v5.6 smoke — serve the static export (out/) and verify:
//  1. app boots, zero console errors
//  2. Home tab mosque card shows the NEW unified note ("সবার জন্য একই ডাক")
//  3. mosque card has NO gender warning anymore
//  4. Settings tab renders (the 🔊/⏰ test buttons are native-only → absent on web, that's correct)
//  5. Settings → permissions card shows the 📤 test-notification button
//  6. version 5.6.0 shows in Settings About
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");
const { spawn } = require("child_process");

(async () => {
  const srv = spawn("python3", ["-m", "http.server", "5611", "--directory", "/home/z/my-project/work/our-habit-fixed/out"], { stdio: "ignore" });
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
    await page.goto("http://localhost:5611/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);

    // 0. pass the auth gate (fresh profile → "এখন না, পরে করবো")
    await page.click('button:has-text("এখন না, পরে করবো")').catch(() => {});
    await page.waitForTimeout(2000);

    // 1. boot
    ok("app booted (no page crash)", errors.filter((e) => e.startsWith("PAGEERROR")).length === 0);

    // 2+3. open the 🔔 অ্যালার্ম ও রিমাইন্ডার detail card first
    await page.click('button:has-text("অ্যালার্ম ও রিমাইন্ডার")').catch(() => {});
    await page.waitForTimeout(1200);
    const body = await page.evaluate(() => document.body.innerText);
    ok("নামাজের রিমাইন্ডার card title", body.includes("নামাজের রিমাইন্ডার"));
    ok("unified note (সবার জন্য একই ডাক)", body.includes("সবার জন্য একই ডাক"));
    ok("NO mosque gender warning", !body.includes("বাছাই করা নেই"));

    // close the alarms detail overlay (fixed full-screen portal) first
    await page.click('button[aria-label="ফিরে যাও"]').catch(() => {});
    await page.waitForTimeout(800);

    // 4+5. Settings tab
    await page.click('nav button:has-text("সেটিংস")').catch(async () => {
      const btns = await page.$$("nav button");
      if (btns.length) await btns[btns.length - 1].click();
    });
    await page.waitForTimeout(1800);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(700);
    const sBody = await page.evaluate(() => document.body.innerText);
    ok("Settings tab rendered", sBody.length > 50);
    ok("test-notification button (📤)", sBody.includes("টেস্ট নোটিফিকেশন"));

    // 6. version
    ok("version 5.6.0 shown", sBody.includes("5.6.0"));

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
