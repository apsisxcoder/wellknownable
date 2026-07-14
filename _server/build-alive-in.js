// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Prerenders the "who was alive in <year>" era pages, one per decade, into real
// static HTML: dist/alive-in/<year>/index.html — each a 200 with its own title,
// meta description, canonical, Open Graph, CollectionPage/ItemList JSON-LD and a
// visible, crawlable list of the people alive that year (+ prev/next decade links
// so the whole run forms one internal-link chain). The SPA mounts on top.
// Decades only keeps adjacent pages meaningfully different (no thin/dup content);
// the /alive-in/:year route still resolves any exact year a visitor types.
// Runs after `vite build`. Usage: node build-alive-in.js

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { personSlug } from "../src/lib/slug.js";
import { aliveIn } from "../src/lib/lifespan.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const distDir = join(root, "dist");
const BASE = "https://wellknownable.com";
const NOW = new Date().getFullYear();
const LIST = 80; // people rendered per page (fame-ranked)
const MIN_ALIVE = 8; // skip antiquity decades too sparse to be a useful page

if (!existsSync(join(distDir, "index.html"))) {
  console.error("dist/index.html not found — run `vite build` first.");
  process.exit(1);
}

const template = readFileSync(join(distDir, "index.html"), "utf8");
const people = JSON.parse(readFileSync(join(root, "public", "data", "people.json"), "utf8"));
for (const p of people) p.slug = personSlug(p);
const byFame = [...people].sort((a, b) => b.sitelinks - a.sitelinks);

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtYear = (y) => (y < 0 ? `${-y} BC` : `${y}`);
const lifespan = (p) => `${fmtYear(p.birthYear)}–${p.deathYear != null ? fmtYear(p.deathYear) : ""}`;

function aliveInYear(year) {
  return byFame.filter((p) => aliveIn(p, year, NOW));
}

// the decades we actually emit: from the first one dense enough to be worthwhile,
// up to the current decade — a continuous run so prev/next never dead-ends
const maxDecade = Math.floor(NOW / 10) * 10;
let firstDecade = maxDecade;
for (let d = 10; d <= maxDecade; d += 10) {
  if (aliveInYear(d).length >= MIN_ALIVE) { firstDecade = d; break; }
}
const decades = new Set();
for (let d = firstDecade; d <= maxDecade; d += 10) decades.add(d);

// ~155 chars, the searched phrase ("alive in <year>") up front, a few marquee
// names as the CTR hook — Google truncates descriptions around 160 chars
function metaDescription(year, alive) {
  const names = alive.slice(0, 3).map((p) => p.name).join(", ");
  const lead = `${alive.length.toLocaleString("en-US")} well-known people were alive in ${year}`;
  const tail = names ? `, including ${names}. See who lived at the same time, and where.` : ". See who lived at the same time, and where.";
  return (lead + tail).slice(0, 160);
}

function jsonLd(year, url, list) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Who was alive in ${year}?`,
    description: `Well-known people alive in the year ${year}.`,
    url,
    isPartOf: { "@type": "WebSite", name: "Wellknownable", url: `${BASE}/` },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: list.length,
      itemListElement: list.map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${BASE}/person/${p.slug}/`,
        name: p.name,
      })),
    },
  });
}

// BreadcrumbList is a supported rich result (the trail shown under the SERP title)
function breadcrumbLd(year, url) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Wellknownable", item: `${BASE}/` },
      { "@type": "ListItem", position: 2, name: `Alive in ${year}`, item: url },
    ],
  });
}

function staticContent(year, alive, list) {
  const items = list
    .map(
      (p) =>
        `<li><a href="/person/${p.slug}/">${esc(p.name)}</a> (${lifespan(p)})${
          p.description ? ` — ${esc(p.description)}` : ""
        }</li>`
    )
    .join("");
  const prev = decades.has(year - 10)
    ? `<a href="/alive-in/${year - 10}/">← ${year - 10}</a>`
    : "";
  const next = decades.has(year + 10)
    ? `<a href="/alive-in/${year + 10}/">${year + 10} →</a>`
    : "";
  // name a few marquee figures in the visible lead so the above-the-fold text is
  // unique per page (not a shared template sentence) — the top SEO signal here
  const marquee = list.slice(0, 3).map((p) => esc(p.name)).join(", ");
  return `<div class="ai" style="max-width:720px;margin:40px auto;padding:0 20px;font-family:Georgia,serif;color:#ece7db">
      <nav aria-label="Breadcrumb" style="font-size:14px"><a href="/">Wellknownable</a> › Who was alive in ${year}?</nav>
      <p>${prev} ${next}</p>
      <h1>Who was alive in ${year}?</h1>
      <p>${alive.length.toLocaleString("en-US")} well-known people were alive in ${year}${
    marquee ? `, including ${marquee}` : ""
  }.${alive.length > list.length ? ` Here are the ${list.length} most notable:` : ""}</p>
      <ul>${items}</ul>
      <p><a href="/globe/">See who was alive and where on the interactive globe →</a></p>
      <p><a href="/">Explore the full timeline of ${people.length.toLocaleString("en-US")} well-known lives →</a></p>
    </div>`;
}

let written = 0;
for (const year of decades) {
  const alive = aliveInYear(year);
  const list = alive.slice(0, LIST);
  const url = `${BASE}/alive-in/${year}/`;
  const title = `Who Was Alive in ${year}? ${alive.length} Famous People | Wellknownable`;
  const desc = metaDescription(year, alive);

  const html = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(
      "</head>",
      `<script type="application/ld+json">${jsonLd(year, url, list)}</script>\n` +
        `<script type="application/ld+json">${breadcrumbLd(year, url)}</script>\n</head>`
    )
    .replace('<div id="app"></div>', `<div id="app">${staticContent(year, alive, list)}</div>`);

  const dir = join(distDir, "alive-in", String(year));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html, "utf8");
  written++;
}

console.log(`Prerendered ${written} alive-in pages (${firstDecade}–${maxDecade}) -> dist/alive-in/<year>/index.html`);
