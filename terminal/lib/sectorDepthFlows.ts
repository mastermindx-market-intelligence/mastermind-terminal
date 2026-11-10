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
 * - v1.1 carried block: the Macro generation carries etf_flows at
 *   projection.data.typed_blocks.etf_flows — the committed producer
 *   collectors.sponsors.sector_flow_periods() with window labels 1D/3D/1W/2W/1M
 *   (= 1/3/5/10/21 trading days), unit usd_mn and the owner's own
 *   full_window flags; flowsFromCarriedBlock() adapts that closed shape. The
 *   block carries NO fund names — the ticker is the identity, nothing invented.
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

/** Reader-facing label per window — exactly the carried block's closed label
 * set, which is the committed producer's own display vocabulary
 * (collectors.sponsors.FLOW_PERIODS): uppercase 1D/3D/1W/2W/1M. Internal ids
 * stay lowercase (data attributes, fixtures); every glyph a reader sees comes
 * from this map, so the surface renders the owner's labels, never a local
 * variant of them. */
export const FLOW_WINDOW_LABEL: Readonly<Record<FlowWindow, string>> = {
  "1d": "1D",
  "3d": "3D",
  "1w": "1W",
  "2w": "2W",
  "1m": "1M",
};

/** One sector ETF row. `values` carries one entry per window; a value is the
 * net flow in US$ millions, or `null` when there is no reading for it.
 * `name` is optional: the carried block provides tickers only, and the ticker
 * then IS the display identity — a name is never invented in its place. */
export interface FlowRow {
  ticker: string;
  name?: string;
  name_zh?: string;
  values: Readonly<Record<FlowWindow, number | null>>;
}

/** Owner-stated per-window metadata from the carried block: the full window
 * length in trading days and the owner's own `full_window` flag. A window
 * whose `full_window` is false renders as PARTIAL regardless of what the
 * depth arithmetic alone would say — the owner's statement wins. */
export interface CarriedWindowMeta {
  trading_days: number;
  full_window: boolean;
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
  /** Source label from the carried block, when it carries one (rendered as
   * carried; never synthesized). */
  source?: string;
  /** Owner-stated window metadata (carried block v1.1); absent for sources
   * that do not state it. */
  windowMeta?: Readonly<Partial<Record<FlowWindow, CarriedWindowMeta>>>;
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
  /** Optional: absent when the source carries tickers only. */
  name?: string;
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

/** Shared window-length law for cells and column headers alike: the owner's
 * stated trading_days wins for the full length when the carried block provides
 * metadata, else the incumbent constant; effective days cap at the collected
 * depth; and `full_window:false` is the owner's partial-window statement,
 * marking the window capped regardless of what depth arithmetic alone says. */
function daysStateOf(
  window: FlowWindow,
  depth: number,
  meta?: CarriedWindowMeta,
): { days: number; full: number; capped: boolean } {
  const full =
    meta !== undefined &&
    typeof meta.trading_days === "number" &&
    Number.isFinite(meta.trading_days) &&
    meta.trading_days >= 1
      ? meta.trading_days
      : WINDOW_DAYS[window];
  const d = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
  const days = Math.min(full, d);
  const capped = meta
    ? !meta.full_window || days < full
    : days < WINDOW_DAYS[window];
  return { days, full, capped };
}

/** Column-header view of the same law, so headers and cells can never
 * disagree about whether a window is partial. */
export function windowHeaderOf(
  window: FlowWindow,
  flows: Pick<FlowsData, "depth" | "windowMeta">,
): { days: number; full: number; capped: boolean } {
  return daysStateOf(window, flows.depth, flows.windowMeta?.[window]);
}

function cellOf(
  window: FlowWindow,
  raw: number | null | undefined,
  depth: number,
  meta?: CarriedWindowMeta,
): FlowCell {
  const missing = raw === null || raw === undefined || !Number.isFinite(raw);
  const v = missing ? null : (raw as number);
  const { days, capped } = daysStateOf(window, depth, meta);
  return {
    window,
    value: v,
    text: fmtMoneyMn(v),
    missing,
    zero: v === 0,
    sign: v === null ? null : v >= 0 ? "up" : "down",
    days,
    capped,
  };
}

function cellsOf(
  values: Readonly<Partial<Record<FlowWindow, number | null>>>,
  depth: number,
  meta?: Readonly<Partial<Record<FlowWindow, CarriedWindowMeta>>>,
): FlowCell[] {
  return FLOW_WINDOWS.map((w) => cellOf(w, values[w], depth, meta?.[w]));
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
      cells: cellsOf(r.values, flows.depth, flows.windowMeta),
    })),
    net: {
      coverage: rowCoverage({ values: flows.net }),
      cells: cellsOf(flows.net, flows.depth, flows.windowMeta),
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
    const cell = cellOf(w, row.values[w], flows.depth, flows.windowMeta?.[w]);
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
    // No name carried ⇒ the ticker is the identity; never invented.
    selectedName: row.name ?? row.ticker,
    selectedNameZh: row.name_zh,
    coverage: rowCoverage(row),
    windows,
    pickers: rows.map((r) => ({
      ticker: r.ticker,
      name: r.name ?? r.ticker,
      nameZh: r.name_zh,
    })),
  };
}

/* ── carried etf_flows block (wire v1.1 §3) ───────────────────────────────── */

/** Window label exactly as the carried block writes it: uppercase
 * 1D/3D/1W/2W/1M (the committed producer's display labels). */
export type CarriedFlowLabel = "1D" | "3D" | "1W" | "2W" | "1M";

/** The closed etf_flows block shape carried at
 * projection.data.typed_blocks.etf_flows — the committed producer
 * collectors.sponsors.sector_flow_periods() re-expressed by the central
 * builder: {source, as_of, depth, unit, measure, windows, funds, net_flow_mn}. */
export interface CarriedEtfFlowsBlock {
  source: string;
  as_of: string;
  depth: number;
  unit: string;
  measure: string;
  windows: {
    label: CarriedFlowLabel | string;
    trading_days: number;
    full_window: boolean;
  }[];
  funds: { ticker: string; flow_mn: Record<string, number | null> }[];
  net_flow_mn: Record<string, number | null>;
}

const CARRIED_LABEL_TO_WINDOW: Readonly<Record<string, FlowWindow>> = {
  "1D": "1d",
  "3D": "3d",
  "1W": "1w",
  "2W": "2w",
  "1M": "1m",
};

/** The carried block's closed label set — the exact strings lane 1 writes.
 * Asserted equal to FLOW_WINDOW_LABEL's image by tests, so the round trip
 * carried label → window id → display label is the identity on labels. */
export const CARRIED_FLOW_LABELS: readonly string[] = Object.keys(
  CARRIED_LABEL_TO_WINDOW,
);

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Adapt the carried etf_flows block into FlowsData. Strict closed-shape read:
 * unit must be "usd_mn" (never silently re-unit), all five windows must be
 * present under their known uppercase labels with finite trading_days and a
 * boolean full_window, and funds/net_flow_mn must be well-formed — anything
 * else returns null so the surface renders its unavailable state instead of
 * an invented number. A window key absent (or null) inside flow_mn is NO
 * READING (null), never zero. The block carries no fund names: the ticker is
 * the identity. The block's own as_of/depth/source are carried through. */
export function flowsFromCarriedBlock(block: unknown): FlowsData | null {
  if (typeof block !== "object" || block === null) return null;
  const b = block as Partial<CarriedEtfFlowsBlock>;
  if (typeof b.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.as_of)) {
    return null;
  }
  if (typeof b.depth !== "number" || !Number.isFinite(b.depth) || b.depth < 0) {
    return null;
  }
  if (b.unit !== "usd_mn") return null;
  if (typeof b.source !== "string" || !b.source) return null;
  if (typeof b.measure !== "string" || !b.measure) return null;
  if (!Array.isArray(b.windows) || !Array.isArray(b.funds)) return null;
  if (typeof b.net_flow_mn !== "object" || b.net_flow_mn === null) return null;

  const windowMeta: Partial<Record<FlowWindow, CarriedWindowMeta>> = {};
  const labelToWindow: Record<string, FlowWindow> = {};
  for (const w of b.windows) {
    if (typeof w !== "object" || w === null) return null;
    const win = CARRIED_LABEL_TO_WINDOW[w.label as string];
    if (win === undefined) return null; // closed label set
    if (
      typeof w.trading_days !== "number" ||
      !Number.isFinite(w.trading_days) ||
      w.trading_days < 1
    ) {
      return null;
    }
    if (typeof w.full_window !== "boolean") return null;
    if (windowMeta[win] !== undefined) return null; // duplicate label
    windowMeta[win] = { trading_days: w.trading_days, full_window: w.full_window };
    labelToWindow[w.label as string] = win;
  }
  for (const w of FLOW_WINDOWS) {
    if (!windowMeta[w]) return null; // all five, or the block is unusable
  }

  const valuesOf = (src: Record<string, unknown>): Record<FlowWindow, number | null> => {
    const out = {} as Record<FlowWindow, number | null>;
    for (const w of FLOW_WINDOWS) out[w] = null;
    for (const [label, v] of Object.entries(src ?? {})) {
      const win = labelToWindow[label];
      if (win !== undefined) out[win] = finiteOrNull(v);
    }
    return out;
  };

  const rows: FlowRow[] = [];
  for (const f of b.funds) {
    if (typeof f !== "object" || f === null) return null;
    if (typeof f.ticker !== "string" || !f.ticker) return null;
    if (typeof f.flow_mn !== "object" || f.flow_mn === null) return null;
    rows.push({ ticker: f.ticker, values: valuesOf(f.flow_mn as Record<string, unknown>) });
  }

  return {
    asof: b.as_of,
    depth: Math.floor(b.depth),
    rows,
    net: valuesOf(b.net_flow_mn as Record<string, unknown>),
    source: b.source,
    windowMeta,
  };
}
