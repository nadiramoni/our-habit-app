// Verify chat-listener.html end-to-end in a browser:
//  1. REST-signIn a real test user → build the localStorage auth session
//  2. mock OHNative bridge (log + postNotification)
//  3. inject oh_chat_state with the real firebase cfg + a pair
//  4. load the page → expect: boot → module load → auth restored →
//     "signed in" log → pair subscription attempt (rules may allow/deny)
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");
const fs = require("fs");

const BAKED = fs.readFileSync("/home/z/my-project/src/lib/firebase-baked.ts", "utf8");
const CFG_JSON = (BAKED.match(/'(\{"apiKey":[^']+\})'/) || [])[1];
const CFG = JSON.parse(CFG_JSON);
const TEST_EMAIL = process.argv[2];
const TEST_PASS = process.argv[3];

(async () => {
  // 1. REAL session captured from the main app (dbg-session.js) — the exact
  //    object the SDK writes with browserLocalPersistence (v2.9's fix)
  const cap = JSON.parse(fs.readFileSync("/tmp/fb-session.json", "utf8"));
  const session = JSON.parse(cap.val);
  console.log("✓ real session loaded (uid", session.uid + ")");

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const notifs = [];
  await page.addInitScript(
    ({ session, cfg, key }) => {
      // mock the Android bridge
      window.OHNative = {
        log: (m) => console.log("[OHNative.log]", m),
        muted: () => false,
        postNotification: (title, body, tag) => console.log("[OHNative.notif]", title, "|", body, "|", tag),
      };
      localStorage.setItem(key, JSON.stringify(session));
      localStorage.setItem(
        "oh_chat_state",
        JSON.stringify({
          cfg: cfg,
          myUid: session.uid,
          pairs: [{ key: "testuidA|testuidB", name: "টেস্ট বন্ধু" }],
          lang: "bn",
          reelsLimitMin: 0,
          reelsWarn: "",
        })
      );
    },
    { session, cfg: CFG, key: cap.key }
  );

  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("[OHNative")) console.log(t.slice(0, 160));
    else if (m.type() === "error") errors.push(t.slice(0, 160));
  });

  await page.goto("http://localhost:4173/chat-listener.html", { waitUntil: "domcontentloaded", timeout: 30000 });
  // give it time to boot: modules → app → auth → listener
  await page.waitForTimeout(12000);

  const state = await page.evaluate(() => ({
    hasState: Boolean(localStorage.getItem("oh_chat_state")),
    hasSession: Object.keys(localStorage).some((k) => k.startsWith("firebase:authUser")),
  }));
  console.log("page state:", JSON.stringify(state));
  console.log("errors:", errors.length ? errors.slice(0, 5) : "none");
  await browser.close();
})();
