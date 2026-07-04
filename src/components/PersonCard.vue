<script>
import { mapStores } from "pinia";
import { usePeopleStore } from "../stores/people.js";

export default {
  name: "PersonCard",

  computed: {
    ...mapStores(usePeopleStore),

    person() {
      return this.peopleStore.selected;
    },
    age() {
      const p = this.person;
      if (!p || p.deathYear === null) return null;
      return p.deathYear - p.birthYear;
    },
    portrait() {
      const img = this.person?.image;
      if (!img) return null;
      return img.startsWith("http") ? `${img}?width=280` : img;
    },
    sourceUrl() {
      // prefer the readable article; Wikidata as fallback
      return this.person.wikipedia ?? `https://www.wikidata.org/wiki/${this.person.id}`;
    },
  },

  methods: {
    fmtYear(y) {
      return y < 0 ? `${-y} BC` : `${y}`;
    },
  },
};
</script>

<template>
  <transition name="card">
    <aside v-if="person" class="person-card">
      <button class="close" aria-label="Close" @click="peopleStore.clear()">×</button>
      <div class="portrait-wrap">
        <img v-if="portrait" :src="portrait" :alt="person.name" />
        <div v-else class="no-portrait">{{ person.name[0] }}</div>
      </div>
      <h2>{{ person.name }}</h2>
      <p class="years">
        {{ fmtYear(person.birthYear) }} – {{ person.deathYear ? fmtYear(person.deathYear) : "unknown" }}
        <span v-if="age" class="age">({{ age }} years)</span>
      </p>
      <p v-if="person.description" class="desc">{{ person.description }}</p>
      <div class="foot">
        <span class="badge">Wikipedia in {{ person.sitelinks }} languages</span>
        <a :href="sourceUrl" target="_blank" rel="noopener">source ↗</a>
      </div>
    </aside>
  </transition>
</template>

<style scoped>
.person-card {
  position: absolute;
  right: 28px;
  bottom: 42px;
  z-index: 20;
  width: 300px;
  padding: 24px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 22px;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(16px);
  text-align: center;
}

.close {
  position: absolute;
  top: 10px;
  right: 14px;
  border: none;
  background: none;
  color: var(--ink-muted);
  font-size: 22px;
  cursor: pointer;
  line-height: 1;
}

.close:hover {
  color: var(--ink);
}

.portrait-wrap {
  width: 108px;
  height: 108px;
  margin: 0 auto 14px;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid var(--gold-soft);
  box-shadow: 0 0 0 6px rgba(224, 180, 92, 0.07);
  background: #232c4d;
}

.portrait-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.no-portrait {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  font: 500 42px var(--font-display);
  color: var(--gold);
}

h2 {
  margin: 0 0 4px;
  font: 600 22px var(--font-display);
  color: var(--ink);
}

.years {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--gold);
  letter-spacing: 0.03em;
}

.age {
  color: var(--ink-muted);
}

.desc {
  margin: 0 0 16px;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--ink-muted);
}

.desc::first-letter {
  text-transform: uppercase;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.badge {
  font-size: 11.5px;
  color: var(--gold);
  background: rgba(224, 180, 92, 0.1);
  border: 1px solid var(--gold-soft);
  padding: 4px 10px;
  border-radius: 999px;
}

.foot a {
  font-size: 12.5px;
  color: var(--ink-muted);
  text-decoration: none;
}

.foot a:hover {
  color: var(--ink);
}

@media (max-width: 640px) {
  .person-card {
    left: 12px;
    right: 12px;
    bottom: 12px;
    width: auto;
    padding: 16px;
  }

  .portrait-wrap {
    width: 72px;
    height: 72px;
  }

  h2 {
    font-size: 18px;
  }

  .desc {
    font-size: 12.5px;
    margin-bottom: 12px;
  }
}

.card-enter-active,
.card-leave-active {
  transition: opacity 0.35s, transform 0.35s;
}

.card-enter-from,
.card-leave-to {
  opacity: 0;
  transform: translateY(16px) scale(0.97);
}
</style>
