// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Generates favicons from public/emblem.png: the emblem centered on the site's
// navy background, at the sizes browsers and mobile home screens ask for.
// Usage: node build-favicon.js

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const emblem = join(publicDir, "emblem.png");
const navy = { r: 13, g: 18, b: 34, alpha: 1 };

const sizes = [
  ["favicon-32.png", 32],
  ["favicon-180.png", 180],
  ["favicon-512.png", 512],
];

for (const [name, s] of sizes) {
  const pad = Math.round(s * 0.08);
  const inner = await sharp(emblem)
    .resize(s - pad * 2, s - pad * 2, { fit: "inside" })
    .toBuffer();
  await sharp({ create: { width: s, height: s, channels: 4, background: navy } })
    .composite([{ input: inner, gravity: "center" }])
    .png()
    .toFile(join(publicDir, name));
  console.log(`wrote ${name}`);
}
