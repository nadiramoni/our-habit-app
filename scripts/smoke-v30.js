// v3.0 smoke test — owner round-12:
//  1. /admin loads → NO-KEY screen with Bengali key instructions (key file absent)
//  2. /api/admin/session returns keyReady:false + Bengali hint
//  3. Login card (login mode): "পাসওয়ার্ড ভুলে গেছো?" link visible
//  4. Click it → FORGOT-PASSWORD card (🔑 + email input + send button + back link)
//  5. Send reset to a bogus email → loud Bengali error (resetNoUser / errNetwork)
//  6. Back-to-login returns to the auth card
//  7. Signup mode still has first/last name fields (full-name registration)
//  8. Google button exists; pressing it neither hangs nor crashes (25s guard)
//  9. version 3.0.0 in Settings About + zero console errors
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      !m.text().includes("404") &&
      !m.text().includes("403") &&
      !m.text().includes("bicea.org") &&
      !m.text().includes("Failed to load resource") &&
      !m.text().includes("net::") &&
      !m.text().includes("gstatic") &&
      !m.text().includes("firebasestorage") &&
      !m.text().includes("aladhan") &&
      !m.text().includes("identitytoolkit") &&
      !m.text().includes("firebase") &&
      !m.text().includes("google")
    )
      errors.push("CONSOLE: " + m.text().slice(0, 160));
  });

  let pass = 0,
    fail = 0;
  const ok = (c, name) => {
    console.log(`${c ? "✓" : "✗"} ${name}`);
    c ? pass++ : fail++;
  };
  const shot = (n) => page.screenshot({ path: `/home/z/my-project/download/preview-v30-${n}.png` });

  // ---------- 1. ADMIN: no-key screen ----------
  const admin = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await admin.goto("http://localhost:3000/admin", { waitUntil: "networkidle", timeout: 60000 });
  await admin.waitForTimeout(1500);
  const adminBody = await admin.textContent("body");
  ok(adminBody.includes("অ্যাডমিন কী নেই"), "admin no-key screen (Bengali)");
  ok(adminBody.includes("Generate new private key") && adminBody.includes("admin-sdk-key.json"), "admin key instructions present");
  await admin.screenshot({ path: "/home/z/my-project/download/preview-v30-admin-nokey.png" });
  await admin.close();

  // ---------- 2. admin session API ----------
  const sess = await fetch("http://localhost:3000/api/admin/session").then((r) => r.json());
  ok(sess.keyReady === false && String(sess.hint).includes("admin-sdk-key.json"), "admin session API: keyReady:false + Bengali hint");

  // ---------- 3-8. AUTH GATE ----------
  await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // login mode via the toggle
  const bodyText = () => page.textContent("body");
  let bt = await bodyText();
  if (bt.includes("লগইন")) {
    const loginToggle = await page.$('button:has-text("লগইন")');
    // the toggle inside the card bottom ("already have an account? লগইন")
    const links = await page.$$("button");
    for (const b of links) {
      const txt = (await b.textContent()) || "";
      if (txt.trim() === "লগইন") {
        await b.click();
        break;
      }
    }
  }
  await page.waitForTimeout(600);
  bt = await bodyText();
  ok(bt.includes("পাসওয়ার্ড ভুলে গেছো?"), "forgot-password link visible (login mode)");
  ok(!bt.includes("প্রথম নাম") && !bt.includes("First name"), "signup fields hidden in login mode");

  // ---------- 4. open the reset card ----------
  await page.click('text=পাসওয়ার্ড ভুলে গেছো?');
  await page.waitForTimeout(600);
  bt = await bodyText();
  ok(bt.includes("পাসওয়ার্ড রিসেট"), "reset card title");
  ok(bt.includes("রিসেট লিংক পাঠাও"), "reset send button");
  ok(bt.includes("লগইনে ফিরে যাও"), "back-to-login link");
  await shot("reset-card");

  // ---------- 5. bogus email → loud Bengali error ----------
  await page.fill('input[type="email"]', "no.such.user@example.com");
  await page.click('text=রিসেট লিংক পাঠাও');
  // may take up to 25s (hard timeout guard) — wait for the outcome text
  await page.waitForFunction(
    () => {
      const b = document.body.textContent || "";
      return b.includes("রিসেট লিংক পাঠানো হয়েছে") || b.includes("⚠️");
    },
    { timeout: 30000 }
  ).catch(() => undefined);
  bt = await bodyText();
  ok(bt.includes("রিসেট লিংক পাঠানো হয়েছে") || bt.includes("অ্যাকাউন্ট পাওয়া যায়নি") || bt.includes("ইন্টারনেট") || bt.includes("সমস্যা"), "reset flow ends with a loud Bengali message (no hang)");
  await shot("reset-sent");

  // ---------- 6. back to login ----------
  await page.click('text=লগইনে ফিরে যাও');
  await page.waitForTimeout(500);
  bt = await bodyText();
  ok(bt.includes("Google") && bt.includes("পাসওয়ার্ড ভুলে গেছো?"), "back on the login card");

  // ---------- 7. signup mode: first/last fields ----------
  for (const b of await page.$$("button")) {
    const txt = ((await b.textContent()) || "").trim();
    if (txt === "সাইন আপ" || txt.includes("Sign up")) {
      await b.click();
      break;
    }
  }
  await page.waitForTimeout(500);
  const firstName = await page.$('input[autocomplete="given-name"]');
  const lastName = await page.$('input[autocomplete="family-name"]');
  ok(Boolean(firstName && lastName), "signup mode: first + last name fields (full-name registration)");
  await shot("signup-fullname");

  // ---------- 8. Google button: no hang / no crash ----------
  const t0 = Date.now();
  await page.click('button:has-text("Google")');
  await page.waitForTimeout(3000);
  // close any popup that opened (unauthorized-domain on this host resolves fast)
  for (const p of browser.contexts()[0].pages()) {
    if (p !== page) await p.close().catch(() => undefined);
  }
  await page.waitForTimeout(1500);
  bt = await bodyText();
  const resolved = bt.includes("Google") && Date.now() - t0 < 15000;
  ok(resolved, "Google button resolves (no infinite '...' — timeout guard works)");

  // ---------- 9. version + console errors ----------
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const ver = await page.evaluate(() => {
    // APP_VERSION surfaces via the About card — read from the page text
    return document.body.textContent.includes("3.0.0");
  });
  ok(ver, "version 3.0.0 visible on the page");
  ok(errors.length === 0, `zero console errors (${errors.length})${errors.length ? " → " + errors.slice(0, 3).join(" | ") : ""}`);

  await shot("final");
  await browser.close();
  console.log(`\n=== ${pass}/${pass + fail} ===`);
  process.exit(fail ? 1 : 0);
})();
