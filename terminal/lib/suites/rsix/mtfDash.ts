// MTF Dashboard — RSI Ultimate suite (on-chart table, no prims).
//
// Contract: lib/indicator-canvas/types.ts (frozen — `TableSpec`). Table plumbing + the honest-basis
// doctrine: lib/suites/shared/mtfTable.ts (read its header first). Masterplan §8.4: "MTF dashboard
// with recency fade".
//
// Three columns — `chart`, `2×`, `4×` — are fixed-block resamples of the SAME loaded bars
// (`resampleOhlcv`), not independent timeframe feeds; the mandatory footnote says so and every cell
// carries a basis tip. Three rows:
//
//   RSI         the reading at the column's last complete block, colored by zone (≥65 bear, ≤35
//               bull, dead-middle muted) and carrying a slope glyph so a level never ships as a
//               static fact (regime-dynamics law).
//   Signal      the most recent in-zone reversal inside MTF_SIGNAL_WINDOW blocks — "▲ 4 ago" /
//               "▼ 4 ago", faded by recency.
//   Divergence  the most recent divergence class inside MTF_DIV_WINDOW blocks, faded by recency.
//
// W2 LAW — SATELLITES READ THE PRODUCER'S SETTINGS. The series comes from `computeUltimateRsi` at
// the ENGINE's live parameters (`rsiEngineParams(ctx.suite)` — length, source, smoothing), and the
// divergence row honors the DIV module's `div.hidden` toggle. `sharedRsi(ctx)` cannot be used here
// because it is hard-wired to `ctx.bars`; this module needs the same parameters applied to the
// RESAMPLED blocks, which is exactly what `rsiEngineParams` + `computeUltimateRsi` give us.
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
// The reversal scan mirrors `rsiSignals`' in-zone reversal rule verbatim (1-bar confirm, one signal
// per excursion, re-armed on leaving the zone) because that module does not export its detector.
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
  mtfSlope,
} from "@/lib/suites/shared/mtfTable";
import type { MtfCell, MtfRow } from "@/lib/suites/shared/mtfTable";
import {
  MID_LEVEL,
  OB_LEVEL,
  OS_LEVEL,
  computeUltimateRsi,
  finiteIdx,
  rsiEngineParams,
} from "./rsiEngine";
import { RSIX_MTF_META } from "./mtfDash.meta";

// ------------------------------------------------------------------------------------ constants

/** Mirrors rsiEngine's private DEAD_ZONE: |rsi − 50| under this reads as "nothing happening". */
const DEAD_ZONE = 8;
/** Mirrors the RSI divergence module's detector settings (wing 5 / span 60). */
const DIV_WING = 5;
const DIV_SPAN = 60;
const MIN_BARS = 12;

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- helpers

interface Reversal {
  pivot: number; // block index of the extreme (where the triangle sits)
  confirm: number; // block index at which the turn was confirmed
  bull: boolean;
  rsi: number;
}

/**
 * In-zone reversals over an RSI series, index-aligned with the blocks it was computed on. Verbatim
 * mirror of `rsiSignals`: a trough at or below 35 that the next defined block turns up from is a
 * bull reversal (mirrored at 65), ONE per excursion — the zone must be left before the family
 * re-arms, which is what stops a grind along the line from printing a picket fence.
 */
function reversalScan(rsi: Float64Array): Reversal[] {
  const fin = finiteIdx(rsi);
  const out: Reversal[] = [];
  if (fin.length < 3) return out;

  let bullFired = false;
  let bearFired = false;
  for (let k = 2; k < fin.length; k++) {
    const iP = fin[k - 1];
    const vPrev = rsi[fin[k - 2]];
    const vPiv = rsi[iP];
    const vNow = rsi[fin[k]];

    if (vPiv > OS_LEVEL) bullFired = false; // left the zone: re-arm
    if (vPiv < OB_LEVEL) bearFired = false;

    if (!bullFired && vPiv <= OS_LEVEL && vPrev > vPiv && vNow > vPiv) {
      out.push({ pivot: iP, confirm: fin[k], bull: true, rsi: vPiv });
      bullFired = true;
    } else if (!bearFired && vPiv >= OB_LEVEL && vPrev < vPiv && vNow < vPiv) {
      out.push({ pivot: iP, confirm: fin[k], bull: false, rsi: vPiv });
      bearFired = true;
    }
  }
  return out;
}

const DIV_SHORT: Record<string, [string, string]> = {
  bull: ["Bull", "底背离"],
  bear: ["Bear", "顶背离"],
  hiddenBull: ["H Bull", "隐底"],
  hiddenBear: ["H Bear", "隐顶"],
};

const ZONE_NAME: Record<string, [string, string]> = {
  ob: ["Overbought", "超买"],
  os: ["Oversold", "超卖"],
  mid: ["Neutral", "中性"],
  work: ["In range", "区间内"],
};

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

  // W2 law: the Engine's live calibration, applied to every resampled column.
  const p = rsiEngineParams(ctx.suite);
  const wantHidden = mtfBool(ctx.suite?.["div.hidden"], true);

  const rowRsi: MtfRow = { label: "RSI", cells: [] };
  const rowSignal: MtfRow = { label: zh ? "信号" : "Signal", cells: [] };
  const rowDiv: MtfRow = { label: zh ? "背离" : "Divergence", cells: [] };

  for (const f of MTF_FACTORS) {
    const { groups, lastSrc } = resampleOhlcv(bars, f);
    let g = groups.length - 1; // last complete block (a partial trailing one is dropped upstream)
    // …but when n % f === 0 the count-complete last block still CONTAINS the live forming bar —
    // treat any block ending on the final loaded bar as live and step back one (review W3-8)
    if (f > 1 && g >= 0 && lastSrc[g] === bars.length - 1) g--;
    if (g < 2) {
      const none: MtfCell = { text: EM_DASH, color: colors.muted };
      rowRsi.cells.push(none);
      rowSignal.cells.push(none);
      rowDiv.cells.push(none);
      continue;
    }
    const lag = n - 1 - lastSrc[g];
    const basis = mtfBasisTip(f, lag, zh ? "zh" : "en");

    const { rsi } = computeUltimateRsi(groups, p.len, p.source, p.smoothLen, p.smoothType);

    // ---- RSI: level + zone color + slope -------------------------------------------------
    const v = rsi[g];
    if (!Number.isFinite(v)) {
      rowRsi.cells.push({
        text: EM_DASH,
        color: colors.muted,
        tip: `${zh ? "最后一个完整分组尚在预热或无可用报价" : "Last complete block is warm-up or has no usable print"} · ${basis}`,
      });
    } else {
      let prev = NaN;
      for (let k = g - 1; k >= 0; k--) {
        if (Number.isFinite(rsi[k])) {
          prev = rsi[k];
          break;
        }
      }
      const zone =
        v >= OB_LEVEL ? "ob" : v <= OS_LEVEL ? "os" : Math.abs(v - MID_LEVEL) < DEAD_ZONE ? "mid" : "work";
      const color =
        zone === "ob"
          ? colors.down
          : zone === "os"
            ? colors.up
            : zone === "mid"
              ? colors.muted
              : colors.brand;
      rowRsi.cells.push({
        text: `${v.toFixed(1)} ${mtfSlope(v, prev)}`,
        color,
        bold: true,
        tip: `${t(ZONE_NAME[zone])} · RSI ${v.toFixed(1)} · ${zh ? "上一格" : "prev"} ${Number.isFinite(prev) ? prev.toFixed(1) : EM_DASH} · ${basis}`,
      });
    }

    // ---- Signal: last in-zone reversal inside the window ---------------------------------
    const revs = reversalScan(rsi);
    const last = revs.length ? revs[revs.length - 1] : null;
    const sAgo = last ? g - last.confirm : -1;
    if (!last || sAgo < 0 || sAgo > MTF_SIGNAL_WINDOW) {
      rowSignal.cells.push({
        text: EM_DASH,
        color: colors.muted,
        tip: `${zh ? `最近 ${MTF_SIGNAL_WINDOW} 格内无区间反转` : `No in-zone reversal in the last ${MTF_SIGNAL_WINDOW} cells`} · ${basis}`,
      });
    } else {
      rowSignal.cells.push({
        text: `${last.bull ? "▲" : "▼"} ${mtfAgo(sAgo, zh ? "zh" : "en")}`,
        color: last.bull ? colors.up : colors.down,
        fade: mtfFade(sAgo, MTF_SIGNAL_WINDOW),
        tip: `${last.bull ? (zh ? "超卖反转" : "Oversold reversal") : zh ? "超买反转" : "Overbought reversal"} · RSI ${last.rsi.toFixed(1)} · ${zh ? `极值在确认前 ${last.confirm - last.pivot} 格` : `extreme ${last.confirm - last.pivot} cell(s) before confirmation`} · ${basis}`,
      });
    }

    // ---- Divergence: last class inside the window -----------------------------------------
    const divs = findDivergences(groups, rsi, {
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
        tip: `${short ? t(short) : hit.kind} · ${zh ? `跨度 ${hit.iB - hit.iA} 格` : `span ${hit.iB - hit.iA} cells`} · RSI ${hit.oscA.toFixed(1)} → ${hit.oscB.toFixed(1)} · ${basis}`,
      });
    }
  }

  const table: TableSpec = buildMtfTable({
    id: "rsix-mtf",
    pos,
    compact,
    title: zh ? "RSI 多周期" : "RSI MTF",
    rows: [rowRsi, rowSignal, rowDiv],
    footnote: mtfFootnote(zh ? "zh" : "en"),
  });

  return { prims: [], tables: [table] };
}

// ---------------------------------------------------------------------------------- module def

export const RSIX_MTF_MODULE: SuiteModuleDef = { ...RSIX_MTF_META, compute };

export default RSIX_MTF_MODULE;
