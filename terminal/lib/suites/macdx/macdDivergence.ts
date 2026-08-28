// MACD Divergence — the shared 4-class divergence engine run over the normalized MACD, drawn in the
// MACD Ultimate pane suite ("macdx").
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"MACD Divergence — visual spec".
// Algorithm: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.3 "Divergence engine" (the
// detector is shared with the RSI and Pulse panes) and §8.4.
//
// This is a PANE module: every emitted price value is a normalized MACD reading in the suite's own
// y-space (pane.min/max = −120..120), never a chart price. Bar indexing is unchanged.
//
//   macd      = sharedMacd(bars, ctx.suite).macd             (the same curve the Engine draws)
//   divs      = findDivergences(bars, macd, { wing: 5, maxSpan: 60, hidden })
//   connector = straight line between the two MACD pivots, read off `macd` by bar index — so the
//               pane line and any future price-pane mirror come from ONE detection record and can
//               never drift apart
//
// Visual grammar is deliberately IDENTICAL to the RSI and Pulse divergence modules, so a trader who
// has read one pane can read the others without re-learning anything: regular = solid connector in
// the direction token, hidden = the same hue dashed at 0.6 alpha (continuation reads softer than
// reversal), one bare label at pivot B ("Bull Div" / "Bear Div" / "H Bull" / "H Bear"), and several
// divergences confirming on the same swing collapse into one bold "×N" label with the fan capped at
// two connectors (bible: cap connectors per anchor at 2). The vendor's cyan/magenta hidden hues are
// deliberately not copied — per the bible it is the STROKE, not the hue, that separates regular from
// hidden, and keeping all four classes on the up/down pair keeps the locale flip coherent.
//
// Non-repaint: the detector only reports a pair once its SECOND pivot is confirmed (`confirmedAt` =
// pivot B + wing) and this module drops anything whose confirmation bar is not inside the loaded
// series; grouping is gated on an IDENTICAL confirmedAt, so a group springs into existence complete
// and no drawn label is ever relocated or re-lettered by a future bar. Pure — no wall clock,
// randomness or module-level state. The event tape ignores `showLast` (the alert bridge reads it).

import type {
  LabelPrim,
  ModuleCtx,
  ModuleResult,
  PolyPrim,
  Prim,
  SuiteEvent,
  SuiteField,
  SuiteModuleDef,
  TooltipDef,
} from "@/lib/indicator-canvas/types";
import { divergenceStrength, findDivergences } from "@/lib/suites/shared/divergence";
import type { DivergenceEvent } from "@/lib/suites/shared/divergence";
import { boolOpt, clamp, intOpt, sharedMacd, tape } from "./macdEngine";
import { MACD_DIVERGENCE_META } from "./macdDivergence.meta";

// ------------------------------------------------------------------------------------ constants

const WING = 5; // MACD pivot half-window handed to the shared detector
const MAX_SPAN = 60; // furthest pivot-A lookback, in bars
const MULTI_WINDOW = 10; // pivot-B spread allowed inside one multi-divergence group
const MAX_FAN = 2; // connectors drawn per group
const LINE_W = 1.2;
const HIDDEN_DASH = "3 3";
const HIDDEN_ALPHA = 0.6;
const LABEL_FS = 8;
const LABEL_MIN_PX = 2; // density gate: 8px text folds away on a zoomed-out chart

// ------------------------------------------------------------------------------------- settings


// ----------------------------------------------------------------------------- divergence rows

type DivKind = DivergenceEvent["kind"];

/** Normalized view of one detector row — the only shape the render half depends on. */
interface Div {
  kind: DivKind;
  ai: number; // pivot A bar index (older)
  bi: number; // pivot B bar index (newer, carries the label)
  confirmedAt: number; // bar at which the divergence became knowable
  strength: number; // 0..100
  hidden: boolean;
  dir: "bull" | "bear";
}

const CHART_LABEL: Record<DivKind, string> = {
  bull: "Bull Div",
  bear: "Bear Div",
  hiddenBull: "H Bull",
  hiddenBear: "H Bear",
};

function className(kind: DivKind, zh: boolean): string {
  if (!zh) return CHART_LABEL[kind];
  switch (kind) {
    case "bull":
      return "常规底背离";
    case "bear":
      return "常规顶背离";
    case "hiddenBull":
      return "隐藏底背离";
    default:
      return "隐藏顶背离";
  }
}

/** Draw priority inside a fan: reversal before continuation, then stronger, then the tighter span. */
function fanRank(a: Div, b: Div): number {
  if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
  if (b.strength !== a.strength) return b.strength - a.strength;
  if (b.ai !== a.ai) return b.ai - a.ai;
  return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
}

interface Group {
  dir: "bull" | "bear";
  confirmedAt: number;
  bi: number; // label anchor: the newest pivot B in the group
  members: Div[];
}

// -------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars?.length ?? 0;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < WING * 2 + 3) return empty;

  const s = ctx.s || {};
  const wantHidden = boolOpt(s.hidden, true);
  const showLast = intOpt(s.showLast, 8, 2, 16);
  const zh = lang === "zh";

  // ---- 1) the series this module reads (identical to the Engine's curve) ----------------
  const { macd } = sharedMacd(bars, ctx.suite);
  if (macd.length < n) return empty;

  // ---- 2) detect, normalize, order deterministically -------------------------------------
  const found = findDivergences(bars, macd, { wing: WING, maxSpan: MAX_SPAN, hidden: wantHidden });
  const rows: Div[] = [];
  for (const e of found) {
    const hidden = e.kind === "hiddenBull" || e.kind === "hiddenBear";
    if (hidden && !wantHidden) continue; // belt-and-braces: never draw what the toggle hid
    const ai = Math.round(e.iA);
    const bi = Math.round(e.iB);
    if (!(ai >= 0 && bi > ai && bi <= n - 1)) continue;
    if (!Number.isFinite(macd[ai]) || !Number.isFinite(macd[bi])) continue;
    const conf = Number.isFinite(e.confirmedAt) ? Math.round(e.confirmedAt) : bi + WING;
    if (conf > n - 1) continue; // not knowable inside the loaded series yet
    rows.push({
      kind: e.kind,
      ai,
      bi,
      confirmedAt: conf,
      strength: clamp(Math.round(divergenceStrength(e, bars)), 0, 100),
      hidden,
      dir: e.kind === "bull" || e.kind === "hiddenBull" ? "bull" : "bear",
    });
  }
  if (!rows.length) return empty;
  rows.sort(
    (x, y) =>
      x.confirmedAt - y.confirmedAt ||
      x.bi - y.bi ||
      x.ai - y.ai ||
      (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0),
  );

  // ---- 3) multi-divergence grouping -------------------------------------------------------
  // Same confirmation bar + same direction + pivot B inside the window ⇒ one fan, one label.
  const groups: Group[] = [];
  const open: Partial<Record<"bull" | "bear", Group>> = {};
  for (const d of rows) {
    const g = open[d.dir];
    const fits =
      g != null && g.confirmedAt === d.confirmedAt && Math.abs(d.bi - g.members[0].bi) <= MULTI_WINDOW;
    if (fits && g) {
      g.members.push(d);
      if (d.bi > g.bi) g.bi = d.bi;
    } else {
      const ng: Group = { dir: d.dir, confirmedAt: d.confirmedAt, bi: d.bi, members: [d] };
      groups.push(ng);
      open[d.dir] = ng;
    }
  }
  groups.sort((a, b) => a.confirmedAt - b.confirmedAt || a.bi - b.bi || (a.dir < b.dir ? -1 : 1));

  // ---- 4) events — the full tape, independent of showLast ---------------------------------
  const events: SuiteEvent[] = rows.map((d) => ({
    type: "macdx_div",
    dir: d.dir,
    i: d.bi,
    p: macd[d.bi],
    strength: d.strength,
    label: `${className(d.kind, zh)} · ${d.bi - d.ai} ${zh ? "根" : "bars"}`,
  }));

  // ---- 5) render the last N groups ---------------------------------------------------------
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];
  const drawn = groups.length > showLast ? groups.slice(groups.length - showLast) : groups;

  const L = {
    title: zh ? "MACD 背离" : "MACD divergence",
    cls: zh ? "类型" : "Class",
    span: zh ? "跨度" : "Span",
    strength: zh ? "强度" : "Strength",
    stack: zh ? "叠加" : "Stacked",
    bars: zh ? "根" : "bars",
    osc: zh ? "MACD 变化" : "MACD travel",
  };

  for (const g of drawn) {
    const fan = g.members.slice().sort(fanRank);
    const primary = fan[0];
    const col = g.dir === "bull" ? colors.up : colors.down;
    const count = g.members.length;
    const stacked = count > 1;
    const tipId = `macdx-div-${g.confirmedAt}-${g.bi}-${g.dir}`;

    for (const d of fan.slice(0, MAX_FAN)) {
      prims.push({
        kind: "poly",
        id: `macdx-div-c-${d.ai}-${d.bi}-${d.kind}`,
        z: 2,
        pts: [
          { i: d.ai, p: macd[d.ai] },
          { i: d.bi, p: macd[d.bi] },
        ],
        color: col,
        w: LINE_W,
        ...(d.hidden ? { dash: HIDDEN_DASH, alpha: HIDDEN_ALPHA } : {}),
      } as PolyPrim);
    }

    prims.push({
      kind: "label",
      id: `${tipId}-t`,
      z: 3,
      i: g.bi,
      p: macd[g.bi],
      text: `${CHART_LABEL[primary.kind]}${stacked ? ` ×${count}` : ""}`,
      place: g.dir === "bull" ? "below" : "above",
      style: "bare",
      color: col,
      fs: LABEL_FS,
      bold: stacked,
      minPxPerBar: LABEL_MIN_PX,
      tooltipId: tipId,
    } as LabelPrim);

    const best = fan.reduce((m, d) => (d.strength > m.strength ? d : m), fan[0]);
    const rowsOut: TooltipDef["rows"] = [
      { k: L.cls, v: className(primary.kind, zh), color: col },
      { k: L.span, v: `${primary.bi - primary.ai} ${L.bars}` },
      { k: L.strength, v: `${best.strength}` },
      { k: L.osc, v: `${(macd[primary.bi] - macd[primary.ai]).toFixed(1)}` },
    ];
    if (stacked) rowsOut.push({ k: L.stack, v: `×${count}` });
    tooltips.push({ id: tipId, title: L.title, accent: col, rows: rowsOut });
  }

  return { prims, tooltips, events: tape(events) };
}

// ----------------------------------------------------------------------------------- module def

export const MACD_DIVERGENCE_MODULE: SuiteModuleDef = { ...MACD_DIVERGENCE_META, compute };

export default MACD_DIVERGENCE_MODULE;
