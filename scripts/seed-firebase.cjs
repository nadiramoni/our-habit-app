// Seeds the owner's REAL Firebase config into the server AppConfig (cfg row)
// WITHOUT touching the existing ads/Adsterra settings. Merge-only.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const FIREBASE_CFG = {
  apiKey: "AIzaSyAfnGjQ22LCDaJTDqj2cogaQ8NkLd1FdSY",
  authDomain: "our-habit-61587.firebaseapp.com",
  projectId: "our-habit-61587",
  storageBucket: "our-habit-61587.firebasestorage.app",
  messagingSenderId: "570611135763",
  appId: "1:570611135763:web:11f7f2bf7a5f20825696e6",
  measurementId: "G-Y66D0DQCQK",
};

async function main() {
  const row = await prisma.appConfig.findUnique({ where: { key: "cfg" } });
  const cfg = row ? JSON.parse(row.value) : {};
  cfg.firebase = { on: true, config: JSON.stringify(FIREBASE_CFG) };
  await prisma.appConfig.upsert({
    where: { key: "cfg" },
    create: { key: "cfg", value: JSON.stringify(cfg) },
    update: { value: JSON.stringify(cfg) },
  });
  const check = await prisma.appConfig.findUnique({ where: { key: "cfg" } });
  const parsed = JSON.parse(check.value);
  console.log("✅ cfg saved. firebase.on =", parsed.firebase.on, "| projectId =", JSON.parse(parsed.firebase.config).projectId);
  console.log("   adsEnabled =", parsed.adsEnabled, "| adsterra zones kept =", Object.keys(parsed.at || {}).length);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
