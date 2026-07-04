// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Merges every _server/output/people-*.json + enrich.json + downloaded portraits
// into the single dataset the frontend ships: src/data/people.json
// Usage: node build-dataset.js

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "output");
const dataDir = join(__dirname, "..", "src", "data");
const portraitsDir = join(__dirname, "..", "public", "portraits");
const enrichFile = join(outputDir, "enrich.json");

const byId = new Map();
const files = readdirSync(outputDir).filter((f) => /^people-.*\.json$/.test(f));

for (const file of files) {
  const people = JSON.parse(readFileSync(join(outputDir, file), "utf8"));
  for (const p of people) {
    const existing = byId.get(p.id);
    if (!existing || p.sitelinks > existing.sitelinks) byId.set(p.id, p);
  }
  console.log(`${file}: ${people.length} people`);
}

const enrich = existsSync(enrichFile) ? JSON.parse(readFileSync(enrichFile, "utf8")) : {};

// downloaded portraits: id -> local path
const portraits = new Map();
if (existsSync(portraitsDir)) {
  for (const f of readdirSync(portraitsDir)) {
    portraits.set(f.replace(/\.\w+$/, ""), `/portraits/${f}`);
  }
}

const merged = [...byId.values()]
  .filter((p) => p.birthYear !== null)
  // the label service occasionally returns raw QIDs; fix-labels.js repairs them, drop leftovers
  .filter((p) => !/^Q\d+$/.test(p.name))
  .sort((a, b) => a.birthYear - b.birthYear)
  .map((p) => {
    const e = enrich[p.id] ?? {};
    return {
      ...p,
      // prefer the self-hosted portrait; fall back to Commons until download completes
      image: portraits.get(p.id) ?? (p.image ? p.image.replace(/^http:/, "https:") : null),
      occupations: e.occupations ?? [],
      country: e.country ?? null,
      birthPlace: e.birthPlace ?? null,
      coord: e.coord ?? null,
      wikipedia: e.wikipedia ?? null,
    };
  });

// data hygiene for "circa" antiquity dates (raw output files stay untouched):
// 1) death < birth -> the two got rounded in opposite directions, swap them
// 2) lifespan > 110y -> death date is a dynasty/period artifact, treat as unknown
let swapped = 0;
let deathNulled = 0;
for (const p of merged) {
  if (p.deathYear !== null && p.deathYear < p.birthYear) {
    [p.birthYear, p.deathYear] = [p.deathYear, p.birthYear];
    swapped++;
  }
  if (p.deathYear !== null && p.deathYear - p.birthYear > 110) {
    p.deathYear = null;
    deathNulled++;
  }
}
merged.sort((a, b) => a.birthYear - b.birthYear);
console.log(`Hygiene: ${swapped} date swaps, ${deathNulled} suspicious death years cleared`);

// easter egg: the founding team (custom entries, already in final shape)
const customFile = join(__dirname, "custom-people.json");
if (existsSync(customFile)) {
  const custom = JSON.parse(readFileSync(customFile, "utf8"));
  for (const p of custom) {
    p.image = portraits.get(p.id) ?? p.image;
    merged.push(p);
  }
  merged.sort((a, b) => a.birthYear - b.birthYear);
  console.log(`+${custom.length} custom entries (the founding team)`);
}

mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, "people.json"), JSON.stringify(merged), "utf8");

const stats = {
  total: merged.length,
  localPortraits: merged.filter((p) => p.image?.startsWith("/portraits/")).length,
  withCoordinates: merged.filter((p) => p.coord).length,
  withOccupation: merged.filter((p) => p.occupations.length).length,
};
console.log(`-> src/data/people.json`, JSON.stringify(stats));
