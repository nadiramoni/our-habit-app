// Make all icon sizes from the generated full-bleed icon
const sharp = require("sharp");

async function run() {
  const src = "/home/z/my-project/public/icon-src2.png";
  const jobs = [
    { out: "/home/z/my-project/public/icon-512.png", size: 512 },
    { out: "/home/z/my-project/public/icon-192.png", size: 192 },
    { out: "/home/z/my-project/public/apple-touch-icon.png", size: 180 },
  ];
  for (const j of jobs) {
    await sharp(src).resize(j.size, j.size, { fit: "cover" }).png({ quality: 90 }).toFile(j.out);
    console.log("✓", j.out);
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
