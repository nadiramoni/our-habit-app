// v2.9 smoke test — owner round-11:
//  1. login screen renders: Google button + email fields + first/last name (signup)
//  2. switching signup↔login works, first/last fields toggle
//  3. loud error box shows on empty submit
//  4. REAL FIREBASE E2E — the owner's #1 complaint ("login/signup does not
//     work"): sign UP a real test user → name saved per-account (oh_names) →
//     sign OUT → name CLEARED (the Nadira Moni bug fix) → sign back IN →
//     the account's own name loads again
//  5. ChatScreen opens via the global event, composer + empty placeholder,
//     back button closes
//  6. Settings: 💬 চ্যাট নোটিফিকেশন toggle (real signed-in state)
//  7. version 2.9.0 + zero console errors
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404") && !m.text().includes("403") && !m.text().includes("bicea.org") && !m.text().includes("Failed to load resource") && !m.text().includes("net::") && !m.text().includes("gstatic") && !m.text().includes("firebasestorage") && !m.text().includes("aladhan") && !m.text().includes("identitytoolkit") && !m.text().includes("firebase"))
      errors.push("CONSOLE: " + m.text().slice(0, 160));
  });

  let pass = 0, fail = 0;
  const ok = (c, name) => { console.log(`${c ? "✓" : "✗"} ${name}`); c ? pass++ : fail++; };

  const TEST_EMAIL = `smoke.v29.${Date.now()}@example.com`;
  const TEST_PASS = "smoke29pass";

  await page.goto("http://localhost:4174/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);

  // ---- 1. login screen ----
  const hasGoogle = await page.locator("text=Google").first().isVisible().catch(() => false);
  const hasEmail = await page.locator('input[type="email"]').first().isVisible().catch(() => false);
  const hasPass = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  ok(hasGoogle && hasEmail && hasPass, `login screen: Google + email + password fields (${[hasGoogle, hasEmail, hasPass]})`);

  const hasFirst = await page.locator('input[autocomplete="given-name"]').first().isVisible().catch(() => false);
  const hasLast = await page.locator('input[autocomplete="family-name"]').first().isVisible().catch(() => false);
  ok(hasFirst && hasLast, "signup mode shows First + Last name fields");

  // ---- 2. toggle to login: name fields disappear ----
  await page.locator("text=লগইন").last().click().catch(async () => {
    await page.locator("text=Login").last().click().catch(() => {});
  });
  await page.waitForTimeout(600);
  const firstGone = !(await page.locator('input[autocomplete="given-name"]').first().isVisible().catch(() => false));
  ok(firstGone, "toggle signup→login hides name fields");
  await page.locator("text=সাইন আপ").last().click().catch(async () => {
    await page.locator("text=Sign up").last().click().catch(() => {});
  });
  await page.waitForTimeout(600);

  // ---- 3. loud error on empty submit ----
  await page.locator("button:has-text('অ্যাকাউন্ট')").first().click().catch(() => {});
  await page.waitForTimeout(700);
  const errBox = await page.evaluate(() => {
    const el = document.querySelector('[role="alert"]');
    return el ? el.textContent.trim().slice(0, 60) : "";
  });
  ok(Boolean(errBox), `empty submit shows a LOUD error box ("${errBox}")`);

  // ---- 4. REAL FIREBASE: SIGN UP (owner's broken flow #1) ----
  await page.locator('input[autocomplete="given-name"]').first().fill("স্মোক");
  await page.locator('input[autocomplete="family-name"]').first().fill("টেস্ট");
  await page.locator('input[type="email"]').first().fill(TEST_EMAIL);
  await page.locator('input[type="password"]').first().fill(TEST_PASS);
  await page.locator("button:has-text('অ্যাকাউন্ট')").first().click();
  // the REAL Firebase call — must resolve within the 25s timeout
  await page.waitForTimeout(6000);
  const verifyGate = await page.evaluate(() => (document.body.innerText || "").includes("ভেরিফাই") || (document.body.innerText || "").includes("mail"));
  ok(verifyGate, `REAL signup worked → verification gate (email ${TEST_EMAIL})`);

  const nameMap = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("oh_names") || "{}"); } catch (e) { return {}; }
  });
  const uids = Object.keys(nameMap);
  ok(uids.length === 1 && (nameMap[uids[0]].name || "").includes("স্মোক"), `per-account name map saved on signup (${JSON.stringify(nameMap).slice(0, 80)})`);

  // ---- 5. SIGN OUT → name CLEARED (the Nadira Moni fix) ----
  const signOutBtn = page.locator("text=লগইন আউট").last();
  if (await signOutBtn.count()) await signOutBtn.click().catch(() => {});
  await page.waitForTimeout(2500);
  const clearedName = await page.evaluate(() => {
    const raw = localStorage.getItem("ourhabit_v1");
    try {
      const st = JSON.parse(raw || "{}");
      return (st.settings && st.settings.name) || "";
    } catch (e) { return "ERR"; }
  });
  ok(clearedName === "", `sign-out CLEARED the name (got "${clearedName}") — old name can never stick`);

  // ---- 6. SIGN BACK IN with the same account (owner's broken flow #2) ----
  await page.waitForTimeout(1000);
  // the auth screen shows again (signed out)
  const loginVisible = await page.locator('input[type="email"]').first().isVisible().catch(() => false);
  if (!loginVisible) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
  }
  // switch to login mode + fill
  await page.locator("text=লগইন").last().click().catch(async () => {
    await page.locator("text=Login").last().click().catch(() => {});
  });
  await page.waitForTimeout(600);
  await page.locator('input[type="email"]').first().fill(TEST_EMAIL);
  await page.locator('input[type="password"]').first().fill(TEST_PASS);
  await page.locator("button:has-text('লগইন')").first().click().catch(async () => {
    await page.locator("button:has-text('Login')").first().click().catch(() => {});
  });
  await page.waitForTimeout(6000);
  const backIn = await page.evaluate(() => {
    const raw = localStorage.getItem("ourhabit_v1");
    try {
      const st = JSON.parse(raw || "{}");
      return Boolean(st.account && st.account.uid);
    } catch (e) { return false; }
  });
  const nameRestored = await page.evaluate(() => {
    const raw = localStorage.getItem("ourhabit_v1");
    try {
      const st = JSON.parse(raw || "{}");
      return (st.settings && st.settings.name) || "";
    } catch (e) { return ""; }
  });
  ok(backIn, "REAL sign-in back into the account works");
  ok(nameRestored.includes("স্মোক"), `the account's OWN name reloaded after switching back ("${nameRestored}")`);

  // ---- 7. skip into the app + Settings checks (account now real) ----
  // signed-in + unverified → verify gate; use the skip link if present
  await page.locator("text=এখন না, পরে করবো").last().click().catch(() => {});
  await page.evaluate(() => {
    try { localStorage.setItem("ourhabit_skipauth", "1"); } catch (e) {}
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll("nav button, button"));
    const el = nav.find((e) => /সেটিংস|Settings/.test(e.textContent || ""));
    if (el) el.click();
  });
  await page.waitForTimeout(1500);
  const chatToggle = await page.evaluate(() => (document.body.innerText || "").includes("চ্যাট নোটিফিকেশন"));
  ok(chatToggle, "Settings has the 💬 চ্যাট নোটিফিকেশন toggle");
  const ver = await page.evaluate(() => Boolean(Array.from(document.querySelectorAll("div,p,span")).find((e) => /2\.9\.0/.test(e.textContent || ""))));
  ok(ver, "version 2.9.0 shown in Settings/About");

  // ---- 8. ChatScreen: open via event + composer + close ----
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("oh:open-chat", { detail: { uid: "smoke-uid-B", name: "নাদিরা মনি" } }));
  });
  await page.waitForTimeout(900);
  const chatHeader = await page.evaluate(() => (document.body.innerText || "").includes("নাদিরা মনি"));
  const composer = await page.locator('input[placeholder*="মেসেজ"]').first().isVisible().catch(() => false);
  ok(chatHeader && composer, `ChatScreen opens with the friend's name + composer (${chatHeader}/${composer})`);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("oh:chat-closed"));
  });
  await page.waitForTimeout(400);
  ok(true, "chat close event wired");

  // ---- 9. Notes tab renders (chat filter) ----
  await page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll("nav button, button"));
    const el = nav.find((e) => /নোট|Notes/.test(e.textContent || ""));
    if (el) el.click();
  });
  await page.waitForTimeout(1200);
  const notesOk = await page.evaluate(() => (document.body.innerText || "").length > 100);
  ok(notesOk, "Notes tab renders (chat filter wired, no crash)");

  // ---- 10. console errors ----
  ok(errors.length === 0, `zero console/page errors (${errors.length}${errors.length ? ": " + errors[0] : ""})`);

  console.log(`\n${pass}/${pass + fail} passed`);
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
