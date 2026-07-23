// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Fetches notable battles/sieges (precise coordinates + dates) and wars (date
// ranges) from Wikidata for the globe's war layer. Battles carry the pins;
// their part-of war/campaign provides the umbrella label. WWI/WWII are typed
// "world war" (Q103495), not "war" (Q198), hence the VALUES lists.
// Output: public/data/wars.json  Usage: node fetch-wars.js

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outFile = join(__dirname, "..", "public", "data", "wars.json");

const MIN_BATTLE_SITELINKS = 12;
const MIN_WAR_SITELINKS = 25;
const UA = "wellknownable-data-fetcher/0.1 (https://github.com/apsisxcoder; arslan.muh.93@gmail.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(sparql, attempt = 1) {
  const res = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/sparql-results+json",
      "User-Agent": UA,
    },
    body: new URLSearchParams({ query: sparql }),
  });
  if (!res.ok) {
    if ([502, 503, 504, 429].includes(res.status) && attempt < 4) {
      console.log(`  HTTP ${res.status}, retrying (10s)...`);
      await sleep(10000);
      return query(sparql, attempt + 1);
    }
    throw new Error(`WDQS error: ${res.status}`);
  }
  try {
    return (await res.json()).results.bindings;
  } catch (err) {
    if (attempt < 4) {
      await sleep(10000);
      return query(sparql, attempt + 1);
    }
    throw err;
  }
}

const parseYear = (v) => {
  const m = v?.match(/^(-?\d+)-/);
  return m ? parseInt(m[1], 10) : null;
};

const parseCoord = (wkt) => {
  const m = wkt?.match(/Point\(([-\d.eE+]+) ([-\d.eE+]+)\)/);
  return m ? { lon: parseFloat(m[1]), lat: parseFloat(m[2]) } : null;
};

async function main() {
  // ---- battles & sieges: the pins (coordinate required) ----
  console.log("Fetching battles & sieges...");
  // P361 often points at a theater/campaign ("Eastern Front"), so also walk the
  // part-of chain up until an actual war entity — that's what lets the UI show
  // "all battles of the active war" (Stalingrad -> WWII, not just Eastern Front)
  // types: battle, siege, offensive (Büyük Taarruz is an "offensive").
  // Coordinate: the battle's own P625, or its location's (Sakarya has none of
  // its own but its location does) — battles with neither are dropped in JS.
  const battleRows = await query(`
SELECT ?b ?bLabel ?t ?start ?end ?coord ?locCoord ?sl ?partLabel ?war ?warLabel WHERE {
  VALUES ?type { wd:Q178561 wd:Q188055 wd:Q2001676 }
  ?b wdt:P31 ?type; wikibase:sitelinks ?sl.
  FILTER(?sl >= ${MIN_BATTLE_SITELINKS})
  OPTIONAL { ?b wdt:P625 ?coord. }
  OPTIONAL { ?b wdt:P276 ?locE. ?locE wdt:P625 ?locCoord. }
  OPTIONAL { ?b wdt:P585 ?t. }
  OPTIONAL { ?b wdt:P580 ?start. }
  OPTIONAL { ?b wdt:P582 ?end. }
  OPTIONAL { ?b wdt:P361 ?part. }
  OPTIONAL {
    ?b wdt:P361+ ?war.
    ?war wdt:P31/wdt:P279* wd:Q198.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`);

  const clean = (v) => (v && !/^Q\d+$/.test(v) ? v : null);
  const battles = new Map();
  for (const r of battleRows) {
    const id = r.b.value.split("/").pop();
    const year = parseYear(r.t?.value) ?? parseYear(r.start?.value);
    if (year == null) continue; // no usable date -> can't place on the slider
    const coord = parseCoord(r.coord?.value) ?? parseCoord(r.locCoord?.value);
    if (!coord) continue;
    const warId = r.war ? r.war.value.split("/").pop() : null;
    let b = battles.get(id);
    if (!b) {
      b = {
        id,
        name: r.bLabel?.value ?? id,
        year,
        endYear: parseYear(r.end?.value), // sieges can span years; usually null
        coord,
        sitelinks: parseInt(r.sl.value, 10),
        theater: clean(r.partLabel?.value), // direct part-of ("Eastern Front")
        warId: null, // the resolved actual war ("World War II") — joined below
        warName: null,
      };
      battles.set(id, b);
    }
    // a battle can chain up to several wars; keep them all as candidates and
    // pick the most notable one after the wars list is known
    if (warId) (b._warCands ??= new Map()).set(warId, clean(r.warLabel?.value));
    if (!b.theater) b.theater = clean(r.partLabel?.value);
  }

  await sleep(1500);

  // ---- battle combatants (P710): who fought whom, for the "X vs Y" line ----
  console.log("Fetching battle combatants...");
  const combRows = await query(`
SELECT ?b ?p ?pLabel WHERE {
  VALUES ?type { wd:Q178561 wd:Q188055 wd:Q2001676 }
  ?b wdt:P31 ?type; wikibase:sitelinks ?sl; wdt:P710 ?p.
  FILTER(?sl >= ${MIN_BATTLE_SITELINKS})
  ?p rdfs:label ?pLabel. FILTER(LANG(?pLabel) = "en")
}`);
  const partIds = new Set();
  for (const r of combRows) {
    const b = battles.get(r.b.value.split("/").pop());
    const label = r.pLabel?.value;
    const pid = r.p.value.split("/").pop();
    if (b && label && !/^Q\d+$/.test(label)) {
      b._comb ??= new Map();
      if (b._comb.size < 12) {
        b._comb.set(pid, label);
        partIds.add(pid);
      }
    }
  }

  await sleep(1500);

  // ---- wars: date ranges + participants (the umbrella + sides fallback) ----
  console.log("Fetching wars...");
  const warRows = await query(`
SELECT ?w ?wLabel ?start ?end ?sl ?p ?pLabel WHERE {
  ?w wdt:P31/wdt:P279* wd:Q198; wikibase:sitelinks ?sl; wdt:P580 ?start.
  FILTER(?sl >= ${MIN_WAR_SITELINKS})
  OPTIONAL { ?w wdt:P582 ?end. }
  OPTIONAL {
    ?w wdt:P710 ?p.
    ?p rdfs:label ?pLabel. FILTER(LANG(?pLabel) = "en")
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`);

  const wars = new Map();
  for (const r of warRows) {
    const id = r.w.value.split("/").pop();
    let w = wars.get(id);
    if (!w) {
      const start = parseYear(r.start?.value);
      if (start == null) continue;
      w = {
        id,
        name: r.wLabel?.value ?? id,
        start,
        end: parseYear(r.end?.value), // null = ongoing
        sitelinks: parseInt(r.sl.value, 10),
      };
      wars.set(id, w);
    }
    const pid = r.p ? r.p.value.split("/").pop() : null;
    const plabel = clean(r.pLabel?.value);
    if (pid && plabel) {
      w._comb ??= new Map();
      if (w._comb.size < 12) {
        w._comb.set(pid, plabel);
        partIds.add(pid);
      }
    }
  }

  // some conflicts carry both a war-ish and a battle-ish P31 ("Iraq War" is
  // typed war AND offensive) — if it's in the wars list, it isn't a pin
  for (const id of [...battles.keys()]) if (wars.has(id)) battles.delete(id);

  await sleep(1500);

  // ---- who belongs to whom (P463 member-of / P361 part-of between combatants):
  // Wikidata lists sides flat ("Australia, UK, Allies, Central Powers"), but the
  // membership edges let us fold members under their alliance -> real two sides
  console.log(`Fetching membership among ${partIds.size} combatant entities...`);
  const memberOf = new Map(); // child id -> Set(parent ids)
  const idList = [...partIds];
  for (let i = 0; i < idList.length; i += 250) {
    const values = idList.slice(i, i + 250).map((id) => `wd:${id}`).join(" ");
    // membership is written in both directions on Wikidata: country P463/P361
    // alliance, and/or alliance P527 (has part) country — accept either edge
    const rows = await query(`
SELECT ?a ?b WHERE {
  VALUES ?a { ${values} }
  { ?a (wdt:P463|wdt:P361) ?b. } UNION { ?b wdt:P527 ?a. }
}`);
    for (const r of rows) {
      const a = r.a.value.split("/").pop();
      const b = r.b.value.split("/").pop();
      if (partIds.has(b)) (memberOf.get(a) ?? memberOf.set(a, new Set()).get(a)).add(b);
    }
    if (i + 250 < idList.length) await sleep(1000);
  }

  // fold a flat combatant map into exactly two camps (alliance anchors + their
  // members), or null when the split isn't clean enough to trust
  function foldSides(comb) {
    const ids = [...comb.keys()];
    if (ids.length === 2) return [[comb.get(ids[0])], [comb.get(ids[1])]];
    if (ids.length < 2) return null;
    const groups = new Map(); // anchor id -> member ids
    const loose = [];
    for (const id of ids) {
      const parents = [...(memberOf.get(id) ?? [])].filter((p) => p !== id && comb.has(p));
      if (parents.length) {
        (groups.get(parents[0]) ?? groups.set(parents[0], []).get(parents[0])).push(id);
      } else if (ids.some((o) => o !== id && memberOf.get(o)?.has(id))) {
        groups.get(id) ?? groups.set(id, []); // an anchor someone points at
      } else {
        loose.push(id); // neither a member nor an anchor
      }
    }
    if (groups.size === 2 && loose.length === 0) {
      return [...groups.entries()].map(([anchor, members]) => [comb.get(anchor), ...members.map((m) => comb.get(m))]);
    }
    // last chance: exactly two bloc-named entries ("Allies...", "Axis Powers",
    // "Central Powers"...) ARE the two sides — the loose countries they cover
    // are redundant next to their bloc, so drop them (WWI/WWII lack membership
    // edges on Wikidata, this is what makes those fold at all)
    const bloc = /\b(allies|axis|central powers|coalition|entente|pact|alliance)\b/i;
    const blocs = ids.filter((id) => bloc.test(comb.get(id)));
    if (blocs.length === 2) return [[comb.get(blocs[0])], [comb.get(blocs[1])]];
    return null;
  }

  for (const b of battles.values()) {
    if (!b._comb) continue;
    b.combatants = [...b._comb.values()]; // flat list stays as the fallback
    const sides = foldSides(b._comb);
    if (sides) b.sides = sides;
    delete b._comb;
  }
  for (const w of wars.values()) {
    if (!w._comb) continue;
    w.participants = [...w._comb.values()].slice(0, 8);
    const sides = foldSides(w._comb);
    if (sides) w.sides = sides;
    delete w._comb;
  }
  for (const w of wars.values()) w.participants ??= [];

  // resolve each battle's war: prefer the candidate that's in our notable wars
  // list (most sitelinks wins); otherwise keep the first candidate's label
  for (const b of battles.values()) {
    if (b._warCands) {
      let best = null;
      for (const [wid, wlabel] of b._warCands) {
        const w = wars.get(wid);
        if (w && (!best || w.sitelinks > best.sl)) best = { id: wid, name: w.name, sl: w.sitelinks };
        if (!best && wlabel) best = { id: wid, name: wlabel, sl: -1 };
      }
      if (best) {
        b.warId = best.id;
        b.warName = best.name;
      }
      delete b._warCands;
    }
    // display fallback: a theater label is better than nothing
    if (!b.warName && b.theater) b.warName = b.theater;
  }

  // re-apply the Wikipedia list-of-wars sides cache (built by
  // enrich-war-sides.js) so a data refresh doesn't lose the filled-in sides
  const cacheFile = join(__dirname, "output", "war-sides-wiki.json");
  if (existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
    let applied = 0;
    for (const list of [battles, wars]) {
      for (const x of list.values()) {
        const c = cached[x.id];
        if (c && !x.sides) {
          x.sides = c.sides;
          x.victorFirst = true;
          applied++;
        }
      }
    }
    console.log(`Applied ${applied} cached sides from the Wikipedia lists.`);
  }

  const out = {
    battles: [...battles.values()].sort((a, b) => b.sitelinks - a.sitelinks),
    wars: [...wars.values()].sort((a, b) => b.sitelinks - a.sitelinks),
  };
  writeFileSync(outFile, JSON.stringify(out), "utf8");

  const kb = Math.round(Buffer.byteLength(JSON.stringify(out)) / 1024);
  console.log(`${out.battles.length} battles, ${out.wars.length} wars -> wars.json (${kb} KB)`);
  console.log("Battle year coverage:",
    `BC: ${out.battles.filter((b) => b.year < 0).length},`,
    `1-1500: ${out.battles.filter((b) => b.year >= 1 && b.year <= 1500).length},`,
    `1500+: ${out.battles.filter((b) => b.year > 1500).length}`);
  console.log("Top battles:", out.battles.slice(0, 6).map((b) => `${b.name} (${b.year})`).join(", "));
  console.log("Top wars:", out.wars.slice(0, 6).map((w) => `${w.name} (${w.start}-${w.end ?? "..."})`).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
