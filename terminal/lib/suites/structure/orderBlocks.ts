// Order Blocks — Structure Core flagship module.
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual acceptance bar:
// docs/PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md § "Order Blocks — visual spec";
// mechanics: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md § 8.1.
//
// Anatomy per live block: a direction-tinted band anchored at the origin candle and extended right,
// an emphasized outer extreme edge + a left origin tick, a dotted midline carrying the tier label,
// two aggressor capsules (sell upper / buy lower) with % chips, a brand score bar, and two
// right-edge metrics chips (total + share, signed delta). Mitigated blocks either vanish or flip
// into a deliberately quiet Breaker Block.
//
// Determinism: pure function of (bars, settings, colors). No wall clock, no randomness, no module
// state across calls. Blocks anchor only on CLOSED bars; grade percentiles use trailing windows
// only; nothing that is drawn for bar i depends on any bar > i (the "peak" method needs bar j+1 to
// confirm a local volume maximum, so a peak block simply does not exist until j+1 has closed — a
// one-bar confirmation delay, never a repaint).
//
// Macro blocks (opt-in): the SAME detector run over 4× resampled bars (`resampleOhlcv`), mapped back
// to source-bar geometry. Honest basis — these are chart bars grouped in fours, not a true HTF feed,
// and a group only becomes usable once it has CLOSED (the next source bar has opened), so the macro
// layer trails the 1× layer by up to 4 bars and never repaints. The 1× path is untouched by it.

import type {
  LabelPrim,
  LinePrim,
  ModuleCompute,
  Prim,
  SuiteBar,
  SuiteEvent,
  SuiteModuleDef,
  TooltipDef,
  XRef,
  ZonePrim,
} from "@/lib/indicator-canvas/types";
import { resampleOhlcv } from "@/lib/suites/shared/oscUtils";
import { findPivotsHL, type Pivot } from "./pivots";
import { ORDER_BLOCKS_META } from "./orderBlocks.meta";

// ------------------------------------------------------------------------------------- constants

const ATR_LEN = 14;
const VOL_WINDOW = 200; // trailing sample for every percentile
const PIVOT_LEN = 5; // "internal" structure pivots (masterplan §8.1)
const ANCHOR_SCAN = 5; // look back 1..5 bars for the last opposing candle
const TOUCH_COOLDOWN = 5; // bars between repeated ob_touch events for one block
const CAPSULE_SPAN = 40; // bars a 100% capsule would occupy
const MAX_LIVE = 24; // active blocks tracked (drawn set is `showLast`)
const MAX_BREAKERS = 8;
const MAX_EVENTS = 240;
const DETAIL_GATE = 3; // minPxPerBar for capsules / chips / score bar
const TIER_GATE = 2; // minPxPerBar for the tier label
const MIN_BARS = 30;
const MACRO_FACTOR = 4; // source bars per macro group
const MACRO_MAX = 3; // macro blocks drawn (capped again by `showLast`)
const MACRO_PREFIX = "Macro "; // event-label prefix (kept language-neutral, like "BOS"/"CHoCH")

type Dir = "bull" | "bear";
type Grade = "WEAK" | "BALANCED" | "HIGH" | "STRONG";

const TIER_LEX: Record<Grade, [string, string]> = {
  WEAK: ["WEAK", "弱"],
  BALANCED: ["BALANCED", "均衡"],
  HIGH: ["HIGH", "高"],
  STRONG: ["STRONG", "强"],
};

// ---------------------------------------------------------------------------------- small helpers

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const numOf = (v: any, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
const strOf = (v: any, dflt: string) => (typeof v === "string" && v ? v : dflt);
const boolOf = (v: any, dflt: boolean) => (typeof v === "boolean" ? v : dflt);

/** Compact volume notation: 954 · 2.95K · 1.20M · 3.40B. */
function fmtVol(x: number): string {
  const a = Math.abs(x);
  if (!Number.isFinite(a)) return "—";
  if (a >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(x / 1e3).toFixed(2)}K`;
  return `${Math.round(x)}`;
}
/** Signed compact volume with a typographic minus (never a hyphen) for the delta chip. */
function fmtSigned(x: number): string {
  return x < 0 ? `−${fmtVol(Math.abs(x))}` : `+${fmtVol(x)}`;
}

/** Wilder ATR over the full series (index-aligned; first ATR_LEN-1 entries are NaN). */
function atrSeries(bars: SuiteBar[], len: number): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  if (n === 0) return out;
  let seed = 0;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const tr =
      i === 0
        ? b.h - b.l
        : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c));
    if (i < len) {
      seed += tr;
      if (i === len - 1) out[i] = seed / len;
    } else {
      out[i] = (out[i - 1] * (len - 1) + tr) / len;
    }
  }
  return out;
}

/**
 * Percentile rank of `value` inside a trailing sample [from..to] (0..100). Returns 50 when the
 * sample is too thin to rank honestly — a neutral grade beats a fabricated extreme.
 */
function pctRank(value: number, sample: (k: number) => number, from: number, to: number): number {
  if (to < from) return 50;
  let le = 0;
  let tot = 0;
  for (let k = from; k <= to; k++) {
    const x = sample(k);
    if (!Number.isFinite(x)) continue;
    tot++;
    if (x <= value) le++;
  }
  if (tot < 10) return 50;
  return (100 * le) / tot;
}

function gradeOf(p: number): Grade {
  if (p >= 85) return "STRONG";
  if (p >= 60) return "HIGH";
  if (p >= 40) return "BALANCED";
  return "WEAK";
}

// ------------------------------------------------------------------------------------ block model

interface OBlock {
  id: number;
  dir: Dir;
  anchor: number; // origin candle (the last opposing candle before the impulse)
  impulse: number; // confirmed impulse bar
  lo: number;
  hi: number;
  buyV: number;
  sellV: number;
  total: number;
  delta: number;
  gradePct: number;
  grade: Grade;
  state: "active" | "breaker";
  breakIdx: number | null;
  lastTouch: number | null;
  touches: number;
}

// --------------------------------------------------------------------------------------- compute

const compute: ModuleCompute = (ctx) => {
  const { bars, colors, lang, s } = ctx;
  const n = bars.length;
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];
  const events: SuiteEvent[] = [];
  if (n < MIN_BARS) return { prims };

  // ---- settings
  const method = strOf(s.method, "volume");
  const showLast = Math.max(1, Math.min(12, Math.round(numOf(s.showLast, 6))));
  const typeFilter = strOf(s.type, "all");
  const boundsMode = strOf(s.boundsMode, "range");
  const mitigation = strOf(s.mitigation, "close");
  const kImpulse = Math.max(0.8, Math.min(3, numOf(s.kImpulse, 1.6)));
  const pVol = Math.max(30, Math.min(90, numOf(s.volPercentile, 60)));
  const breakerOn = boolOf(s.breaker, true);
  const showInternals = boolOf(s.showInternals, true);
  const showRating = boolOf(s.showRating, true);
  const bigTier = strOf(s.sizeDetail, "small") === "large";
  const extendRight = boolOf(s.extendRight, true);
  const macro = boolOf(s.macro, false);

  /**
   * The whole detector — series precomputation, detection and lifecycle — over ONE bar series, so
   * the macro layer can reuse it verbatim on resampled bars. Indices in the result are indices into
   * `src`; the caller maps them back when `src` is not the chart's own bar array. Pure: reads only
   * `src` and the settings closed over above.
   */
  const detect = (src: SuiteBar[]): { live: OBlock[]; breakers: OBlock[]; evs: SuiteEvent[] } => {
    const m = src.length;

    // ---- series precomputation (single pass each; prefix sums make every window O(1))
    const atr = atrSeries(src, ATR_LEN);
    const cumV = new Float64Array(m + 1);
    const cumBuy = new Float64Array(m + 1);
    for (let i = 0; i < m; i++) {
      const b = src[i];
      const rng = b.h - b.l;
      const buyFrac = rng > 0 ? clamp01((b.c - b.l) / rng) : 0.5;
      const v = Number.isFinite(b.v) && b.v > 0 ? b.v : 0;
      cumV[i + 1] = cumV[i] + v;
      cumBuy[i + 1] = cumBuy[i] + v * buyFrac;
    }
    const winVol = (a: number, b: number) => cumV[b + 1] - cumV[a];
    const winBuy = (a: number, b: number) => cumBuy[b + 1] - cumBuy[a];

    // Latest confirmed internal pivot level available AT each bar (no lookahead: a pivot only enters
    // the series at its confirmedAt bar).
    const lastPH = new Float64Array(m).fill(NaN);
    const lastPL = new Float64Array(m).fill(NaN);
    if (method === "priceAction") {
      const pivots: Pivot[] = findPivotsHL(src, PIVOT_LEN, PIVOT_LEN, "wick") ?? [];
      const phAt = new Float64Array(m).fill(NaN);
      const plAt = new Float64Array(m).fill(NaN);
      for (const pv of pivots) {
        const at = Math.max(0, Math.min(m - 1, Math.round(pv.confirmedAt)));
        if (pv.kind === "high") phAt[at] = pv.p;
        else plAt[at] = pv.p;
      }
      let ph = NaN;
      let pl = NaN;
      for (let i = 0; i < m; i++) {
        if (Number.isFinite(phAt[i])) ph = phAt[i];
        if (Number.isFinite(plAt[i])) pl = plAt[i];
        lastPH[i] = ph;
        lastPL[i] = pl;
      }
    }

    // ---- detection + lifecycle in ONE forward walk (O(n × MAX_LIVE), never O(n²))
    const live: OBlock[] = [];
    const breakers: OBlock[] = [];
    const evs: SuiteEvent[] = [];
    let nextId = 1;

    const pushEvent = (e: SuiteEvent) => {
      evs.push(e);
      if (evs.length > MAX_EVENTS) evs.shift();
    };

    const start = Math.max(ATR_LEN + 2, ANCHOR_SCAN + 1);
    for (let i = start; i < m; i++) {
      const bar = src[i];
      // An OHLC=0 / non-finite bar is a MISSING print (CN/HK premarket law) — it must neither touch,
      // mitigate nor break a block; one zero bar would otherwise close-through every bull zone at
      // once and spray false ob_break alerts (W4 review).
      if (!(Number.isFinite(bar.o) && Number.isFinite(bar.h) && Number.isFinite(bar.l) && Number.isFinite(bar.c)) || (bar.o === 0 && bar.h === 0 && bar.l === 0 && bar.c === 0)) continue;

      // ---- 1. lifecycle for blocks that already existed BEFORE this bar
      for (let k = live.length - 1; k >= 0; k--) {
        const b = live[k];
        if (b.impulse >= i) continue;
        const mid = (b.lo + b.hi) / 2;
        const overlaps = bar.l <= b.hi && bar.h >= b.lo;

        if (overlaps && (b.lastTouch === null || i - b.lastTouch >= TOUCH_COOLDOWN)) {
          b.lastTouch = i;
          b.touches++;
          pushEvent({
            type: "ob_touch",
            dir: b.dir,
            i,
            p: mid,
            strength: Math.round(b.gradePct),
            label: lang === "zh" ? `${b.dir === "bull" ? "看涨" : "看跌"}订单块回测` : `${b.dir === "bull" ? "Bullish" : "Bearish"} OB retest`,
          });
        }

        let done = false;
        if (mitigation === "touch") done = overlaps;
        else if (mitigation === "wick") done = b.dir === "bull" ? bar.l < b.lo : bar.h > b.hi;
        else if (mitigation === "avg") done = b.dir === "bull" ? bar.c < mid : bar.c > mid;
        else done = b.dir === "bull" ? bar.c < b.lo : bar.c > b.hi; // "close" (default)

        if (!done) continue;
        live.splice(k, 1);
        b.breakIdx = i;
        pushEvent({
          type: "ob_break",
          dir: b.dir,
          i,
          p: mid,
          strength: Math.round(b.gradePct),
          label:
            lang === "zh"
              ? `${b.dir === "bull" ? "看涨" : "看跌"}订单块被击穿`
              : `${b.dir === "bull" ? "Bullish" : "Bearish"} OB mitigated`,
        });
        if (breakerOn) {
          b.state = "breaker";
          breakers.push(b);
          if (breakers.length > MAX_BREAKERS) breakers.shift();
        }
      }

      // ---- 2. impulse detection on this (closed) bar
      const a = atr[i];
      if (!Number.isFinite(a) || a <= 0) continue;
      const body = src[i].c - src[i].o;
      const expanded = Math.abs(body) > kImpulse * a;

      let dir: Dir | null = null;
      if (method === "priceAction") {
        const ph = lastPH[i];
        const pl = lastPL[i];
        if (Number.isFinite(ph) && bar.c > ph && src[i - 1].c <= ph) dir = "bull";
        else if (Number.isFinite(pl) && bar.c < pl && src[i - 1].c >= pl) dir = "bear";
      } else if (method === "peak") {
        // Exhaustion flavor: an expansion bar that is the local volume maximum of j-1..j+1 and closes
        // in the outer quarter of its own range. Needs j+1 → confirms one bar late, by design.
        if (expanded && i + 1 < m) {
          const v0 = src[i - 1].v;
          const v1 = src[i].v;
          const v2 = src[i + 1].v;
          const isPeak = v1 >= v0 && v1 >= v2;
          const rng = bar.h - bar.l;
          const cp = rng > 0 ? (bar.c - bar.l) / rng : 0.5;
          if (isPeak && (cp >= 0.75 || cp <= 0.25)) dir = body > 0 ? "bull" : "bear";
        }
      } else {
        // "volume" (default): range expansion confirmed by a high trailing volume percentile.
        if (expanded) {
          const vp = pctRank(src[i].v, (k) => src[k].v, Math.max(0, i - VOL_WINDOW), i - 1);
          if (vp >= pVol) dir = body > 0 ? "bull" : "bear";
        }
      }
      if (!dir) continue;

      // ---- 3. anchor = LAST opposing candle in the 1..5 bars before the impulse
      let anchor = -1;
      for (let k = i - 1; k >= Math.max(0, i - ANCHOR_SCAN); k--) {
        const ob = src[k];
        const opposing = dir === "bull" ? ob.c < ob.o : ob.c > ob.o;
        if (opposing) {
          anchor = k;
          break;
        }
      }
      if (anchor < 0) continue;
      if (live.some((b) => b.anchor === anchor)) continue; // one block per origin candle

      const ab = src[anchor];
      const lo = boundsMode === "body" ? Math.min(ab.o, ab.c) : ab.l;
      const hi = boundsMode === "body" ? Math.max(ab.o, ab.c) : ab.h;
      if (!(hi > lo)) continue;

      // ---- 4. volume internals over the formation window [anchor-2 .. impulse]
      const w0 = Math.max(0, anchor - 2);
      const W = i - w0 + 1;
      const total = winVol(w0, i);
      const buyV = winBuy(w0, i);
      const sellV = Math.max(0, total - buyV);
      const delta = buyV - sellV;

      // ---- 5. grade = blended trailing percentile of (window volume, |delta| share, impulse size)
      const from = Math.max(W - 1, i - VOL_WINDOW);
      const pTotal = pctRank(total, (k) => winVol(k - W + 1, k), from, i - 1);
      const dRatio = total > 0 ? Math.abs(delta) / total : 0;
      const pDelta = pctRank(
        dRatio,
        (k) => {
          const t = winVol(k - W + 1, k);
          return t > 0 ? Math.abs(2 * winBuy(k - W + 1, k) - t) / t : NaN;
        },
        from,
        i - 1,
      );
      const pImp = pctRank(
        Math.abs(body) / a,
        (k) => (atr[k] > 0 ? Math.abs(src[k].c - src[k].o) / atr[k] : NaN),
        Math.max(ATR_LEN, i - VOL_WINDOW),
        i - 1,
      );
      const gradePct = (pTotal + pDelta + pImp) / 3;

      const blk: OBlock = {
        id: nextId++,
        dir,
        anchor,
        impulse: i,
        lo,
        hi,
        buyV,
        sellV,
        total,
        delta,
        gradePct,
        grade: gradeOf(gradePct),
        state: "active",
        breakIdx: null,
        lastTouch: null,
        touches: 0,
      };
      live.push(blk);
      if (live.length > MAX_LIVE) live.shift();
      pushEvent({
        type: "ob_created",
        dir,
        i,
        p: (lo + hi) / 2,
        strength: Math.round(gradePct),
        label:
          lang === "zh"
            ? `${dir === "bull" ? "看涨" : "看跌"}订单块 · ${TIER_LEX[blk.grade][1]}`
            : `${dir === "bull" ? "Bullish" : "Bearish"} OB · ${blk.grade}`,
      });
    }

    return { live, breakers, evs };
  };

  const { live, breakers, evs } = detect(bars);
  for (const e of evs) events.push(e);

  // ---- draw set
  const keep = (b: OBlock) =>
    typeFilter === "all" || (typeFilter === "bull" ? b.dir === "bull" : b.dir === "bear");
  const drawn = live.filter(keep).slice(-showLast);
  const drawnBreakers = breakerOn ? breakers.filter(keep).slice(-showLast) : [];

  // Population-relative share: recomputed over the VISIBLE blocks (vendor behaviour — the same
  // block reads 54.8% with 2 shown and 34.7% with 3).
  const popTotal = drawn.reduce((acc, b) => acc + b.total, 0);

  const lastIdx = n - 1;
  const dirColor = (d: Dir) => (d === "bull" ? colors.up : colors.down);

  // ---- Macro blocks: the same detector on 4× resampled bars (masterplan §8.1). Drawn UNDER the 1×
  // layer, deliberately quiet — a fainter fill, a dashed hairline outer edge, an "M-" tier label and
  // nothing else. No internals: the buy/sell split of a grouped bar is an estimate of an estimate.
  if (macro) {
    const { groups, lastSrc } = resampleOhlcv(bars, MACRO_FACTOR);
    // `resampleOhlcv` already drops a short trailing group, but when n % 4 === 0 the last complete
    // group still ENDS on the live forming bar. A group is usable only once closed (the next source
    // bar has opened) — the mtfDash.ts rule — so step back one (see report / guide "Macro blocks").
    let gLast = groups.length - 1;
    if (gLast >= 0 && lastSrc[gLast] === n - 1) gLast--;
    const closed = groups.slice(0, gLast + 1);
    if (closed.length >= MIN_BARS) {
      const srcEnd = (g: number) => Math.max(0, Math.min(lastIdx, lastSrc[g]));
      const srcStart = (g: number) => Math.max(0, srcEnd(g) - MACRO_FACTOR + 1);
      const mac = detect(closed);
      for (const e of mac.evs) {
        events.push({
          ...e,
          i: srcEnd(e.i),
          label: e.label ? `${MACRO_PREFIX}${e.label}` : e.label,
        });
      }
      const macroDrawn = mac.live.filter(keep).slice(-Math.min(MACRO_MAX, showLast));
      for (const b of macroDrawn) {
        const c = dirColor(b.dir);
        const i1 = srcStart(b.anchor);
        // Non-extending macro bands live 15 MACRO bars, i.e. 15 × 4 source bars — same rule, HTF scale.
        const endIdx = extendRight
          ? lastIdx
          : Math.min(srcEnd(b.impulse) + 15 * MACRO_FACTOR, lastIdx);
        const rightRef: XRef = extendRight ? "right" : endIdx;
        prims.push({
          kind: "zone",
          id: `obm:${b.id}:z`,
          i1,
          i2: rightRef,
          p1: b.lo,
          p2: b.hi,
          fill: c,
          fillAlpha: 0.06,
          stroke: c,
          strokeW: 1,
          dash: "4 3",
          edges: [b.dir === "bull" ? "bottom" : "top"],
          z: 0,
        } as ZonePrim);
        prims.push({
          kind: "label",
          id: `obm:${b.id}:tier`,
          i: i1,
          p: (b.lo + b.hi) / 2,
          text: `M-${TIER_LEX[b.grade][lang === "zh" ? 1 : 0]}`,
          place: "right",
          style: "bare",
          color: colors.muted,
          fs: bigTier ? 14 : 9,
          bold: bigTier,
          dxPx: 4,
          dyPx: -7,
          z: 3,
          minPxPerBar: TIER_GATE,
        } as LabelPrim);
      }
    }
    // The macro leg APPENDS its (older, group-end) events after the whole 1× tape, which would
    // leave the merged stream unordered — consumers read the newest event as the last element —
    // and would let the tape run to 2 × MAX_EVENTS. Restore the module's one contract: bar-ordered
    // (stable, so in-bar emission order survives) and bounded by MAX_EVENTS, newest kept.
    events.sort((a, b) => a.i - b.i);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  }

  if (!drawn.length && !drawnBreakers.length) return { prims, events };

  for (const b of drawn) {
    const endIdx = extendRight ? lastIdx : Math.min(b.impulse + 15, lastIdx);
    const rightRef: XRef = extendRight ? "right" : endIdx;
    const c = dirColor(b.dir);
    const h = b.hi - b.lo;
    const mid = b.lo + h / 2;
    const pSell = b.lo + 0.75 * h;
    const pBuy = b.lo + 0.25 * h;
    const tipId = `ob:${b.id}:tip`;

    // Band: direction tint, emphasized outer extreme edge, dotted muted midline.
    const zone: ZonePrim = {
      kind: "zone",
      id: `ob:${b.id}:z`,
      i1: b.anchor,
      i2: rightRef,
      p1: b.lo,
      p2: b.hi,
      fill: c,
      fillAlpha: 0.09,
      stroke: c,
      strokeW: 2,
      edges: [b.dir === "bull" ? "bottom" : "top"],
      midline: { color: colors.muted, dash: "1 3" },
      z: 0,
    };
    prims.push(zone);

    // Left origin tick (vertical hairline at the anchor candle).
    prims.push({
      kind: "line",
      id: `ob:${b.id}:tick`,
      a: { i: b.anchor, p: b.lo },
      b: { i: b.anchor, p: b.hi },
      color: c,
      w: 1,
      alpha: 0.55,
      z: 1,
    } as LinePrim);

    // Right spine — only expressible when the band ends at a real bar index (see report).
    if (!extendRight) {
      prims.push({
        kind: "line",
        id: `ob:${b.id}:spine`,
        a: { i: endIdx, p: b.lo },
        b: { i: endIdx, p: b.hi },
        color: c,
        w: 3,
        alpha: 0.95,
        z: 1,
      } as LinePrim);
    }

    // Aggressor capsules + % chips.
    if (showInternals && b.total > 0) {
      const sellShare = b.sellV / b.total;
      const buyShare = b.buyV / b.total;
      const maxLen = Math.max(1, endIdx - b.anchor);
      const sellLen = Math.max(1, Math.min(Math.round(sellShare * CAPSULE_SPAN), maxLen));
      const buyLen = Math.max(1, Math.min(Math.round(buyShare * CAPSULE_SPAN), maxLen));

      prims.push(
        {
          kind: "line",
          id: `ob:${b.id}:sellbar`,
          a: { i: b.anchor, p: pSell },
          b: { i: b.anchor + sellLen, p: pSell },
          color: colors.flowSell,
          w: 4,
          z: 2,
          minPxPerBar: DETAIL_GATE,
        } as LinePrim,
        {
          kind: "label",
          id: `ob:${b.id}:sellpct`,
          i: b.anchor + sellLen,
          p: pSell,
          text: `▼ ${(sellShare * 100).toFixed(2)}%`,
          place: "right",
          style: "bare",
          color: colors.flowSell,
          fs: 10,
          dxPx: 4,
          z: 3,
          minPxPerBar: DETAIL_GATE,
        } as LabelPrim,
        {
          kind: "line",
          id: `ob:${b.id}:buybar`,
          a: { i: b.anchor, p: pBuy },
          b: { i: b.anchor + buyLen, p: pBuy },
          color: colors.flowBuy,
          w: 4,
          z: 2,
          minPxPerBar: DETAIL_GATE,
        } as LinePrim,
        {
          kind: "label",
          id: `ob:${b.id}:buypct`,
          i: b.anchor + buyLen,
          p: pBuy,
          text: `▲ ${(buyShare * 100).toFixed(2)}%`,
          place: "right",
          style: "bare",
          color: colors.flowBuy,
          fs: 10,
          dxPx: 4,
          z: 3,
          minPxPerBar: DETAIL_GATE,
        } as LabelPrim,
      );

      // Metrics chips at the band's right edge: total (+ share of visible population), then delta.
      const share = popTotal > 0 ? (b.total / popTotal) * 100 : 0;
      prims.push(
        {
          kind: "label",
          id: `ob:${b.id}:total`,
          i: rightRef,
          p: b.lo + 0.78 * h,
          text: `${fmtVol(b.total)} (${share.toFixed(1)}%)`,
          place: "left",
          style: "chip",
          color: c,
          fs: 10,
          dxPx: -8,
          tooltipId: tipId,
          z: 3,
          minPxPerBar: DETAIL_GATE,
        } as LabelPrim,
        {
          kind: "label",
          id: `ob:${b.id}:delta`,
          i: rightRef,
          p: b.lo + 0.22 * h,
          text: fmtSigned(b.delta),
          place: "left",
          style: "chip",
          color: b.delta >= 0 ? colors.flowBuy : colors.flowSell,
          fs: 10,
          dxPx: -8,
          tooltipId: tipId,
          z: 3,
          minPxPerBar: DETAIL_GATE,
        } as LabelPrim,
      );
    }

    // Score bar on the midline (grade percentile) + its readout.
    if (showRating) {
      const maxLen = Math.max(1, endIdx - b.anchor);
      const sLen = Math.max(1, Math.min(Math.round((b.gradePct / 100) * CAPSULE_SPAN), maxLen));
      prims.push(
        {
          kind: "line",
          id: `ob:${b.id}:score`,
          a: { i: b.anchor, p: mid },
          b: { i: b.anchor + sLen, p: mid },
          color: colors.brand,
          w: 3,
          z: 2,
          minPxPerBar: DETAIL_GATE,
        } as LinePrim,
        {
          kind: "label",
          id: `ob:${b.id}:scorepct`,
          i: b.anchor + sLen,
          p: mid,
          text: `▶ ${Math.round(b.gradePct)}%`,
          place: "right",
          style: "bare",
          color: colors.brand,
          fs: 9,
          dxPx: 4,
          z: 3,
          minPxPerBar: DETAIL_GATE,
        } as LabelPrim,
      );
    }

    // Tier label — rides just above the midline near the origin so it never sits under the score bar.
    prims.push({
      kind: "label",
      id: `ob:${b.id}:tier`,
      i: b.anchor,
      p: mid,
      text: TIER_LEX[b.grade][lang === "zh" ? 1 : 0],
      place: "right",
      style: "bare",
      color: bigTier ? colors.text : colors.muted,
      fs: bigTier ? 16 : 9,
      bold: bigTier,
      dxPx: 4,
      dyPx: -7,
      tooltipId: tipId,
      z: 3,
      minPxPerBar: TIER_GATE,
    } as LabelPrim);

    const zh = lang === "zh";
    tooltips.push({
      id: tipId,
      title: zh
        ? `${b.dir === "bull" ? "看涨" : "看跌"}订单块`
        : `${b.dir === "bull" ? "Bullish" : "Bearish"} Order Block`,
      accent: c,
      rows: [
        { k: zh ? "成交量" : "Volume", v: fmtVol(b.total) },
        {
          k: zh ? "净差" : "Delta",
          v: fmtSigned(b.delta),
          color: b.delta >= 0 ? colors.flowBuy : colors.flowSell,
        },
        {
          k: zh ? "买方 %" : "Buy %",
          v: `${(b.total > 0 ? (b.buyV / b.total) * 100 : 0).toFixed(2)}%`,
          color: colors.flowBuy,
        },
        {
          k: zh ? "卖方 %" : "Sell %",
          v: `${(b.total > 0 ? (b.sellV / b.total) * 100 : 0).toFixed(2)}%`,
          color: colors.flowSell,
        },
        { k: zh ? "评级" : "Grade", v: `${TIER_LEX[b.grade][zh ? 1 : 0]} · ${Math.round(b.gradePct)}%` },
        { k: zh ? "存续（根）" : "Age (bars)", v: `${lastIdx - b.impulse}` },
      ],
    });
  }

  // Breaker Blocks: role-flipped, deliberately quiet — no internals, no chips, dashed hairline.
  for (const b of drawnBreakers) {
    const from = b.breakIdx ?? b.impulse;
    const endIdx = extendRight ? lastIdx : Math.min(from + 15, lastIdx);
    const rightRef: XRef = extendRight ? "right" : endIdx;
    const flipped: Dir = b.dir === "bull" ? "bear" : "bull";
    prims.push({
      kind: "zone",
      id: `ob:${b.id}:brk`,
      i1: from,
      i2: rightRef,
      p1: b.lo,
      p2: b.hi,
      fill: dirColor(flipped),
      fillAlpha: 0.06,
      stroke: colors.muted,
      strokeW: 1,
      dash: "4 3",
      z: 0,
    } as ZonePrim);
    prims.push({
      kind: "label",
      id: `ob:${b.id}:brklbl`,
      i: rightRef,
      p: (b.lo + b.hi) / 2,
      text: lang === "zh" ? "破位块" : "Breaker Block",
      place: "left",
      style: "bare",
      color: colors.muted,
      fs: 10,
      dxPx: -10,
      z: 3,
      minPxPerBar: TIER_GATE,
    } as LabelPrim);
  }

  return { prims, tooltips, events };
};

// --------------------------------------------------------------------------------- module export

export const ORDER_BLOCKS_MODULE: SuiteModuleDef = { ...ORDER_BLOCKS_META, compute };

export default ORDER_BLOCKS_MODULE;
