// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Generates public/sitemap.xml. Right now only the homepage is a real 200 page,
// so that's all we list — submitting SPA person routes (which return 404 via the
// 404.html fallback) would harm indexing. Once ViteSSG prerenders person pages
// into real 200 HTML, flip INCLUDE_PEOPLE to true to list the top N by fame.
// Usage: node build-sitemap.js

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { personSlug } from "../src/lib/slug.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const BASE = "https://wellknownable.com";

const INCLUDE_PEOPLE = true; // /person/<slug>/ pages are prerendered by build-prerender.js
const TOP_N = 5000;

const urls = [{ loc: `${BASE}/`, priority: "1.0" }];

if (INCLUDE_PEOPLE) {
  const people = JSON.parse(readFileSync(join(publicDir, "data", "people.json"), "utf8"));
  const byFame = [...people].sort((a, b) => b.sitelinks - a.sitelinks).slice(0, TOP_N);
  const custom = people.filter((p) => p.id.startsWith("CUSTOM-"));
  const top = [...new Set([...byFame, ...custom])];
  for (const p of top) urls.push({ loc: `${BASE}/person/${personSlug(p)}/`, priority: "0.6" });
}

const today = new Date().toISOString().slice(0, 10);
const body = urls
  .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${u.priority}</priority>\n  </url>`)
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;

writeFileSync(join(publicDir, "sitemap.xml"), xml, "utf8");
console.log(`sitemap.xml: ${urls.length} url${urls.length === 1 ? "" : "s"}`);
