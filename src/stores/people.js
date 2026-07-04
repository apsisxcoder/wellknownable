import { defineStore } from "pinia";

export const usePeopleStore = defineStore("people", {
  state: () => ({
    people: [],
    loading: true,
    selectedId: null,
    flySeq: 0, // bumped on every select so re-selecting the same person still triggers the fly-to
  }),

  getters: {
    selected(state) {
      if (!state.selectedId) return null;
      return state.people.find((p) => p.id === state.selectedId) ?? null;
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
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}data/people.json`);
        this.people = await res.json();
      } finally {
        this.loading = false;
      }
    },

    select(id) {
      this.selectedId = id;
      this.flySeq++;
    },

    clear() {
      this.selectedId = null;
    },
  },
});
