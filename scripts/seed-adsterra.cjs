/* Seed live Adsterra config (owner-provided code) — banner goes live for all users */
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const ADSTERRA_CODE = `atOptions = {
  'key' : 'd0e278b00806c3211340b80c8035781f',
  'format' : 'iframe',
  'height' : 60,
  'width' : 468,
  'params' : {}
};
<script src="https://bicea.org/22/d0e278b00806c3211340b80c8035781f"></script>`;

const CFG = {
  adsEnabled: true,
  ads: {
    banner: { on: false, id: "" },
    native: { on: false, id: "" },
    rewarded: { on: false, id: "" },
    adsense: { on: false, id: "" },
    adsterra: { on: true, id: ADSTERRA_CODE },
  },
  latestVersion: "",
  apkUrl: "",
  changelog: "",
  forceUpdate: false,
};

async function main() {
  await db.appConfig.upsert({
    where: { key: "cfg" },
    create: { key: "cfg", value: JSON.stringify(CFG) },
    update: { value: JSON.stringify(CFG) },
  });
  console.log("Adsterra banner config seeded — LIVE for all users");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
