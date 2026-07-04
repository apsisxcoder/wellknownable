// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Repairs entries whose name came back broken from the label service:
// either a raw QID ("Q1035"), or a non-Latin-script label even though an
// English label exists on Wikidata. Scans _server/output/people-*.json,
// refetches labels in batches of 100, rewrites the files in place.
// Usage: node fix-labels.js

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "output");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchLabels(ids, attempt = 1) {
  const values = ids.map((id) => `wd:${id}`).join(" ");
  // fetch the English label explicitly; label-service fallback chains sometimes
  // returned Russian/other languages even when an English label existed
  const query = `
SELECT ?person ?enLabel ?personLabel ?personDescription WHERE {
  VALUES ?person { ${values} }
  OPTIONAL { ?person rdfs:label ?enLabel. FILTER(LANG(?enLabel) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,de,fr,es,it,tr". }
}`;
  const res = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/sparql-results+json",
      "User-Agent": "wellknownable-data-fetcher/0.1 (https://github.com/apsisxcoder; arslan.muh.93@gmail.com)",
    },
    body: new URLSearchParams({ query }),
  });
  if (!res.ok) {
    if (attempt < 4) {
      console.log(`  batch failed with ${res.status}, retrying (10s)...`);
      await sleep(10000);
      return fetchLabels(ids, attempt + 1);
    }
    throw new Error(`WDQS error: ${res.status}`);
  }
  try {
    const data = await res.json();
    const map = new Map();
    for (const row of data.results.bindings) {
      const id = row.person.value.split("/").pop();
      if (map.has(id) && map.get(id).name && !/^Q\d+$/.test(map.get(id).name)) continue;
      map.set(id, {
        name: row.enLabel?.value ?? row.personLabel?.value ?? id,
        description: row.personDescription?.value ?? null,
      });
    }
    return map;
  } catch (err) {
    if (attempt < 4) {
      await sleep(10000);
      return fetchLabels(ids, attempt + 1);
    }
    throw err;
  }
}

async function main() {
  const files = readdirSync(outputDir).filter((f) => /^people-.*\.json$/.test(f));
  const broken = new Set();
  const fileData = new Map();

  for (const file of files) {
    const people = JSON.parse(readFileSync(join(outputDir, file), "utf8"));
    fileData.set(file, people);
    for (const p of people) {
      // raw QIDs, or names that slipped through in a non-Latin script
      // (Cyrillic/Greek/CJK/Arabic etc.) even though an English label exists
      if (/^Q\d+$/.test(p.name) || /[Ѐ-ӿͰ-Ͽ一-鿿؀-ۿ぀-ヿ가-힯]/.test(p.name)) {
        broken.add(p.id);
      }
    }
  }

  if (broken.size === 0) {
    console.log("No broken names, nothing to do.");
    return;
  }
  console.log(`${broken.size} broken names found, repairing...`);

  const ids = [...broken];
  const labels = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const map = await fetchLabels(batch);
    for (const [k, v] of map) labels.set(k, v);
    if (i + 100 < ids.length) await sleep(1500);
  }

  let fixed = 0;
  let stillBroken = 0;
  for (const [file, people] of fileData) {
    let touched = false;
    for (const p of people) {
      if (!broken.has(p.id)) continue;
      const repair = labels.get(p.id);
      if (repair && !/^Q\d+$/.test(repair.name) && repair.name !== p.name) {
        p.name = repair.name;
        p.description = p.description ?? repair.description;
        fixed++;
        touched = true;
      } else {
        stillBroken++;
      }
    }
    if (touched) writeFileSync(join(outputDir, file), JSON.stringify(people, null, 2), "utf8");
  }
  console.log(`Repaired: ${fixed}, still broken (genuinely no usable label): ${stillBroken}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
