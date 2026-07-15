// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Prerenders the top-N most famous people into real static HTML pages:
// dist/person/<slug>/index.html — each returns HTTP 200 with a unique title,
// meta description, canonical URL, Open Graph tags, ProfilePage/Person JSON-LD
// and visible content (bio atoms + contemporaries) that crawlers and AI bots
// can read without JavaScript. The SPA mounts on top and takes over.
// Runs after `vite build`. Usage: node build-prerender.js

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { personSlug } from "../src/lib/slug.js";
import { endYear as lifespanEnd } from "../src/lib/lifespan.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const distDir = join(root, "dist");
const BASE = "https://wellknownable.com";
const TOP_N = Infinity; // every person gets a real static page (was top-5000)
const FAME_POOL = 2000; // contemporaries are picked among the most famous

if (!existsSync(join(distDir, "index.html"))) {
  console.error("dist/index.html not found — run `vite build` first.");
  process.exit(1);
}

const template = readFileSync(join(distDir, "index.html"), "utf8");
const people = JSON.parse(readFileSync(join(root, "public", "data", "people.json"), "utf8"));

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const NOW = new Date().getFullYear();
// same 100-years-alive / assumed-80y heuristic as the timeline, globe and alive-in
const endYear = (p) => lifespanEnd(p, NOW);
const fmtYear = (y) => (y < 0 ? `${-y} BC` : `${y}`);
const years = (p) => `${fmtYear(p.birthYear)}–${p.deathYear ? fmtYear(p.deathYear) : ""}`;

// ISO date strings for schema.org (year precision is all Wikidata gives us here)
const isoYear = (y) => (y < 0 ? `-${String(-y).padStart(4, "0")}` : String(y).padStart(4, "0"));

const byFame = [...people].sort((a, b) => b.sitelinks - a.sitelinks);
// the founding team (custom entries) always gets a page, fame notwithstanding
const custom = people.filter((p) => p.id.startsWith("CUSTOM-"));
const top = [...new Set([...byFame.slice(0, TOP_N), ...custom])];
const famePool = byFame.slice(0, FAME_POOL);

for (const p of people) p.slug = personSlug(p);

function contemporaries(p, n = 8) {
  const start = p.birthYear;
  const end = endYear(p);
  // require a meaningful overlap (15y, or half a short life) so Einstein gets
  // Gandhi and Churchill rather than a 9-year-overlap Donald Trump
  const minOverlap = Math.max(1, Math.min(15, Math.floor((end - start) / 2)));
  const out = [];
  const weak = [];
  for (const c of famePool) {
    if (c.id === p.id) continue;
    const ov = Math.min(end, endYear(c)) - Math.max(start, c.birthYear);
    if (ov >= minOverlap) {
      out.push(c);
      if (out.length === n) return out;
    } else if (ov > 0 && weak.length < n) {
      weak.push(c);
    }
  }
  return out.concat(weak).slice(0, n);
}

function metaDescription(p, contemps) {
  const bits = [`${p.name} (${years(p)})`];
  if (p.description) bits.push(`${p.description}.`);
  if (p.birthPlace) bits.push(`Born in ${p.birthPlace}.`);
  const names = contemps.slice(0, 3).map((c) => c.name);
  if (names.length) bits.push(`Lived alongside ${names.join(", ")}.`);
  bits.push(`See their life on an interactive timeline of ${people.length.toLocaleString("en-US")} well-known lives.`);
  return bits.join(" ").slice(0, 300);
}

function jsonLd(p, url, contemps) {
  const person = {
    "@type": "Person",
    "@id": `${BASE}/person/${p.slug}/#person`,
    name: p.name,
    birthDate: isoYear(p.birthYear),
  };
  if (p.deathYear) person.deathDate = isoYear(p.deathYear);
  if (p.description) person.description = p.description;
  if (p.image) person.image = BASE + p.image;
  if (p.birthPlace) person.birthPlace = { "@type": "Place", name: p.birthPlace };
  if (p.occupations?.length) person.hasOccupation = p.occupations.map((o) => ({ "@type": "Occupation", name: o }));
  const sameAs = [];
  if (p.wikipedia) sameAs.push(p.wikipedia);
  if (/^Q\d+$/.test(p.id)) sameAs.push(`https://www.wikidata.org/wiki/${p.id}`);
  if (sameAs.length) person.sameAs = sameAs;
  person.knows = contemps.slice(0, 3).map((c) => ({ "@type": "Person", name: c.name, url: `${BASE}/person/${c.slug}/` }));

  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    dateModified: new Date().toISOString(), // full ISO 8601 datetime — Google rejects date-only here
    url,
    mainEntity: person,
  });
}

// era-page links for every decade of the person's life — each of the 5k person
// pages feeds the /alive-in hubs, and every hub links 80 people back, so the two
// page types keep lifting each other in the internal link graph
function decadeLinks(p) {
  const first = Math.max(10, Math.ceil(p.birthYear / 10) * 10); // era pages start at decade 10
  const last = Math.min(endYear(p), NOW);
  const links = [];
  for (let d = first; d <= last; d += 10) {
    links.push(`<a href="/alive-in/${d}/">${d}</a>`);
  }
  if (!links.length) return "";
  return `<p>See everyone who was alive in ${links.join(" · ")}.</p>`;
}

function staticContent(p, contemps) {
  const occ = p.occupations?.length ? `<p class="pp-occ">${esc(p.occupations.join(" · "))}</p>` : "";
  const birth = p.birthPlace ? `<p class="pp-birth">Born in ${esc(p.birthPlace)}</p>` : "";
  const img = p.image
    ? `<img src="${esc(p.image)}" alt="Portrait of ${esc(p.name)}" width="128" height="128" style="border-radius:50%" />`
    : "";
  const links = contemps
    .map((c) => `<li><a href="/person/${c.slug}/">${esc(c.name)}</a> (${years(c)})</li>`)
    .join("");
  return `<div class="pp" style="max-width:640px;margin:40px auto;padding:0 20px;font-family:Georgia,serif;color:#ece7db">
      ${img}
      <h1>${esc(p.name)}</h1>
      <p class="pp-years">${years(p)}</p>
      ${p.description ? `<p class="pp-desc">${esc(p.description)}</p>` : ""}
      ${occ}
      ${birth}
      <h2>Contemporaries</h2>
      <p>People who walked the earth at the same time as ${esc(p.name)}:</p>
      <ul>${links}</ul>
      ${decadeLinks(p)}
      <p><a href="/">Explore the full timeline of ${people.length.toLocaleString("en-US")} well-known lives →</a></p>
    </div>`;
}

let written = 0;
for (const p of top) {
  const url = `${BASE}/person/${p.slug}/`;
  const contemps = contemporaries(p);
  const title = `${p.name} (${years(p)}) | Wellknownable`;
  const desc = metaDescription(p, contemps);
  const ogImage = p.image ? BASE + p.image : `${BASE}/logo.png`;

  let html = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${esc(ogImage)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(
      "</head>",
      `<script type="application/ld+json">${jsonLd(p, url, contemps)}</script>\n</head>`
    )
    .replace('<div id="app"></div>', `<div id="app">${staticContent(p, contemps)}</div>`);

  const dir = join(distDir, "person", p.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html, "utf8");
  written++;
  if (written % 1000 === 0) console.log(`  ${written}/${top.length}`);
}

// SEO shell for the globe view (the WebGL globe itself is client-only, but the
// page needs a real 200 with its own title/description to be indexable)
{
  const url = `${BASE}/globe/`;
  const title = "Interactive History Globe — See Who Was Alive and Where | Wellknownable";
  const desc = `An interactive world globe of ${people.length.toLocaleString("en-US")} famous historical figures. Drag the year slider to see who was alive in any year — and where they were born, from 3000 BC to today.`;
  const globeHtml = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(
      "</head>",
      `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: title,
        description: desc,
        url,
        isPartOf: { "@type": "WebSite", name: "Wellknownable", url: `${BASE}/` },
      })}</script>\n</head>`
    )
    .replace(
      '<div id="app"></div>',
      `<div id="app"><div style="max-width:640px;margin:40px auto;padding:0 20px;font-family:Georgia,serif;color:#ece7db"><h1>Interactive history globe — famous people around the world</h1><p>Spin the interactive globe and drag the year slider through history to see which historical figures were alive in any year, and where on the world map they were born. <a href="/">Or explore the full interactive history timeline →</a></p></div></div>`
    );
  mkdirSync(join(distDir, "globe"), { recursive: true });
  writeFileSync(join(distDir, "globe", "index.html"), globeHtml, "utf8");
}

console.log(`Prerendered ${written} person pages + globe -> dist/person/<slug>/index.html`);
