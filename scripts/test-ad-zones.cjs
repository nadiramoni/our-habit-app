/**
 * test-ad-zones.cjs — temporarily seed test Adsterra zone codes DIRECTLY into
 * the server AppConfig (no admin PIN needed), so the ad rendering components
 * can be verified in the browser. Run restore-ad-zones.cjs afterwards.
 */
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const TEST_KEY = "0123456789abcdef0123456789abcdef";

async function main() {
  const row = await db.appConfig.findUnique({ where: { key: "cfg" } });
  const cfg = JSON.parse(row.value);
  cfg.adsEnabled = true;
  cfg.at = cfg.at || {};
  // banner 300x250 with a test key (iframe banner)
  cfg.at.banner300 = {
    on: true,
    code: `atOptions = { 'key' : '${TEST_KEY}', 'format' : 'iframe', 'height' : 250, 'width' : 300, 'params' : {} };\n<script src="https://bicea.org/22/${TEST_KEY}/invoke.js"></script>`,
  };
  // native banner style snippet (script + container div)
  cfg.at.nativeBanner = {
    on: true,
    code: `<script async data-cfasync="false" src="https://pl1999.profitablecpmrate.com/abcdef12/invoke.js"></script>\n<div id="container-abcdef12"></div>`,
  };
  // social bar script (protocol-relative)
  cfg.at.socialBar = { on: true, code: `<script type="text/javascript" src="//pl2000.profitablecpmgate.com/1234/5678/90ab/invoke.js"></script>` };
  // smartlink direct URL
  cfg.at.smartlink = { on: true, code: `https://example.com/support-direct-link` };
  cfg.at.popunder = { on: false, code: "" };
  // temporarily silence the owner's 468x60 so banner300 shows on phones
  cfg.ads.adsterra.on = false;
  await db.appConfig.update({ where: { key: "cfg" }, data: { value: JSON.stringify(cfg) } });
  console.log("✓ test zone codes seeded (banner300, native, socialbar, smartlink)");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
