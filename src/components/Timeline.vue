<script>
import { mapStores } from "pinia";
import { usePeopleStore } from "../stores/people.js";

const MIN_SPAN = 24;
const MAX_SPAN = 5400; // wide enough to see 3000 BC -> today in one sweep

export default {
  name: "Timeline",

  data() {
    // W/H track the container's real pixel size (1 svg unit = 1 px),
    // so text stays readable on every screen instead of scaling down
    return {
      W: 1500,
      H: 700,
      camera: { center: 950, span: 3400 },
      offsetY: 0,
      NOW: new Date().getFullYear(),
      drag: null,
      pointers: new Map(), // active pointers by id, for multi-touch pinch
      pinch: null,
      lastMoved: false,
      animHandle: null,
    };
  },

  computed: {
    ...mapStores(usePeopleStore),

    left() {
      return this.camera.center - this.camera.span / 2;
    },
    pxPerYear() {
      return this.W / this.camera.span;
    },

    // 1 = pure century bubbles, 0 = pure person bars; in between = crossfade
    eraOpacity() {
      return Math.min(1, Math.max(0, (this.camera.span - 260) / 240));
    },

    ticks() {
      // pick the smallest step that keeps labels at least ~90px apart,
      // so narrow screens automatically show fewer ticks
      const steps = [5, 10, 20, 50, 100, 200, 500, 1000];
      const step = steps.find((s) => s * this.pxPerYear >= 90) ?? 1000;
      const first = Math.ceil(this.left / step) * step;
      const out = [];
      for (let y = first; y <= this.left + this.camera.span; y += step) {
        out.push({ year: y, x: this.xFor(y) });
      }
      return out;
    },

    bubbles() {
      const scale = Math.min(1, this.W / 1100);
      return this.peopleStore.centuries.map((c) => ({
        ...c,
        x: this.xFor(c.start + 50),
        y: this.H * 0.52,
        r: Math.max(7, Math.min(64, 12 + Math.sqrt(c.count) * 1.55) * scale),
      }));
    },

    // famous first: the best-known people (and the selected one) always get a lane,
    // so the top rows naturally hold the biggest names. No lane cap — everyone who
    // shares the window gets a row, reachable by dragging vertically.
    packedAll() {
      if (this.eraOpacity >= 1) return { bars: [], laneCount: 0 };
      const right = this.left + this.camera.span;
      const selId = this.peopleStore.selectedId;
      const candidates = this.peopleStore.people
        .filter((p) => p.birthYear < right && this.endYear(p) > this.left)
        .sort((a, b) => (b.id === selId) - (a.id === selId) || b.sitelinks - a.sitelinks)
        .slice(0, 100);

      const lanes = [];
      const bars = [];
      for (const p of candidates) {
        const x1 = this.xFor(p.birthYear);
        const x2 = this.xFor(this.endYear(p));
        // 52px avatar+padding, ~8.4px per name char, ~70px for the years label
        const labelEnd = x1 + 52 + p.name.length * 8.4 + 70;
        const packEnd = Math.max(x2, labelEnd);
        let lane = lanes.findIndex((iv) => iv.every(([a, b]) => packEnd + 10 < a || b + 10 < x1));
        if (lane === -1) {
          lane = lanes.length;
          lanes.push([]);
        }
        lanes[lane].push([x1, packEnd]);
        bars.push({ p, x1, x2, w: Math.max(x2 - x1, 36), y: 84 + lane * 54 });
      }
      return { bars, laneCount: lanes.length };
    },

    // render the viewport plus a buffer band above/below, so portraits start
    // loading before their row scrolls into view (less pop-in while dragging).
    // av = atlas cell, resolved only for the handful of bars actually drawn.
    visibleBars() {
      return this.packedAll.bars
        .map((b) => ({ ...b, y: b.y - this.offsetY }))
        .filter((b) => b.y > -160 && b.y < this.H + 160)
        .map((b) => ({ ...b, av: this.peopleStore.avatar(b.p.id) }));
    },

    maxOffsetY() {
      return Math.max(0, 84 + this.packedAll.laneCount * 54 - (this.H - 40));
    },

    hiddenBelow() {
      const cutoff = this.H - 30 + this.offsetY;
      return this.packedAll.bars.filter((b) => b.y >= cutoff).length;
    },

    // dragged all the way down: the era shows only its top 100, nudge to search
    atBottom() {
      return this.eraOpacity < 0.5 && this.maxOffsetY > 0 && this.offsetY >= this.maxOffsetY - 1;
    },
  },

  watch: {
    "peopleStore.flySeq"() {
      const p = this.peopleStore.selected;
      if (!p) return;
      const end = this.endYear(p);
      const mid = (p.birthYear + end) / 2;
      const span = Math.min(220, Math.max(110, (end - p.birthYear) * 2.6));
      this.flyTo(mid, span, 1600);
    },
  },

  mounted() {
    const size = () => {
      const r = this.$refs.wrap.getBoundingClientRect();
      this.W = Math.max(320, r.width);
      this.H = Math.max(320, r.height);
    };
    size();
    this.resizeObserver = new ResizeObserver(size);
    this.resizeObserver.observe(this.$refs.wrap);
    // a pointer can be released outside the svg — window catches those so a
    // drag/pinch always ends cleanly
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    // opening shot: settle from far out into the overview
    this.flyTo(950, 2300, 1800);
  },

  beforeUnmount() {
    this.resizeObserver?.disconnect();
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    cancelAnimationFrame(this.animHandle);
  },

  methods: {
    xFor(year) {
      return (year - this.left) * this.pxPerYear;
    },
    yearAt(px) {
      return this.left + px / this.pxPerYear;
    },
    endYear(p) {
      if (p.deathYear != null) return p.deathYear;
      // no death date: someone born recently enough to plausibly still be living
      // extends to today; a birth 100+ years ago gets an assumed ~80y lifespan
      return this.NOW - p.birthYear <= 100 ? this.NOW : p.birthYear + 80;
    },
    fmtYear(y) {
      return y < 0 ? `${-y} BC` : `${y}`;
    },
    fmtCentury(start) {
      if (start < 0) return `${-start}s BC`;
      if (start === 0) return "1–100 AD";
      return `${start}s`;
    },
    initials(p) {
      return p.name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase();
    },
    thumb(p) {
      return p.image.startsWith("http") ? `${p.image}?width=64` : p.image;
    },

    flyTo(targetCenter, targetSpan, duration = 1200) {
      cancelAnimationFrame(this.animHandle);
      this.offsetY = 0;
      const c0 = this.camera.center;
      const s0 = this.camera.span;
      const c1 = targetCenter;
      const s1 = Math.min(MAX_SPAN, Math.max(MIN_SPAN, targetSpan));
      // zoom out first, then dive toward distant targets (Google Earth feel)
      const sMid = Math.max(s0, s1, Math.abs(c1 - c0) * 1.5);
      const start = performance.now();
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const logLerp = (a, b, t) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);

      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const e = ease(t);
        this.camera.center = c0 + (c1 - c0) * e;
        this.camera.span =
          e < 0.5 ? logLerp(s0, sMid, e * 2) : logLerp(sMid, s1, (e - 0.5) * 2);
        if (t < 1) this.animHandle = requestAnimationFrame(step);
      };
      this.animHandle = requestAnimationFrame(step);
    },

    // selection is URL-driven: navigate, and Home's route watcher does the rest
    goHome() {
      if (this.$route.name !== "home") this.$router.push("/");
    },

    zoomCentury(start) {
      if (this.lastMoved) return;
      this.goHome();
      this.flyTo(start + 50, 150, 1400);
    },

    pick(p) {
      if (this.lastMoved) return;
      this.$router.push(`/person/${p.slug}`);
    },

    svgX(clientX) {
      const rect = this.$refs.svg.getBoundingClientRect();
      return ((clientX - rect.left) / rect.width) * this.W;
    },

    clampCenter(center) {
      return Math.min(this.NOW + 100, Math.max(-3200, center));
    },

    onWheel(e) {
      cancelAnimationFrame(this.animHandle);
      const factor = e.deltaY > 0 ? 1.16 : 1 / 1.16;
      const px = this.svgX(e.clientX);
      const anchor = this.yearAt(px);
      const span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, this.camera.span * factor));
      this.camera.span = span;
      this.camera.center = this.clampCenter(anchor + (0.5 - px / this.W) * span);
    },

    // no pointer capture here: capturing retargets click events to the svg root,
    // which would swallow clicks on bubbles and person bars
    onDown(e) {
      cancelAnimationFrame(this.animHandle);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.lastMoved = false;
      if (this.pointers.size === 1) {
        this.pinch = null;
        this.drag = {
          startX: e.clientX,
          startY: e.clientY,
          startCenter: this.camera.center,
          startOffsetY: this.offsetY,
          moved: false,
        };
      } else if (this.pointers.size === 2) {
        this.drag = null;
        this.beginPinch();
      }
    },
    onMove(e) {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.pointers.size >= 2) {
        this.updatePinch();
      } else if (this.drag) {
        const rect = this.$refs.svg.getBoundingClientRect();
        const dxPx = ((e.clientX - this.drag.startX) / rect.width) * this.W;
        const dyPx = ((e.clientY - this.drag.startY) / rect.height) * this.H;
        if (Math.abs(dxPx) > 5 || Math.abs(dyPx) > 5) this.drag.moved = true;
        this.camera.center = this.clampCenter(this.drag.startCenter - dxPx / this.pxPerYear);
        this.offsetY = Math.min(this.maxOffsetY, Math.max(0, this.drag.startOffsetY - dyPx));
      }
    },
    onUp(e) {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 1) {
        // one finger lifted mid-pinch: resume single-finger pan from the other
        const [p] = [...this.pointers.values()];
        this.pinch = null;
        this.drag = { startX: p.x, startY: p.y, startCenter: this.camera.center, startOffsetY: this.offsetY, moved: true };
      } else if (this.pointers.size === 0) {
        // pointerup fires before click: remember a pan/pinch so click handlers ignore it
        if (this.drag?.moved || this.pinch?.moved) this.lastMoved = true;
        this.drag = null;
        this.pinch = null;
      }
    },

    beginPinch() {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2, moved: false };
    },
    updatePinch() {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const rect = this.$refs.svg.getBoundingClientRect();

      // two-finger pan: follow the midpoint, horizontally (time) and vertically (people)
      const dPxX = ((midX - this.pinch.midX) / rect.width) * this.W;
      this.camera.center = this.clampCenter(this.camera.center - dPxX / this.pxPerYear);
      const dPxY = ((midY - this.pinch.midY) / rect.height) * this.H;
      this.offsetY = Math.min(this.maxOffsetY, Math.max(0, this.offsetY - dPxY));

      // zoom anchored at the midpoint
      if (this.pinch.dist > 0 && dist > 0) {
        const pxMid = ((midX - rect.left) / rect.width) * this.W;
        const anchor = this.yearAt(pxMid);
        const span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, this.camera.span * (this.pinch.dist / dist)));
        this.camera.span = span;
        this.camera.center = this.clampCenter(anchor + (0.5 - pxMid / this.W) * span);
      }

      if (Math.abs(dist - this.pinch.dist) > 4 || Math.abs(dPxX) > 4 || Math.abs(dPxY) > 4) {
        this.pinch.moved = true;
        this.lastMoved = true;
      }
      this.pinch.dist = dist;
      this.pinch.midX = midX;
      this.pinch.midY = midY;
    },
    onBackgroundClick() {
      if (this.lastMoved) return;
      this.goHome();
    },
  },
};
</script>

<template>
  <div ref="wrap" class="tl-wrap">
    <svg
      ref="svg"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="xMidYMid meet"
      @wheel.prevent="onWheel"
      @pointerdown.prevent="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @click="onBackgroundClick"
    >
      <defs>
        <clipPath id="avatarClip" clipPathUnits="objectBoundingBox">
          <circle cx="0.5" cy="0.5" r="0.5" />
        </clipPath>
        <clipPath id="cellClip">
          <circle cx="14" cy="14" r="14" />
        </clipPath>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#252e52" />
          <stop offset="1" stop-color="#151c36" />
        </linearGradient>
        <linearGradient id="barGradSel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f2cd83" />
          <stop offset="1" stop-color="#c79939" />
        </linearGradient>
      </defs>

      <g class="axis">
        <line
          v-for="t in ticks"
          :key="'g' + t.year"
          :x1="t.x"
          :x2="t.x"
          :y1="46"
          :y2="H - 24"
          stroke="rgba(139,147,167,0.13)"
        />
        <text v-for="t in ticks" :key="'l' + t.year" :x="t.x" y="32" class="tick">
          {{ fmtYear(t.year) }}
        </text>
        <g v-if="xFor(NOW) > 0 && xFor(NOW) < W" class="today">
          <line :x1="xFor(NOW)" :x2="xFor(NOW)" :y1="46" :y2="H - 24" />
          <text :x="xFor(NOW)" :y="H - 8">today</text>
        </g>
      </g>

      <g v-if="eraOpacity > 0" :opacity="eraOpacity" class="era">
        <g
          v-for="b in bubbles"
          :key="b.start"
          class="bubble"
          @click.stop="zoomCentury(b.start)"
        >
          <circle :cx="b.x" :cy="b.y" :r="b.r" class="halo" />
          <circle :cx="b.x" :cy="b.y" :r="Math.max(4, b.r * 0.12)" class="core" />
          <text v-if="b.r > 13" :x="b.x" :y="b.y - b.r - 16" class="century">{{ fmtCentury(b.start) }}</text>
          <text v-if="b.r > 13" :x="b.x" :y="b.y + b.r + 26" class="count">{{ b.count.toLocaleString("en-US") }} people</text>
        </g>
      </g>

      <g v-if="eraOpacity < 1" :opacity="1 - eraOpacity" class="people">
        <g
          v-for="b in visibleBars"
          :key="b.p.id"
          class="person"
          :class="{
            sel: b.p.id === peopleStore.selectedId,
            dim: peopleStore.selectedId && b.p.id !== peopleStore.selectedId,
          }"
          @click.stop="pick(b.p)"
        >
          <rect
            :x="b.x1"
            :y="b.y"
            :width="b.w"
            height="36"
            rx="18"
            :fill="b.p.id === peopleStore.selectedId ? 'url(#barGradSel)' : 'url(#barGrad)'"
            :stroke="b.p.id === peopleStore.selectedId ? '#f2cd83' : 'rgba(139,147,167,0.35)'"
            :stroke-dasharray="b.p.deathYear === null ? '5 5' : null"
          />
          <g v-if="b.av" :transform="`translate(${b.x1 + 4}, ${b.y + 4})`" clip-path="url(#cellClip)">
            <image
              :href="b.av.url"
              :x="-b.av.col * 28"
              :y="-b.av.row * 28"
              :width="28 * b.av.cols"
              :height="28 * b.av.cols"
              preserveAspectRatio="none"
            />
          </g>
          <image
            v-else-if="b.p.image"
            :href="thumb(b.p)"
            :x="b.x1 + 4"
            :y="b.y + 4"
            width="28"
            height="28"
            clip-path="url(#avatarClip)"
            preserveAspectRatio="xMidYMid slice"
          />
          <circle v-else :cx="b.x1 + 18" :cy="b.y + 18" r="14" class="noimg" />
          <text v-if="!b.av && !b.p.image" :x="b.x1 + 18" :y="b.y + 22" class="init">{{ initials(b.p) }}</text>
          <text :x="b.x1 + 40" :y="b.y + 23" class="pname">
            {{ b.p.name }}
            <tspan class="years" dx="8">{{ fmtYear(b.p.birthYear) }}–{{ b.p.deathYear ? fmtYear(b.p.deathYear) : "?" }}</tspan>
          </text>
        </g>
      </g>
    </svg>
    <div v-if="atBottom" class="more">showing the top 100 of this era — search ↑ to find anyone else</div>
    <div v-else-if="hiddenBelow > 0 && eraOpacity < 0.5" class="more">↓ {{ hiddenBelow }} more people below</div>
    <div class="hint">drag ⇄ through time, ⇅ through people · scroll to zoom · click a century to dive in</div>
  </div>
</template>

<style scoped>
.tl-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

svg {
  flex: 1;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

svg:active {
  cursor: grabbing;
}

.tick {
  fill: var(--ink-muted);
  font: 500 13px var(--font-ui);
  text-anchor: middle;
}

.bubble {
  cursor: pointer;
}

.bubble .halo {
  fill: rgba(224, 180, 92, 0.09);
  stroke: rgba(224, 180, 92, 0.55);
  stroke-width: 1.4;
  transition: fill 0.3s;
}

.bubble:hover .halo {
  fill: rgba(224, 180, 92, 0.22);
}

.bubble .core {
  fill: var(--gold);
}

.century {
  fill: var(--ink);
  font: 600 17px var(--font-display);
  text-anchor: middle;
}

.count {
  fill: var(--ink-muted);
  font: 400 13px var(--font-ui);
  text-anchor: middle;
}

.person {
  cursor: pointer;
  transition: opacity 0.3s;
}

.person.dim {
  opacity: 0.3;
}

.pname {
  fill: var(--ink);
  font: 500 13.5px var(--font-ui);
  pointer-events: none;
}

.person.sel .pname {
  fill: #1c1204;
  font-weight: 600;
}

.years {
  fill: var(--ink-muted);
  font-size: 11.5px;
  font-weight: 400;
}

.person.sel .years {
  fill: rgba(28, 18, 4, 0.65);
}

.noimg {
  fill: #2b3352;
  stroke: rgba(139, 147, 167, 0.4);
}

.init {
  fill: var(--ink-muted);
  font: 600 10px var(--font-ui);
  text-anchor: middle;
  pointer-events: none;
}

.hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  color: var(--ink-muted);
  letter-spacing: 0.04em;
  pointer-events: none;
}

.more {
  position: absolute;
  bottom: 36px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  color: var(--gold);
  background: rgba(224, 180, 92, 0.08);
  border: 1px solid var(--gold-soft);
  border-radius: 999px;
  padding: 3px 14px;
  pointer-events: none;
}

.today line {
  stroke: var(--gold);
  stroke-width: 1.2;
  stroke-dasharray: 3 6;
  opacity: 0.55;
}

.today text {
  fill: var(--gold);
  font: 500 12px var(--font-ui);
  text-anchor: middle;
  letter-spacing: 0.08em;
}

@media (max-width: 640px) {
  .hint {
    display: none;
  }

  .more {
    bottom: 12px;
    font-size: 11px;
  }
}
</style>
