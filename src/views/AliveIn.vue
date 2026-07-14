<script>
import { mapStores } from "pinia";
import { usePeopleStore } from "../stores/people.js";
import { aliveIn } from "../lib/lifespan.js";

const MIN_YEAR = 1;
const MAX_YEAR = new Date().getFullYear();
const LIMIT = 80; // fame-ranked portraits shown by default; "show all" reveals the rest

export default {
  name: "AliveIn",

  data() {
    return { showAll: false };
  },

  computed: {
    ...mapStores(usePeopleStore),

    // clamp the URL year into range; null if the param isn't a number
    year() {
      const n = parseInt(this.$route.params.year, 10);
      if (!Number.isFinite(n)) return null;
      return Math.max(MIN_YEAR, Math.min(MAX_YEAR, n));
    },
    yearLabel() {
      return this.year == null ? "" : String(this.year);
    },
    prevYear() {
      return Math.max(MIN_YEAR, (this.year ?? MIN_YEAR) - 10);
    },
    nextYear() {
      return Math.min(MAX_YEAR, (this.year ?? MAX_YEAR) + 10);
    },
    hasPrev() {
      return this.year != null && this.year > MIN_YEAR;
    },
    hasNext() {
      return this.year != null && this.year < MAX_YEAR;
    },

    // everyone alive that year, fame-first (peopleByFame is cached in the store)
    aliveAll() {
      if (this.year == null) return [];
      return this.peopleStore.peopleByFame.filter((p) => aliveIn(p, this.year, MAX_YEAR));
    },
    people() {
      return this.showAll ? this.aliveAll : this.aliveAll.slice(0, LIMIT);
    },
    totalAlive() {
      return this.aliveAll.length;
    },
    limit() {
      return LIMIT;
    },
  },

  watch: {
    // keep the tab title (and GA page_title) in step as you page through years,
    // and collapse back to the top-80 whenever the year changes
    year: { immediate: true, handler() { this.setTitle(); this.showAll = false; } },
  },

  async mounted() {
    await this.peopleStore.load();
    this.setTitle();
  },

  methods: {
    setTitle() {
      if (this.year != null) document.title = `Who was alive in ${this.year}? | Wellknownable`;
    },
    avatarStyle(p) {
      const a = this.peopleStore.avatar(p.id);
      if (!a) return null;
      const s = 56;
      return {
        backgroundImage: `url(${a.url})`,
        backgroundSize: `${s * a.cols}px ${s * a.cols}px`,
        backgroundPosition: `-${a.col * s}px -${a.row * s}px`,
      };
    },
    initials(p) {
      return p.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    },
    fmtYear(y) {
      if (y == null) return "";
      return y < 0 ? `${-y} BC` : `${y}`;
    },
    lifespan(p) {
      return `${this.fmtYear(p.birthYear)} – ${p.deathYear == null ? "?" : this.fmtYear(p.deathYear)}`;
    },
  },
};
</script>

<template>
  <div class="alive-view">
    <header class="aheader">
      <router-link to="/" class="alogo">
        <img src="/emblem.png" alt="" />
        <span class="word">well<em>known</em>able</span>
      </router-link>
      <div class="nav">
        <router-link to="/globe" class="switch">🌍<span class="lbl"> globe</span></router-link>
        <router-link to="/" class="switch">↔<span class="lbl"> timeline</span></router-link>
      </div>
    </header>

    <main class="abody">
      <template v-if="year != null">
        <nav class="ynav">
          <router-link v-if="hasPrev" :to="`/alive-in/${prevYear}`" class="ybtn">← {{ prevYear }}</router-link>
          <span v-else class="ybtn ghost"></span>
          <h1>Who was alive in <span class="yr">{{ yearLabel }}</span>?</h1>
          <router-link v-if="hasNext" :to="`/alive-in/${nextYear}`" class="ybtn">{{ nextYear }} →</router-link>
          <span v-else class="ybtn ghost"></span>
        </nav>

        <p v-if="peopleStore.loading" class="lead">Loading…</p>
        <p v-else-if="totalAlive === 0" class="lead">
          No well-known people in our dataset were alive in {{ yearLabel }}.
          Try a <router-link :to="`/alive-in/${nextYear}`">later year</router-link>.
        </p>
        <p v-else class="lead">
          <strong>{{ totalAlive.toLocaleString("en-US") }}</strong> well-known
          {{ totalAlive === 1 ? "person was" : "people were" }} alive in {{ yearLabel }}<template v-if="!showAll && totalAlive > limit"> — showing the {{ limit }} most notable</template>.
        </p>

        <ul class="grid" v-if="people.length">
          <li v-for="p in people" :key="p.id">
            <router-link :to="`/person/${p.slug}`" class="pcard">
              <span v-if="avatarStyle(p)" class="av" :style="avatarStyle(p)"></span>
              <span v-else class="av fallback">{{ initials(p) }}</span>
              <span class="pinfo">
                <span class="pname">{{ p.name }}</span>
                <span class="pmeta">{{ lifespan(p) }} · age {{ year - p.birthYear }}</span>
                <span v-if="p.description" class="pdesc">{{ p.description }}</span>
              </span>
            </router-link>
          </li>
        </ul>

        <div class="showall" v-if="totalAlive > limit">
          <button v-if="!showAll" class="showall-btn" @click="showAll = true">
            Show all {{ totalAlive.toLocaleString("en-US") }} →
          </button>
          <button v-else class="showall-btn" @click="showAll = false">Show fewer ↑</button>
        </div>

        <div class="cta" v-if="totalAlive">
          <router-link :to="`/globe?year=${year}`" class="cta-btn">🌍 See them on the globe</router-link>
          <router-link to="/" class="cta-btn">↔ Explore the full timeline</router-link>
        </div>
      </template>

      <p v-else class="lead">
        Pick a year to see who was alive:
        <router-link :to="`/alive-in/1500`">1500</router-link>,
        <router-link :to="`/alive-in/1800`">1800</router-link>,
        <router-link :to="`/alive-in/1969`">1969</router-link>.
      </p>
    </main>

    <footer class="afooter">
      <span class="brand">crafted by <a href="https://github.com/apsisxcoder" target="_blank" rel="noopener">apsisxcoder</a></span>
    </footer>
  </div>
</template>

<style scoped>
.alive-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.aheader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
}

.alogo {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
}

.alogo img {
  height: 44px;
}

.alogo .word {
  font: 600 24px var(--font-display);
  color: var(--ink);
}

.alogo .word em {
  font-style: normal;
  color: var(--gold);
}

.nav {
  display: flex;
  gap: 10px;
}

.switch {
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

.abody {
  flex: 1;
  width: min(1040px, 92vw);
  margin: 0 auto;
  padding: 12px 0 60px;
}

.ynav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  margin: 18px 0 6px;
}

.ynav h1 {
  margin: 0;
  text-align: center;
  font: 600 32px var(--font-display);
  color: var(--ink);
}

.ynav .yr {
  color: var(--gold);
}

.ybtn {
  flex: none;
  min-width: 82px;
  text-align: center;
  font-size: 14px;
  color: var(--ink-muted);
  text-decoration: none;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 7px 14px;
  background: rgba(255, 255, 255, 0.04);
}

.ybtn:hover {
  color: var(--ink);
  border-color: var(--gold-soft);
}

.ybtn.ghost {
  border-color: transparent;
  background: none;
  pointer-events: none;
}

.lead {
  text-align: center;
  margin: 8px 0 28px;
  font-size: 15px;
  color: var(--ink-muted);
}

.lead strong {
  color: var(--gold);
}

.lead a {
  color: var(--gold);
}

.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.pcard {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  text-decoration: none;
  height: 100%;
  transition: border-color 0.2s, transform 0.2s, background 0.2s;
}

.pcard:hover {
  border-color: var(--gold-soft);
  background: rgba(224, 180, 92, 0.07);
  transform: translateY(-2px);
}

.av {
  width: 56px;
  height: 56px;
  flex: none;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid var(--gold-soft);
  background-color: #232c4d;
  background-repeat: no-repeat;
}

.av.fallback {
  display: grid;
  place-items: center;
  font: 600 18px var(--font-ui, "Inter", sans-serif);
  color: var(--ink-muted);
}

.pinfo {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pname {
  font: 600 15px var(--font-display);
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pmeta {
  font-size: 12px;
  color: var(--gold);
  letter-spacing: 0.02em;
}

.pdesc {
  font-size: 12.5px;
  color: var(--ink-muted);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.showall {
  display: flex;
  justify-content: center;
  margin-top: 22px;
}

.showall-btn {
  font: 500 14px var(--font-ui, "Inter", sans-serif);
  color: var(--gold);
  cursor: pointer;
  border: 1px solid var(--gold-soft);
  border-radius: 999px;
  padding: 9px 22px;
  background: rgba(224, 180, 92, 0.06);
  transition: background 0.2s, color 0.2s;
}

.showall-btn:hover {
  background: rgba(224, 180, 92, 0.16);
  color: var(--ink);
}

.cta {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 34px;
}

.cta-btn {
  font-size: 14px;
  color: var(--ink);
  text-decoration: none;
  border: 1px solid var(--gold-soft);
  border-radius: 999px;
  padding: 10px 20px;
  background: rgba(224, 180, 92, 0.08);
}

.cta-btn:hover {
  background: rgba(224, 180, 92, 0.16);
}

.afooter {
  padding: 12px 24px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  color: var(--ink-muted);
  text-align: right;
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
  .ynav {
    gap: 8px;
  }

  .ynav h1 {
    font-size: 22px;
  }

  .ybtn {
    min-width: 0;
    padding: 6px 10px;
    font-size: 12px;
  }

  .aheader {
    padding: 12px 14px;
  }

  .alogo img {
    height: 34px;
  }

  .alogo .word {
    font-size: 19px;
  }

  .nav {
    gap: 6px;
  }

  /* tight header on phones: buttons collapse to just their icon */
  .switch {
    padding: 7px 11px;
    font-size: 15px;
  }

  .switch .lbl {
    display: none;
  }

  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
