// Divergences — Pulse Oscillator module (4-class divergence engine over the pulse wave).
//
// Contract: lib/indicator-canvas/types.ts (frozen). Visual spec: docs/
// PREMIUM_INDICATOR_VISUAL_DESIGN_BIBLE_2026-07-28.md §"Divergence Detection — visual spec".
// Algorithm: docs/PREMIUM_INDICATOR_SUITE_MASTERPLAN_2026-07-28.md §8.3 "Divergence engine".
//
// This is a PANE module: every emitted price value is an oscillator value in the Pulse suite's own
// y-space (pane.min/max = -110..110), never a chart price. Bar indexing is unchanged.
//
//   wave      = computePulseWave(bars, profile).wave        (same series the Wave module draws)
//   divs      = findDivergences(bars, wave, { wing, maxSpan, hidden })
//   connector = straight line between the two OSCILLATOR pivots (a → b), read off `wave` directly
//               so this module depends on nothing but the two pivot BAR INDICES of a divergence
//
// Four classes, encoded as {direction token} × {saturation tier} exactly per the bible: regular =
// solid up/down, hidden = the same hue dashed at 0.6 alpha (continuation reads softer than
// reversal). One bare label sits at pivot B: "Bull Div" / "Bear Div" / "H Bull" / "H Bear".
//
// Multi-divergence (the bible's "fan from a shared anchor"): several divergences landing on the
// SAME confirmation bar with pivot B inside `MULTI_WINDOW` bars collapse into ONE label, bold with
// a "×N" suffix, and draw up to MAX_FAN connectors (bible: cap connectors per anchor at 2). The
// count stays honest even when the fan is clipped.
//
// Non-repaint: a divergence is only ever emitted once its `confirmedAt` bar is inside the loaded
// series, so replaying bar-by-bar reproduces the identical tape. Multi-grouping is deliberately
// gated on an IDENTICAL confirmedAt (not merely nearby pivots): a group therefore springs into
// existence complete, and no already-drawn label is ever rewritten or relocated by a future bar.
// Pure — no wall clock, no randomness, no module state. The event tape ignores `showLast` (the
// alert bridge reads it) and is tail-capped at MAX_EVENTS.

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
import { computePulseWave, pulseProfileOf } from "./pulseWave";
import { findDivergences } from "@/lib/suites/shared/divergence";
import { PULSE_DIVERGENCE_META } from "./divergences.meta";

// ------------------------------------------------------------------------------------ constants

const WING = 5;          // osc/price pivot half-window handed to the shared detector
const MAX_SPAN = 60;     // furthest pivot-A lookback, in bars
const MULTI_WINDOW = 10; // pivot-B spread allowed inside one multi-divergence group
const MAX_FAN = 2;       // connectors drawn per group (bible: cap the fan at 2)
const LINE_W = 1.2;
const HIDDEN_DASH = "3 3";
const HIDDEN_ALPHA = 0.6;
const LABEL_FS = 8;
const LABEL_MIN_PX = 2;  // density gate: 8px text folds away on a zoomed-out chart
const MAX_EVENTS = 300;

// ------------------------------------------------------------------------------------- settings


// -------------------------------------------------------------------------------------- helpers

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function numOpt(v: any, d: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? clamp(n, lo, hi) : d;
}

function boolOpt(v: any, d: boolean): boolean {
  return typeof v === "boolean" ? v : d;
}

// ------------------------------------------------------------------------------- divergence rows

type DivKind = "bull" | "bear" | "hiddenBull" | "hiddenBear";
const KINDS: readonly string[] = ["bull", "bear", "hiddenBull", "hiddenBear"];

/** Normalized view of one detector row — the only shape this module depends on. */
interface Div {
  kind: DivKind;
  ai: number;          // pivot A bar index (older)
  bi: number;          // pivot B bar index (newer, carries the label)
  confirmedAt: number; // bar at which the divergence became knowable
  strength: number;    // 0..100
  hidden: boolean;
  dir: "bull" | "bear";
}

/**
 * Read one row of `findDivergences` output. Only `kind`, the two pivot bar indices and (optionally)
 * `confirmedAt`/`strength` are consumed; oscillator values come from `wave` so the two builds cannot
 * disagree about geometry. Rows that fail validation are dropped rather than drawn wrong.
 */
function readDiv(raw: any, wave: ArrayLike<number>, n: number): Div | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind)) return null;
  // DivergenceEvent carries flat pivot indices (iA/iB); `a.i`/`b.i` is a tolerated legacy shape.
  const ai = Math.round(Number(raw.iA ?? raw.a?.i));
  const bi = Math.round(Number(raw.iB ?? raw.b?.i));
  if (!Number.isInteger(ai) || !Number.isInteger(bi)) return null;
  if (ai < 0 || bi <= ai || bi > n - 1) return null;
  if (!Number.isFinite(wave[ai]) || !Number.isFinite(wave[bi])) return null;

  // confirmedAt is the non-repaint gate; fall back to the pivot's own confirmation lag.
  const rawConf = Number(raw.confirmedAt);
  const confirmedAt = Number.isFinite(rawConf) ? Math.round(rawConf) : bi + WING;
  if (confirmedAt > n - 1) return null; // not knowable inside the loaded series yet

  const hidden = kind === "hiddenBull" || kind === "hiddenBear";
  const dir: "bull" | "bear" = kind === "bull" || kind === "hiddenBull" ? "bull" : "bear";
  const rawStr = Number(raw.strength);
  const strength = Number.isFinite(rawStr)
    ? clamp(Math.round(rawStr), 0, 100)
    : fallbackStrength(wave[ai], wave[bi]);
  return { kind: kind as DivKind, ai, bi, confirmedAt, strength, hidden, dir };
}

/**
 * Used only when the detector does not score a row: half the oscillator travel between the two
 * pivots, half how deep into the extremes the pair sits (a divergence off a -90 trough outranks the
 * same shape around zero). Deterministic and monotone in both inputs.
 */
function fallbackStrength(oa: number, ob: number): number {
  const travel = Math.abs(ob - oa);
  const extreme = Math.max(Math.abs(oa), Math.abs(ob));
  return clamp(Math.round(0.5 * travel + 0.5 * extreme), 0, 100);
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
  bi: number;        // label anchor: the newest pivot B in the group
  members: Div[];
}

// ------------------------------------------------------------------------------------ vocabulary

const CHART_LABEL: Record<DivKind, string> = {
  bull: "Bull Div",
  bear: "Bear Div",
  hiddenBull: "H Bull",
  hiddenBear: "H Bear",
};

function className(kind: DivKind, zh: boolean): string {
  if (!zh) return CHART_LABEL[kind];
  switch (kind) {
    case "bull": return "常规底背离";
    case "bear": return "常规顶背离";
    case "hiddenBull": return "隐藏底背离";
    default: return "隐藏顶背离";
  }
}

// -------------------------------------------------------------------------------------- compute

function compute(ctx: ModuleCtx): ModuleResult {
  const { bars, colors, lang } = ctx;
  const n = bars?.length ?? 0;
  const empty: ModuleResult = { prims: [], tooltips: [], events: [] };
  if (n < WING * 2 + 3) return empty;

  const s = ctx.s || {};
  // ONE profile knob per pane: the Wave module owns it and this module follows it through
  // ctx.suite, so the connectors always land on the wave the trader is actually looking at.
  const profile = pulseProfileOf(ctx.suite);
  const wantHidden = boolOpt(s.hidden, true);
  const wantMulti = boolOpt(s.multi, true);
  const showLast = Math.round(numOpt(s.showLast, 8, 2, 16));
  const zh = lang === "zh";

  // ---- 1) the wave this module reads (same series the Wave module draws) --------------
  const pulse = computePulseWave(bars, profile);
  const wave = pulse?.wave;
  if (!wave || wave.length < n) return empty;

  // ---- 2) detect, normalize, order deterministically ----------------------------------
  const found = findDivergences(bars, wave, { wing: WING, maxSpan: MAX_SPAN, hidden: wantHidden }) as any;
  const rows: Div[] = [];
  if (Array.isArray(found)) {
    for (const raw of found) {
      const d = readDiv(raw, wave, n);
      if (!d) continue;
      if (!wantHidden && d.hidden) continue; // belt-and-braces: never draw what the toggle hid
      rows.push(d);
    }
  }
  if (!rows.length) return empty;
  rows.sort(
    (x, y) =>
      x.confirmedAt - y.confirmedAt ||
      x.bi - y.bi ||
      x.ai - y.ai ||
      (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0),
  );

  // ---- 3) multi-divergence grouping ----------------------------------------------------
  // Same confirmation bar + pivot B inside the window + same direction ⇒ one fan. Gating on an
  // identical confirmedAt is what keeps this non-repainting: a group is complete the instant it is
  // first drawable, so a later bar can never re-letter or move a label already on the chart.
  // With `multi` off the window collapses to 0 — divergences landing on the SAME pivot still share
  // one label (three labels on one bar would simply overprint), they just lose the ×N counter.
  const win = wantMulti ? MULTI_WINDOW : 0;
  const groups: Group[] = [];
  const open: Partial<Record<"bull" | "bear", Group>> = {};
  for (const d of rows) {
    const g = open[d.dir];
    const fits =
      g != null && g.confirmedAt === d.confirmedAt && Math.abs(d.bi - g.members[0].bi) <= win;
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

  // ---- 4) events — the full tape, independent of showLast ------------------------------
  const events: SuiteEvent[] = [];
  for (const d of rows) {
    events.push({
      type: "pulse_div",
      dir: d.dir,
      i: d.bi,
      p: wave[d.bi],
      strength: d.strength,
      label: `${className(d.kind, zh)} · ${d.bi - d.ai} ${zh ? "根" : "bars"}`,
    });
  }
  const tape = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;

  // ---- 5) render the last N groups ------------------------------------------------------
  const prims: Prim[] = [];
  const tooltips: TooltipDef[] = [];
  const drawn = groups.length > showLast ? groups.slice(groups.length - showLast) : groups;

  const L = {
    title: zh ? "脉冲背离" : "Pulse divergence",
    cls: zh ? "类型" : "Class",
    span: zh ? "跨度" : "Span",
    strength: zh ? "强度" : "Strength",
    stack: zh ? "叠加" : "Stacked",
    bars: zh ? "根" : "bars",
    osc: zh ? "振幅" : "Osc travel",
  };

  for (const g of drawn) {
    const fan = g.members.slice().sort(fanRank);
    const primary = fan[0];
    const col = g.dir === "bull" ? colors.up : colors.down;
    const count = g.members.length;
    const stacked = wantMulti && count > 1;
    const tipId = `div-${g.confirmedAt}-${g.bi}-${g.dir}`;

    for (const d of fan.slice(0, MAX_FAN)) {
      prims.push({
        kind: "poly",
        id: `div-c-${d.ai}-${d.bi}-${d.kind}`,
        z: 2,
        pts: [
          { i: d.ai, p: wave[d.ai] },
          { i: d.bi, p: wave[d.bi] },
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
      p: wave[g.bi],
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
      { k: L.osc, v: `${(wave[primary.bi] - wave[primary.ai]).toFixed(1)}` },
    ];
    if (stacked) rowsOut.push({ k: L.stack, v: `×${count}` });
    tooltips.push({ id: tipId, title: L.title, accent: col, rows: rowsOut });
  }

  return { prims, tooltips, events: tape };
}

// --------------------------------------------------------------------------------- module def

export const PULSE_DIVERGENCE_MODULE: SuiteModuleDef = { ...PULSE_DIVERGENCE_META, compute };

export default PULSE_DIVERGENCE_MODULE;
