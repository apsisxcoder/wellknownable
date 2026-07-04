import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

// GitHub Pages has no server-side rewrites (no .htaccess), so a direct hit to
// /person/xxx would 404. Serving the SPA as 404.html makes the router boot and
// resolve the URL on the client. (Phase D: ViteSSG will prerender real pages
// that return 200; this fallback only backstops non-prerendered routes.)
function spaFallback() {
  return {
    name: "spa-404-fallback",
    apply: "build",
    enforce: "post",
    writeBundle(options) {
      const dir = options.dir || resolve("dist");
      copyFileSync(resolve(dir, "index.html"), resolve(dir, "404.html"));
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), spaFallback()],
});
