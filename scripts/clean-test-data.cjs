const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  await db.sharedNote.deleteMany({});
  await db.challenge.deleteMany({});
  await db.friendship.deleteMany({});
  await db.dailySummary.deleteMany({});
  await db.user.deleteMany({});
  console.log("test data cleaned");
  await db.$disconnect();
})();
