import { defineStore } from "pinia";
import peopleData from "../data/people.json";

export const usePeopleStore = defineStore("people", {
  state: () => ({
    people: peopleData,
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
    select(id) {
      this.selectedId = id;
      this.flySeq++;
    },
    clear() {
      this.selectedId = null;
    },
  },
});
