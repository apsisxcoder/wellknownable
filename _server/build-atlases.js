// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Packs the 19k individual portraits into a handful of texture atlases so the
// timeline loads faces in a few requests instead of hundreds. Portraits are
// ordered by fame (sitelinks) and the timeline always shows the most famous
// first, so the visible set almost always comes from the first one or two
// atlases. Output: public/atlases/a<N>.webp + public/data/atlas-map.json
// Usage: node build-atlases.js   (run after build-dataset.js)

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const portraitsDir = join(publicDir, "portraits");
const atlasDir = join(publicDir, "atlases");
const dataFile = join(publicDir, "data", "people.json");

const CELL = 128; // portrait native size
const COLS = 12; // 12 x 12 = 144 portraits per atlas
const PER = COLS * COLS;
const ATLAS = CELL * COLS; // 1536px

// id -> actual portrait file on disk (extension varies: jpg/png/webp)
const fileById = new Map();
for (const f of readdirSync(portraitsDir)) {
  fileById.set(f.replace(/\.\w+$/, ""), join(portraitsDir, f));
}

const people = JSON.parse(readFileSync(dataFile, "utf8"));
const ordered = people
  .filter((p) => fileById.has(p.id))
  .sort((a, b) => b.sitelinks - a.sitelinks);

console.log(`${ordered.length} portraits -> ${Math.ceil(ordered.length / PER)} atlases`);
mkdirSync(atlasDir, { recursive: true });

const ids = [];
let atlasCount = 0;

async function buildAtlas(slice, index) {
  const cells = await Promise.all(
    slice.map(async (p, i) => {
      const buf = await sharp(fileById.get(p.id))
        .resize(CELL, CELL, { fit: "cover", position: "top" })
        .toBuffer();
      return { input: buf, left: (i % COLS) * CELL, top: Math.floor(i / COLS) * CELL };
    })
  );
  await sharp({ create: { width: ATLAS, height: ATLAS, channels: 4, background: { r: 35, g: 44, b: 77, alpha: 1 } } })
    .composite(cells)
    .webp({ quality: 78 })
    .toFile(join(atlasDir, `a${index}.webp`));
}

for (let i = 0; i < ordered.length; i += PER) {
  const slice = ordered.slice(i, i + PER);
  await buildAtlas(slice, atlasCount);
  for (const p of slice) ids.push(p.id);
  atlasCount++;
  if (atlasCount % 20 === 0) console.log(`  atlas ${atlasCount}/${Math.ceil(ordered.length / PER)}`);
}

writeFileSync(
  join(publicDir, "data", "atlas-map.json"),
  JSON.stringify({ cell: CELL, cols: COLS, per: PER, atlasSize: ATLAS, ids })
);
console.log(`Done: ${atlasCount} atlases, ${ids.length} portraits mapped -> public/data/atlas-map.json`);
