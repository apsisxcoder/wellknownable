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
    return { year: 1500, MIN_YEAR, MAX_YEAR, aliveCount: 0 };
  },

  computed: {
    ...mapStores(usePeopleStore),
    yearLabel() {
      return this.year < 0 ? `${-this.year} BC` : `${this.year}`;
    },
  },

  watch: {
    year() {
      this.scheduleRefresh();
    },
    "peopleStore.selectedId"() {
      // just re-highlight; DON'T move the camera — clicking a visible pin should
      // never yank you out of your zoom. (Search flies explicitly, see onSearch.)
      this.scheduleRefresh();
    },
  },

  async mounted() {
    await this.peopleStore.load();
    this.peopleStore.clear();
    this.initGlobe();
    this.refreshMarkers();

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

    // search picked a person: jump the year into their lifetime, select them, and
    // fly the camera to them (they may be off-screen — this is the one place we move it)
    onSearch(p) {
      const mid = Math.round((p.birthYear + this.endYear(p)) / 2);
      this.year = Math.max(MIN_YEAR, Math.min(MAX_YEAR, mid));
      this.peopleStore.select(p.id);
      if (p.coord && this.globe) {
        this.globe.pointOfView({ lat: p.coord.lat, lng: p.coord.lon, altitude: 1.3 }, 1000);
      }
    },

    jumpTo(v) {
      const n = parseInt(v, 10);
      if (!Number.isNaN(n)) this.year = Math.max(MIN_YEAR, Math.min(MAX_YEAR, n));
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
        .htmlElement((d) => this.makePin(d));

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

    scheduleRefresh() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this.refreshMarkers();
      });
    },

    refreshMarkers() {
      if (!this.globe) return;
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
      <router-link to="/" class="switch">↔ timeline</router-link>
    </header>

    <div class="gsearch"><SearchBox @select="onSearch" /></div>

    <div ref="globe" class="globe-canvas"></div>

    <div class="wife-credit">the globe was my <span>beloved wife's</span> idea <em>♥</em></div>

    <div class="year-panel">
      <div class="year-readout">
        <span class="yr">{{ yearLabel }}</span>
        <span class="cnt">{{ aliveCount.toLocaleString("en-US") }} alive</span>
        <input
          class="jump"
          type="number"
          placeholder="jump to year"
          @change="jumpTo($event.target.value)"
          @keyup.enter="jumpTo($event.target.value)"
        />
      </div>
      <input type="range" :min="MIN_YEAR" :max="MAX_YEAR" step="1" v-model.number="year" />
      <div class="scale"><span>3000 BC</span><span>{{ MAX_YEAR }}</span></div>
    </div>

    <PersonCard />
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
  top: 68px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  width: min(520px, 90vw);
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
</style>

<style>
/* portrait + name pin at the top of each stick (global: rendered by globe.gl) */
.gpin {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  pointer-events: auto;
  transform: translateY(-50%);
  user-select: none;
}
.gpin .av {
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
</style>
