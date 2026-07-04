<script>
import { mapStores } from "pinia";
import { usePeopleStore } from "../stores/people.js";
import SearchBox from "../components/SearchBox.vue";
import Timeline from "../components/Timeline.vue";
import PersonCard from "../components/PersonCard.vue";

export default {
  name: "Home",

  components: { SearchBox, Timeline, PersonCard },

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
    <h1 class="logo">
      <img class="emblem" src="/emblem.png" alt="" />
      <span class="word">well<em>known</em>able</span>
    </h1>
    <p class="tagline">every well-known life in history, on a single timeline</p>
    <SearchBox />
  </header>

  <main>
    <Timeline />
    <PersonCard />
  </main>

  <footer>
    <span>{{ peopleCount }} people · data: <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a></span>
    <span class="brand">crafted by <strong>apsisxcoder</strong></span>
  </footer>
</template>

<style scoped>
header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 30px 20px 18px;
}

.logo {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 18px;
}

.emblem {
  height: 72px;
  display: block;
}

.word {
  font: 600 40px var(--font-display);
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

.brand strong {
  color: var(--gold);
  font-weight: 600;
  letter-spacing: 0.04em;
}

@media (max-width: 640px) {
  header {
    padding: 16px 12px 10px;
    gap: 6px;
  }

  .logo {
    gap: 10px;
  }

  .emblem {
    height: 44px;
  }

  .word {
    font-size: 24px;
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
