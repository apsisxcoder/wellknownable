// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Enriches fetched people with occupation, country, birthplace (+coordinates)
// and the English Wikipedia article URL, in batches of 100 QIDs.
// Results accumulate in _server/output/enrich.json (resumable: re-run skips done ids).
// Usage: node enrich-people.js

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "output");
const enrichFile = join(outputDir, "enrich.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildQuery(ids) {
  const values = ids.map((id) => `wd:${id}`).join(" ");
  return `
SELECT ?person ?countryLabel ?birthPlaceLabel ?coord ?article
       (GROUP_CONCAT(DISTINCT ?occLabel; separator="|") AS ?occs)
WHERE {
  VALUES ?person { ${values} }
  OPTIONAL {
    ?person wdt:P106 ?occ.
    ?occ rdfs:label ?occLabel. FILTER(LANG(?occLabel) = "en")
  }
  OPTIONAL { ?person wdt:P27 ?country. }
  OPTIONAL {
    ?person wdt:P19 ?birthPlace.
    OPTIONAL { ?birthPlace wdt:P625 ?coord. }
  }
  OPTIONAL {
    ?article schema:about ?person;
             schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?person ?countryLabel ?birthPlaceLabel ?coord ?article
`;
}

function parseCoord(wkt) {
  // "Point(66.9 36.7)" -> { lon, lat }
  const m = wkt?.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
  return m ? { lon: parseFloat(m[1]), lat: parseFloat(m[2]) } : null;
}

async function fetchBatch(ids, attempt = 1) {
  const res = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/sparql-results+json",
      "User-Agent": "wellknownable-data-fetcher/0.1 (https://github.com/apsisxcoder; arslan.muh.93@gmail.com)",
    },
    body: new URLSearchParams({ query: buildQuery(ids) }),
  });
  if (!res.ok) {
    if ([502, 503, 504, 429].includes(res.status) && attempt < 4) {
      console.log(`  HTTP ${res.status}, retrying (10s)...`);
      await sleep(10000);
      return fetchBatch(ids, attempt + 1);
    }
    throw new Error(`WDQS error: ${res.status}`);
  }
  try {
    return (await res.json()).results.bindings;
  } catch (err) {
    if (attempt < 4) {
      console.log(`  malformed response, retrying (10s)...`);
      await sleep(10000);
      return fetchBatch(ids, attempt + 1);
    }
    throw err;
  }
}

async function main() {
  // collect every fetched person id
  const allIds = new Set();
  for (const file of readdirSync(outputDir).filter((f) => /^people-.*\.json$/.test(f))) {
    for (const p of JSON.parse(readFileSync(join(outputDir, file), "utf8"))) allIds.add(p.id);
  }

  const enriched = existsSync(enrichFile) ? JSON.parse(readFileSync(enrichFile, "utf8")) : {};
  const todo = [...allIds].filter((id) => !(id in enriched));
  console.log(`${allIds.size} people total, ${todo.length} to enrich`);

  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    const rows = await fetchBatch(batch);

    // a person can still produce multiple rows (several countries/birthplaces);
    // keep the first row, prefer one that has coordinates
    const byId = new Map();
    for (const row of rows) {
      const id = row.person.value.split("/").pop();
      const entry = {
        occupations: row.occs?.value ? row.occs.value.split("|").slice(0, 3) : [],
        country: row.countryLabel?.value ?? null,
        birthPlace: row.birthPlaceLabel?.value ?? null,
        coord: parseCoord(row.coord?.value),
        wikipedia: row.article?.value ?? null,
      };
      const prev = byId.get(id);
      if (!prev || (!prev.coord && entry.coord)) byId.set(id, entry);
    }
    for (const id of batch) enriched[id] = byId.get(id) ?? { occupations: [], country: null, birthPlace: null, coord: null, wikipedia: null };

    writeFileSync(enrichFile, JSON.stringify(enriched), "utf8");
    console.log(`  ${Math.min(i + 100, todo.length)}/${todo.length}`);
    if (i + 100 < todo.length) await sleep(1200);
  }

  console.log(`Done -> ${enrichFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
