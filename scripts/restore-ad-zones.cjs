/** restore-ad-zones.cjs — put back the EXACT server cfg saved before testing. */
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const db = new PrismaClient();

async function main() {
  const backup = JSON.parse(fs.readFileSync("/tmp/cfg-backup.json", "utf8"));
  await db.appConfig.update({
    where: { key: "cfg" },
    data: { value: JSON.stringify(backup.cfg) },
  });
  console.log("✓ server cfg restored from /tmp/cfg-backup.json (owner's live banner back)");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
