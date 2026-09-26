"use client";
/**
 * StrikeExpiryMatrix — the ONE strike × expiry matrix renderer (masterplan §5.3).
 *
 * Two surfaces used to draw the SAME `matrix:{ROOT}` payload with OPPOSITE colourings:
 *
 *   • msc/MatrixHeatCard (Positioning) painted MINUS gex as a dealer hedge transaction,
 *     on --flow-buy/--flow-sell — a transaction side, never flipped by the zh east
 *     convention.
 *   • prism/MatrixGrid (the retired PRISM tab) painted RAW gex on --up-rgb/--down-rgb,
 *     so (a) the same cell read the opposite way from Positioning, and (b) the whole
 *     grid inverted under html[data-updown="east"] on a quantity that is not a price
 *     direction at all.
 *
 * This module ends that: the sign, unit and colour law live here once, and both
 * surfaces render through it. §5.3's "one ladder idiom, one expiry render".
 *
 * COLOUR LAW (single source of truth — see also globals.css:106-112):
 *   hedge  — a transaction side → --flow-buy / --flow-sell. NEVER --up/--down, and
 *            never flipped by html[data-updown="east"].
 *   doi    — build vs unwind → the structure tab's neutral pair --brand-2 / --ai.
 *   oi/vol — magnitudes → one neutral ramp (--brand-2). A magnitude must never look
 *            directional.
 *
 * NORMALISATION: colour saturates at the 5-95th percentile of the VISIBLE window,
 * through a sqrt intensity curve, so one monster strike cannot wash out the field.
 * `normalization: "column"` runs that scale per expiry column instead of once over
 * the whole grid (the PRISM control, kept).
 *
 * EXPIRY SCOPE is anchored to the PAYLOAD'S OWN SESSION (`_build_meta.asof_date`),
 * never the wall clock — an EOD snapshot's "0DTE" is a property of the snapshot's
 * session, exactly as GexDeskView's expiry lens already states.
 *
 * DEFAULTS reproduce Positioning's card byte for byte (metrics hedge/oi/vol/doi,
 * ±8% window, 41 rows, 14 cols, global normalisation, no Σ column, no badges).
 * Everything PRISM did better is opt-in.
 */

import React, { useEffect, useRef, useState } from "react";
import { formatExposureMn } from "@/lib/optionsCompanion";
import railStyles from "./StrikeExpiryMatrixRail.module.css";

// ─── Payload types ────────────────────────────────────────────────────────────

/** Structural superset of gexLadder's GexMatrixCell — the payload carries all of these. */
export interface MatrixHeatCell {
  strike: number;
  expiry: string;
  gex?: number | null;
  call_oi?: number | null;
  put_oi?: number | null;
  call_vol?: number | null;
  put_vol?: number | null;
  /** The builder publishes an OBJECT {call, put} (PIT-lagged ΔOI per leg). */
  delta_oi?: number | { call?: number | null; put?: number | null } | null;
}

export interface StrikeExpiryDoc {
  asof?: string;
  spot?: number | null;
  expiries?: string[];
  strikes?: number[];
  cells?: MatrixHeatCell[];
  /** Prod: the SESSION date; the top-level asof is the build timestamp. */
  _build_meta?: { asof_date?: string | null } | null;
}

export type MatrixMetric = "hedge" | "oi" | "vol" | "doi";
/** Raw exposure is an explicit opt-in; legacy desk selectors keep their original four metrics. */
export type MatrixDisplayMetric = MatrixMetric | "gex";

/** Structural levels the badge column marks, in badge precedence order. */
export interface MatrixLevels {
  call_wall?: number | null;
  put_support?: number | null;
  hvl?: number | null;
  gamma_flip?: number | null;
  max_pain?: number | null;
}

export type LevelBadgeKey =
  | "levelFlip"
  | "levelWall"
  | "levelSupport"
  | "levelMagnet"
  | "levelMaxPain";

export type MatrixScope = "default" | "0dte" | "all";
export type MatrixNorm = "global" | "column";

// ─── Defaults (Positioning's contract) ────────────────────────────────────────

/** Strike window each side of spot. ±8% is the session's tradable neighbourhood. */
export const DEFAULT_WINDOW_PCT = 8;
/** Row/column caps keep the grid readable; the foot discloses what was cut. */
export const DEFAULT_MAX_ROWS = 41;
export const DEFAULT_MAX_COLS = 14;
/** Colour saturates at this percentile of the visible field. */
const CLIP_PCTILE = 95;
const FLOOR_PCTILE = 5;

export const MATRIX_METRICS: { key: MatrixMetric; signed: boolean }[] = [
  { key: "hedge", signed: true },
  { key: "oi", signed: false },
  { key: "vol", signed: false },
  { key: "doi", signed: true },
];

export function isSignedMetric(m: MatrixDisplayMetric): boolean {
  return m === "hedge" || m === "doi" || m === "gex";
}

// ─── Value / format / colour law ──────────────────────────────────────────────

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** ΔOI arrives as {call, put} from the builder (and the fixture); flatten to net. */
export const numDoi = (v: MatrixHeatCell["delta_oi"]): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const c = num(v.call);
  const p = num(v.put);
  return c == null && p == null ? null : (c ?? 0) + (p ?? 0);
};

function pctile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Cell value in the chosen metric. null = not published, 0 = published zero.
 *
 * `hedge` is MINUS the cell's gamma exposure: dollars a continuously hedged dealer
 * transacts per +1% spot, matching `hedgeProfile` (lib/marketStructure.ts). Rendering
 * raw GEX instead is what put two opposite colourings of one strike on one screen.
 */
export function matrixCellValue(c: MatrixHeatCell, m: MatrixDisplayMetric): number | null {
  switch (m) {
    case "gex": {
      const g = num(c.gex);
      return g == null ? null : g / 1e6; // raw exposure, NOT the hedge transaction below
    }
    case "hedge": {
      const g = num(c.gex);
      // matrix gex is WHOLE DOLLARS of exposure; every surface speaks $mn of hedge.
      return g == null ? null : g === 0 ? 0 : -g / 1e6;
    }
    case "oi": {
      const a = num(c.call_oi);
      const b = num(c.put_oi);
      return a == null && b == null ? null : (a ?? 0) + (b ?? 0);
    }
    case "vol": {
      const a = num(c.call_vol);
      const b = num(c.put_vol);
      return a == null && b == null ? null : (a ?? 0) + (b ?? 0);
    }
    case "doi":
      return numDoi(c.delta_oi);
  }
}

export function fmtMatrixCell(v: number, m: MatrixDisplayMetric): string {
  if (m === "gex") return formatExposureMn(v);
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : m === "hedge" || m === "doi" ? "+" : "";
  if (m === "hedge") {
    if (a >= 1000) return `${sign}${(a / 1000).toFixed(1)}B`;
    if (a >= 10) return `${sign}${a.toFixed(0)}M`;
    return `${sign}${a.toFixed(1)}M`;
  }
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${a.toFixed(0)}`;
}

/**
 * The tone a cell is painted in. THE law — no caller may pick its own.
 * Hedge rides the aggressor-side pair, which globals.css deliberately excludes from
 * the html[data-updown="east"] flip; ΔOI rides the neutral structure pair; magnitudes
 * ride one neutral ramp.
 */
export function matrixCellTone(v: number, m: MatrixDisplayMetric): string {
  if (m === "gex") return v > 0 ? "var(--exposure-positive)" : "var(--exposure-negative)";
  if (!isSignedMetric(m)) return "var(--brand-2)";
  if (m === "doi") return v > 0 ? "var(--brand-2)" : "var(--ai)";
  return v > 0 ? "var(--flow-buy)" : "var(--flow-sell)";
}

// ─── Grid construction ────────────────────────────────────────────────────────

export interface BuildMatrixGridOpts {
  matrix: StrikeExpiryDoc | null | undefined;
  spot?: number | null;
  callWall?: number | null;
  putWall?: number | null;
  metric: MatrixDisplayMetric;
  windowPct?: number;
  maxRows?: number;
  maxCols?: number;
  normalization?: MatrixNorm;
  scope?: MatrixScope;
  /** Compute the Σ-across-visible-expiries column. Off by default (Positioning). */
  withSigma?: boolean;
  /** Companion cells can be pinned on a chart: never invent a rounded strike. */
  exactStrikes?: boolean;
}

export interface MatrixScale {
  hi: number;
  lo: number;
}

export interface MatrixGridModel {
  strikes: number[];
  exps: string[];
  byKey: Map<string, MatrixHeatCell>;
  spotRef: number | null;
  bucket: number;
  cw: number | null;
  pw: number | null;
  nAll: number;
  nExpAll: number;
  /** The session the CELLS describe (payload's own), not today. */
  sessionDate: string;
  scaleHi: number;
  scaleLo: number;
  /** Per-expiry scales when normalization === "column"; null under "global". */
  perCol: Map<string, MatrixScale> | null;
  /** Σ per strike across the visible expiries; empty unless `withSigma`. */
  sigma: Map<number, number | null>;
  sigmaScale: MatrixScale;
}

function scaleOf(mags: number[], signed: boolean): MatrixScale {
  if (!mags.length) return { hi: 1, lo: 0 };
  const sorted = [...mags].sort((a, b) => a - b);
  const hi = pctile(sorted, CLIP_PCTILE) || sorted[sorted.length - 1];
  const lo = signed ? 0 : pctile(sorted, FLOOR_PCTILE);
  return { hi, lo };
}

export function buildMatrixGrid(opts: BuildMatrixGridOpts): MatrixGridModel | null {
  const {
    matrix,
    spot,
    callWall,
    putWall,
    metric,
    windowPct = DEFAULT_WINDOW_PCT,
    maxRows = DEFAULT_MAX_ROWS,
    maxCols = DEFAULT_MAX_COLS,
    normalization = "global",
    scope = "default",
    withSigma = false,
    exactStrikes = false,
  } = opts;

  const signed = isSignedMetric(metric);
  const cells = matrix?.cells;
  if (!Array.isArray(cells) || cells.length === 0) return null;

  const spotRef = num(matrix?.spot) ?? num(spot);
  const allStrikes = [...new Set(cells.map((c) => c.strike).filter((k) => Number.isFinite(k)))];
  if (allStrikes.length < 2) return null;

  // Session date: prod's top-level asof is the BUILD timestamp (Fri 23:00Z over a
  // Thursday chain) and prod grids carry ALREADY-EXPIRED expiries — dead columns
  // unless filtered against the session the cells actually describe.
  const sessionDate =
    (typeof matrix?._build_meta?.asof_date === "string" && matrix._build_meta.asof_date) ||
    (typeof matrix?.asof === "string" ? matrix.asof.slice(0, 10) : "");
  let allExps = [...new Set(cells.map((c) => c.expiry).filter(Boolean))]
    .sort()
    .filter((e) => !sessionDate || e.slice(0, 10) >= sessionDate);
  // 0DTE is measured against the SNAPSHOT's session, never today: an EOD grid replayed
  // on a later day has no wall-clock 0DTE, but it does have one for its own session.
  if (scope === "0dte") {
    const zero = allExps.filter((e) => sessionDate && e.slice(0, 10) === sessionDate);
    allExps = zero.length > 0 ? zero : allExps.slice(0, 1);
  }
  const exps = allExps.slice(0, maxCols);
  const expSet = new Set(exps);

  // Strike buckets (chosen automatically): prod ladders run 281 strikes at $1 spacing —
  // raw rows would either overflow or cover ±2% of spot. Pick the smallest round bucket
  // that fits the ±windowPct window in ~maxRows.
  let bucket = 0;
  if (!exactStrikes) {
    const windowed = spotRef
      ? allStrikes.filter((k) => Math.abs(k - spotRef) / spotRef <= windowPct / 100)
      : allStrikes;
    const src = windowed.length >= 5 ? windowed : allStrikes;
    // The ACTUAL span of the windowed ladder — a thin fixture grid must keep its native
    // resolution while a 281-strike prod ladder coarsens to round buckets.
    const span = Math.max(...src) - Math.min(...src);
    if (Number.isFinite(span) && span > 0) {
      const target = span / (maxRows - 1);
      bucket = [0.5, 1, 2.5, 5, 10, 25, 50, 100, 250].find((c) => c >= target) ?? 250;
    }
  }
  const toBucket = (k: number) => (bucket > 0 ? Math.round(k / bucket) * bucket : k);

  let strikes = spotRef
    ? [...new Set(allStrikes.filter((k) => Math.abs(k - spotRef) / spotRef <= windowPct / 100).map(toBucket))]
    : [...new Set(allStrikes.map(toBucket))];
  if (!exactStrikes && strikes.length < 5) strikes = [...new Set(allStrikes.map(toBucket))];
  if (strikes.length > maxRows) {
    strikes = spotRef
      ? strikes.sort((a, b) => Math.abs(a - spotRef) - Math.abs(b - spotRef)).slice(0, maxRows)
      : strikes.slice(0, maxRows);
  }
  strikes.sort((a, b) => b - a); // ladder order: high strikes on top
  const strikeSet = new Set(strikes);

  // Aggregate raw fields into (bucket, expiry) so every metric sums coherently.
  const byKey = new Map<string, MatrixHeatCell>();
  const FIELDS = ["gex", "call_oi", "put_oi", "call_vol", "put_vol", "delta_oi"] as const;
  for (const c of cells) {
    if (!Number.isFinite(c.strike) || !expSet.has(c.expiry)) continue;
    const kb = toBucket(c.strike);
    if (!strikeSet.has(kb)) continue;
    const key = `${kb}|${c.expiry}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = { strike: kb, expiry: c.expiry };
      byKey.set(key, acc);
    }
    for (const f of FIELDS) {
      // delta_oi is an {call, put} object — flatten before summing.
      const v = f === "delta_oi" ? numDoi(c.delta_oi) : num(c[f]);
      if (v != null) {
        acc[f] = ((f === "delta_oi" ? numDoi(acc.delta_oi) : num(acc[f])) ?? 0) + v;
      }
    }
  }

  // Normalisation over the VISIBLE field only (the window is what the eye compares).
  const mags: number[] = [];
  for (const c of byKey.values()) {
    const v = matrixCellValue(c, metric);
    if (v != null && v !== 0) mags.push(Math.abs(v));
  }
  const global = scaleOf(mags, signed);

  let perCol: Map<string, MatrixScale> | null = null;
  if (normalization === "column") {
    perCol = new Map();
    for (const e of exps) {
      const colMags: number[] = [];
      for (const k of strikes) {
        const c = byKey.get(`${k}|${e}`);
        const v = c ? matrixCellValue(c, metric) : null;
        if (v != null && v !== 0) colMags.push(Math.abs(v));
      }
      perCol.set(e, scaleOf(colMags, signed));
    }
  }

  const sigma = new Map<number, number | null>();
  let sigmaScale: MatrixScale = { hi: 1, lo: 0 };
  if (withSigma) {
    const sigMags: number[] = [];
    for (const k of strikes) {
      let total = 0;
      let hasAny = false;
      for (const e of exps) {
        const c = byKey.get(`${k}|${e}`);
        const v = c ? matrixCellValue(c, metric) : null;
        if (v != null) {
          total += v;
          hasAny = true;
        }
      }
      // null (never 0) when no expiry published this strike — an absent row must not
      // render as a confident "flat", the same reason heatSeekerConfPct returns null.
      sigma.set(k, hasAny ? total : null);
      if (hasAny && total !== 0) sigMags.push(Math.abs(total));
    }
    sigmaScale = scaleOf(sigMags, signed);
  }

  return {
    strikes,
    exps,
    byKey,
    spotRef,
    bucket,
    // Walls land in the bucket that contains them, and only when visible.
    cw: callWall != null && strikeSet.has(toBucket(callWall)) ? toBucket(callWall) : null,
    pw: putWall != null && strikeSet.has(toBucket(putWall)) ? toBucket(putWall) : null,
    nAll: allStrikes.length,
    nExpAll: allExps.length,
    sessionDate,
    scaleHi: global.hi,
    scaleLo: global.lo,
    perCol,
    sigma,
    sigmaScale,
  };
}

// ─── Cell paint ───────────────────────────────────────────────────────────────

/** 0..1 intensity of a value against a scale, matching the card's original curve. */
function intensity(v: number, scale: MatrixScale, signed: boolean): number {
  const a = Math.abs(v);
  return signed
    ? Math.min(1, a / (scale.hi || 1))
    : Math.min(1, Math.max(0, (a - scale.lo) / ((scale.hi - scale.lo) || 1)));
}

export function matrixCellBg(v: number, scale: MatrixScale, metric: MatrixDisplayMetric): string {
  const t01 = intensity(v, scale, isSignedMetric(metric));
  const alpha = Math.max(4, Math.sqrt(t01) * (metric === "gex" ? 48 : 78));
  return `color-mix(in srgb, ${matrixCellTone(v, metric)} ${alpha.toFixed(1)}%, transparent)`;
}

// ─── Level badges ─────────────────────────────────────────────────────────────

export interface LevelBadge {
  key: LevelBadgeKey;
  color: string;
}

/** One token per marker — a badge can never drift out of the palette. */
export const LEVEL_BADGE_COLORS: Record<LevelBadgeKey, string> = {
  levelFlip: "var(--ai)",
  levelWall: "var(--brand-2)",
  // --danger, not --down: a structural level is not a price direction, and --down is
  // redefined by html[data-updown="east"]. --danger is the health family (never flipped)
  // and is the SAME hue #f0566b that --down resolves to in the west theme, so the badge
  // looks identical to before and simply stops inverting.
  levelSupport: "var(--danger)",
  levelMagnet: "var(--signal)",
  levelMaxPain: "var(--text-2)",
};

/** The five markers in badge precedence order — also drives the legend. */
export const LEVEL_BADGE_ORDER: LevelBadgeKey[] = [
  "levelFlip",
  "levelWall",
  "levelSupport",
  "levelMagnet",
  "levelMaxPain",
];

export function estimateStrikeStep(strikes: number[]): number {
  if (strikes.length < 2) return 5;
  const sorted = [...strikes].sort((a, b) => a - b);
  const diffs = sorted.slice(1).map((s, i) => s - sorted[i]).filter((d) => d > 0);
  if (diffs.length === 0) return 5;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

const LEVEL_FIELDS: { key: LevelBadgeKey; field: keyof MatrixLevels }[] = [
  { key: "levelFlip", field: "gamma_flip" },
  { key: "levelWall", field: "call_wall" },
  { key: "levelSupport", field: "put_support" },
  { key: "levelMagnet", field: "hvl" },
  { key: "levelMaxPain", field: "max_pain" },
];

/**
 * Map each level onto the ONE visible strike nearest it.
 *
 * The retired PRISM grid asked "is any strike within step*1.2 of this level?" per row,
 * which on a $1-spaced ladder badged THREE rows WALL for a single call wall (759/760/761
 * are all within 1.2). A level is one price: it gets one row. Ties are impossible because
 * the nearest strike is chosen by distance, and precedence (flip > wall > support >
 * magnet > max pain) decides when two levels claim the same row.
 *
 * A level further than one full step from every visible strike is off-grid and unbadged
 * — it would otherwise label a row it does not describe.
 */
export function buildLevelBadgeMap(
  strikes: number[],
  levels: MatrixLevels | null | undefined,
  step: number
): Map<number, LevelBadgeKey> {
  const out = new Map<number, LevelBadgeKey>();
  if (!levels || strikes.length === 0) return out;
  // Reverse precedence order so the strongest marker overwrites a weaker one.
  for (const { key, field } of [...LEVEL_FIELDS].reverse()) {
    const v = levels[field];
    if (v == null || !Number.isFinite(v)) continue;
    let best: number | null = null;
    let bestD = Infinity;
    for (const k of strikes) {
      const d = Math.abs(k - v);
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best != null && bestD <= step) out.set(best, key);
  }
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface StrikeExpiryMatrixProps {
  grid: MatrixGridModel;
  metric: MatrixDisplayMetric;
  /**
   * "card" — Positioning's dense hover-reveal grid (the DEFAULT; byte-identical to
   * MatrixHeatCard's original markup). "desk" — the Exposure matrix view: taller rows,
   * always-visible values, a level-badge column and the Σ column.
   */
  variant?: "card" | "desk" | "rail";
  /** Rail-only interaction contract. Existing card/desk markup is unchanged. */
  rail?: MatrixRailInteraction;
  /** CSS-module class names for the card variant's scroll/table/strike cell. */
  classes?: { scroll?: string; table?: string; strike?: string };
  /** Desk variant only — structural levels for the badge column. */
  levels?: MatrixLevels | null;
  /** Desk variant only — bilingual badge text. Never baked English. */
  badgeLabel?: (key: LevelBadgeKey) => string;
  /** Desk variant only — render the Σ pinned summary column. */
  showSigma?: boolean;
  /** Desk variant only — accessible name for the Σ column header. */
  sigmaAria?: string;
  /** Desk variant only — "SPOT" chip text on the row nearest spot. */
  spotLabel?: string;
  /** Desk variant only — bilingual strike-column header. */
  strikeLabel?: string;
}

export function StrikeExpiryMatrix({
  grid,
  metric,
  variant = "card",
  classes,
  levels,
  badgeLabel,
  showSigma = false,
  sigmaAria,
  spotLabel,
  strikeLabel,
  rail,
}: StrikeExpiryMatrixProps) {
  if (variant === "rail" && rail) return <RailMatrix grid={grid} metric={metric} interaction={rail} />;
  const globalScale: MatrixScale = { hi: grid.scaleHi, lo: grid.scaleLo };
  const scaleFor = (exp: string): MatrixScale => grid.perCol?.get(exp) ?? globalScale;

  if (variant === "card") {
    // ── Positioning's card. This markup is the pre-§5.3 MatrixHeatCard body verbatim;
    //    it must stay byte-identical, so nothing opt-in may leak into this branch.
    //    (`scaleFor` is shared with the desk branch and DOES honour perCol — the card
    //    simply never asks for it: MatrixHeatCard leaves `normalization` at its "global"
    //    default, so grid.perCol is null and scaleFor always returns the global scale.)
    return (
      <div className={classes?.scroll}>
        <table className={classes?.table}>
          <thead>
            <tr>
              <th />
              {grid.exps.map((e) => (
                <th key={e} scope="col">
                  {e.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.strikes.map((k, i) => {
              const next = grid.strikes[i + 1];
              const spotBetween =
                grid.spotRef != null && next != null && k >= grid.spotRef && next < grid.spotRef;
              const isCw = grid.cw != null && k === grid.cw;
              const isPw = grid.pw != null && k === grid.pw;
              const spotBorder = spotBetween
                ? ({ borderBottom: "1px dashed var(--text-2)" } as const)
                : null;
              return (
                <tr key={k}>
                  <td
                    className={classes?.strike}
                    style={{ ...(isCw || isPw ? { fontWeight: 700 } : null), ...spotBorder }}
                  >
                    {k.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    {isCw ? " ·CW" : isPw ? " ·PW" : ""}
                  </td>
                  {grid.exps.map((e) => {
                    const c = grid.byKey.get(`${k}|${e}`);
                    const v = c ? matrixCellValue(c, metric) : null;
                    const bg =
                      v != null && v !== 0
                        ? matrixCellBg(v, scaleFor(e), metric)
                        : "transparent";
                    return (
                      <td key={e} style={{ background: bg, ...spotBorder }}>
                        {v == null || v === 0 ? "" : fmtMatrixCell(v, metric)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // ── Desk variant ────────────────────────────────────────────────────────────
  const step = estimateStrikeStep(grid.strikes);
  const showBadges = !!levels && !!badgeLabel;
  const badgeMap = showBadges
    ? buildLevelBadgeMap(grid.strikes, levels, step)
    : new Map<number, LevelBadgeKey>();

  return (
    <div style={DESK_SCROLL} className="obs-scroll obs-mtx-desk-grid">
      <table style={DESK_TABLE}>
        <thead>
          <tr>
            <th className="obs-lbl" style={TH_STRIKE} scope="col">
              {strikeLabel}
            </th>
            {showBadges && <th style={TH_BADGE} />}
            {grid.exps.map((e) => (
              <th key={e} style={TH_EXP} scope="col">
                <span style={EXP_DATE}>{fmtExpShort(e)}</span>
                <span style={EXP_DTE}>{dteLabel(e, grid.sessionDate)}</span>
              </th>
            ))}
            {showSigma && (
              <th style={TH_SIGMA} scope="col" aria-label={sigmaAria}>
                Σ
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {grid.strikes.map((k, i) => {
            const next = grid.strikes[i + 1];
            const spotBetween =
              grid.spotRef != null && next != null && k >= grid.spotRef && next < grid.spotRef;
            const spotBorder = spotBetween
              ? ({ borderBottom: "2px solid color-mix(in srgb, var(--brand-2) 45%, transparent)" } as const)
              : null;
            const isSpotRow =
              grid.spotRef != null &&
              k === grid.strikes.reduce((best, s) =>
                Math.abs(s - grid.spotRef!) < Math.abs(best - grid.spotRef!) ? s : best
              );
            const badge = badgeMap.get(k) ?? null;
            const pct =
              grid.spotRef != null
                ? `${(((k - grid.spotRef) / grid.spotRef) * 100).toFixed(1)}%`
                : null;
            const sigmaV = showSigma ? grid.sigma.get(k) ?? null : null;

            return (
              <tr key={k} style={isSpotRow ? SPOT_ROW : undefined}>
                <td
                  style={{
                    ...TD_STRIKE,
                    background: isSpotRow ? SPOT_TINT : "var(--bg)",
                    ...spotBorder,
                  }}
                >
                  <span
                    className="num"
                    style={{
                      ...STRIKE_NUM,
                      color: badge
                        ? LEVEL_BADGE_COLORS[badge]
                        : isSpotRow
                          ? "var(--brand-2)"
                          : "var(--text-2)",
                      fontWeight: badge || isSpotRow ? 700 : 400,
                    }}
                  >
                    {k.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                  {isSpotRow && grid.spotRef != null && spotLabel ? (
                    <span
                      className="obs-tag num"
                      style={{ ...SPOT_CHIP, "--c": "var(--brand-2)" } as React.CSSProperties}
                    >
                      {spotLabel} {grid.spotRef.toFixed(2)}
                    </span>
                  ) : (
                    pct && <span className="num" style={SPOT_PCT}>{pct}</span>
                  )}
                </td>

                {showBadges && (
                  <td
                    style={{
                      ...TD_BADGE,
                      background: isSpotRow ? SPOT_TINT : "var(--bg)",
                      ...spotBorder,
                    }}
                  >
                    {badge && (
                      <span
                        className="obs-tag"
                        style={{ ...BADGE, "--c": LEVEL_BADGE_COLORS[badge] } as React.CSSProperties}
                      >
                        {badgeLabel!(badge)}
                      </span>
                    )}
                  </td>
                )}

                {grid.exps.map((e) => {
                  const c = grid.byKey.get(`${k}|${e}`);
                  const v = c ? matrixCellValue(c, metric) : null;
                  const live = v != null && v !== 0;
                  const scale = scaleFor(e);
                  return (
                    <td
                      key={e}
                      style={{
                        ...TD_CELL,
                        background: live ? matrixCellBg(v!, scale, metric) : "transparent",
                        ...spotBorder,
                      }}
                    >
                      {live && (
                        <span
                          className="num"
                          style={{
                            ...CELL_TEXT,
                            color: `color-mix(in srgb, #fff 26%, ${matrixCellTone(v!, metric)})`,
                            opacity: intensity(v!, scale, isSignedMetric(metric)) < 0.12 ? 0.6 : 1,
                          }}
                        >
                          {fmtMatrixCell(v!, metric)}
                        </span>
                      )}
                    </td>
                  );
                })}

                {showSigma && (
                  <td
                    style={{
                      ...TD_SIGMA,
                      background:
                        sigmaV != null && sigmaV !== 0
                          ? matrixCellBg(sigmaV, grid.sigmaScale, metric)
                          : "var(--panel)",
                      ...spotBorder,
                    }}
                  >
                    {sigmaV != null && sigmaV !== 0 && (
                      <span
                        className="num"
                        style={{
                          ...CELL_TEXT,
                          fontWeight: 700,
                          color: `color-mix(in srgb, #fff 26%, ${matrixCellTone(sigmaV, metric)})`,
                        }}
                      >
                        {fmtMatrixCell(sigmaV, metric)}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Desk-variant helpers ─────────────────────────────────────────────────────

function fmtExpShort(exp: string): string {
  const p = (exp || "").slice(0, 10).split("-");
  return p.length === 3 ? `${parseInt(p[1], 10)}/${parseInt(p[2], 10)}` : exp.slice(5);
}

/**
 * Days to expiry measured from the SNAPSHOT's session, never the wall clock — the
 * same anchor GexDeskView's expiry lens uses.
 */
function dteLabel(exp: string, sessionDate: string): string {
  if (!sessionDate) return "";
  const a = Date.parse(`${exp.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${sessionDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  const d = Math.round((a - b) / 86_400_000);
  return d === 0 ? "0DTE" : `${d}d`;
}

// ─── Desk-variant styles ──────────────────────────────────────────────────────

const DESK_SCROLL: React.CSSProperties = {
  overflowX: "auto",
  overflowY: "auto",
  flex: 1,
  minHeight: 0,
};

const DESK_TABLE: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  fontSize: 10,
  fontVariantNumeric: "tabular-nums",
};

const TH_STRIKE: React.CSSProperties = {
  position: "sticky",
  top: 0,
  left: 0,
  zIndex: 4,
  background: "var(--panel)",
  padding: "4px 8px",
  borderBottom: "1px solid var(--line)",
  textAlign: "left",
  minWidth: 76,
};

const TH_BADGE: React.CSSProperties = {
  position: "sticky",
  top: 0,
  left: 76,
  zIndex: 4,
  background: "var(--panel)",
  padding: "4px 4px",
  borderBottom: "1px solid var(--line)",
  minWidth: 56,
};

const TH_EXP: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 3,
  padding: "3px 6px",
  borderBottom: "1px solid var(--line)",
  borderLeft: "1px solid var(--line-2)",
  textAlign: "center",
  minWidth: 58,
  background: "var(--panel)",
  display: "table-cell",
};

const TH_SIGMA: React.CSSProperties = {
  padding: "3px 6px",
  borderBottom: "1px solid var(--line)",
  borderLeft: "2px solid var(--line)",
  textAlign: "center",
  minWidth: 64,
  background: "var(--panel)",
  fontSize: 10,
  color: "var(--brand-2)",
  fontWeight: 800,
  position: "sticky",
  top: 0,
  right: 0,
  zIndex: 4,
};

const EXP_DATE: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 700,
  color: "var(--text-2)",
  fontVariantNumeric: "tabular-nums",
};

const EXP_DTE: React.CSSProperties = {
  display: "block",
  fontSize: 8,
  color: "var(--muted)",
  fontWeight: 400,
};

const SPOT_ROW: React.CSSProperties = {
  outline: "1px solid color-mix(in srgb, var(--brand-2) 28%, transparent)",
};

const SPOT_TINT = "color-mix(in srgb, var(--brand-2) 6%, var(--bg))";

const TD_STRIKE: React.CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 2,
  padding: "0 6px",
  borderBottom: "1px solid var(--line-2)",
  height: 24,
  verticalAlign: "middle",
  whiteSpace: "nowrap",
  display: "table-cell",
};

const STRIKE_NUM: React.CSSProperties = {
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
  marginRight: 4,
};

const SPOT_PCT: React.CSSProperties = {
  fontSize: 8,
  color: "var(--muted)",
};

const SPOT_CHIP: React.CSSProperties = {
  fontSize: 8,
  fontWeight: 700,
  padding: "1px 5px",
};

const TD_BADGE: React.CSSProperties = {
  position: "sticky",
  left: 76,
  zIndex: 2,
  padding: "0 4px",
  borderBottom: "1px solid var(--line-2)",
  borderRight: "1px solid var(--line-2)",
  height: 24,
  verticalAlign: "middle",
};

const BADGE: React.CSSProperties = {
  fontSize: 7.5,
  fontWeight: 800,
  letterSpacing: "0.06em",
  padding: "2px 5px",
  gap: 3,
};

const TD_CELL: React.CSSProperties = {
  padding: "0 5px",
  height: 24,
  borderBottom: "1px solid var(--line-2)",
  borderLeft: "1px solid var(--line-2)",
  textAlign: "center",
  verticalAlign: "middle",
  whiteSpace: "nowrap",
};

const TD_SIGMA: React.CSSProperties = {
  ...TD_CELL,
  borderLeft: "2px solid var(--line)",
  position: "sticky",
  right: 0,
  zIndex: 2,
};

const CELL_TEXT: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "-0.01em",
};


export interface MatrixCellSelection { strike: number; expiry: string }
export interface MatrixRailInteraction {
  selected: MatrixCellSelection | null;
  onSelect: (cell: MatrixCellSelection | null) => void;
  name: string;
  strikeLabel: string;
  missingLabel: string;
  spotLabel: string;
  units: string;
}

/** The compact presentation of the SAME model and color/value laws, not another heatmap engine. */
function RailMatrix({ grid, metric, interaction }: {
  grid: MatrixGridModel; metric: MatrixDisplayMetric; interaction: MatrixRailInteraction;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const spot = grid.spotRef;
  const nearest = grid.strikes.reduce<number | null>((best, strike) =>
    best == null || (spot != null && Math.abs(strike - spot) < Math.abs(best - spot)) ? strike : best, null);
  const fallback = `${nearest ?? grid.strikes[0]}|${grid.exps[0]}`;
  const [focusedStrike, focusedExpiry] = (focused ?? "").split("|");
  const activeKey = focused && grid.strikes.includes(Number(focusedStrike)) && grid.exps.includes(focusedExpiry) ? focused : fallback;
  const identity = `${grid.sessionDate}|${grid.exps.join(",")}|${grid.strikes.join(",")}`;
  useEffect(() => {
    const scroll = scrollRef.current;
    const row = scroll?.querySelector<HTMLTableRowElement>('[data-reference-row="true"]');
    if (scroll && row) scroll.scrollTop = Math.max(0, row.offsetTop - scroll.clientHeight / 2);
  }, [identity]);

  function navigate(event: React.KeyboardEvent<HTMLButtonElement>, row: number, col: number) {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); interaction.onSelect(null); return;
    }
    let r = row, c = col;
    switch (event.key) {
      case "ArrowUp": r--; break;
      case "ArrowDown": r++; break;
      case "ArrowLeft": c--; break;
      case "ArrowRight": c++; break;
      case "Home": c = 0; if (event.ctrlKey || event.metaKey) r = 0; break;
      case "End": c = grid.exps.length - 1; if (event.ctrlKey || event.metaKey) r = grid.strikes.length - 1; break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation();
    r = Math.max(0, Math.min(grid.strikes.length - 1, r));
    c = Math.max(0, Math.min(grid.exps.length - 1, c));
    scrollRef.current?.querySelector<HTMLButtonElement>(`[data-row="${r}"][data-col="${c}"]`)?.focus();
  }

  return <div className={railStyles.scroll} ref={scrollRef} data-options-grid>
    <table className={railStyles.table} aria-label={interaction.name}>
      <thead><tr><th scope="col">{interaction.strikeLabel}</th>{grid.exps.map((exp) =>
        <th scope="col" key={exp}><time dateTime={exp}>{exp.slice(5)}</time><small>{dteLabel(exp, grid.sessionDate)}</small></th>)}</tr></thead>
      <tbody>{grid.strikes.map((strike, row) => <tr key={strike} data-reference-row={strike === nearest}>
        <th scope="row" title={strike === nearest && spot != null ? `${interaction.spotLabel} ${spot}` : undefined}>
          <span>{strike.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
          {strike === nearest && spot != null && <small>{interaction.spotLabel}</small>}
        </th>
        {grid.exps.map((expiry, col) => {
          const key = `${strike}|${expiry}`;
          const cell = grid.byKey.get(key);
          const value = cell ? matrixCellValue(cell, metric) : null;
          const selected = interaction.selected?.strike === strike && interaction.selected?.expiry === expiry;
          const scale = grid.perCol?.get(expiry) ?? { hi: grid.scaleHi, lo: grid.scaleLo };
          return <td key={expiry}>
            <button type="button" data-row={row} data-col={col} data-selected={selected}
              data-value={value ?? "missing"} aria-pressed={selected}
              tabIndex={key === activeKey ? 0 : -1}
              className={railStyles.cell}
              style={{ background: value == null || value === 0 ? undefined : matrixCellBg(value, scale, metric) }}
              aria-label={`${strike}, ${expiry}: ${value == null ? interaction.missingLabel : `${fmtMatrixCell(value, metric)} ${interaction.units}`}`}
              onFocus={() => setFocused(key)} onKeyDown={(event) => navigate(event, row, col)}
              onClick={() => interaction.onSelect(selected ? null : { strike, expiry })}>
              {value == null ? "—" : value === 0 ? "0" : fmtMatrixCell(value, metric)}
            </button>
          </td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}
