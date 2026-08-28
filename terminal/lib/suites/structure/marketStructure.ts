// Market Structure — the visual centerpiece of Structure Core.
//
// Spec: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.1 and the
// "Market Structure — visual spec" section of docs/PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md.
// Contract: lib/indicator-canvas/types.ts. Pure + deterministic: no DOM, no CSS reads, no clock,
// no randomness, no module-level mutable state.
//
// Non-repaint law: every prim/event below derives ONLY from (a) pivots whose `confirmedAt` has
// already passed and (b) closes at or before the bar being evaluated. The single exception is the
// deliberately-live zigzag leg (dashed) and the pending projection rays, which are un-confirmed by
// construction and are drawn as such.

import type {
  CandlePaintEntry,
  ModuleCtx,
  ModuleResult,
  Prim,
  SuiteBar,
  SuiteColors,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  TooltipDef,
} from "@/lib/indicator-canvas/types";
import { findPivotsHL, type Pivot } from "./pivots";
import { MARKET_STRUCTURE_META } from "./marketStructure.meta";

// ------------------------------------------------------------------------------------- constants

const CISD_LOOKAHEAD = 10;      // bars a break has to survive before it can no longer fail (spec: k=10)
const DTDB_SCAN = 250;          // bars to wait for a neckline break before abandoning a double top/bottom
const DTDB_MAX_DRAWN = 4;       // density: only the most recent handful of patterns stay on the chart
const DELTA_WINDOW = 100;       // trailing swings used for the delta percentile
const INTERNAL_MAX_DRAWN = 20;  // internal chain is chrome — never let it out-shout the swing chain
const INTERNAL_MIN_PX = 2.5;    // ...and fold it away entirely when bars get thin
const PIVOT_MARK_MIN = 8;       // diamonds / swing labels / zigzag legs drawn, floor…
const PIVOT_MARK_MAX = 24;      // …and ceiling (keeps the worst-case prim budget under 400)

// ------------------------------------------------------------------------------------ small utils

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function numSet(v: any, def: number, lo: number, hi: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : def;
}
function boolSet(v: any, def: boolean): boolean {
  return typeof v === "boolean" ? v : def;
}
function pickOne<T extends string>(v: any, allowed: readonly T[], def: T): T {
  return (allowed as readonly string[]).includes(v) ? (v as T) : def;
}

/** K/M/B notation, 3 decimals inside a magnitude (matches the reference tooltip's "5.314K"). */
function fmtK(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(3)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(3)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(3)}K`;
  return v.toFixed(0);
}

/** Candle-geometry aggressor split (same formula as intradayMath.cvdApprox, inlined to stay pure). */
function barDelta(b: SuiteBar, prevClose: number | null): number {
  const v = Math.max(0, Number(b.v) || 0);
  const range = b.h - b.l;
  if (!(range > 0)) {
    const prev = prevClose ?? b.c;
    const d = b.c - prev;
    return (d > 0 ? 1 : d < 0 ? -1 : 0) * v;
  }
  return (v * ((b.c - b.l) - (b.h - b.c))) / range;
}

/** Fraction of the sample strictly below x, in [0,1]. */
function pctRank(sample: number[], x: number): number {
  if (!sample.length) return 0.5;
  let lt = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] < x) lt++;
  return lt / sample.length;
}

// ------------------------------------------------------------------------------- trend/break model

type Dir = "bull" | "bear";
interface Brk {
  kind: "bos" | "choch";
  dir: Dir;
  pi: number;   // pivot bar index (line origin)
  pp: number;   // level price
  j: number;    // break bar (close through the level)
}
interface ChainRun {
  breaks: Brk[];
  firedAt: Map<string, number>;  // `${kind}:${pivot.i}` -> break bar
  trendAt: Int8Array;            // per-bar trend state (-1/0/1)
  pendingHigh: Pivot | null;     // most recent un-broken swing high
  pendingLow: Pivot | null;
  trend: number;                 // final state
}

/**
 * One pivot chain's state machine.
 *
 * Levels are absorbed on their `confirmedAt` bar and can only be broken on a LATER bar, so a level
 * never fires on a bar that was inside its own confirmation window. Each level fires at most once;
 * a freshly confirmed pivot replaces the defended level and re-arms it.
 */
function runChain(bars: SuiteBar[], pivots: Pivot[]): ChainRun {
  const n = bars.length;
  const byConfirm = new Map<number, { hi?: Pivot; lo?: Pivot }>();
  for (const pv of pivots) {
    const e = byConfirm.get(pv.confirmedAt) ?? {};
    if (pv.kind === "high") e.hi = pv; else e.lo = pv;
    byConfirm.set(pv.confirmedAt, e);
  }

  const breaks: Brk[] = [];
  const firedAt = new Map<string, number>();
  const trendAt = new Int8Array(n);
  let trend = 0;
  let sh: Pivot | null = null, shFired = false;
  let sl: Pivot | null = null, slFired = false;

  for (let j = 0; j < n; j++) {
    const e = byConfirm.get(j);
    if (e?.hi) { sh = e.hi; shFired = false; }
    if (e?.lo) { sl = e.lo; slFired = false; }

    const c = bars[j].c;
    if (Number.isFinite(c)) {
      if (sh && !shFired && j > sh.confirmedAt && c > sh.p) {
        breaks.push({ kind: trend === -1 ? "choch" : "bos", dir: "bull", pi: sh.i, pp: sh.p, j });
        firedAt.set(`high:${sh.i}`, j);
        shFired = true;
        trend = 1;
      }
      if (sl && !slFired && j > sl.confirmedAt && c < sl.p) {
        breaks.push({ kind: trend === 1 ? "choch" : "bos", dir: "bear", pi: sl.i, pp: sl.p, j });
        firedAt.set(`low:${sl.i}`, j);
        slFired = true;
        trend = -1;
      }
    }
    trendAt[j] = trend as -1 | 0 | 1;
  }

  return {
    breaks,
    firedAt,
    trendAt,
    pendingHigh: sh && !shFired ? sh : null,
    pendingLow: sl && !slFired ? sl : null,
    trend,
  };
}

/** Alternating high/low chain (zigzag reduction): same-kind runs collapse to the more extreme pivot. */
function alternating(pivots: Pivot[]): Pivot[] {
  const out: Pivot[] = [];
  for (const pv of pivots) {
    const last = out[out.length - 1];
    if (!last) { out.push(pv); continue; }
    if (last.kind === pv.kind) {
      const better = pv.kind === "high" ? pv.p > last.p : pv.p < last.p;
      if (better) out[out.length - 1] = pv;
    } else {
      out.push(pv);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------- the compute

function compute(ctx: ModuleCtx): ModuleResult {
  const bars = ctx.bars ?? [];
  const n = bars.length;
  const C: SuiteColors = ctx.colors;
  const zh = ctx.lang === "zh";
  const L = (en: string, cn: string) => (zh ? cn : en);

  const prims: Prim[] = [];
  const events: SuiteEvent[] = [];
  const tooltips: TooltipDef[] = [];
  const empty: ModuleResult = { prims: [], events: [], tooltips: [] };
  if (n < 12) return empty;

  const s = ctx.s ?? {};
  const internalLen = Math.round(numSet(s.internalLen, 5, 2, 20));
  const swingLen = Math.round(numSet(s.swingLen, 50, 10, 100));
  const source = pickOne(s.source, ["wick", "body"] as const, "wick");
  const filter = pickOne(s.filter, ["all", "bull", "bear"] as const, "all");
  const wantProjection = boolSet(s.projection, true);
  const wantCisd = boolSet(s.cisd, true);
  const wantDiamonds = boolSet(s.diamonds, true);
  const wantMapping = boolSet(s.mapping, false);
  const wantSwingLabels = boolSet(s.swingLabels, true);
  const wantStrongWeak = boolSet(s.strongWeak, false);
  const wantDtdb = boolSet(s.dtdb, true);
  const dtdbThreshold = numSet(s.dtdbThreshold, 0.3, 0.05, 2);
  const wantStructCandles = boolSet(s.structCandles, false);
  const showLast = Math.round(numSet(s.showLast, 12, 4, 40));

  const dirOk = (d: Dir) => filter === "all" || (filter === "bull" ? d === "bull" : d === "bear");
  const dirColor = (d: Dir) => (d === "bull" ? C.up : C.down);
  const markKeep = clamp(showLast, PIVOT_MARK_MIN, PIVOT_MARK_MAX);

  // --- pivot chains + state machines (always run over FULL history; only prims are capped) -------
  const swingPivots = findPivotsHL(bars, swingLen, swingLen, source);
  const internalPivots = findPivotsHL(bars, internalLen, internalLen, source);
  const swing = runChain(bars, swingPivots);
  const internal = runChain(bars, internalPivots);

  // --- 1. structure lines + labels (BOS dashed / CHoCH solid) ------------------------------------
  const drawBreaks = (run: ChainRun, isSwing: boolean) => {
    const list = run.breaks.slice(-(isSwing ? showLast : Math.min(showLast, INTERNAL_MAX_DRAWN)));
    for (const b of list) {
      if (!dirOk(b.dir)) continue;
      const solid = b.kind === "choch";
      const col = isSwing ? dirColor(b.dir) : C.neutral;
      const tag = isSwing ? "sw" : "in";
      prims.push({
        kind: "line",
        id: `ms-${tag}-${b.kind}-${b.j}`,
        z: 1,
        a: { i: b.pi, p: b.pp },
        b: { i: b.j, p: b.pp },
        color: col,
        w: solid ? 1.8 : 1,
        dash: solid ? undefined : "4 3",
        alpha: isSwing ? 1 : 0.7,
        ...(isSwing ? {} : { minPxPerBar: INTERNAL_MIN_PX }),
      });
      prims.push({
        kind: "label",
        id: `ms-${tag}-${b.kind}-l-${b.j}`,
        z: 3,
        i: Math.round((b.pi + b.j) / 2),
        p: b.pp,
        text: b.kind === "bos" ? "BOS" : "CHoCH",
        place: b.dir === "bull" ? "above" : "below",
        style: "bare",
        color: isSwing ? C.text : C.muted,
        fs: 9,
        ...(isSwing ? {} : { minPxPerBar: INTERNAL_MIN_PX }),
      });
    }
  };
  drawBreaks(swing, true);
  drawBreaks(internal, false);

  // Events come from the swing chain only (the tradable ones) — internal breaks stay chrome so
  // alerts do not fire on every 5-bar wiggle. Events are NOT capped by showLast.
  for (const b of swing.breaks) {
    events.push({
      type: b.kind,
      dir: b.dir,
      i: b.j,
      p: b.pp,
      label: `${b.kind === "bos" ? "BOS" : "CHoCH"} ${b.dir === "bull" ? "↑" : "↓"}`,
    });
  }

  // --- 2. projection: pending (un-broken) swing levels ray to the right edge ---------------------
  if (wantProjection) {
    const proj = (pv: Pivot | null, side: Dir) => {
      if (!pv || !dirOk(side)) return;
      // Breaking the level in `side` direction continues the trend ⇒ BOS, otherwise it reverses ⇒ CHOCH.
      const continues = side === "bull" ? swing.trend >= 0 : swing.trend <= 0;
      prims.push({
        kind: "line",
        id: `ms-proj-${side}`,
        z: 1,
        a: { i: pv.i, p: pv.p },
        b: { i: "right", p: pv.p },
        color: C.neutral,
        w: 1,
        dash: "3 4",
        alpha: 0.75,
      });
      prims.push({
        kind: "label",
        id: `ms-proj-l-${side}`,
        z: 3,
        i: "right",
        p: pv.p,
        text: continues ? "BOS" : "CHOCH",
        place: "left",
        style: "bare",
        color: dirColor(side),
        fs: 9,
        dxPx: -4,
      });
    };
    proj(swing.pendingHigh, "bull");
    proj(swing.pendingLow, "bear");
  }

  // --- 3. CISD — a break whose impulse is fully retraced within k bars ---------------------------
  if (wantCisd) {
    // Detection runs over every break (events are uncapped); only the recent window is drawn.
    const drawnFrom = swing.breaks.length > markKeep ? swing.breaks[swing.breaks.length - markKeep].j : -1;
    for (const b of swing.breaks) {
      const open = bars[b.j].o;
      if (!Number.isFinite(open)) continue;
      let ext = b.dir === "bull" ? bars[b.j].h : bars[b.j].l;
      const stop = Math.min(n - 1, b.j + CISD_LOOKAHEAD);
      for (let m = b.j + 1; m <= stop; m++) {
        const bar = bars[m];
        if (b.dir === "bull") {
          if (bar.h > ext) ext = bar.h;
          if (!(bar.c < open)) continue;
        } else {
          if (bar.l < ext) ext = bar.l;
          if (!(bar.c > open)) continue;
        }
        // The leg failed: the CISD points the OPPOSITE way to the break it invalidated.
        const cdir: Dir = b.dir === "bull" ? "bear" : "bull";
        const col = dirColor(cdir);
        const text = cdir === "bull" ? "+CISD" : "-CISD";
        events.push({ type: "cisd", dir: cdir, i: m, p: open, label: text });
        if (dirOk(cdir) && b.j >= drawnFrom) {
          prims.push({
            kind: "zone",
            id: `ms-cisd-${b.j}`,
            z: 0,
            i1: b.j, i2: m,
            p1: open, p2: ext,
            fill: col,
            fillAlpha: 0.1,
            stroke: col,
            strokeW: 1.5,
            edges: [b.dir === "bull" ? "bottom" : "top"],
          });
          prims.push({
            kind: "label",
            id: `ms-cisd-l-${b.j}`,
            z: 3,
            i: m, p: open,
            text,
            place: cdir === "bull" ? "above" : "below",
            style: "bare",
            color: col,
            fs: 9,
          });
        }
        break;
      }
    }
  }

  // --- 4. delta diamonds at confirmed swing pivots (+ hover breakdown) ---------------------------
  if (wantDiamonds && swingPivots.length) {
    // Rolling close for the zero-range fallback, computed once.
    const deltas = new Float64Array(n);
    for (let i = 0; i < n; i++) deltas[i] = barDelta(bars[i], i > 0 ? bars[i - 1].c : null);

    const hist: number[] = [];      // trailing net deltas (signed)
    const histAbs: number[] = [];   // trailing |net delta| for the quality tier
    let prevVol = 0;

    const firstDrawn = Math.max(0, swingPivots.length - markKeep);

    for (let k = 0; k < swingPivots.length; k++) {
      const pv = swingPivots[k];
      const from = Math.max(0, pv.i - swingLen);
      let net = 0, vol = 0;
      for (let i = from; i <= pv.i; i++) { net += deltas[i]; vol += Math.max(0, Number(bars[i].v) || 0); }

      const enough = hist.length >= 5;
      const pct = enough ? pctRank(hist, net) : net > 0 ? 1 : net < 0 ? 0 : 0.5;
      const qPct = enough ? pctRank(histAbs, Math.abs(net)) : 0.5;
      const fill = pct >= 0.66 ? C.up : pct <= 0.34 ? C.down : C.warn;

      if (k >= firstDrawn) {
        const tid = `ms-dia-${pv.kind}-${pv.i}`;
        const fired = swing.firedAt.get(`${pv.kind}:${pv.i}`);
        const ttb = fired === undefined ? "—" : L(`${fired - pv.i} bars`, `${fired - pv.i} 根K线`);
        const rel = prevVol > 0 ? `${(vol / prevVol).toFixed(2)}x` : "—";
        const quality = qPct >= 0.66 ? L("Strong", "强") : qPct >= 0.34 ? L("Moderate", "中等") : L("Weak", "弱");
        prims.push({
          kind: "marker",
          id: tid,
          z: 2,
          i: pv.i,
          p: pv.p,
          shape: "diamond",
          size: 7,
          fill,
          stroke: fill,
          alpha: 0.55,
          tooltipId: tid,
          minPxPerBar: 1.5,
        });
        tooltips.push({
          id: tid,
          title: pv.kind === "high" ? L("Swing High", "波段高点") : L("Swing Low", "波段低点"),
          accent: fill,
          rows: [
            { k: L("Volume", "成交量"), v: fmtK(vol) },
            { k: L("Net Delta", "净委差"), v: fmtK(net), color: net >= 0 ? C.flowBuy : C.flowSell },
            { k: L("Relative Strength", "相对强度"), v: rel },
            { k: L("Break Quality", "突破质量"), v: quality },
            { k: L("Time to Break", "突破用时"), v: ttb },
          ],
        });
      }

      hist.push(net);
      histAbs.push(Math.abs(net));
      if (hist.length > DELTA_WINDOW) { hist.shift(); histAbs.shift(); }
      prevVol = vol;
    }
  }

  // --- 5. mapping zigzag + swing labels ----------------------------------------------------------
  const chain = alternating(swingPivots);

  if (wantMapping && chain.length >= 2) {
    const start = Math.max(1, chain.length - markKeep);
    for (let k = start; k < chain.length; k++) {
      const a = chain[k - 1], b = chain[k];
      prims.push({
        kind: "poly",
        id: `ms-zz-${a.i}-${b.i}`,
        z: 1,
        pts: [{ i: a.i, p: a.p }, { i: b.i, p: b.p }],
        color: b.kind === "high" ? C.up : C.down,
        w: 1.5,
        alpha: 0.9,
      });
    }
    // Live (un-confirmed) leg: last pivot -> running extreme since it. Dashed, by construction provisional.
    const last = chain[chain.length - 1];
    if (last.i < n - 1) {
      let xi = last.i + 1;
      let xp = last.kind === "high" ? bars[xi].l : bars[xi].h;
      for (let i = last.i + 1; i < n; i++) {
        const v = last.kind === "high" ? bars[i].l : bars[i].h;
        if (last.kind === "high" ? v < xp : v > xp) { xp = v; xi = i; }
      }
      prims.push({
        kind: "poly",
        id: "ms-zz-live",
        z: 1,
        pts: [{ i: last.i, p: last.p }, { i: xi, p: xp }],
        color: last.kind === "high" ? C.down : C.up,
        w: 1.5,
        dash: "4 3",
        alpha: 0.8,
      });
    }
  }

  if (wantSwingLabels && chain.length >= 3) {
    const start = Math.max(2, chain.length - markKeep);
    for (let k = start; k < chain.length; k++) {
      const cur = chain[k], prevSame = chain[k - 2];
      if (!prevSame || prevSame.kind !== cur.kind) continue;
      let text: string, color: string;
      if (cur.kind === "high") {
        const hh = cur.p >= prevSame.p;
        text = hh ? "HH" : "LH";
        color = hh ? C.text : C.down;   // continuation reads neutral; a lower high is the warning
      } else {
        const ll = cur.p <= prevSame.p;
        text = ll ? "LL" : "HL";
        color = ll ? C.text : C.up;
      }
      prims.push({
        kind: "label",
        id: `ms-sl-${cur.kind}-${cur.i}`,
        z: 3,
        i: cur.i,
        p: cur.p,
        text,
        place: cur.kind === "high" ? "above" : "below",
        style: "bare",
        color,
        fs: 9,
        dyPx: cur.kind === "high" ? -10 : 10,
        minPxPerBar: 2,
      });
    }
  }

  // --- 6. strong / weak high & low ---------------------------------------------------------------
  if (wantStrongWeak) {
    const trendCol = swing.trend >= 0 ? C.up : C.down;
    const oppCol = swing.trend >= 0 ? C.down : C.up;
    const lastOf = (kind: "high" | "low"): Pivot | null => {
      for (let k = swingPivots.length - 1; k >= 0; k--) if (swingPivots[k].kind === kind) return swingPivots[k];
      return null;
    };
    for (const kind of ["high", "low"] as const) {
      const pv = lastOf(kind);
      if (!pv) continue;
      let swept = false;
      for (let i = pv.i + 1; i < n; i++) {
        if (kind === "high" ? bars[i].h > pv.p : bars[i].l < pv.p) { swept = true; break; }
      }
      const strong = !swept;
      const col = strong ? trendCol : oppCol;
      prims.push({
        kind: "line",
        id: `ms-sw-lvl-${kind}`,
        z: 1,
        a: { i: pv.i, p: pv.p },
        b: { i: "right", p: pv.p },
        color: col,
        w: strong ? 3 : 1.5,
        alpha: strong ? 1 : 0.6,
      });
      prims.push({
        kind: "label",
        id: `ms-sw-tag-${kind}`,
        z: 3,
        i: "right",
        p: pv.p,
        text: strong
          ? (kind === "high" ? L("Strong High", "强高点") : L("Strong Low", "强低点"))
          : (kind === "high" ? L("Weak High", "弱高点") : L("Weak Low", "弱低点")),
        place: "left",
        style: "tag",
        color: col,
        fs: 9,
        dxPx: -4,
      });
    }
  }

  // --- 7. double tops / bottoms ------------------------------------------------------------------
  if (wantDtdb && chain.length >= 3) {
    const found: Array<{ a: Pivot; b: Pivot; m: number; top: boolean; strong: boolean }> = [];
    for (let k = 0; k + 2 < chain.length; k++) {
      const a = chain[k], mid = chain[k + 1], b = chain[k + 2];
      if (a.kind !== b.kind) continue;
      const base = Math.abs(a.p) || 1e-9;
      if ((Math.abs(b.p - a.p) / base) * 100 > dtdbThreshold) continue;
      const top = a.kind === "high";
      const neck = mid.p;
      const invalid = top ? Math.max(a.p, b.p) : Math.min(a.p, b.p);
      const stop = Math.min(n - 1, b.confirmedAt + DTDB_SCAN);
      for (let m = b.confirmedAt + 1; m <= stop; m++) {
        const c = bars[m].c;
        if (top ? c > invalid : c < invalid) break;                       // pattern taken out — abandon
        if (top ? c < neck : c > neck) {
          const strong = top ? bars[m].c < bars[m].o : bars[m].c > bars[m].o;
          found.push({ a, b, m, top, strong });
          break;
        }
      }
    }
    for (const f of found.slice(-DTDB_MAX_DRAWN)) {
      if (!dirOk(f.top ? "bear" : "bull")) continue;
      const col = f.top ? C.warn : C.up;
      prims.push({
        kind: "poly",
        id: `ms-dt-${f.a.i}-${f.b.i}`,
        z: 1,
        pts: [{ i: f.a.i, p: f.a.p }, { i: f.b.i, p: f.b.p }],
        color: col,
        w: 1,
        dash: "1 3",
        alpha: 0.9,
        minPxPerBar: 2,
      });
      prims.push({
        kind: "label",
        id: `ms-dt-l-${f.a.i}-${f.b.i}`,
        z: 3,
        i: Math.round((f.a.i + f.b.i) / 2),
        p: f.top ? Math.max(f.a.p, f.b.p) : Math.min(f.a.p, f.b.p),
        text: `${f.strong ? "+" : ""}${f.top ? "DT" : "DB"}`,
        place: f.top ? "above" : "below",
        style: "bare",
        color: col,
        fs: 9,
        minPxPerBar: 2,
      });
    }
  }

  // --- 8. structure candles (internal-chain trend takes the candle colors over entirely) ---------
  let candlePaint: CandlePaintEntry[] | undefined;
  if (wantStructCandles) {
    candlePaint = new Array(n);
    for (let i = 0; i < n; i++) {
      const t = internal.trendAt[i];
      const col = t > 0 ? C.up : t < 0 ? C.down : C.neutral;
      candlePaint[i] = { i, color: col, borderColor: col, wickColor: col };
    }
  }

  return { prims, events, tooltips, ...(candlePaint ? { candlePaint } : {}) };
}

// ---------------------------------------------------------------------------------- settings schema


export const MARKET_STRUCTURE_MODULE: SuiteModuleDef = { ...MARKET_STRUCTURE_META, compute };
