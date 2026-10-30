/* Clean test data: test accounts, their friendships/summaries, and reset admin config */
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

async function main() {
  const testUsers = ["husband_t2", "wife_t2"];
  for (const u of testUsers) {
    await db.dailySummary.deleteMany({ where: { username: u } });
    await db.friendship.deleteMany({
      where: { OR: [{ fromUser: u }, { toUser: u }] },
    });
    await db.challenge.deleteMany({
      where: { OR: [{ fromUser: u }, { toUser: u }] },
    });
    await db.sharedNote.deleteMany({
      where: { OR: [{ author: u }, { pairKey: { contains: u } }] },
    });
    await db.user.deleteMany({ where: { username: u } });
  }
  // reset admin config so the real owner sets a fresh PIN + config
  await db.appConfig.deleteMany({});
  console.log("cleaned: test users + admin config reset");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
