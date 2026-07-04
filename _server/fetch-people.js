// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Fetches notable people born in a given year range from Wikidata.
// Usage:   node fetch-people.js [fromYear] [toYear] [minSitelinks] [chunkYears]
// Example: node fetch-people.js 1800 1900 40 10   -> fetch in 10-year chunks (avoids WDQS timeouts)
// Output:  _server/output/people-<from>-<to>.json

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const [, , fromArg = "1", toArg = "100", minSitelinksArg = "15", chunkArg] = process.argv;
const fromYear = parseInt(fromArg, 10);
const toYear = parseInt(toArg, 10);
const minSitelinks = parseInt(minSitelinksArg, 10);
const chunkYears = chunkArg ? parseInt(chunkArg, 10) : toYear - fromYear + 1;

// year as an xsd:dateTime string (negative years = BC)
function yearToDate(year) {
  const y = String(Math.abs(year)).padStart(4, "0");
  return `${year < 0 ? "-" : ""}${y}-01-01T00:00:00Z`;
}

function buildQuery(from, to) {
  return `
SELECT ?person ?personLabel ?personDescription ?birth ?death ?image ?sitelinks WHERE {
  ?person wdt:P31 wd:Q5;
          wdt:P569 ?birth. hint:Prior hint:rangeSafe true.
  ?person wikibase:sitelinks ?sitelinks.
  OPTIONAL { ?person wdt:P570 ?death. }
  OPTIONAL { ?person wdt:P18 ?image. }
  FILTER("${yearToDate(from)}"^^xsd:dateTime <= ?birth && ?birth < "${yearToDate(to + 1)}"^^xsd:dateTime)
  FILTER(?sitelinks >= ${minSitelinks})
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 5000
`;
}

function parseYear(dateTime) {
  if (!dateTime) return null;
  const m = dateTime.match(/^(-?\d+)-/);
  return m ? parseInt(m[1], 10) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchChunk(from, to, attempt = 1) {
  const res = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/sparql-results+json",
      "User-Agent": "wellknownable-data-fetcher/0.1 (https://github.com/apsisxcoder; arslan.muh.93@gmail.com)",
    },
    body: new URLSearchParams({ query: buildQuery(from, to) }),
  });

  if (!res.ok) {
    if ([502, 503, 504, 429].includes(res.status) && attempt < 4) {
      console.log(`  ${from}-${to}: HTTP ${res.status}, retry ${attempt} (waiting 10s)...`);
      await sleep(10000);
      return fetchChunk(from, to, attempt + 1);
    }
    throw new Error(`WDQS error (${from}-${to}): ${res.status} ${res.statusText}`);
  }

  try {
    const data = await res.json();
    return data.results.bindings;
  } catch (err) {
    if (attempt < 4) {
      console.log(`  ${from}-${to}: malformed response (${err.message}), retry ${attempt} (waiting 10s)...`);
      await sleep(10000);
      return fetchChunk(from, to, attempt + 1);
    }
    throw err;
  }
}

async function main() {
  console.log(`Query: births ${fromYear} to ${toYear}, min ${minSitelinks} sitelinks, ${chunkYears}-year chunks...`);

  const byId = new Map();
  for (let start = fromYear; start <= toYear; start += chunkYears) {
    const end = Math.min(start + chunkYears - 1, toYear);
    const rows = await fetchChunk(start, end);
    let added = 0;
    for (const row of rows) {
      const id = row.person.value.split("/").pop();
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        name: row.personLabel?.value ?? id,
        description: row.personDescription?.value ?? null,
        birthYear: parseYear(row.birth?.value),
        deathYear: parseYear(row.death?.value),
        image: row.image?.value ?? null,
        sitelinks: parseInt(row.sitelinks.value, 10),
      });
      added++;
    }
    console.log(`  ${start}-${end}: +${added} people (total ${byId.size})`);
    if (end < toYear) await sleep(1500);
  }

  const people = [...byId.values()].sort((a, b) => b.sitelinks - a.sitelinks);

  const outDir = join(__dirname, "output");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `people-${fromYear}-${toYear}.json`);
  writeFileSync(outFile, JSON.stringify(people, null, 2), "utf8");

  console.log(`${people.length} people found -> ${outFile}`);
  console.log("Top 10:");
  for (const p of people.slice(0, 10)) {
    console.log(`  ${p.name} (${p.birthYear ?? "?"} - ${p.deathYear ?? "?"}) [${p.sitelinks} sitelinks]${p.image ? "" : " [no image]"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
