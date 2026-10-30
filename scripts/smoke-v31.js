// v3.1 smoke test — owner round-13 ("check everything again" + web admin panel):
//  A. NEW standalone panel (public/admin-panel.html == download/admin-panel/index.html):
//    1. same-origin (localhost:3000/admin-panel.html) → NO-KEY screen (state-based)
//    2. cross-origin (:5599 → API :3000) → CORS works in a real browser → NO-KEY
//    3. dead server URL → OFFLINE screen (state-based, not just text)
//    4. URL editor saves + re-boot reaches the API again
//  B. REGRESSION (v3.0 features — the owner asked to re-check EVERYTHING):
//    5. /api/admin/session → keyReady:false + Bengali hint (unchanged)
//    6. CORS preflight 204 + ACAO:* + private-network (GitHub Pages ready)
//    7. /admin old page → NO-KEY screen (v3.0 intact)
//    8. login card + forgot-password link (login mode)
//    9. reset card → send → loud Bengali outcome (no hang)
//   10. back to login card
//   11. signup mode: first + last name fields
//   12. Google button resolves (timeout guard, no crash)
//   13. version 3.0.0 + zero unexpected console errors
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");
const { spawn } = require("child_process");

(async () => {
  // serve the GitHub-Pages copy of the panel on :5599 (cross-origin vs API :3000)
  const staticSrv = spawn("python3", ["-m", "http.server", "5599", "--directory", "/home/z/my-project/download/admin-panel"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 900));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      !m.text().includes("404") &&
      !m.text().includes("403") &&
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

  let pass = 0, fail = 0;
  const ok = (c, name) => {
    console.log(`${c ? "✓" : "✗"} ${name}`);
    c ? pass++ : fail++;
  };
  const activeScreens = (p) => p.evaluate(() => [...document.querySelectorAll(".active")].map((e) => e.id));

  // ---------- A1. panel same-origin ----------
  const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  desk.on("pageerror", (e) => errors.push("PANEL PAGEERROR: " + e.message));
  await desk.goto("http://localhost:3000/admin-panel.html", { waitUntil: "networkidle", timeout: 60000 });
  await desk.waitForTimeout(1600);
  let scr = await activeScreens(desk);
  ok(scr.includes("scr-nokey"), "A1 panel (same-origin) → NO-KEY screen (state)");
  let body = await desk.textContent("body");
  ok(body.includes("Generate new private key") && body.includes("admin-sdk-key.json"), "A1 panel shows the key guide");
  await desk.screenshot({ path: "/home/z/my-project/download/preview-v31-panel-nokey.png" });

  // ---------- A2. panel cross-origin (:5599 → API :3000) ----------
  await desk.goto("http://localhost:5599/", { waitUntil: "networkidle", timeout: 60000 });
  await desk.evaluate(() => localStorage.clear());
  await desk.reload({ waitUntil: "networkidle" });
  await desk.waitForTimeout(1800);
  scr = await activeScreens(desk);
  ok(scr.includes("scr-nokey"), "A2 panel (cross-origin :5599→:3000) boots — CORS works in a real browser");
  const baseShown = await desk.textContent("#loginBase");
  ok((baseShown || "").includes("localhost:3000"), "A2 default server base = http://localhost:3000");
  await desk.screenshot({ path: "/home/z/my-project/download/preview-v31-panel-cross.png" });

  // ---------- A3. dead server → OFFLINE (state-based) ----------
  await desk.evaluate(() => localStorage.setItem("oh_webadmin_base", "http://localhost:5999"));
  await desk.click("#scr-nokey button"); // the only button on the nokey card = আবার চেষ্টা করো
  await desk.waitForTimeout(1800);
  scr = await activeScreens(desk);
  ok(scr.includes("scr-off") && !scr.includes("scr-nokey"), "A3 dead server → OFFLINE screen (state)");
  body = await desk.textContent("#scr-off");
  ok(body.includes("bun run dev"), "A3 offline screen teaches bun run dev");
  ok(body.includes("সার্ভার কানেক্ট হচ্ছে না"), "A3 offline title present");
  await desk.screenshot({ path: "/home/z/my-project/download/preview-v31-panel-offline.png" });

  // ---------- A4. URL editor saves + re-boot ----------
  await desk.fill("#offUrl", "http://localhost:3000");
  await desk.click("#scr-off .rowline button"); // সেভ
  await desk.waitForTimeout(2400);
  const savedBase = await desk.evaluate(() => localStorage.getItem("oh_webadmin_base"));
  ok(savedBase === "http://localhost:3000", "A4 URL editor saves to localStorage");
  scr = await activeScreens(desk);
  ok(scr.includes("scr-nokey"), "A4 re-boot reaches the API again (NO-KEY back = key guide state)");
  await desk.evaluate(() => localStorage.clear());
  await desk.close();

  // ---------- B5. session API regression ----------
  const sess = await fetch("http://localhost:3000/api/admin/session").then((r) => r.json());
  ok(sess.keyReady === false && String(sess.hint).includes("admin-sdk-key.json"), "B5 session API: keyReady:false + Bengali hint (v3.0 unchanged)");

  // ---------- B6. CORS preflight (browser-grade) ----------
  const pf = await fetch("http://localhost:3000/api/admin/users", {
    method: "OPTIONS",
    headers: {
      Origin: "https://owner.github.io",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  ok(
    pf.status === 204 &&
      pf.headers.get("access-control-allow-origin") === "*" &&
      pf.headers.get("access-control-allow-headers").includes("Authorization") &&
      pf.headers.get("access-control-allow-private-network") === "true",
    "B6 CORS preflight: 204 + ACAO:* + Authorization + private-network (GitHub Pages ready)"
  );

  // ---------- B7. /admin old page regression ----------
  const admin = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await admin.goto("http://localhost:3000/admin", { waitUntil: "networkidle", timeout: 60000 });
  await admin.waitForTimeout(1500);
  const adminBody = await admin.textContent("body");
  ok(adminBody.includes("অ্যাডমিন কী নেই") && adminBody.includes("admin-sdk-key.json"), "B7 /admin page NO-KEY screen unchanged (v3.0 intact)");
  await admin.screenshot({ path: "/home/z/my-project/download/preview-v31-admin-old.png" });
  await admin.close();

  // ---------- B8-12. AUTH GATE regression (v3.0-verified selectors) ----------
  await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2200);

  const bodyText = () => page.textContent("body");
  let bt = await bodyText();
  if (bt.includes("লগইন")) {
    for (const b of await page.$$("button")) {
      const txt = ((await b.textContent()) || "").trim();
      if (txt === "লগইন") { await b.click(); break; }
    }
  }
  await page.waitForTimeout(600);
  bt = await bodyText();
  ok(bt.includes("পাসওয়ার্ড ভুলে গেছো?"), "B8 login card + forgot-password link (login mode)");
  ok(bt.includes("Google"), "B8 Google button present");
  await page.screenshot({ path: "/home/z/my-project/download/preview-v31-app-login.png" });

  // reset card
  await page.click('text=পাসওয়ার্ড ভুলে গেছো?');
  await page.waitForTimeout(700);
  bt = await bodyText();
  ok(bt.includes("পাসওয়ার্ড রিসেট") && bt.includes("রিসেট লিংক পাঠাও"), "B9 reset card opens");
  await page.fill('input[type="email"]', "owner-test@example.com");
  await page.click('text=রিসেট লিংক পাঠাও');
  await page.waitForFunction(
    () => {
      const b = document.body.textContent || "";
      return b.includes("রিসেট লিংক পাঠানো হয়েছে") || b.includes("⚠️");
    },
    { timeout: 30000 }
  ).catch(() => undefined);
  bt = await bodyText();
  ok(
    bt.includes("রিসেট লিংক পাঠানো হয়েছে") || bt.includes("অ্যাকাউন্ট পাওয়া যায়নি") || bt.includes("ইন্টারনেট") || bt.includes("সমস্যা"),
    "B9 reset flow ends with a loud Bengali message (no hang)"
  );
  await page.screenshot({ path: "/home/z/my-project/download/preview-v31-reset.png" });

  // back to login
  await page.click('text=লগইনে ফিরে যাও');
  await page.waitForTimeout(500);
  bt = await bodyText();
  ok(bt.includes("Google") && bt.includes("পাসওয়ার্ড ভুলে গেছো?"), "B10 back on the login card");

  // signup mode: first/last fields
  for (const b of await page.$$("button")) {
    const txt = ((await b.textContent()) || "").trim();
    if (txt === "সাইন আপ" || txt.includes("Sign up")) { await b.click(); break; }
  }
  await page.waitForTimeout(600);
  const firstName = await page.$('input[autocomplete="given-name"]');
  const lastName = await page.$('input[autocomplete="family-name"]');
  ok(Boolean(firstName && lastName), "B11 signup mode: first + last name fields (full-name registration)");
  await page.screenshot({ path: "/home/z/my-project/download/preview-v31-signup.png" });

  // Google button: no hang / no crash
  const t0 = Date.now();
  await page.click('button:has-text("Google")');
  await page.waitForTimeout(3000);
  for (const p of browser.contexts()[0].pages()) {
    if (p !== page) await p.close().catch(() => undefined);
  }
  await page.waitForTimeout(1500);
  bt = await bodyText();
  ok(bt.includes("Google") && Date.now() - t0 < 15000, "B12 Google button resolves (timeout guard, no crash)");
  await page.screenshot({ path: "/home/z/my-project/download/preview-v31-google.png" }).catch(() => undefined);

  // ---------- B13. version + panel copies + console errors ----------
  const versionSrc = require("fs").readFileSync("/home/z/my-project/src/lib/version.ts", "utf8");
  ok(/APP_VERSION\s*=\s*"3\.0\.0"/.test(versionSrc), "B13 APP_VERSION still 3.0.0 (this round did not touch app version)");
  const panelSame = require("fs")
    .readFileSync("/home/z/my-project/public/admin-panel.html")
    .equals(require("fs").readFileSync("/home/z/my-project/download/admin-panel/index.html"));
  ok(panelSame, "B13 public/admin-panel.html == download/admin-panel/index.html (the two copies are identical)");
  ok(errors.length === 0, `B13 zero unexpected console errors ${errors.length ? "→ " + errors.slice(0, 3).join(" | ") : ""}`);
  await page.screenshot({ path: "/home/z/my-project/download/preview-v31-final.png" });

  console.log(`\n=== ${pass}/${pass + fail} ===`);
  await browser.close();
  staticSrv.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(2);
});
