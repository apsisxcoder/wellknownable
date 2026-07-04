// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Authoritative English-name pass. The SPARQL label service is unreliable under
// load (it returns the QID, or a fallback language, even when an English label
// exists), which once poisoned names like Michael Jackson -> "Майкл Джексон".
// This uses the Wikidata REST API (wbgetentities), which returns English labels
// deterministically, and overwrites every name that has a canonical English label.
// Resumable via output/en-labels.json cache. Usage: node refresh-names.js

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "output");
const cacheFile = join(outputDir, "en-labels.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchLabels(ids, attempt = 1) {
  // English label first; some items (even famous ones like Michael Jackson) have
  // no en label but do have an English Wikipedia article — use its title as the name
  const url =
    "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json" +
    "&props=labels|sitelinks&languages=en&sitefilter=enwiki&ids=" +
    ids.join("|");
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "wellknownable-name-fetcher/0.1 (https://github.com/apsisxcoder; arslan.muh.93@gmail.com)" },
    });
    if (!res.ok) {
      if ([429, 500, 502, 503].includes(res.status) && attempt < 4) {
        await sleep(5000 * attempt);
        return fetchLabels(ids, attempt + 1);
      }
      throw new Error(`API error: ${res.status}`);
    }
    const data = await res.json();
    const map = {};
    for (const [id, entity] of Object.entries(data.entities ?? {})) {
      const name = entity.labels?.en?.value ?? entity.sitelinks?.enwiki?.title;
      if (name) map[id] = name;
    }
    return map;
  } catch (err) {
    if (attempt < 4) {
      await sleep(5000 * attempt);
      return fetchLabels(ids, attempt + 1);
    }
    throw err;
  }
}

async function main() {
  // gather every real QID across the fetched files
  const ids = new Set();
  const files = readdirSync(outputDir).filter((f) => /^people-.*\.json$/.test(f));
  for (const file of files) {
    for (const p of JSON.parse(readFileSync(join(outputDir, file), "utf8"))) {
      if (/^Q\d+$/.test(p.id)) ids.add(p.id);
    }
  }

  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  const todo = [...ids].filter((id) => !(id in cache));
  console.log(`${ids.size} entities, ${todo.length} to look up (rest cached)`);

  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const map = await fetchLabels(batch);
    // record null for ids with genuinely no English label, so we don't refetch
    for (const id of batch) cache[id] = map[id] ?? null;
    writeFileSync(cacheFile, JSON.stringify(cache), "utf8");
    if (i % 1000 === 0) console.log(`  ${Math.min(i + 50, todo.length)}/${todo.length}`);
    await sleep(400);
  }

  // apply: overwrite any name that differs from its canonical English label
  let changed = 0;
  let noEnglish = 0;
  for (const file of files) {
    const people = JSON.parse(readFileSync(join(outputDir, file), "utf8"));
    let touched = false;
    for (const p of people) {
      const en = cache[p.id];
      if (en === null || en === undefined) {
        if (cache[p.id] === null) noEnglish++;
        continue;
      }
      if (p.name !== en) {
        p.name = en;
        changed++;
        touched = true;
      }
    }
    if (touched) writeFileSync(join(outputDir, file), JSON.stringify(people, null, 2), "utf8");
  }

  console.log(`Names updated: ${changed}. Entities with no English label (left as-is): ${noEnglish}`);
  console.log("Next: node build-dataset.js");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
