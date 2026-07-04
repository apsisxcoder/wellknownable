// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Data health report for src/data/people.json — field coverage + anomaly scan.
// Usage: node health-report.js

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const people = JSON.parse(readFileSync(join(__dirname, "..", "public", "data", "people.json"), "utf8"));
const NOW = new Date().getFullYear();
const pct = (n) => `${((n / people.length) * 100).toFixed(1)}%`;

console.log(`=== WELLKNOWNABLE DATA HEALTH REPORT ===`);
console.log(`Total people: ${people.length}\n`);

console.log(`--- Field coverage ---`);
const localImg = people.filter((p) => p.image?.startsWith("/portraits/")).length;
const remoteImg = people.filter((p) => p.image?.startsWith("http")).length;
console.log(`Portrait (self-hosted): ${localImg} (${pct(localImg)})`);
console.log(`Portrait (still on Commons): ${remoteImg}`);
console.log(`No portrait: ${people.length - localImg - remoteImg}`);
for (const [label, fn] of [
  ["Description", (p) => p.description],
  ["Death year", (p) => p.deathYear !== null],
  ["Occupation", (p) => p.occupations?.length],
  ["Country", (p) => p.country],
  ["Birthplace", (p) => p.birthPlace],
  ["Coordinates", (p) => p.coord],
  ["Wikipedia (EN)", (p) => p.wikipedia],
]) {
  const n = people.filter(fn).length;
  console.log(`${label}: ${n} (${pct(n)})`);
}

console.log(`\n--- Anomalies ---`);
const dead = people.filter((p) => p.deathYear !== null);

const negAge = dead.filter((p) => p.deathYear < p.birthYear);
console.log(`Death before birth (DATA ERROR): ${negAge.length}`);
for (const p of negAge.slice(0, 10)) console.log(`   ${p.name} (${p.id}): ${p.birthYear} -> ${p.deathYear}`);

const tooOld = dead.filter((p) => p.deathYear - p.birthYear > 110);
console.log(`Lifespan over 110y (suspicious): ${tooOld.length}`);
for (const p of tooOld.slice(0, 10)) console.log(`   ${p.name} (${p.id}): ${p.birthYear}-${p.deathYear} (${p.deathYear - p.birthYear}y)`);

const zeroAge = dead.filter((p) => p.deathYear === p.birthYear);
console.log(`Birth year = death year (mostly ancient "circa" dates): ${zeroAge.length}`);

const futureBirth = people.filter((p) => p.birthYear > NOW);
console.log(`Born in the future (DATA ERROR): ${futureBirth.length}`);

const aliveOld = people.filter((p) => p.deathYear === null && NOW - p.birthYear > 105);
console.log(`Apparently "alive" at 105+ (missing death record): ${aliveOld.length}`);
for (const p of aliveOld.slice(0, 10)) console.log(`   ${p.name} (${p.id}): ${p.birthYear} (${NOW - p.birthYear}y)`);

const badCoord = people.filter((p) => p.coord && (Math.abs(p.coord.lat) > 90 || Math.abs(p.coord.lon) > 180));
console.log(`Invalid coordinates: ${badCoord.length}`);

const nullIsland = people.filter((p) => p.coord && Math.abs(p.coord.lat) < 0.01 && Math.abs(p.coord.lon) < 0.01);
console.log(`Coordinates at (0,0) / "null island" (suspicious): ${nullIsland.length}`);

const dupes = new Map();
for (const p of people) {
  const key = `${p.name}|${p.birthYear}`;
  dupes.set(key, (dupes.get(key) ?? 0) + 1);
}
const dupeCount = [...dupes.values()].filter((n) => n > 1).length;
console.log(`Same name + same birth year (possible duplicates): ${dupeCount}`);

console.log(`\n--- Era distribution ---`);
const eras = [
  ["3000-801 BC", -3000, -801],
  ["800 BC-AD 0", -800, 0],
  ["1-1000", 1, 1000],
  ["1001-1500", 1001, 1500],
  ["1501-1800", 1501, 1800],
  ["1801-1900", 1801, 1900],
  ["1901-2026", 1901, 2026],
];
for (const [label, from, to] of eras) {
  const n = people.filter((p) => p.birthYear >= from && p.birthYear <= to).length;
  console.log(`${label}: ${n}`);
}
