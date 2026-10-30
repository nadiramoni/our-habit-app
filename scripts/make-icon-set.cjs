// make-icon-set.cjs — v2.4 owner round-6 #2 (কভার ডিজাইন)
// Generates EVERYTHING the app needs from the new icon design (icon-src3.png):
//   1. public/ PWA icons (512 / 192 / 180)
//   2. android-res/ tree that prepare-apk.mjs copies over the Capacitor
//      template (which otherwise ships the DEFAULT blue Capacitor icon!):
//      - legacy launcher icons (all densities)
//      - round launcher icons (circle-masked)
//      - adaptive foreground layers (all densities)
//      - adaptive icon XML + background color
//      - portrait + landscape splash screens (all densities)
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = "/home/z/my-project";
const SRC = path.join(ROOT, "public", "icon-src3.png");
const RES = path.join(ROOT, "android-res");

const BG = "#0a3d2e"; // deep emerald behind the adaptive icon

async function main() {
  if (!fs.existsSync(SRC)) throw new Error("icon-src3.png missing");
  fs.rmSync(RES, { recursive: true, force: true });

  // full-bleed square (cuts off the rounded corners of the design)
  const fullBleed = await sharp(SRC).resize(1120, 1120, { fit: "cover" }).extract({ left: 60, top: 60, width: 1000, height: 1000 }).png().toBuffer();

  // ---- 1. public PWA icons ----
  const pubJobs = [
    ["public/icon-512.png", 512],
    ["public/icon-192.png", 192],
    ["public/apple-touch-icon.png", 180],
  ];
  for (const [out, size] of pubJobs) {
    await sharp(fullBleed).resize(size, size).png().toFile(path.join(ROOT, out));
    console.log("✓", out);
  }

  // ---- 2. android launcher icons ----
  const densities = [
    ["mipmap-mdpi", 48, 108],
    ["mipmap-hdpi", 72, 162],
    ["mipmap-xhdpi", 96, 216],
    ["mipmap-xxhdpi", 144, 324],
    ["mipmap-xxxhdpi", 192, 432],
  ];

  // circular mask for round icons
  const circleMask = (size) =>
    Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);

  for (const [dir, size, fgSize] of densities) {
    const d = path.join(RES, dir);
    fs.mkdirSync(d, { recursive: true });
    // legacy launcher (square, the design has its own rounded corners)
    await sharp(SRC).resize(size, size, { fit: "cover" }).png().toFile(path.join(d, "ic_launcher.png"));
    // round launcher
    await sharp(fullBleed)
      .resize(size, size)
      .composite([{ input: circleMask(size), blend: "dest-in" }])
      .png()
      .toFile(path.join(d, "ic_launcher_round.png"));
    // adaptive FOREGROUND — full-bleed icon (content sits in the safe zone)
    await sharp(fullBleed).resize(fgSize, fgSize).png().toFile(path.join(d, "ic_launcher_foreground.png"));
    console.log(`✓ ${dir} (${size}px / fg ${fgSize}px)`);
  }

  // adaptive icon XML + background color (overrides the template's white bg)
  const anydpi = path.join(RES, "mipmap-anydpi-v26");
  fs.mkdirSync(anydpi, { recursive: true });
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  fs.writeFileSync(path.join(anydpi, "ic_launcher.xml"), adaptive);
  fs.writeFileSync(path.join(anydpi, "ic_launcher_round.xml"), adaptive);
  const values = path.join(RES, "values");
  fs.mkdirSync(values, { recursive: true });
  fs.writeFileSync(
    path.join(values, "ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BG}</color>
</resources>
`
  );
  console.log("✓ adaptive icon XML + background color");

  // ---- 3. splash screens ----
  // icon with rounded corners (no white square edges on the splash)
  const roundedIcon = await sharp(SRC)
    .resize(280, 280)
    .composite([
      {
        input: Buffer.from(`<svg width="280" height="280"><rect width="280" height="280" rx="56" ry="56" fill="#fff"/></svg>`),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  const stars = Array.from({ length: 18 }, (_, i) => {
    const x = 40 + ((i * 137) % 1000);
    const y = 40 + ((i * 311) % 1800);
    const r = i % 4 === 0 ? 2.4 : 1.3;
    const o = 0.25 + ((i * 7) % 10) / 22;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffe9a3" opacity="${o.toFixed(2)}"/>`;
  }).join("");
  const splashBg = (w, h) => Buffer.from(`<svg width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#07271d"/><stop offset="55%" stop-color="#0a3d2e"/><stop offset="100%" stop-color="#0d5c40"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${stars}</svg>`);

  const writeSplash = async (dir, w, h) => {
    fs.mkdirSync(path.join(RES, dir), { recursive: true });
    await sharp(splashBg(w, h))
      .composite([{ input: roundedIcon, left: Math.round((w - 280) / 2), top: Math.round((h - 280) / 2) - 20 }])
      .png()
      .toFile(path.join(RES, dir, "splash.png"));
    console.log(`✓ ${dir}/splash.png (${w}x${h})`);
  };
  await writeSplash("drawable", 1080, 1920);
  for (const d of ["drawable-port-mdpi", "drawable-port-hdpi", "drawable-port-xhdpi", "drawable-port-xxhdpi", "drawable-port-xxxhdpi"]) {
    await writeSplash(d, 1080, 1920);
  }
  for (const d of ["drawable-land-mdpi", "drawable-land-hdpi", "drawable-land-xhdpi", "drawable-land-xxhdpi", "drawable-land-xxxhdpi"]) {
    await writeSplash(d, 1920, 1080);
  }

  console.log("\n✅ android-res/ ready — prepare-apk.mjs will copy it into the APK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
