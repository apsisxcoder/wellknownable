// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Fetches every era with per-era notability thresholds by driving fetch-people.js.
// Skips ranges whose output file already exists, so it's safe to re-run (resume).
// Usage: node fetch-all.js

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// [fromYear, toYear, minSitelinks, chunkYears]
// thresholds rise toward the present so the modern flood stays curated
const RANGES = [
  [-3000, -801, 10, 1100],
  [-800, 0, 12, 200],
  [1, 100, 15, 100],
  [101, 1000, 15, 100],
  [1000, 1100, 15, 100],
  [1101, 1500, 15, 50],
  [1500, 1600, 20, 20],
  [1601, 1700, 20, 20],
  [1701, 1800, 30, 10],
  [1800, 1900, 40, 10],
  [1901, 1950, 50, 5],
  [1951, 2026, 70, 5],
];

for (const [from, to, minSitelinks, chunk] of RANGES) {
  const outFile = join(__dirname, "output", `people-${from}-${to}.json`);
  if (existsSync(outFile)) {
    console.log(`SKIP: ${from}-${to} already fetched`);
    continue;
  }
  console.log(`\n=== ${from} to ${to} (min ${minSitelinks} sitelinks) ===`);
  const result = spawnSync(
    process.execPath,
    [join(__dirname, "fetch-people.js"), String(from), String(to), String(minSitelinks), String(chunk)],
    { stdio: "inherit" }
  );
  if (result.status !== 0) {
    console.error(`ERROR: ${from}-${to} failed — the next run will resume from here.`);
    process.exit(1);
  }
}

console.log("\nAll ranges done. Next: node fix-labels.js && node enrich-people.js && node build-dataset.js");
