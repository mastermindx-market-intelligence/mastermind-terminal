// MTF Dashboard — MACD Ultimate suite (on-chart table, no prims).
//
// Contract: lib/indicator-canvas/types.ts (frozen — `TableSpec`). Table plumbing + the honest-basis
// doctrine: lib/suites/shared/mtfTable.ts (read its header first). Masterplan §8.4: "MTF dashboard".
//
// Three columns — `chart`, `2×`, `4×` — are fixed-block resamples of the SAME loaded bars
// (`resampleOhlcv`), not independent timeframe feeds; the mandatory footnote says so and every cell
// carries a basis tip. Three rows:
//
//   MACD    the normalized ±100 reading at the column's last complete block, colored HeatMap-style
//           (quiet middle muted, working range brand, saturated extreme = the directional
//           OPPORTUNITY hue, exactly as the Engine paints its curve) plus a slope glyph, so a level
//           never ships without its direction (regime-dynamics law).
//   Signal  the most recent extreme-zone cross inside MTF_SIGNAL_WINDOW blocks — "▲ 4 ago" /
//           "▼ 4 ago", faded by recency.
//   Phase   the locked regime at the last complete block: ▲ / ▼ plus how many blocks it has held.
//
// W2 LAW — SATELLITES READ THE PRODUCER'S SETTINGS. The curve comes from `sharedMacd(groups,
// ctx.suite)` (the Engine's live fast/slow/signalLen/MA types) and the Signal row uses the SIGNALS
// module's live `sig.threshold`. Nothing here re-assumes a default: retune the Engine or the zone
// and the dashboard follows.
//
// ─── Factor-mapping honesty (the two rules that make this non-repainting) ─────────────────────
//
//  1. A block's value applies only from its LAST source bar (`resampleOhlcv`'s `lastSrc`); we never
//     let a block describe an earlier chart bar. The dashboard reports the LAST block only, so the
//     consequence is staleness — disclosed in every cell tip, never hidden.
//  2. The "last bar" of a column is its last COMPLETE block; a trailing partial block is dropped by
//     `resampleOhlcv`, so 2× lags by up to 1 chart bar and 4× by up to 3. Aggregating the in-progress
//     block would make the cell mutate tick by tick — the repaint the suite forbids.
//
// The cross scan mirrors `macdSignals` (cross gated to its own extreme zone) and the phase machine
// mirrors `macdTrend` (side of the signal line + 3 consecutive bars of momentum to commit, mirrored
// condition to end) verbatim — neither module exports its detector.
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
import {
  EM_DASH,
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
  mtfSlope,
} from "@/lib/suites/shared/mtfTable";
import type { MtfCell, MtfRow } from "@/lib/suites/shared/mtfTable";
import { intOpt, sharedMacd } from "./macdEngine";
import { MACDX_MTF_META } from "./mtfDash.meta";

// ------------------------------------------------------------------------------------ constants

/** Mirrors macdEngine's private HEAT_MID: |value| under this is noise, not heat. */
const HEAT_MID = 40;
/** Mirrors macdEngine's heat ramp: past this the curve takes the opportunity hue. */
const HEAT_HI = 80;
/** Mirrors macdTrend: consecutive blocks of momentum required to commit a phase. */
const STREAK = 3;
const MIN_BARS = 12;

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- helpers

interface Cross {
  i: number; // block index of the cross (no confirmation window — decided from i−1 and i)
  bull: boolean;
  macd: number;
  signal: number;
}

/** Extreme-zone-only macd × signal crosses. Verbatim mirror of `macdSignals`' scan. */
function crossScan(macd: Float64Array, signal: Float64Array, threshold: number): Cross[] {
  const n = Math.min(macd.length, signal.length);
  const out: Cross[] = [];
  let pm = NaN;
  let ps = NaN;
  for (let i = 0; i < n; i++) {
    const m = macd[i];
    const g = signal[i];
    if (!Number.isFinite(m) || !Number.isFinite(g)) continue;
    if (Number.isFinite(pm) && Number.isFinite(ps)) {
      if (pm <= ps && m > g && m <= -threshold) out.push({ i, bull: true, macd: m, signal: g });
      else if (pm >= ps && m < g && m >= threshold) out.push({ i, bull: false, macd: m, signal: g });
    }
    pm = m;
    ps = g;
  }
  return out;
}

/**
 * Phase-locked regime per block. Verbatim mirror of `macdTrend`: a phase commits only when the macd
 * is on the right side of its signal AND has moved that way for STREAK consecutive blocks, and can
 * only be ended by the mirrored condition — the hysteresis that stops the lane strobing in chop. A
 * missing print never breaks a phase.
 */
function phaseScan(macd: Float64Array, signal: Float64Array): Int8Array {
  const n = Math.min(macd.length, signal.length);
  const phase = new Int8Array(n);
  let cur = 0;
  let prevV = NaN;
  let up = 0;
  let dn = 0;
  for (let i = 0; i < n; i++) {
    const v = macd[i];
    const g = signal[i];
    if (!Number.isFinite(v) || !Number.isFinite(g)) {
      phase[i] = cur;
      continue;
    }
    if (Number.isFinite(prevV)) {
      if (v > prevV) {
        up++;
        dn = 0;
      } else if (v < prevV) {
        dn++;
        up = 0;
      } else {
        up = 0;
        dn = 0;
      }
    }
    prevV = v;
    if (v > g && up >= STREAK && cur !== 1) cur = 1;
    else if (v < g && dn >= STREAK && cur !== -1) cur = -1;
    phase[i] = cur;
  }
  return phase;
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

  // W2 law: the Signals module's live extreme zone (its own field range/default: 60..95, 80).
  const threshold = intOpt(ctx.suite?.["sig.threshold"], 80, 60, 95);

  const heatColor = (v: number): string => {
    const a = Math.abs(v);
    if (a < HEAT_MID) return colors.muted;
    if (a <= HEAT_HI) return colors.brand;
    return v < 0 ? colors.up : colors.down;
  };

  const rowMacd: MtfRow = { label: "MACD", cells: [] };
  const rowSignal: MtfRow = { label: zh ? "信号" : "Signal", cells: [] };
  const rowPhase: MtfRow = { label: zh ? "阶段" : "Phase", cells: [] };

  for (const f of MTF_FACTORS) {
    const { groups, lastSrc } = resampleOhlcv(bars, f);
    let g = groups.length - 1; // last complete block (a partial trailing one is dropped upstream)
    // …but when n % f === 0 the count-complete last block still CONTAINS the live forming bar —
    // treat any block ending on the final loaded bar as live and step back one (review W3-8)
    if (f > 1 && g >= 0 && lastSrc[g] === bars.length - 1) g--;
    if (g < 2) {
      const none: MtfCell = { text: EM_DASH, color: colors.muted };
      rowMacd.cells.push(none);
      rowSignal.cells.push(none);
      rowPhase.cells.push(none);
      continue;
    }
    const lag = n - 1 - lastSrc[g];
    const basis = mtfBasisTip(f, lag, zh ? "zh" : "en");

    // The ENGINE's own curve at its live settings, applied to this column's blocks.
    const { macd, signal } = sharedMacd(groups, ctx.suite);

    // ---- MACD: level + heat color + slope ------------------------------------------------
    const v = macd[g];
    if (!Number.isFinite(v)) {
      rowMacd.cells.push({
        text: EM_DASH,
        color: colors.muted,
        tip: `${zh ? "最后一个完整分组尚在预热或无可用报价" : "Last complete block is warm-up or has no usable print"} · ${basis}`,
      });
    } else {
      let prev = NaN;
      for (let k = g - 1; k >= 0; k--) {
        if (Number.isFinite(macd[k])) {
          prev = macd[k];
          break;
        }
      }
      const sig = signal[g];
      rowMacd.cells.push({
        text: `${v.toFixed(1)} ${mtfSlope(v, prev)}`,
        color: heatColor(v),
        bold: true,
        tip: `${zh ? "归一化 MACD" : "Normalized MACD"} ${v.toFixed(1)} · ${zh ? "信号线" : "signal"} ${Number.isFinite(sig) ? sig.toFixed(1) : EM_DASH} · ${zh ? "上一格" : "prev"} ${Number.isFinite(prev) ? prev.toFixed(1) : EM_DASH} · ${basis}`,
      });
    }

    // ---- Signal: last extreme-zone cross inside the window --------------------------------
    const hits = crossScan(macd, signal, threshold);
    const last = hits.length ? hits[hits.length - 1] : null;
    const sAgo = last ? g - last.i : -1;
    if (!last || sAgo < 0 || sAgo > MTF_SIGNAL_WINDOW) {
      rowSignal.cells.push({
        text: EM_DASH,
        color: colors.muted,
        tip: `${zh ? `最近 ${MTF_SIGNAL_WINDOW} 格内无 ±${threshold} 区反转` : `No cross inside the ±${threshold} zone in the last ${MTF_SIGNAL_WINDOW} cells`} · ${basis}`,
      });
    } else {
      rowSignal.cells.push({
        text: `${last.bull ? "▲" : "▼"} ${mtfAgo(sAgo, zh ? "zh" : "en")}`,
        color: last.bull ? colors.up : colors.down,
        fade: mtfFade(sAgo, MTF_SIGNAL_WINDOW),
        tip: `${last.bull ? (zh ? "超卖区动能反转" : "Oversold momentum reversal") : zh ? "超买区动能反转" : "Overbought momentum reversal"} · MACD ${last.macd.toFixed(1)} · ${zh ? "信号线" : "signal"} ${last.signal.toFixed(1)} · ${zh ? "门槛" : "zone"} ±${threshold} · ${basis}`,
      });
    }

    // ---- Phase: locked regime + persistence ------------------------------------------------
    const phase = phaseScan(macd, signal);
    const ph = phase[g];
    if (ph === 0) {
      rowPhase.cells.push({
        text: EM_DASH,
        color: colors.muted,
        tip: `${zh ? "尚未确立阶段（需同向 3 格且位于信号线正确一侧）" : "No phase committed yet (needs 3 blocks of momentum on the right side of the signal line)"} · ${basis}`,
      });
    } else {
      let held = 1;
      while (g - held >= 0 && phase[g - held] === ph) held++;
      const bull = ph > 0;
      rowPhase.cells.push({
        text: `${bull ? "▲" : "▼"} ${held}`,
        color: bull ? colors.up : colors.down,
        bold: true,
        tip: `${bull ? (zh ? "多头阶段" : "Up phase") : zh ? "空头阶段" : "Down phase"} · ${zh ? `已持续 ${held} 格` : `held ${held} cell${held === 1 ? "" : "s"}`} · ${zh ? "翻转条件：反向 3 格 + 穿越信号线" : "flips on 3 blocks + signal cross"} · ${basis}`,
      });
    }
  }

  const table: TableSpec = buildMtfTable({
    id: "macdx-mtf",
    pos,
    compact,
    title: zh ? "MACD 多周期" : "MACD MTF",
    rows: [rowMacd, rowSignal, rowPhase],
    footnote: mtfFootnote(zh ? "zh" : "en"),
  });

  return { prims: [], tables: [table] };
}

// ---------------------------------------------------------------------------------- module def

export const MACDX_MTF_MODULE: SuiteModuleDef = { ...MACDX_MTF_META, compute };

export default MACDX_MTF_MODULE;
