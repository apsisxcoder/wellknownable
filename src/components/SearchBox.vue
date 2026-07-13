<script>
import { mapStores } from "pinia";
import { usePeopleStore } from "../stores/people.js";

export default {
  name: "SearchBox",

  emits: ["select"],

  data() {
    return {
      query: "",
      open: false,
      highlighted: 0,
    };
  },

  computed: {
    ...mapStores(usePeopleStore),

    results() {
      const q = this.query.trim().toLocaleLowerCase("tr");
      if (q.length < 2) return [];
      // exact > name starts with > any word starts with > substring,
      // then fame — otherwise "avel" only ever shows Machiavelli and Pavels
      const rank = (name) => {
        if (name === q) return 0;
        if (name.startsWith(q)) return 1;
        if (name.split(/\s+/).some((w) => w.startsWith(q))) return 2;
        return 3;
      };
      return this.peopleStore.people
        .filter((p) => p.name.toLocaleLowerCase("tr").includes(q))
        .map((p) => ({ p, r: rank(p.name.toLocaleLowerCase("tr")) }))
        .sort((a, b) => a.r - b.r || b.p.sitelinks - a.p.sitelinks)
        .slice(0, 8)
        .map((x) => x.p);
    },
  },

  methods: {
    thumb(p) {
      if (!p.image) return null;
      // self-hosted portraits are already 128px; only Commons URLs need a width param
      return p.image.startsWith("http") ? `${p.image}?width=64` : p.image;
    },
    avatarStyle(p) {
      const a = this.peopleStore.avatar(p.id);
      if (!a) return null;
      const s = 36;
      return {
        backgroundImage: `url(${a.url})`,
        backgroundSize: `${s * a.cols}px ${s * a.cols}px`,
        backgroundPosition: `-${a.col * s}px -${a.row * s}px`,
      };
    },
    initials(p) {
      return p.name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase();
    },
    onInput() {
      this.open = true;
      this.highlighted = 0;
    },
    move(dir) {
      if (!this.results.length) return;
      this.highlighted = (this.highlighted + dir + this.results.length) % this.results.length;
    },
    pick(p) {
      if (!p) return;
      this.query = p.name;
      this.open = false;
      this.$emit("select", p);
      this.$refs.input.blur();
    },
    onEnter() {
      this.pick(this.results[this.highlighted]);
    },
    onBlur() {
      // give the dropdown click a chance to register before closing
      setTimeout(() => (this.open = false), 150);
    },
  },
};
</script>

<template>
  <div class="searchbox">
    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
    <input
      ref="input"
      v-model="query"
      type="text"
      placeholder="Search a name... Shakespeare, Galileo, Khayyam"
      @input="onInput"
      @focus="onInput"
      @blur="onBlur"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="onEnter"
      @keydown.esc="open = false"
    />
    <ul v-if="open && results.length" class="dropdown">
      <li
        v-for="(p, i) in results"
        :key="p.id"
        :class="{ active: i === highlighted }"
        @mouseenter="highlighted = i"
        @mousedown.prevent="pick(p)"
      >
        <span v-if="avatarStyle(p)" class="thumb" :style="avatarStyle(p)"></span>
        <img v-else-if="p.image" :src="thumb(p)" alt="" loading="lazy" />
        <span v-else class="fallback">{{ initials(p) }}</span>
        <span class="who">
          <span class="name">{{ p.name }}</span>
          <span class="meta">{{ p.birthYear }} – {{ p.deathYear ?? "?" }}<template v-if="p.description"> · {{ p.description }}</template></span>
        </span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.searchbox {
  position: relative;
  width: min(520px, 90vw);
}

.icon {
  position: absolute;
  left: 16px;
  top: 50%;
  width: 18px;
  height: 18px;
  transform: translateY(-50%);
  color: var(--ink-muted);
  pointer-events: none;
}

input {
  width: 100%;
  padding: 14px 18px 14px 46px;
  font: 500 15px var(--font-ui);
  color: var(--ink);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  border-radius: 999px;
  outline: none;
  backdrop-filter: blur(8px);
  transition: border-color 0.25s, box-shadow 0.25s;
}

input::placeholder {
  color: var(--ink-muted);
  font-weight: 400;
}

input:focus {
  border-color: var(--gold-soft);
  box-shadow: 0 0 0 4px rgba(224, 180, 92, 0.08), 0 8px 32px rgba(0, 0, 0, 0.35);
}

.dropdown {
  position: absolute;
  z-index: 30;
  top: calc(100% + 10px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 6px;
  list-style: none;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(14px);
  overflow: hidden;
}

li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border-radius: 12px;
  cursor: pointer;
}

li.active {
  background: rgba(224, 180, 92, 0.12);
}

li img,
li .thumb,
li .fallback {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  flex: none;
  background: #232c4d;
}

li .thumb {
  background-repeat: no-repeat;
}

li .fallback {
  display: grid;
  place-items: center;
  font: 600 12px var(--font-ui);
  color: var(--ink-muted);
}

.who {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.name {
  font-weight: 500;
  font-size: 14px;
}

.meta {
  font-size: 12px;
  color: var(--ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
