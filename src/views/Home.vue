<script>
import { mapStores } from "pinia";
import { usePeopleStore } from "../stores/people.js";
import SearchBox from "../components/SearchBox.vue";
import Timeline from "../components/Timeline.vue";
import PersonCard from "../components/PersonCard.vue";

export default {
  name: "Home",

  components: { SearchBox, Timeline, PersonCard },

  data() {
    return { rolling: false };
  },

  computed: {
    ...mapStores(usePeopleStore),

    peopleCount() {
      return this.peopleStore.people.length.toLocaleString("en-US");
    },
  },

  watch: {
    // the URL is the source of truth for the selection: /person/:slug selects,
    // / clears. Search and timeline clicks navigate; this reacts to that.
    "$route.params.slug": {
      immediate: true,
      handler(slug) {
        this.syncFromRoute(slug);
      },
    },
  },

  async mounted() {
    await this.peopleStore.load();
    // data may have arrived after the initial route resolution
    this.syncFromRoute(this.$route.params.slug);
  },

  methods: {
    goToPerson(p) {
      this.$router.push(`/person/${p.slug}`);
    },
    // random famous person: same fly-to as picking them in search (the 🎲 button)
    surprise() {
      const pool = this.peopleStore.peopleByFame.slice(0, 2000);
      const p = pool[Math.floor(Math.random() * pool.length)];
      if (!p) return;
      this.rolling = true;
      setTimeout(() => (this.rolling = false), 700);
      if (typeof window.gtag === "function") window.gtag("event", "surprise_me", { person_name: p.name });
      this.goToPerson(p);
    },
    syncFromRoute(slug) {
      if (!this.peopleStore.people.length) return;
      if (!slug) {
        this.peopleStore.clear();
        return;
      }
      const person = this.peopleStore.bySlug(slug);
      if (person) this.peopleStore.select(person.id);
      else this.peopleStore.clear();
    },
  },
};
</script>

<template>
  <header>
    <router-link to="/globe" class="switch">🌍<span class="lbl"> globe</span></router-link>
    <h1 class="logo">
      <img class="emblem" src="/emblem.png" alt="" />
      <span class="word">well<em>known</em>able</span>
    </h1>
    <p class="tagline">an interactive timeline &amp; map of every well-known life in history</p>
    <div class="searchrow">
      <SearchBox @select="goToPerson" />
      <button class="dice" :class="{ rolling }" title="Surprise me — fly to a random famous person" @click="surprise">🎲</button>
    </div>
  </header>

  <main>
    <Timeline />
    <PersonCard />
  </main>

  <footer>
    <span>{{ peopleCount }} people · data: <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a></span>
    <span class="brand">crafted by <a href="https://github.com/apsisxcoder" target="_blank" rel="noopener">apsisxcoder</a></span>
  </footer>
</template>

<style scoped>
header {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 30px 20px 18px;
}

.switch {
  position: absolute;
  top: 20px;
  right: 24px;
  font-size: 13px;
  color: var(--ink-muted);
  text-decoration: none;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.04);
}

.switch:hover {
  color: var(--ink);
  border-color: var(--gold-soft);
}

.logo {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 18px;
}

.emblem {
  height: 86px;
  display: block;
}

.word {
  font: 600 47px var(--font-display);
  letter-spacing: 0.02em;
  color: var(--ink);
}

.word em {
  font-style: normal;
  color: var(--gold);
}

.tagline {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--ink-muted);
  letter-spacing: 0.06em;
}

.searchrow {
  display: flex;
  align-items: center;
  gap: 8px;
  /* the row owns the width; the searchbox shrinks inside it so the dice
     never pushes past the viewport edge on phones */
  width: min(520px, 92vw);
}

.searchrow :deep(.searchbox) {
  flex: 1;
  width: auto;
}

.dice {
  flex: none;
  width: 44px;
  height: 44px;
  font-size: 19px;
  line-height: 1;
  cursor: pointer;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  transition: transform 0.15s, border-color 0.15s;
}

.dice:hover {
  transform: rotate(20deg) scale(1.08);
  border-color: var(--gold);
}

/* the roll: two full tumbles with a bounce, like a die settling */
.dice.rolling {
  animation: diceroll 0.7s cubic-bezier(0.3, 1.4, 0.5, 1);
}

@keyframes diceroll {
  0% { transform: rotate(0) scale(1); }
  35% { transform: rotate(380deg) scale(1.25); }
  70% { transform: rotate(700deg) scale(0.92); }
  100% { transform: rotate(720deg) scale(1); }
}

main {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 24px;
  font-size: 12px;
  color: var(--ink-muted);
  border-top: 1px solid var(--line);
}

footer a {
  color: var(--ink-muted);
}

footer a:hover {
  color: var(--ink);
}

.brand a {
  color: var(--gold);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-decoration: none;
}

.brand a:hover {
  text-decoration: underline;
}

@media (max-width: 640px) {
  header {
    padding: 16px 12px 10px;
    gap: 6px;
  }

  /* tight header on phones: the pill collapses to just its icon so the label
     can't ride over the logo */
  .switch {
    top: 12px;
    right: 12px;
    padding: 7px 11px;
    font-size: 15px;
  }

  .switch .lbl {
    display: none;
  }

  .logo {
    gap: 10px;
  }

  .emblem {
    height: 38px;
  }

  .word {
    font-size: 22px;
  }

  .tagline {
    font-size: 12px;
    text-align: center;
    margin-bottom: 4px;
  }

  footer {
    font-size: 11px;
    padding: 8px 12px;
    gap: 8px;
  }
}
</style>
