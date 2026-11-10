/** Sector-ETF fund-flow matrix — pure readers and formatters for the retained
 * Sector Intelligence depth surface ("Where sector-ETF money is flowing").
 *
 * Incumbent Macro semantics, reproduced exactly:
 * - A flow value is net creation/redemption flow (ΔShares × NAV) summed over the
 *   window, in US$ millions; positive = money in.
 * - `null` is NO READING. `0` is a measured number. They are never conflated:
 *   every model cell keeps them visibly distinct (`missing` vs `zero`).
 * - Windows are "1d" | "3d" | "1w" | "2w" | "1m" = 1/3/5/10/21 trading days in
 *   that fixed order, and each window caps at the number of trading days
 *   collected so far (`depth`) — so the wider windows coincide until more
 *   history accrues.
 * - The heat scale is per window (per column) and is computed over the 11 ETF
 *   rows ONLY. The net row is excluded from its window's scale (incumbent law).
 *
 * This module is pure: no React, no i18n, no DOM. The component layer owns all
 * customer-facing copy through the lane lexicon (lib/sectorDepthLex.ts).
 */

/** The five flow windows, in the incumbent's fixed order. Every surface — heat
 * columns, exact-value table, phone window list — iterates this order. */
export type FlowWindow = "1d" | "3d" | "1w" | "2w" | "1m";

export const FLOW_WINDOWS: readonly FlowWindow[] = ["1d", "3d", "1w", "2w", "1m"];

/** Full window length in trading days (1 week = 5 sessions, 2 weeks = 10,
 * 1 month = 21). */
export const WINDOW_DAYS: Readonly<Record<FlowWindow, number>> = {
  "1d": 1,
  "3d": 3,
  "1w": 5,
  "2w": 10,
  "1m": 21,
};

/** One sector ETF row. `values` carries one entry per window; a value is the
 * net flow in US$ millions, or `null` when there is no reading for it. */
export interface FlowRow {
  ticker: string;
  name: string;
  name_zh?: string;
  values: Readonly<Record<FlowWindow, number | null>>;
}

/** The flow-matrix payload as published by the Macro sector generation. */
export interface FlowsData {
  /** Reading date, "YYYY-MM-DD". */
  asof: string;
  /** Trading days of history collected so far; windows cap at this. */
  depth: number;
  /** The 11 sector SPDRs, in source order. */
  rows: FlowRow[];
  /** The complex-wide net row, one entry per window (same null law). */
  net: Readonly<Record<FlowWindow, number | null>>;
}

/** U+2212 MINUS SIGN — the incumbent's minus, never an ASCII hyphen. */
export const MINUS_SIGN = "−";

/** The glyph a missing reading renders as: U+2014 EM DASH. */
export const MISSING_GLYPH = "—";

function groupThousands(n: number): string {
  // In the M branch |v| < 1000, so this only fires when 999.5+ rounds up to 1,000.
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Incumbent money formatting, US$ millions in / billions out:
 * - `null` → "—" (em dash) — a missing reading, never a zero.
 * - |v| ≥ 1000 → sign + "$" + |v|/1000 with exactly 1 decimal + "B".
 * - otherwise  → sign + "$" + |v| rounded to 0 decimals, thousands-separated + "M".
 * - sign is "+" for v ≥ 0 and "−" (U+2212) for negative. 0 → "+$0M".
 *
 * A non-finite input (NaN/±Infinity cannot be a measured flow) is treated as a
 * missing reading rather than rendered as an invented number.
 */
export function fmtMoneyMn(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return MISSING_GLYPH;
  const sign = v >= 0 ? "+" : MINUS_SIGN;
  const a = Math.abs(v);
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}B`;
  return `${sign}$${groupThousands(Math.round(a))}M`;
}

/** Trading days a window actually covers: the window's full length capped at
 * the collected history. Label the result with the lexicon's
 * siFlowsWindowDays {n} so capped windows are visible to the reader. */
export function effectiveWindowDays(window: FlowWindow, depth: number): number {
  const d = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
  return Math.min(WINDOW_DAYS[window], d);
}

/** Per-window heat scale: the max absolute value across the ETF rows ONLY.
 * The net row is structurally excluded (it is not passed in) — the incumbent
 * law keeps the complex-wide net from flattening every cell's intensity.
 * A window with no measured values (all null) — or all measured exactly 0 —
 * scales to 0, and every intensity in it is 0. */
export function heatScale(flows: FlowsData): Record<FlowWindow, number> {
  const out = {} as Record<FlowWindow, number>;
  for (const w of FLOW_WINDOWS) {
    let max = 0;
    for (const row of flows.rows) {
      const v = row.values[w];
      if (typeof v === "number" && Number.isFinite(v)) {
        const a = Math.abs(v);
        if (a > max) max = a;
      }
    }
    out[w] = max;
  }
  return out;
}

/** Cell heat intensity in [0,1]: |value| / scale, clamped. A missing reading,
 * a non-finite value or a 0-scale window all yield 0 (no tint). */
export function cellIntensity(value: number | null, scale: number): number {
  if (value === null || !Number.isFinite(value) || !(scale > 0)) return 0;
  return Math.min(1, Math.abs(value) / scale);
}

/** This row's share of the complex-wide net move for the same window, in
 * percent rounded to 1 decimal. Defined ONLY when both inputs are finite
 * non-null numbers and the net is not exactly 0 — otherwise `undefined`
 * (never Infinity or NaN). A measured row flow of 0 over a live net is a
 * defined 0.0%. */
export function participation(
  rowValue: number | null,
  netValue: number | null,
): number | undefined {
  if (rowValue === null || netValue === null) return undefined;
  if (!Number.isFinite(rowValue) || !Number.isFinite(netValue)) return undefined;
  if (netValue === 0) return undefined;
  return Math.round((rowValue / netValue) * 1000) / 10;
}

/** How many of the five windows this row has a measured reading for. An
 * all-null row scores 0 of 5 and still renders — with "no reading" in every
 * window, visibly distinct from an absent row. */
export function rowCoverage(row: Pick<FlowRow, "values">): number {
  let n = 0;
  for (const w of FLOW_WINDOWS) {
    const v = row.values[w];
    if (typeof v === "number" && Number.isFinite(v)) n += 1;
  }
  return n;
}

/** One matrix cell, resolved for presentation. `text` is the exact formatted
 * value the surface shows; the heat view and the exact-value table are built
 * from the same cells so they cannot disagree. */
export interface FlowCell {
  window: FlowWindow;
  /** The measured value, or null when there is no reading. */
  value: number | null;
  /** fmtMoneyMn(value) — "—" when missing. */
  text: string;
  /** No reading for this window (value was null / not finite). */
  missing: boolean;
  /** Measured exactly 0 — a real number, never conflated with missing. */
  zero: boolean;
  /** "up" = money in (≥ 0), "down" = money out (< 0); null when missing. */
  sign: "up" | "down" | null;
  /** Effective window length in trading days (capped at depth). */
  days: number;
  /** True when the window is still capped below its full length. */
  capped: boolean;
}

/** One ETF row of the matrix model. */
export interface FlowRowModel {
  ticker: string;
  name: string;
  nameZh?: string;
  /** Measured windows out of 5 (siFlowsRowCoverage {measured}{windows}). */
  coverage: number;
  /** One cell per window, in FLOW_WINDOWS order. */
  cells: FlowCell[];
}

/** The net row model — its label is lexicon-owned (siFlowsNetRow), so the
 * model carries only values, exactly like an ETF row. */
export interface FlowNetModel {
  coverage: number;
  cells: FlowCell[];
}

/** Full matrix model: the heat view and the exact-value table are both
 * projections of this, which is what makes them equivalent by construction. */
export interface FlowsTableModel {
  asof: string;
  depth: number;
  /** Fixed window order, ["1d","3d","1w","2w","1m"]. */
  windows: FlowWindow[];
  /** The 11 ETF rows, source order preserved. */
  rows: FlowRowModel[];
  net: FlowNetModel;
  /** Per-window ETF-only heat scale (net excluded). */
  scale: Record<FlowWindow, number>;
}

function cellOf(
  window: FlowWindow,
  raw: number | null | undefined,
  depth: number,
): FlowCell {
  const missing = raw === null || raw === undefined || !Number.isFinite(raw);
  const v = missing ? null : (raw as number);
  const days = effectiveWindowDays(window, depth);
  return {
    window,
    value: v,
    text: fmtMoneyMn(v),
    missing,
    zero: v === 0,
    sign: v === null ? null : v >= 0 ? "up" : "down",
    days,
    capped: days < WINDOW_DAYS[window],
  };
}

function cellsOf(
  values: Readonly<Partial<Record<FlowWindow, number | null>>>,
  depth: number,
): FlowCell[] {
  return FLOW_WINDOWS.map((w) => cellOf(w, values[w], depth));
}

/** Exact-value table model for the matrix. Every number the heat view tint
 * encodes appears here as the identical formatted string, and every null is
 * flagged `missing` in both — the equivalence is asserted by tests. */
export function tableModel(flows: FlowsData): FlowsTableModel {
  return {
    asof: flows.asof,
    depth: flows.depth,
    windows: [...FLOW_WINDOWS],
    rows: flows.rows.map((r) => ({
      ticker: r.ticker,
      name: r.name,
      nameZh: r.name_zh,
      coverage: rowCoverage(r),
      cells: cellsOf(r.values, flows.depth),
    })),
    net: {
      coverage: rowCoverage({ values: flows.net }),
      cells: cellsOf(flows.net, flows.depth),
    },
    scale: heatScale(flows),
  };
}

/** One window entry of the phone model: the exact value with its unit lexicon
 * key, plus this row's share of the complex's net move when that is defined. */
export interface PhoneWindowEntry extends FlowCell {
  /** Lexicon key for the unit label (siFlowsUnitsMn) — kept as a key id so
   * this module stays i18n-free; the component resolves it. */
  unitsKey: "siFlowsUnitsMn";
  /** Row/net × 100, 1 decimal — undefined when the net is missing or 0. */
  participationPct: number | undefined;
}

/** Phone (≤760px) model: ONE selected ETF with all five windows' exact
 * values — not a ticker strip — plus its coverage and the source clock parts. */
export interface PhoneModel {
  asof: string;
  depth: number;
  selectedTicker: string;
  selectedName: string;
  selectedNameZh?: string;
  coverage: number;
  /** All five windows, fixed order, exact values. */
  windows: PhoneWindowEntry[];
  /** The 11 ETFs to pick between, source order preserved. */
  pickers: { ticker: string; name: string; nameZh?: string }[];
}

/** Resolve the phone surface for `ticker` (falls back to the first ETF row
 * when unset or unknown). Returns null only for a payload with no rows at
 * all — nothing is invented in place of a missing selection. */
export function phoneModel(flows: FlowsData, ticker?: string): PhoneModel | null {
  const rows = flows.rows;
  if (rows.length === 0) return null;
  const row = rows.find((r) => r.ticker === ticker) ?? rows[0];
  const windows: PhoneWindowEntry[] = FLOW_WINDOWS.map((w) => {
    const cell = cellOf(w, row.values[w], flows.depth);
    return {
      ...cell,
      unitsKey: "siFlowsUnitsMn",
      participationPct: participation(row.values[w] ?? null, flows.net[w] ?? null),
    };
  });
  return {
    asof: flows.asof,
    depth: flows.depth,
    selectedTicker: row.ticker,
    selectedName: row.name,
    selectedNameZh: row.name_zh,
    coverage: rowCoverage(row),
    windows,
    pickers: rows.map((r) => ({
      ticker: r.ticker,
      name: r.name,
      nameZh: r.name_zh,
    })),
  };
}
