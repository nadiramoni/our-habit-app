// v2.9 preview screenshots: login screen + chat screen
const { chromium } = require("/home/z/.npm-global/lib/node_modules/playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto("http://localhost:4174/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "/home/z/my-project/download/preview-v29-login.png" });

  // signed-in-ish chat preview: skip auth, open chat with a friend + fake messages
  await page.locator("text=এখন না, পরে করবো").last().click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("oh:open-chat", { detail: { uid: "preview-friend", name: "নাদিরা মনি" } })
    );
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "/home/z/my-project/download/preview-v29-chat-empty.png" });

  console.log("previews saved");
  await browser.close();
})();
