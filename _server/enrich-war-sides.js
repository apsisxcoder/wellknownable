// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Fills the missing "who fought whom" sides using Wikipedia's List_of_wars
// pages: ~10 pages of simple tables (Start | Finish | Name | Victorious party |
// Defeated party) that already have the sides split — far cheaper and sturdier
// than scraping every conflict's own article. Matches rows to our sideless
// wars/battles by normalized name + year sanity, then patches
// public/data/wars.json in place and caches the result so fetch-wars.js can
// re-apply it on future refetches. Sides are stored victor-first.
// Usage: node enrich-war-sides.js

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const warsFile = join(__dirname, "..", "public", "data", "wars.json");
const cacheFile = join(__dirname, "output", "war-sides-wiki.json");
const UA = "wellknownable-data-fetcher/0.1 (https://github.com/apsisxcoder; arslan.muh.93@gmail.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LIST_PAGES = [
  "List_of_wars:_before_1000",
  "List_of_wars:_1000%E2%80%931499",
  "List_of_wars:_1500%E2%80%931799",
  "List_of_wars:_1800%E2%80%931899",
  "List_of_wars:_1900%E2%80%931944",
  "List_of_wars:_1945%E2%80%931989",
  "List_of_wars:_1990%E2%80%932002",
  "List_of_wars:_2003%E2%80%932019",
  "List_of_wars:_2020%E2%80%93present",
];

async function fetchPage(title, attempt = 1) {
  const res = await fetch(`https://en.wikipedia.org/wiki/${title}`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) {
    if (attempt < 4) {
      await sleep(5000);
      return fetchPage(title, attempt + 1);
    }
    throw new Error(`${title}: HTTP ${res.status}`);
  }
  return res.text();
}

// "1919", "c. 1007", "500 BC", "Ongoing" -> year int or null (BC negative)
function parseYearCell(text) {
  const bc = /\bBC\b/i.test(text);
  const m = text.match(/\d{1,4}/);
  if (!m) return null;
  return bc ? -parseInt(m[0], 10) : parseInt(m[0], 10);
}

const stripTags = (html) =>
  html
    .replace(/<sup[\s\S]*?<\/sup>/g, "") // refs
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// belligerent cell -> party names: anchor texts are the reliable bits
function parseParties(cellHtml) {
  const names = [];
  for (const m of cellHtml.matchAll(/<a [^>]*title="([^"]+)"[^>]*>/g)) {
    const t = m[1].replace(/ \(page does not exist\)/, "").trim();
    if (t && !/^(File|Help|Category|Template):/.test(t) && !names.includes(t)) names.push(t);
  }
  return names.slice(0, 8);
}

// match key: lowercase, ascii-fold, drop punctuation and noise words
function norm(name) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’(),.]/g, "")
    .replace(/[–—-]/g, " ")
    .replace(/\b(the|of|war|wars)\b/g, " ") // "Battle of the Sakarya" ~ "Battle of Sakarya"
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  // 1) collect table rows from every list page
  const rows = [];
  for (const page of LIST_PAGES) {
    const html = await fetchPage(page);
    let count = 0;
    for (const tm of html.matchAll(/<table[^>]*wikitable[\s\S]*?<\/table>/g)) {
      for (const rm of tm[0].matchAll(/<tr[\s\S]*?<\/tr>/g)) {
        const cells = [...rm[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
        if (cells.length < 5) continue; // header/rowspan-fragment rows
        const start = parseYearCell(stripTags(cells[0]));
        const finish = parseYearCell(stripTags(cells[1])) ?? start;
        const name = stripTags(cells[2]);
        const victors = parseParties(cells[3]);
        const defeated = parseParties(cells[4]);
        if (start == null || !name || !victors.length || !defeated.length) continue;
        rows.push({ start, finish, name, key: norm(name), victors, defeated });
        count++;
      }
    }
    console.log(`${decodeURIComponent(page)}: ${count} usable rows`);
    await sleep(500);
  }
  console.log(`Total table rows with both sides: ${rows.length}`);

  const byKey = new Map();
  for (const r of rows) (byKey.get(r.key) ?? byKey.set(r.key, []).get(r.key)).push(r);

  // 2) match our sideless wars and battles
  const data = JSON.parse(readFileSync(warsFile, "utf8"));
  const overrides = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  let hitW = 0;
  let hitB = 0;

  const findRow = (name, from, to) => {
    const cands = byKey.get(norm(name));
    if (!cands) return null;
    // year sanity: the row's range must touch ours (2y slack for "c." dates)
    return cands.find((r) => r.start - 2 <= to && (r.finish ?? r.start) + 2 >= from) ?? null;
  };

  for (const w of data.wars) {
    if (w.sides) continue;
    const row = findRow(w.name, w.start, w.end ?? w.start + 100);
    if (row) {
      w.sides = [row.victors, row.defeated];
      w.victorFirst = true;
      overrides[w.id] = { sides: w.sides, victorFirst: true, source: `enwiki-list:${row.name}` };
      hitW++;
    }
  }
  for (const b of data.battles) {
    if (b.sides) continue;
    const row = findRow(b.name, b.year, b.endYear ?? b.year);
    if (row) {
      b.sides = [row.victors, row.defeated];
      b.victorFirst = true;
      overrides[b.id] = { sides: b.sides, victorFirst: true, source: `enwiki-list:${row.name}` };
      hitB++;
    }
  }

  // 3) write back + cache for future fetch-wars.js runs
  writeFileSync(warsFile, JSON.stringify(data), "utf8");
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(overrides, null, 1), "utf8");

  console.log(`Matched: +${hitW} wars, +${hitB} battles`);
  console.log(
    `Now sided: wars ${data.wars.filter((w) => w.sides).length}/${data.wars.length}, battles ${
      data.battles.filter((b) => b.sides).length
    }/${data.battles.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
