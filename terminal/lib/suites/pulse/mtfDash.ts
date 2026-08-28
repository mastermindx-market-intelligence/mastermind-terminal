// MTF Dashboard — Pulse Oscillator suite (on-chart table, no prims).
//
// Contract: lib/indicator-canvas/types.ts (frozen — `TableSpec`). Table plumbing + the honest-basis
// doctrine: lib/suites/shared/mtfTable.ts (read its header first). Masterplan §8.3 "MTF Signals
// Dashboard". Vendor reference: Nautilus' "Signals Dashboard across 6 timeframes".
//
// Three columns — `chart`, `2×`, `4×` — are fixed-block resamples of the SAME loaded bars
// (`resampleOhlcv`), not independent timeframe feeds; the mandatory footnote says so and every cell
// carries a basis tip. Three rows:
//
//   State       the wave's 4-state color code at the column's last complete block, plus the wave
//               level and (in the tip) how long the state has held — a regime label never ships
//               without its level and persistence (regime-dynamics law).
//   Signal      the most recent Pulse Buy / Pulse Sell inside MTF_SIGNAL_WINDOW blocks, e.g.
//               "BUY 4 ago", faded by recency.
//   Divergence  the most recent divergence class inside MTF_DIV_WINDOW blocks, faded by recency.
//
// W2 LAW — SATELLITES READ THE PRODUCER'S SETTINGS. The wave comes from `computePulseWave` at the
// profile the WAVE module is actually drawing (`pulseProfileOf(ctx.suite)`, i.e. `wave.profile`),
// and the divergence row honors the DIV module's `div.hidden` toggle. Nothing here re-assumes a
// default: a retuned pane retunes its dashboard.
//
// ─── Factor-mapping honesty (the two rules that make this non-repainting) ─────────────────────
//
//  1. A block's value applies only from its LAST source bar. `resampleOhlcv` returns `lastSrc[g]`
//     for exactly this reason; we never let a block's reading describe a chart bar earlier than
//     `lastSrc[g]`. The dashboard only ever reports the LAST block, so the single place this bites
//     is staleness — which we disclose rather than hide (`mtfBasisTip` prints the lag).
//  2. The "last bar" of a column is its last COMPLETE block. `resampleOhlcv` drops a trailing
//     partial block outright, so a 2× column can lag the chart by 1 bar and a 4× column by 3. The
//     alternative — aggregating the in-progress block — would make the cell mutate on every tick,
//     which is precisely the repaint the suite forbids.
//
// The Buy/Sell scan below mirrors `pulseSignals`' buy/sell family verbatim (±60 extreme, confirmed
// trough/peak, 5-bar per-family cooldown) because that module does not export its detector; the
// constants are duplicated with that provenance noted, not re-invented.
//
// Deterministic and pure: no events, no prims, no DOM, no wall clock, no randomness, no state.

import type {
  ModuleCtx,
  ModuleResult,
  SuiteField,
  SuiteModuleDef,
  TableSpec,
} from "@/lib/indicator-canvas/types";
import { resampleOhlcv } from "@/lib/suites/shared/oscUtils";
import { findDivergences } from "@/lib/suites/shared/divergence";
import {
  EM_DASH,
  MTF_DIV_WINDOW,
  MTF_FACTORS,
  MTF_SIGNAL_WINDOW,
  buildMtfTable,
  mtfAgo,
  mtfBasisTip,
  mtfBool,
  mtfDefaults,
  mtfFade,
  mtfFields,
  mtfFootnote,
  mtfPos,
} from "@/lib/suites/shared/mtfTable";
import type { MtfCell, MtfRow } from "@/lib/suites/shared/mtfTable";
import { WAVE_STATE, computePulseWave, pulseProfileOf } from "./pulseWave";
import { PULSE_MTF_META } from "./mtfDash.meta";

// ------------------------------------------------------------------------------------ constants

/** Mirrors pulseSignals: buy/sell fire off the ±60 extreme zone with a 5-bar per-family cooldown. */
const EXTREME = 60;
const COOLDOWN = 5;
/** Mirrors the pulse divergence module's detector settings (wing 5 / span 60). */
const DIV_WING = 5;
const DIV_SPAN = 60;
/** Below this the resampled columns are pure warm-up and the table would be three columns of dashes. */
const MIN_BARS = 12;

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- helpers

interface BuySell {
  pivot: number; // block index of the trough/peak the glyph sits on
  confirm: number; // block index at which it became knowable (pivot + 1 finite block)
  bull: boolean;
  wave: number;
}

/**
 * Pulse Buy / Pulse Sell over a wave series, index-aligned with the blocks it was computed on.
 * Verbatim mirror of `pulseSignals`' buy/sell branch: a confirmed trough at or below −60 is a buy,
 * a confirmed peak at or above +60 is a sell, each family on its own 5-bar cooldown. The scan runs
 * over the WHOLE series (not a tail window) so the cooldown state matches the drawn glyphs exactly.
 */
function buySellScan(wave: Float64Array): BuySell[] {
  const n = wave.length;
  const K: number[] = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(wave[i])) K.push(i);
  const out: BuySell[] = [];
  // `pulseSignals` refuses to scan fewer than 4 finite prints; a looser guard here would let the
  // dashboard report a BUY on the first bar out of warm-up that the pane does not draw.
  if (K.length < 4) return out;

  let lastBuy = -1e9;
  let lastSell = -1e9;
  for (let k = 2; k < K.length; k++) {
    const i0 = K[k];
    const i1 = K[k - 1];
    const w0 = wave[i0];
    const w1 = wave[i1];
    const w2 = wave[K[k - 2]];
    if (w1 < w2 && w0 > w1 && w1 <= -EXTREME && i0 - lastBuy >= COOLDOWN) {
      out.push({ pivot: i1, confirm: i0, bull: true, wave: w1 });
      lastBuy = i0;
    } else if (w1 > w2 && w0 < w1 && w1 >= EXTREME && i0 - lastSell >= COOLDOWN) {
      out.push({ pivot: i1, confirm: i0, bull: false, wave: w1 });
      lastSell = i0;
    }
  }
  return out;
}

const STATE_SHORT: Record<number, [string, string]> = {
  [WAVE_STATE.RISE_BELOW]: ["Accum", "吸筹"],
  [WAVE_STATE.RISE_ABOVE]: ["Momo", "动能"],
  [WAVE_STATE.DECAY]: ["Decay", "衰减"],
  [WAVE_STATE.TRANSITION]: ["Turn", "转折"],
};

const STATE_LONG: Record<number, [string, string]> = {
  [WAVE_STATE.RISE_BELOW]: ["Rising below the midline", "零轴下方上行"],
  [WAVE_STATE.RISE_ABOVE]: ["Rising above the midline", "零轴上方上行"],
  [WAVE_STATE.DECAY]: ["Momentum decaying", "动能衰减"],
  [WAVE_STATE.TRANSITION]: ["Turning up", "由跌转升"],
};

const DIV_SHORT: Record<string, [string, string]> = {
  bull: ["Bull", "底背离"],
  bear: ["Bear", "顶背离"],
  hiddenBull: ["H Bull", "隐底"],
  hiddenBear: ["H Bear", "隐顶"],
};

function signed(v: number): string {
  return `${v > 0 ? "+" : ""}${Math.round(v)}`;
}

// -------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars?.length ?? 0;
  const empty: ModuleResult = { prims: [] };
  if (n < MIN_BARS) return empty;

  const s = ctx.s || {};
  const pos = mtfPos(s.pos, "br");
  const compact = mtfBool(s.compact, false);
  const zh = lang === "zh";
  const t = (pair: [string, string]) => (zh ? pair[1] : pair[0]);

  // W2 law: the producer's live settings, never this module's guess at them.
  const profile = pulseProfileOf(ctx.suite);
  const wantHidden = mtfBool(ctx.suite?.["div.hidden"], true);

  const stateColor = (st: number): string =>
    st === WAVE_STATE.RISE_BELOW
      ? colors.up
      : st === WAVE_STATE.RISE_ABOVE
        ? colors.brand
        : st === WAVE_STATE.DECAY
          ? colors.down
          : st === WAVE_STATE.TRANSITION
            ? colors.neutral
            : colors.muted;

  const rowState: MtfRow = { label: zh ? "状态" : "State", cells: [] };
  const rowSignal: MtfRow = { label: zh ? "信号" : "Signal", cells: [] };
  const rowDiv: MtfRow = { label: zh ? "背离" : "Divergence", cells: [] };

  for (const f of MTF_FACTORS) {
    const { groups, lastSrc } = resampleOhlcv(bars, f);
    let g = groups.length - 1; // last complete block (resampleOhlcv drops a partial trailing one)
    // …but when n % f === 0 the count-complete last block still CONTAINS the live forming bar —
    // treat any block ending on the final loaded bar as live and step back one (review W3-8)
    if (f > 1 && g >= 0 && lastSrc[g] === bars.length - 1) g--;
    if (g < 2) {
      const none: MtfCell = { text: EM_DASH, color: colors.muted };
      rowState.cells.push(none);
      rowSignal.cells.push(none);
      rowDiv.cells.push(none);
      continue;
    }
    const lag = n - 1 - lastSrc[g];
    const basis = mtfBasisTip(f, lag, zh ? "zh" : "en");

    const { wave, states } = computePulseWave(groups, profile);

    // ---- State: label + level + (tip) persistence -------------------------------------
    const w = wave[g];
    if (!Number.isFinite(w)) {
      rowState.cells.push({
        text: EM_DASH,
        color: colors.muted,
        tip: `${zh ? "最后一个完整分组无可用报价" : "No usable print in the last complete block"} · ${basis}`,
      });
    } else {
      const st = states[g];
      let held = 1;
      while (g - held >= 0 && states[g - held] === st) held++;
      const short = STATE_SHORT[st];
      const long = STATE_LONG[st];
      rowState.cells.push({
        text: short ? `${t(short)} ${signed(w)}` : signed(w),
        color: stateColor(st),
        bold: true,
        tip: `${long ? t(long) : zh ? "状态未确立" : "State not established"} · ${zh ? "波值" : "wave"} ${signed(w)} · ${zh ? `已持续 ${held} 格` : `held ${held} cell${held === 1 ? "" : "s"}`} · ${basis}`,
      });
    }

    // ---- Signal: last Pulse Buy / Sell inside the window --------------------------------
    const sigs = buySellScan(wave);
    const last = sigs.length ? sigs[sigs.length - 1] : null;
    const sAgo = last ? g - last.confirm : -1;
    if (!last || sAgo < 0 || sAgo > MTF_SIGNAL_WINDOW) {
      rowSignal.cells.push({
        text: EM_DASH,
        color: colors.muted,
        tip: `${zh ? `最近 ${MTF_SIGNAL_WINDOW} 格内无买卖信号` : `No buy/sell in the last ${MTF_SIGNAL_WINDOW} cells`} · ${basis}`,
      });
    } else {
      rowSignal.cells.push({
        text: `${last.bull ? "BUY" : "SELL"} ${mtfAgo(sAgo, zh ? "zh" : "en")}`,
        color: last.bull ? colors.up : colors.down,
        fade: mtfFade(sAgo, MTF_SIGNAL_WINDOW),
        tip: `${last.bull ? (zh ? "脉冲买入" : "Pulse Buy") : zh ? "脉冲卖出" : "Pulse Sell"} · ${zh ? "波值" : "wave"} ${signed(last.wave)} · ${zh ? `极值在确认前 ${last.confirm - last.pivot} 格` : `extreme ${last.confirm - last.pivot} cell(s) before confirmation`} · ${basis}`,
      });
    }

    // ---- Divergence: last class inside the window ---------------------------------------
    // `lookback` bounds the scan cost; the detector widens it internally by maxSpan + 2·wing, so a
    // pair whose first pivot sits just outside the window still forms.
    const divs = findDivergences(groups, wave, {
      wing: DIV_WING,
      maxSpan: DIV_SPAN,
      hidden: wantHidden,
      lookback: MTF_DIV_WINDOW,
    });
    let hit: (typeof divs)[number] | null = null;
    for (let k = divs.length - 1; k >= 0; k--) {
      const d = divs[k];
      if (d.confirmedAt > g) continue; // not knowable inside the completed blocks
      if (g - d.confirmedAt > MTF_DIV_WINDOW) break; // sorted by confirmedAt: nothing newer left
      hit = d;
      break;
    }
    if (!hit) {
      rowDiv.cells.push({
        text: EM_DASH,
        color: colors.muted,
        tip: `${zh ? `最近 ${MTF_DIV_WINDOW} 格内无背离` : `No divergence in the last ${MTF_DIV_WINDOW} cells`} · ${basis}`,
      });
    } else {
      const dAgo = g - hit.confirmedAt;
      const bull = hit.kind === "bull" || hit.kind === "hiddenBull";
      const short = DIV_SHORT[hit.kind];
      rowDiv.cells.push({
        text: `${short ? t(short) : hit.kind} ${mtfAgo(dAgo, zh ? "zh" : "en")}`,
        color: bull ? colors.up : colors.down,
        fade: mtfFade(dAgo, MTF_DIV_WINDOW),
        tip: `${short ? t(short) : hit.kind} · ${zh ? `跨度 ${hit.iB - hit.iA} 格` : `span ${hit.iB - hit.iA} cells`} · ${zh ? "振幅" : "osc travel"} ${(hit.oscB - hit.oscA).toFixed(1)} · ${basis}`,
      });
    }
  }

  const table: TableSpec = buildMtfTable({
    id: "pulse-mtf",
    pos,
    compact,
    title: zh ? "脉冲 多周期" : "Pulse MTF",
    rows: [rowState, rowSignal, rowDiv],
    footnote: mtfFootnote(zh ? "zh" : "en"),
  });

  return { prims: [], tables: [table] };
}

// ---------------------------------------------------------------------------------- module def

export const PULSE_MTF_MODULE: SuiteModuleDef = { ...PULSE_MTF_META, compute };

export default PULSE_MTF_MODULE;
