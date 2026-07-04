// wellknownable — https://wellknownable.com — crafted by apsisxcoder
// Downloads 128px portrait thumbnails from Wikimedia Commons into public/portraits/,
// so the released site has zero runtime dependency on external services.
// Resumable: existing files are skipped. Usage: node download-images.js
//
// Note: Commons images are mostly CC/PD licensed; the person card links back to
// Wikidata/Wikipedia where full attribution lives.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "output");
const portraitsDir = join(__dirname, "..", "public", "portraits");
const WIDTH = 128;
const CONCURRENCY = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };

async function download(p, attempt = 1) {
  const url = `${p.image}?width=${WIDTH}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "wellknownable-image-fetcher/0.1 (https://github.com/apsisxcoder; arslan.muh.93@gmail.com)" },
    });
    if (!res.ok) {
      if ([429, 500, 502, 503].includes(res.status) && attempt < 3) {
        await sleep(5000 * attempt);
        return download(p, attempt + 1);
      }
      return { id: p.id, ok: false, reason: `HTTP ${res.status}` };
    }
    const type = res.headers.get("content-type")?.split(";")[0];
    const ext = EXT[type];
    if (!ext) return { id: p.id, ok: false, reason: `unsupported type: ${type}` };
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(join(portraitsDir, `${p.id}.${ext}`), buf);
    return { id: p.id, ok: true };
  } catch (err) {
    if (attempt < 3) {
      await sleep(5000 * attempt);
      return download(p, attempt + 1);
    }
    return { id: p.id, ok: false, reason: err.message };
  }
}

async function main() {
  mkdirSync(portraitsDir, { recursive: true });

  const byId = new Map();
  for (const file of readdirSync(outputDir).filter((f) => /^people-.*\.json$/.test(f))) {
    for (const p of JSON.parse(readFileSync(join(outputDir, file), "utf8"))) {
      if (p.image && !byId.has(p.id)) byId.set(p.id, { id: p.id, image: p.image.replace(/^http:/, "https:") });
    }
  }

  const existing = new Set(readdirSync(portraitsDir).map((f) => f.replace(/\.\w+$/, "")));
  const todo = [...byId.values()].filter((p) => !existing.has(p.id));
  console.log(`${byId.size} people with images, ${todo.length} to download`);

  let done = 0;
  let failed = 0;
  const failures = [];
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const results = await Promise.all(todo.slice(i, i + CONCURRENCY).map((p) => download(p)));
    for (const r of results) {
      if (r.ok) done++;
      else {
        failed++;
        failures.push(r);
      }
    }
    if ((i / CONCURRENCY) % 40 === 0) console.log(`  ${i + results.length}/${todo.length} (failed: ${failed})`);
    await sleep(50);
  }

  writeFileSync(join(outputDir, "image-failures.json"), JSON.stringify(failures, null, 2), "utf8");
  console.log(`Done: ${done} downloaded, ${failed} failed (see image-failures.json)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
