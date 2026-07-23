<script>
import { mapStores } from "pinia";
import Globe from "globe.gl";
import { usePeopleStore } from "../stores/people.js";
import PersonCard from "../components/PersonCard.vue";
import SearchBox from "../components/SearchBox.vue";

const MIN_YEAR = -3000;
const MAX_YEAR = new Date().getFullYear();
const MIN_PINS = 40; // portrait pins when zoomed all the way out
const MAX_PINS = 160; // portrait pins when zoomed all the way in (semantic zoom)

export default {
  name: "Globe",

  components: { PersonCard, SearchBox },

  data() {
    // an /alive-in page can deep-link here with ?year=1492 — start on that year
    const q = parseInt(this.$route.query.year, 10);
    const year = Number.isFinite(q) ? Math.max(MIN_YEAR, Math.min(MAX_YEAR, q)) : 1500;
    return {
      year, MIN_YEAR, MAX_YEAR, aliveCount: 0, battleCount: 0, rolling: false,
      mode: "people", // 👤 people | ⚔️ wars — one world at a time, search follows
      warData: null, // { battles, wars } — lazy-fetched, globe-only payload
      selectedBattleId: null,
    };
  },

  computed: {
    ...mapStores(usePeopleStore),
    yearLabel() {
      return this.year < 0 ? `${-this.year} BC` : `${this.year}`;
    },
    selectedBattle() {
      if (!this.selectedBattleId || !this.warData) return null;
      return this.warData.battles.find((b) => b.id === this.selectedBattleId) ?? null;
    },
    // wars whose range covers the slider year — their battles ARE the war map
    activeWarIds() {
      if (!this.warData) return new Set();
      const y = this.year;
      return new Set(this.warData.wars.filter((w) => w.start <= y && (w.end ?? MAX_YEAR) >= y).map((w) => w.id));
    },
    // who fought: the battle's own sides; else the parent war's sides; else a
    // flat combatant list (when Wikidata doesn't say who stood where)
    battleSides() {
      const b = this.selectedBattle;
      if (!b) return null;
      const war = b.warId && this.warData ? this.warData.wars.find((w) => w.id === b.warId) : null;
      if (b.sides) return { left: b.sides[0], right: b.sides[1], src: "battle" };
      if (war?.sides) return { left: war.sides[0], right: war.sides[1], src: "war" };
      if (b.combatants?.length) return { flat: b.combatants, src: "battle" };
      if (war?.participants?.length) return { flat: war.participants, src: "war" };
      return null;
    },

    // what the search box searches: people, or wars+battles (mode-driven)
    searchPool() {
      if (this.mode !== "wars") return null;
      if (!this.warData) return [];
      const fy = (y) => (y < 0 ? `${-y} BC` : `${y}`);
      return [
        ...this.warData.wars.map((w) => ({
          kind: "war", id: w.id, name: w.name, icon: "⚔️", sitelinks: w.sitelinks,
          meta: `${fy(w.start)} – ${w.end != null ? fy(w.end) : "ongoing"} · war`,
        })),
        ...this.warData.battles.map((b) => ({
          kind: "battle", id: b.id, name: b.name, icon: "🗡️", sitelinks: b.sitelinks,
          meta: `${fy(b.year)}${b.warName ? ` · ${b.warName}` : ""}`,
        })),
      ];
    },
  },

  watch: {
    year() {
      // if the selected person isn't alive in the new year, drop the selection —
      // closes the card, removes their forced pin, and clears the search box
      const sel = this.peopleStore.selected;
      if (sel && !(sel.birthYear <= this.year && this.endYear(sel) >= this.year)) {
        this.peopleStore.clear();
      }
      // same rule for a selected battle that drops off the war map
      const b = this.selectedBattle;
      if (b && !this.battleVisible(b, this.year)) this.selectedBattleId = null;
      this.scheduleRefresh();
    },
    "peopleStore.selectedId"(id) {
      // just re-highlight; DON'T move the camera — clicking a visible pin should
      // never yank you out of your zoom. (Search flies explicitly, see onSearch.)
      if (id) this.selectedBattleId = null; // one card at a time
      this.scheduleRefresh();
    },
  },

  async mounted() {
    // GA key event: how many visitors open the globe at all?
    if (typeof window.gtag === "function") window.gtag("event", "globe_open");
    await this.peopleStore.load();
    this.peopleStore.clear();
    this.initGlobe();
    this.refreshMarkers();

    // war layer data: globe-only payload (~260 KB), fetched after the globe is
    // already interactive so it never delays first render
    fetch(`${import.meta.env.BASE_URL}data/wars.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          this.warData = d;
          this.scheduleRefresh();
        }
      })
      .catch(() => {});

    this.onResize = () => {
      if (!this.globe) return;
      const r = this.$refs.globe.getBoundingClientRect();
      this.globe.width(r.width).height(r.height);
    };
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(this.$refs.globe);
  },

  beforeUnmount() {
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this._raf);
    if (this.globe) {
      this.globe._destructor?.();
      this.globe = null;
    }
  },

  methods: {
    endYear(p) {
      if (p.deathYear != null) return p.deathYear;
      // no death date: someone young enough to plausibly still be living counts
      // as alive to today; a birth 100+ years ago gets an assumed ~80y lifespan
      return MAX_YEAR - p.birthYear <= 100 ? MAX_YEAR : p.birthYear + 80;
    },

    // random famous person — or, on the war map, a random famous battle (the 🎲)
    surprise() {
      this.rolling = true;
      setTimeout(() => (this.rolling = false), 700);
      if (this.mode === "wars" && this.warData) {
        const pool = this.warData.battles.slice(0, 400);
        const b = pool[Math.floor(Math.random() * pool.length)];
        if (!b) return;
        if (typeof window.gtag === "function") window.gtag("event", "surprise_me", { battle_name: b.name });
        this.year = Math.max(MIN_YEAR, Math.min(MAX_YEAR, b.year));
        this.selectBattle(b);
        if (this.globe) this.globe.pointOfView({ lat: b.coord.lat, lng: b.coord.lon, altitude: 0.75 }, 1300);
        return;
      }
      const pool = this.peopleStore.peopleByFame.slice(0, 2000);
      const p = pool[Math.floor(Math.random() * pool.length)];
      if (!p) return;
      if (typeof window.gtag === "function") window.gtag("event", "surprise_me", { person_name: p.name });
      this.onSearch(p);
    },

    // search picked a person: jump the year into their lifetime, select them, and
    // fly the camera to them (they may be off-screen — this is the one place we move it)
    onSearch(p) {
      const mid = Math.round((p.birthYear + this.endYear(p)) / 2);
      this.year = Math.max(MIN_YEAR, Math.min(MAX_YEAR, mid));
      this.peopleStore.select(p.id);
      if (p.coord && this.globe) {
        // close enough that WHERE they are is obvious, not just that they exist
        this.globe.pointOfView({ lat: p.coord.lat, lng: p.coord.lon, altitude: 0.75 }, 1300);
      }
    },

    jumpTo(e) {
      const n = parseInt(e.target.value, 10);
      if (!Number.isNaN(n)) this.year = Math.max(MIN_YEAR, Math.min(MAX_YEAR, n));
      // clear the box: the readout is the source of truth, and an out-of-range
      // entry (2068) must not linger next to the clamped year it didn't become
      e.target.value = "";
      e.target.blur();
    },

    // battles are a single year; sieges may span (year..endYear)
    battleInYear(b, y) {
      return b.year === y || (b.endYear != null && b.year <= y && b.endYear >= y);
    },

    // on the war map a battle shows while its war is active, not just its own
    // year — but within ±20y of the slider, or century-spanning conflict series
    // (Roman–Persian Wars run 54 BC to 628 AD as ONE Wikidata entry) would keep
    // parading battles from 260 years earlier
    battleVisible(b, y) {
      if (this.battleInYear(b, y)) return true;
      if (b.warId == null || !this.activeWarIds.has(b.warId)) return false;
      const dist = b.endYear != null && y > b.year ? Math.max(0, y - b.endYear) : Math.abs(b.year - y);
      return dist <= 20;
    },

    setMode(m) {
      if (this.mode === m) return;
      this.mode = m;
      this.peopleStore.clear();
      this.selectedBattleId = null;
      if (typeof window.gtag === "function") window.gtag("event", "globe_mode", { mode: m });
      this.scheduleRefresh();
    },

    // search select: people mode gets a person, wars mode a war or battle
    onPick(item) {
      if (this.mode !== "wars") return this.onSearch(item);
      if (item.kind === "battle") {
        const b = this.warData.battles.find((x) => x.id === item.id);
        if (!b) return;
        this.year = Math.max(MIN_YEAR, Math.min(MAX_YEAR, b.year));
        this.selectBattle(b);
        if (this.globe) this.globe.pointOfView({ lat: b.coord.lat, lng: b.coord.lon, altitude: 0.75 }, 1300);
      } else {
        const w = this.warData.wars.find((x) => x.id === item.id);
        if (!w) return;
        // land mid-war and zoom out enough to see the whole theater light up
        this.year = Math.max(MIN_YEAR, Math.min(MAX_YEAR, Math.round((w.start + (w.end ?? w.start)) / 2)));
        const first = this.warData.battles.find((b) => b.warId === w.id);
        if (first && this.globe) this.globe.pointOfView({ lat: first.coord.lat, lng: first.coord.lon, altitude: 1.9 }, 1000);
      }
    },

    selectBattle(b) {
      this.selectedBattleId = b.id;
      this.peopleStore.clear(); // one card at a time
      if (typeof window.gtag === "function") window.gtag("event", "select_battle", { battle_name: b.name });
    },

    fmtOneYear(y) {
      return y < 0 ? `${-y} BC` : `${y}`;
    },
    fmtYears(p) {
      const b = p.birthYear < 0 ? `${-p.birthYear} BC` : `${p.birthYear}`;
      return `${b}–${p.deathYear ?? ""}`;
    },

    initGlobe() {
      const el = this.$refs.globe;
      const r = el.getBoundingClientRect();
      // NOT reactive — Vue must not proxy the Three.js scene graph
      this.globe = Globe()(el)
        .width(r.width)
        .height(r.height)
        .backgroundColor("rgba(0,0,0,0)")
        .globeImageUrl(`${import.meta.env.BASE_URL}textures/earth-day.webp`)
        .showAtmosphere(true)
        .atmosphereColor("#e0b45c")
        .atmosphereAltitude(0.16)
        // the rising sticks
        .pointsData([])
        .pointLat((d) => d.lat)
        .pointLng((d) => d.lng)
        .pointAltitude((d) => d.alt)
        .pointRadius((d) => d.pr)
        .pointColor((d) => (d.sel ? "#f2cd83" : "rgba(224,180,92,0.5)"))
        .pointsMerge(false)
        // the portrait + name markers at the top of each stick
        .htmlElementsData([])
        .htmlLat((d) => d.lat)
        .htmlLng((d) => d.lng)
        .htmlAltitude((d) => d.alt)
        .htmlElement((d) => (d.b ? this.makeWarPin(d) : this.makePin(d)));

      this.globe.pointOfView({ lat: 30, lng: 20, altitude: 2.5 });
      const c = this.globe.controls();
      c.autoRotate = true;
      c.autoRotateSpeed = 0.3;
      c.enableDamping = true;
      c.addEventListener("start", () => (c.autoRotate = false));
      // reveal more faces as you zoom in (semantic zoom); ignore pure rotation
      this._lastAlt = 2.5;
      c.addEventListener("change", () => {
        const alt = this.globe.pointOfView().altitude;
        if (Math.abs(alt - this._lastAlt) / this._lastAlt > 0.05) {
          this._lastAlt = alt;
          this.scheduleRefresh();
        }
      });

      // max anisotropic filtering keeps the earth crisp at grazing angles / zoom
      this.globe.onGlobeReady(() => {
        const map = this.globe.globeMaterial()?.map;
        const renderer = this.globe.renderer();
        if (map && renderer) {
          map.anisotropy = renderer.capabilities.getMaxAnisotropy();
          map.needsUpdate = true;
        }
      });
    },

    makePin(d) {
      const p = d.p;
      const el = document.createElement("div");
      el.className = "gpin" + (d.sel ? " sel" : "");
      // prefer the fame-ordered atlas (1-2 requests for all pins) over per-person
      // portrait files (which would be ~160 separate slow requests)
      const av = this.peopleStore.avatar(p.id);
      const s = d.size;
      const dim = `width:${s}px;height:${s}px`;
      let avatar;
      if (av) {
        avatar = `<span class="av" style="${dim};background-image:url(${av.url});background-size:${s * av.cols}px ${s * av.cols}px;background-position:-${av.col * s}px -${av.row * s}px"></span>`;
      } else if (p.image) {
        avatar = `<span class="av" style="${dim}"><img src="${p.image}" alt="" onerror="this.remove()" /></span>`;
      } else {
        avatar = `<span class="av" style="${dim}"><span class="ini">${p.name.slice(0, 1)}</span></span>`;
      }
      el.innerHTML = `${avatar}<span class="nm">${p.name}</span>`;
      el.onclick = (e) => {
        e.stopPropagation();
        this.peopleStore.select(p.id);
      };
      return el;
    },

    // crossed-swords pin for a battle — visually distinct from the gold portraits
    makeWarPin(d) {
      const b = d.b;
      const el = document.createElement("div");
      el.className = "wpin" + (d.sel ? " sel" : "");
      const s = d.size;
      el.innerHTML = `<span class="wav" style="width:${s}px;height:${s}px;font-size:${Math.round(s * 0.52)}px">⚔️</span><span class="nm">${b.name}</span>`;
      el.onclick = (e) => {
        e.stopPropagation();
        this.selectBattle(b);
      };
      return el;
    },

    scheduleRefresh() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this.refreshMarkers();
      });
    },

    refreshMarkers() {
      if (!this.globe) return;
      if (this.mode === "wars") return this.refreshWarMarkers();
      const y = this.year;
      const selId = this.peopleStore.selectedId;
      const alive = [];
      for (const p of this.peopleStore.people) {
        if (!p.coord) continue;
        if (p.birthYear <= y && this.endYear(p) >= y) alive.push(p);
      }
      this.aliveCount = alive.length;
      alive.sort((a, b) => b.sitelinks - a.sitelinks);

      // pin count scales with zoom: far out = the few most famous, zoomed in =
      // progressively more faces (the globe equivalent of the timeline's zoom)
      const alt = this.globe.pointOfView().altitude;
      const t = Math.max(0, Math.min(1, (2.5 - alt) / (2.5 - 0.3)));
      const pinCount = Math.round(MIN_PINS + t * (MAX_PINS - MIN_PINS));

      // always include the selected person even if they'd fall past the cap
      const shown = alive.slice(0, pinCount);
      const sel = this.peopleStore.selected;
      if (sel && sel.coord && !shown.some((p) => p.id === selId)) shown.push(sel);

      // the founding team always shows when they're alive (fame notwithstanding)
      for (const p of alive) {
        if (p.id.startsWith("CUSTOM-") && !shown.some((s) => s.id === p.id)) shown.push(p);
      }

      // group people born at the same spot so we can bloom them apart
      const groups = new Map();
      for (const p of shown) {
        const key = `${p.coord.lat.toFixed(1)},${p.coord.lon.toFixed(1)}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = []));
        g.push(p);
      }

      const fame = (p) => Math.max(0, Math.min(1, (Math.sqrt(p.sitelinks) - 3) / 15));
      const markers = [];
      for (const arr of groups.values()) {
        arr.forEach((p, i) => {
          let lat = p.coord.lat;
          let lng = p.coord.lon;
          // most famous stays put; the rest spiral outward like flower petals
          if (i > 0) {
            const ang = i * 2.399963; // golden angle -> even, non-overlapping spread
            const rad = 0.6 + i * 0.32; // degrees, grows outward
            lat += rad * Math.sin(ang);
            lng += (rad * Math.cos(ang)) / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
          }
          const f = fame(p);
          markers.push({
            p,
            lat,
            lng,
            sel: p.id === selId,
            size: Math.round(26 + f * 24), // 26–50 px portrait
            alt: 0.006 + f * 0.03, // hover just above the surface (no tall sticks)
          });
        });
      }
      // portraits only — the fat cylinder "sticks" looked terrible when zoomed in
      this.globe.htmlElementsData(markers);
    },

    // ⚔️ mode: the battles of every war active in the slider year — a war map,
    // not a year snapshot (1916 shows Verdun AND 1915's Gallipoli: same war)
    refreshWarMarkers() {
      const y = this.year;
      const selB = this.selectedBattleId;
      const visible = this.warData ? this.warData.battles.filter((b) => this.battleVisible(b, y)) : [];
      this.battleCount = visible.length;

      // fame-first cap, scaled by zoom like the people pins
      const alt = this.globe.pointOfView().altitude;
      const t = Math.max(0, Math.min(1, (2.5 - alt) / (2.5 - 0.3)));
      const cap = Math.round(24 + t * 56); // 24–80 swords
      const shown = visible.slice(0, cap);
      if (selB && !shown.some((b) => b.id === selB)) {
        const sb = visible.find((b) => b.id === selB);
        if (sb) shown.push(sb);
      }

      const markers = shown.map((b) => {
        const f = Math.max(0, Math.min(1, (Math.sqrt(b.sitelinks) - 3) / 12));
        return {
          b,
          lat: b.coord.lat,
          lng: b.coord.lon,
          sel: b.id === selB,
          size: Math.round(26 + f * 22), // 26–48 px
          alt: 0.004 + f * 0.02,
        };
      });
      this.globe.htmlElementsData(markers);
    },
  },
};
</script>

<template>
  <div class="globe-view">
    <header class="gheader">
      <router-link to="/" class="glogo">
        <img src="/emblem.png" alt="" />
        <span class="word">well<em>known</em>able</span>
      </router-link>
      <router-link to="/" class="switch">↔<span class="lbl"> timeline</span></router-link>
    </header>

    <div class="gsearch">
      <div class="mode-switch" role="radiogroup" aria-label="Globe mode">
        <button :class="{ on: mode === 'people' }" @click="setMode('people')">👤 People</button>
        <button :class="{ on: mode === 'wars' }" @click="setMode('wars')">⚔️ Wars</button>
      </div>
      <div class="searchline">
        <SearchBox :pool="searchPool" @select="onPick" />
        <button class="dice" :class="{ rolling }" :title="mode === 'wars' ? 'Surprise me — fly to a random battle' : 'Surprise me — fly to a random famous person'" @click="surprise">🎲</button>
      </div>
    </div>

    <div ref="globe" class="globe-canvas"></div>

    <div class="wife-credit">the globe was my <span>beloved wife's</span> idea <em>♥</em></div>

    <div class="year-panel">
      <div class="year-readout">
        <span class="yr">{{ yearLabel }}</span>
        <span class="cnt">
          <template v-if="mode === 'wars'">{{ battleCount.toLocaleString("en-US") }} battles</template>
          <template v-else>{{ aliveCount.toLocaleString("en-US") }} alive</template>
        </span>
        <input
          class="jump"
          type="number"
          placeholder="jump to year"
          @change="jumpTo($event)"
        />
      </div>
      <input type="range" :min="MIN_YEAR" :max="MAX_YEAR" step="1" v-model.number="year" />
      <div class="scale"><span>3000 BC</span><span>{{ MAX_YEAR }}</span></div>
    </div>

    <PersonCard />

    <transition name="card">
      <aside v-if="selectedBattle" class="war-card">
        <button class="close" aria-label="Close" @click="selectedBattleId = null">×</button>
        <div class="swords">⚔️</div>
        <h2>{{ selectedBattle.name }}</h2>
        <p class="years">
          {{ fmtOneYear(selectedBattle.year) }}<template v-if="selectedBattle.endYear && selectedBattle.endYear !== selectedBattle.year"> – {{ fmtOneYear(selectedBattle.endYear) }}</template>
        </p>
        <p v-if="battleSides && battleSides.src === 'war'" class="sides-label">
          {{ battleSides.left ? "sides in the wider war" : "involved in the wider war" }}
        </p>
        <div v-if="battleSides && battleSides.left" class="sides-grid">
          <ul class="side left"><li v-for="n in battleSides.left" :key="n">{{ n }}</li></ul>
          <div class="vs-col"><span class="line"></span><span class="vs">⚔</span><span class="line"></span></div>
          <ul class="side right"><li v-for="n in battleSides.right" :key="n">{{ n }}</li></ul>
        </div>
        <p v-else-if="battleSides" class="sides">{{ battleSides.flat.join(" · ") }}</p>
        <p v-if="selectedBattle.warName" class="ofwar">part of <strong>{{ selectedBattle.warName }}</strong></p>
        <div class="foot">
          <span class="badge">Wikipedia in {{ selectedBattle.sitelinks }} languages</span>
          <a :href="`https://www.wikidata.org/wiki/${selectedBattle.id}`" target="_blank" rel="noopener">source ↗</a>
        </div>
      </aside>
    </transition>
  </div>
</template>

<style scoped>
.globe-view {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.globe-canvas {
  position: absolute;
  inset: 0;
  z-index: 1; /* own stacking context so globe.gl's html pins stay under the UI */
  /* hand pinch/drag to the globe's controls — without this the browser claims the
     gesture as a page zoom and the globe never sees it (same fix as the timeline) */
  touch-action: none;
}

.globe-canvas :deep(canvas) {
  touch-action: none;
}

.wife-credit {
  position: absolute;
  bottom: 20px;
  left: 24px;
  z-index: 20;
  font: italic 13px var(--font-display);
  color: var(--ink-muted);
  letter-spacing: 0.02em;
  pointer-events: none;
}

.wife-credit span {
  color: var(--gold);
}

.wife-credit em {
  font-style: normal;
  color: var(--gold);
}

.gsearch {
  position: absolute;
  top: 62px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  width: min(520px, 90vw);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.mode-switch {
  display: flex;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(13, 18, 34, 0.8);
  padding: 3px;
  backdrop-filter: blur(8px);
}

.mode-switch button {
  border: none;
  background: none;
  color: var(--ink-muted);
  font: 500 13px var(--font-ui, "Inter", sans-serif);
  padding: 6px 16px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.mode-switch button.on {
  background: rgba(224, 180, 92, 0.16);
  color: var(--gold);
}

.mode-switch button.on:last-child {
  background: rgba(224, 122, 92, 0.16);
  color: #e07a5c;
}

.searchline {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}

.searchline :deep(.searchbox) {
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
  border: 1px solid rgba(224, 180, 92, 0.28);
  border-radius: 50%;
  background: rgba(13, 18, 34, 0.8);
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

/* the bright day globe washes out the faint search bar — darken it here */
.gsearch :deep(input) {
  background: rgba(13, 18, 34, 0.8);
  border-color: rgba(224, 180, 92, 0.28);
}

.gsearch :deep(input::placeholder) {
  color: rgba(236, 231, 219, 0.65);
}

.gheader {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  pointer-events: none;
}

.glogo {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  pointer-events: auto;
}

.glogo img {
  height: 44px;
}

.glogo .word {
  font: 600 24px var(--font-display);
  color: var(--ink);
}

.glogo .word em {
  font-style: normal;
  color: var(--gold);
}

.switch {
  pointer-events: auto;
  font-size: 13px;
  color: var(--ink-muted);
  text-decoration: none;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(8px);
}

.switch:hover {
  color: var(--ink);
  border-color: var(--gold-soft);
}

.year-panel {
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  width: min(560px, 92vw);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 16px 20px;
  backdrop-filter: blur(14px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
}

.year-readout {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 10px;
}

.year-readout .yr {
  font: 600 26px var(--font-display);
  color: var(--gold);
}

.year-readout .cnt {
  flex: 1;
  font-size: 13px;
  color: var(--ink-muted);
}

.year-readout .jump {
  width: 110px;
  padding: 5px 10px;
  font: 500 13px var(--font-ui, "Inter", sans-serif);
  color: var(--ink);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  border-radius: 999px;
  outline: none;
}

.year-readout .jump:focus {
  border-color: var(--gold-soft);
}

.year-readout .jump::placeholder {
  color: var(--ink-muted);
}

.year-panel input[type="range"] {
  width: 100%;
  accent-color: var(--gold);
}

.scale {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--ink-muted);
  margin-top: 4px;
}

/* battle card — the person card's layout with an ember-red accent */
.war-card {
  position: absolute;
  right: 28px;
  bottom: 42px;
  z-index: 20;
  width: 300px;
  padding: 24px;
  background: var(--card);
  border: 1px solid rgba(224, 122, 92, 0.35);
  border-radius: 22px;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(16px);
  text-align: center;
}

.war-card .close {
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

.war-card .close:hover {
  color: var(--ink);
}

.war-card .swords {
  font-size: 40px;
  margin-bottom: 8px;
}

.war-card h2 {
  margin: 0 0 4px;
  font: 600 20px var(--font-display);
  color: var(--ink);
}

.war-card .years {
  margin: 0 0 8px;
  font-size: 14px;
  color: #e07a5c;
  letter-spacing: 0.03em;
}

.war-card .sides {
  margin: 0 0 8px;
  font: 600 13.5px var(--font-ui, "Inter", sans-serif);
  color: var(--ink);
  line-height: 1.5;
}

.war-card .sides-label {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

/* two camps, a divider line down the middle, crossed swords at its heart */
.war-card .sides-grid {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 10px;
  align-items: center;
  margin: 2px 0 10px;
}

.war-card .side {
  list-style: none;
  margin: 0;
  padding: 0;
  font: 600 12.5px var(--font-ui, "Inter", sans-serif);
  color: var(--ink);
  line-height: 1.45;
  text-align: left;
}

/* bullet + hanging indent: a wrapped multi-word name stays visually ONE entry
   instead of blurring into its neighbors */
.war-card .side li {
  position: relative;
  padding-left: 12px;
  margin-bottom: 5px;
}

.war-card .side li::before {
  content: "•";
  position: absolute;
  left: 0;
  color: #e07a5c;
}

.war-card .vs-col {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.war-card .vs-col .line {
  flex: 1;
  width: 1px;
  min-height: 6px;
  background: rgba(224, 122, 92, 0.4);
}

.war-card .vs {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  font-size: 14px;
  color: #e07a5c;
  border: 1px solid rgba(224, 122, 92, 0.45);
  border-radius: 50%;
  background: rgba(224, 122, 92, 0.08);
  margin: 4px 0;
}

.war-card .ofwar {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--ink-muted);
}

.war-card .ofwar strong {
  color: var(--ink);
  font-weight: 600;
}

.war-card .foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.war-card .badge {
  font-size: 11.5px;
  color: #e07a5c;
  background: rgba(224, 122, 92, 0.1);
  border: 1px solid rgba(224, 122, 92, 0.35);
  padding: 4px 10px;
  border-radius: 999px;
}

.war-card .foot a {
  font-size: 12.5px;
  color: var(--ink-muted);
  text-decoration: none;
}

.war-card .foot a:hover {
  color: var(--ink);
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

@media (max-width: 640px) {
  /* same bottom-sheet treatment as the person card */
  .war-card {
    left: 0;
    right: 0;
    bottom: 0;
    width: auto;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
    border-radius: 22px 22px 0 0;
    border-left: none;
    border-right: none;
    border-bottom: none;
    max-height: 68vh; /* fallback */
    max-height: 68dvh;
    overflow-y: auto;
    /* iOS WebKit won't scroll the sheet without being told the vertical pan
       gesture belongs to it */
    touch-action: pan-y;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }

  /* the close button rides along while the sheet scrolls — always reachable */
  .war-card .close {
    position: sticky;
    top: 0;
    margin-left: auto;
    display: block;
    z-index: 2;
  }

  .gheader {
    padding: 12px 14px;
  }

  .glogo img {
    height: 34px;
  }

  .glogo .word {
    font-size: 19px;
  }

  /* icon-only pill on phones so the label can't ride over the logo */
  .switch {
    padding: 7px 11px;
    font-size: 15px;
  }

  .switch .lbl {
    display: none;
  }
}
</style>

<style>
/* portrait + name pin at the top of each stick (global: rendered by globe.gl) */
.gpin {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  /* the wrapper is as wide as the (hidden) name label — mouse belongs to the
     avatar circle only, so a long label can't shadow the pin next door */
  pointer-events: none;
  transform: translateY(-50%);
  user-select: none;
}
.gpin .av {
  pointer-events: auto;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid var(--gold-soft);
  background-color: #232c4d;
  background-repeat: no-repeat;
  display: grid;
  place-items: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
  transition: transform 0.15s, border-color 0.15s;
}
.gpin .av img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.gpin .ini {
  font: 600 15px "Inter", sans-serif;
  color: var(--ink-muted);
}
.gpin .nm {
  font: 500 11px "Inter", sans-serif;
  color: #ece7db;
  background: rgba(13, 18, 34, 0.85);
  border-radius: 6px;
  padding: 1px 7px;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.15s;
  /* labels are display-only: even at opacity 0 they'd otherwise catch the mouse
     and block hovering/clicking the neighboring pin they overlap */
  pointer-events: none;
}
.gpin:hover .av,
.gpin.sel .av {
  transform: scale(1.18);
  border-color: var(--gold);
}
.gpin:hover .nm,
.gpin.sel .nm {
  opacity: 1;
}

/* battle pin: ember-red crossed swords, softly pulsing (global: rendered by globe.gl) */
.wpin {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  /* same as .gpin: mouse belongs to the swords circle, not the label-wide box */
  pointer-events: none;
  transform: translateY(-50%);
  user-select: none;
}
.wpin .wav {
  pointer-events: auto;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 2px solid rgba(224, 122, 92, 0.75);
  background: rgba(46, 18, 12, 0.82);
  box-shadow: 0 0 0 0 rgba(224, 122, 92, 0.45);
  animation: warpulse 2.2s ease-out infinite;
  transition: transform 0.15s, border-color 0.15s;
}
@keyframes warpulse {
  0% { box-shadow: 0 0 0 0 rgba(224, 122, 92, 0.45); }
  70% { box-shadow: 0 0 0 9px rgba(224, 122, 92, 0); }
  100% { box-shadow: 0 0 0 0 rgba(224, 122, 92, 0); }
}
.wpin .nm {
  font: 500 11px "Inter", sans-serif;
  color: #f3ddd6;
  background: rgba(46, 18, 12, 0.88);
  border-radius: 6px;
  padding: 1px 7px;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
}
.wpin:hover .wav,
.wpin.sel .wav {
  transform: scale(1.18);
  border-color: #e07a5c;
}
.wpin:hover .nm,
.wpin.sel .nm {
  opacity: 1;
}
</style>
