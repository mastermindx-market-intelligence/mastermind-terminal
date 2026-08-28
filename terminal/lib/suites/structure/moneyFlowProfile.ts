// Money Flow Profile — Structure Core module.
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Money Flow Profile — visual spec".
// Algorithm sketch: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.1.
//
// A price-binned profile over the last `length` bars. Per bin we accumulate total volume, the
// aggressive-buy share, delta (buy − sell) and money flow (Σ price × volume). Level Strength % is
// the bin's volume normalized to the heaviest bin; POC is the winner under the selected metric;
// the Value Area is the smallest contiguous band around POC holding ≥ vaPct of the volume.
//
// Honesty: we have no per-trade aggressor tape on this surface, so the buy/sell split is a
// CANDLE-SHAPE ESTIMATE — buyFrac = (c − l) / (h − l), volume-weighted. That basis is stated on
// the chart (footnote at the profile top) and in the tooltip, never implied to be real tape.
//
// Non-repaint: the profile is an explicit snapshot over the trailing window (that is what a
// profile is); every number is derived from bars ≤ n in one forward pass plus one bin pass.
// Pure — no wall clock, no randomness, no module-level mutable state.

import type {
  LabelPrim,
  LinePrim,
  ModuleCtx,
  ModuleResult,
  Prim,
  ProfilePrim,
  SuiteBar,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  TooltipDef,
} from "@/lib/indicator-canvas/types";
import { MONEY_FLOW_PROFILE_META } from "./moneyFlowProfile.meta";

// ------------------------------------------------------------------------------------ constants

const MAX_PX = 140; // profile bar length cap (px), right-anchored
const BIN_ALPHA = 0.45;
const LABEL_MIN_STRENGTH = 60; // per-bin "72%" text only on the meaningful rows (renderer owns fs)
const CHIP_FS = 9;
const NOTE_FS = 8;
const POC_W = 1.5;
const VA_DASH = "3 3";
const POC_COOLDOWN = 5; // bars between two POC-touch events
const MAX_EVENTS = 40;

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- helpers

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function numOpt(v: any, d: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? clamp(n, lo, hi) : d;
}

function selOpt<T extends string>(v: any, d: T, allowed: readonly T[]): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : d;
}

function boolOpt(v: any, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}

/** A bar with a zero/NaN price is MISSING, not a print (CN/HK premarket pushes OHLC=0). */
function validBar(b: SuiteBar | undefined): b is SuiteBar {
  if (!b) return false;
  return (
    Number.isFinite(b.o) &&
    Number.isFinite(b.h) &&
    Number.isFinite(b.l) &&
    Number.isFinite(b.c) &&
    b.h > 0 &&
    b.l > 0 &&
    b.h >= b.l
  );
}

function vol(b: SuiteBar): number {
  return Number.isFinite(b.v) && b.v > 0 ? b.v : 0;
}

function fmtPrice(p: number): string {
  const a = Math.abs(p);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return p.toFixed(d);
}

/** Compact magnitude with the vendor's B/M/K ladder; `sign` prints an explicit +/−. */
function fmtNum(v: number, sign = false): string {
  const a = Math.abs(v);
  const s = v < 0 ? "−" : sign ? "+" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a >= 100 ? a.toFixed(0) : a.toFixed(2)}`;
}

// ------------------------------------------------------------------------------------- bin state

interface Bin {
  lo: number;
  hi: number;
  mid: number;
  v: number; // total volume
  buy: number; // estimated aggressive-buy volume
  mf: number; // Σ price × volume
}

// ---------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars.length;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < 2) return empty;

  const s = ctx.s || {};
  const length = Math.round(numOpt(s.length, 400, 100, 1000));
  const levels = Math.round(numOpt(s.levels, 24, 10, 40));
  const pocMetric = selOpt(s.pocMetric, "moneyFlow" as const, [
    "moneyFlow",
    "deltaPos",
    "deltaNeg",
    "strength",
  ] as const);
  const valueArea = boolOpt(s.valueArea, true);
  const vaPct = numOpt(s.vaPct, 70, 50, 90);
  const labels = boolOpt(s.labels, true);

  const zh = lang === "zh";
  const L = {
    title: zh ? "资金流分布" : "Money Flow Profile",
    poc: zh ? "POC" : "POC",
    metric: zh ? "POC 依据" : "POC by",
    mMoney: zh ? "资金流" : "Money flow",
    mDeltaPos: zh ? "买方净量" : "Delta +",
    mDeltaNeg: zh ? "卖方净量" : "Delta −",
    mStrength: zh ? "档位强度" : "Level strength",
    va: zh ? "价值区" : "Value area",
    money: zh ? "POC 资金流" : "Money at POC",
    buyShare: zh ? "买方占比" : "Buy share",
    delta: zh ? "净量" : "Delta",
    window: zh ? "窗口" : "Window",
    barsU: zh ? "根K线" : "bars",
    basis: zh ? "口径" : "Basis",
    // Honest basis line — printed on the chart, short in both languages.
    note: zh ? "净量为K线形态估算" : "delta = candle-shape estimate",
    noteLong: zh
      ? "买卖拆分按 (收−低)/(高−低) 估算，非逐笔主动成交"
      : "buy/sell split estimated from candle shape, not trade tape",
    noVol: zh ? "无成交量数据" : "no volume data",
    touch: zh ? "POC 触及" : "POC touch",
  };

  const i0 = Math.max(0, n - length);

  // ---- 1) window extent (single pass) -------------------------------------------------
  let pLo = Infinity;
  let pHi = -Infinity;
  let anyBar = false;
  for (let i = i0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b)) continue;
    anyBar = true;
    if (b.l < pLo) pLo = b.l;
    if (b.h > pHi) pHi = b.h;
  }
  if (!anyBar || !(pHi > pLo)) return empty;

  const binH = (pHi - pLo) / levels;
  if (!(binH > 0)) return empty;

  const bins: Bin[] = new Array(levels);
  for (let k = 0; k < levels; k++) {
    const lo = pLo + k * binH;
    bins[k] = { lo, hi: lo + binH, mid: lo + binH / 2, v: 0, buy: 0, mf: 0 };
  }

  // ---- 2) accumulate (one pass over bars, inner loop bounded by overlapped bins) -------
  const events: SuiteEvent[] = [];
  let totalV = 0;
  let totalBuy = 0;
  for (let i = i0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b)) continue;
    const v = vol(b);
    if (v <= 0) continue;
    const rng = b.h - b.l;
    // Candle-geometry aggressor estimate: a close at the high reads as fully bought.
    const buyFrac = rng > 0 ? clamp((b.c - b.l) / rng, 0, 1) : 0.5;
    totalV += v;
    totalBuy += v * buyFrac;

    const lo = Math.max(pLo, b.l);
    const hi = Math.min(pHi, b.h);
    if (rng <= 0 || hi <= lo) {
      // dojis / zero-range prints land whole in the bin holding the close
      const k = clamp(Math.floor((clamp(b.c, pLo, pHi) - pLo) / binH), 0, levels - 1);
      const bin = bins[k];
      bin.v += v;
      bin.buy += v * buyFrac;
      bin.mf += bin.mid * v;
      continue;
    }
    const k1 = clamp(Math.floor((lo - pLo) / binH), 0, levels - 1);
    const k2 = clamp(Math.floor((hi - pLo) / binH), 0, levels - 1);
    const span = hi - lo;
    for (let k = k1; k <= k2; k++) {
      const bin = bins[k];
      const ov = Math.min(hi, bin.hi) - Math.max(lo, bin.lo);
      if (!(ov > 0)) continue;
      const w = ov / span;
      const pv = v * w;
      bin.v += pv;
      bin.buy += pv * buyFrac;
      bin.mf += bin.mid * pv;
    }
  }

  if (!(totalV > 0)) {
    // Honest empty state: the symbol has no volume on this timeframe (some CN/HK indices).
    const note: LabelPrim = {
      kind: "label",
      id: "mfp-novol",
      z: 3,
      i: "right",
      p: pHi,
      text: L.noVol,
      place: "left",
      style: "bare",
      color: colors.muted,
      fs: NOTE_FS,
      dyPx: -8,
    };
    return { prims: [note], tooltips: [], events: [] };
  }

  // ---- 3) POC + value area -------------------------------------------------------------
  let maxV = 0;
  for (let k = 0; k < levels; k++) if (bins[k].v > maxV) maxV = bins[k].v;
  if (!(maxV > 0)) return empty;

  let pocK = -1;
  let best = -Infinity;
  for (let k = 0; k < levels; k++) {
    const bin = bins[k];
    if (bin.v <= 0) continue;
    const delta = bin.buy - (bin.v - bin.buy);
    const score =
      pocMetric === "moneyFlow"
        ? bin.mf
        : pocMetric === "deltaPos"
          ? delta
          : pocMetric === "deltaNeg"
            ? -delta
            : bin.v;
    if (score > best) {
      best = score;
      pocK = k; // strict > keeps ties deterministic (lowest bin wins)
    }
  }
  if (pocK < 0) return empty;
  const pocBin = bins[pocK];
  const pocPrice = pocBin.mid;

  // Value area: expand from POC toward the heavier neighbour until the mass target is met —
  // the standard construction, and the smallest contiguous band around POC in practice.
  let vaLoK = pocK;
  let vaHiK = pocK;
  if (valueArea) {
    const target = (totalV * vaPct) / 100;
    let mass = pocBin.v;
    while (mass < target && (vaLoK > 0 || vaHiK < levels - 1)) {
      const dn = vaLoK > 0 ? bins[vaLoK - 1].v : -1;
      const up = vaHiK < levels - 1 ? bins[vaHiK + 1].v : -1;
      if (up >= dn) {
        vaHiK += 1;
        mass += bins[vaHiK].v;
      } else {
        vaLoK -= 1;
        mass += bins[vaLoK].v;
      }
    }
  }
  const vah = bins[vaHiK].hi;
  const val = bins[vaLoK].lo;

  // ---- 4) POC touch events (close crossing the window POC, throttled) -------------------
  const conc = clamp(Math.round((pocBin.v / totalV) * 100), 0, 100);
  let prevC = NaN;
  let lastTouch = -POC_COOLDOWN * 4;
  for (let i = i0; i < n; i++) {
    const b = bars[i];
    if (!validBar(b)) continue;
    const c = b.c;
    if (Number.isFinite(prevC) && i - lastTouch >= POC_COOLDOWN) {
      const a = prevC - pocPrice;
      const d = c - pocPrice;
      if ((a < 0 && d >= 0) || (a > 0 && d <= 0)) {
        lastTouch = i;
        events.push({
          type: "mfp_poc_touch",
          dir: d >= 0 ? "bull" : "bear",
          i,
          p: pocPrice,
          strength: conc,
          label: `${L.touch} · ${fmtPrice(pocPrice)}`,
        });
      }
    }
    prevC = c;
  }

  // ------------------------------------------------------------------------------ render
  const prims: Prim[] = [];
  const tipId = "mfp-tip";

  const profile: ProfilePrim = {
    kind: "profile",
    id: "mfp-profile",
    z: 0,
    side: "right",
    maxPx: MAX_PX,
    bins: [],
  };
  for (let k = 0; k < levels; k++) {
    const bin = bins[k];
    if (bin.v <= 0) continue;
    const frac = bin.v / maxV;
    const buyShare = clamp(bin.buy / bin.v, 0, 1);
    const delta = bin.buy - (bin.v - bin.buy);
    const strength = frac * 100;
    profile.bins.push({
      p1: bin.lo,
      p2: bin.hi,
      frac,
      // aggressor family (flowBuy/flowSell) — never the locale-flipping up/down pair
      color: delta >= 0 ? colors.flowBuy : colors.flowSell,
      alpha: BIN_ALPHA,
      // renderer measures overlayFrac against the SAME maxPx as frac, so the buy overlay is
      // the buy slice OF THIS BAR, not the raw share (else it would overhang the bar).
      overlayFrac: frac * buyShare,
      overlayColor: colors.flowBuy,
      label: labels && strength >= LABEL_MIN_STRENGTH ? `${Math.round(strength)}%` : undefined,
    });
  }
  if (!profile.bins.length) return empty;
  prims.push(profile);

  // value-area hairlines (drawn under the POC line)
  if (valueArea) {
    for (const [key, p] of [
      ["vah", vah],
      ["val", val],
    ] as Array<[string, number]>) {
      prims.push({
        kind: "line",
        id: `mfp-${key}`,
        z: 1,
        a: { i: i0, p },
        b: { i: "right", p },
        color: colors.muted,
        w: 1,
        dash: VA_DASH,
        alpha: 0.7,
      } as LinePrim);
      if (labels) {
        prims.push({
          kind: "label",
          id: `mfp-${key}-l`,
          z: 3,
          i: "right",
          p,
          text: key.toUpperCase(),
          place: "left",
          style: "bare",
          color: colors.muted,
          fs: NOTE_FS,
          dxPx: -MAX_PX,
          tooltipId: tipId,
        } as LabelPrim);
      }
    }
  }

  // POC across the profile span
  prims.push({
    kind: "line",
    id: "mfp-poc",
    z: 2,
    a: { i: i0, p: pocPrice },
    b: { i: "right", p: pocPrice },
    color: colors.warn,
    w: POC_W,
    alpha: 0.95,
  } as LinePrim);
  prims.push({
    kind: "label",
    id: "mfp-poc-c",
    z: 3,
    i: "right",
    p: pocPrice,
    text: L.poc,
    place: "left",
    style: "chip",
    color: colors.warn,
    fs: CHIP_FS,
    dxPx: -MAX_PX, // sit clear of the profile block, always in view
    tooltipId: tipId,
  } as LabelPrim);

  // honesty footnote at the profile top
  prims.push({
    kind: "label",
    id: "mfp-note",
    z: 3,
    i: "right",
    p: pHi,
    text: L.note,
    place: "left",
    style: "bare",
    color: colors.muted,
    fs: NOTE_FS,
    dyPx: -8,
    tooltipId: tipId,
  } as LabelPrim);

  // ------------------------------------------------------------------------------ tooltip
  const buyShareAll = clamp(totalBuy / totalV, 0, 1);
  const deltaAll = totalBuy - (totalV - totalBuy);
  const metricLabel =
    pocMetric === "moneyFlow"
      ? L.mMoney
      : pocMetric === "deltaPos"
        ? L.mDeltaPos
        : pocMetric === "deltaNeg"
          ? L.mDeltaNeg
          : L.mStrength;
  const rows: TooltipDef["rows"] = [
    { k: L.poc, v: fmtPrice(pocPrice), color: colors.warn },
    { k: L.metric, v: metricLabel },
    { k: L.money, v: `$ ${fmtNum(pocBin.mf)}` },
    { k: L.buyShare, v: `${Math.round(buyShareAll * 100)}%` },
    {
      k: L.delta,
      v: fmtNum(deltaAll, true),
      color: deltaAll >= 0 ? colors.flowBuy : colors.flowSell,
    },
  ];
  if (valueArea) {
    rows.push({ k: `${L.va} ${Math.round(vaPct)}%`, v: `${fmtPrice(val)} – ${fmtPrice(vah)}` });
  }
  rows.push({ k: L.window, v: `${n - i0} ${L.barsU} · ${levels} × ${fmtPrice(binH)}` });
  rows.push({ k: L.basis, v: L.noteLong, color: colors.muted });

  const tooltips: TooltipDef[] = [{ id: tipId, title: L.title, accent: colors.warn, rows }];
  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  return { prims, tooltips, events: tape };
}

// --------------------------------------------------------------------------------- module def

export const MONEY_FLOW_PROFILE_MODULE: SuiteModuleDef = { ...MONEY_FLOW_PROFILE_META, compute };

export default MONEY_FLOW_PROFILE_MODULE;
