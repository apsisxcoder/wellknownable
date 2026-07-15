import { defineStore } from "pinia";
import { personSlug } from "../lib/slug.js";

export const usePeopleStore = defineStore("people", {
  state: () => ({
    people: [],
    slugIndex: {}, // slug -> person, for resolving /person/:slug URLs
    atlasMeta: null, // { cell, cols, per, atlasSize }
    atlasIndex: {}, // person id -> position in the fame-ordered atlas packing
    loading: true,
    selectedId: null,
    flySeq: 0, // bumped on every select so re-selecting the same person still triggers the fly-to
  }),

  getters: {
    selected(state) {
      if (!state.selectedId) return null;
      return state.people.find((p) => p.id === state.selectedId) ?? null;
    },

    bySlug: (state) => (slug) => state.slugIndex[slug] ?? null,

    // fame-ordered once (cached) so the timeline can grab the top-N in a window
    // without re-sorting all 24k people on every drag frame
    peopleByFame(state) {
      return [...state.people].sort((a, b) => b.sitelinks - a.sitelinks);
    },

    // atlas cell for a person, or null if they aren't packed (fall back to their
    // individual portrait). Returns the source rect within the atlas image.
    avatar: (state) => (id) => {
      if (!state.atlasMeta) return null;
      const i = state.atlasIndex[id];
      if (i === undefined) return null;
      const { per, cols, cell } = state.atlasMeta;
      const within = i % per;
      return {
        url: `${import.meta.env.BASE_URL}atlases/a${Math.floor(i / per)}.webp`,
        col: within % cols,
        row: Math.floor(within / cols),
        cols,
        cell,
      };
    },

    // birth counts per century -> the bubbles of the zoomed-out view
    centuries(state) {
      const counts = new Map();
      for (const p of state.people) {
        const c = Math.floor(p.birthYear / 100) * 100;
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([start, count]) => ({ start, count }))
        .sort((a, b) => a.start - b.start);
    },
  },

  actions: {
    // dataset ships as a static file, fetched once at startup: it stays out of
    // the JS bundle (fast first paint) and the browser caches it separately
    async load() {
      if (this.people.length) return;
      try {
        const base = import.meta.env.BASE_URL;
        const [data, atlas] = await Promise.all([
          fetch(`${base}data/people.json`).then((r) => r.json()),
          fetch(`${base}data/atlas-map.json`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ]);
        const index = {};
        for (const p of data) {
          p.slug = personSlug(p);
          index[p.slug] = p;
        }
        this.people = data;
        this.slugIndex = index;
        if (atlas) {
          this.atlasMeta = { cell: atlas.cell, cols: atlas.cols, per: atlas.per, atlasSize: atlas.atlasSize };
          const ai = {};
          atlas.ids.forEach((id, i) => (ai[id] = i));
          this.atlasIndex = ai;
        }
      } finally {
        this.loading = false;
      }
    },

    select(id) {
      this.selectedId = id;
      this.flySeq++;
      // GA key event: which people do visitors actually look at?
      if (typeof window !== "undefined" && typeof window.gtag === "function") {
        const p = this.selected;
        if (p) window.gtag("event", "select_person", { person_id: p.id, person_name: p.name });
      }
    },

    clear() {
      this.selectedId = null;
    },
  },
});
