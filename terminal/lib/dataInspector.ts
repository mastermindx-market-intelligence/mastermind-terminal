// Time-aware Data Inspector — the pure model behind the chart's table view (E10).
//
// ── Identity law ──────────────────────────────────────────────────────────────────────────────
// A row IS its canonical bar time: `String(bar.time)`, the same key the chart's readout map
// (`indRowsAt`) and Lightweight Charts' time scale use. Nothing here keys a selection, a jump, a
// difference or an export on a row NUMBER. Row numbers move under every sort, every virtual-scroll
// window and every re-publication of the bar set (an SWR refresh that prepends history shifts every
// index by the number of bars it added), so a selection stored by position silently starts naming a
// different bar. `seq` exists only to order rows and to count bars between two observations.
//
// ── Time basis ────────────────────────────────────────────────────────────────────────────────
// Intraday bars carry a numeric DISPLAY epoch: the exchange's wall clock read as UTC (see
// lib/liveCandle.ts). Formatting therefore reads UTC fields and never applies a second zone
// conversion. Daily-family bars carry "YYYY-MM-DD" session dates and stay date-only — a daily bar has
// no time of day, so the inspector never invents one.
//
// ── Scope ─────────────────────────────────────────────────────────────────────────────────────
// The inspector only ever sees the bars the chart published for the plotted series. Under Bar
// Replay that set already ends at the replay cursor and the readout map has no later keys, so no
// selection, difference or export can reach a bar the user has not been shown. Study values are read
// from the chart's own readout callback; this module never computes an indicator.

import { classify, isIntradayTf, isSecondTf } from "./intradayShared";
import { isMacroSymbol, macroDisplayTz } from "./macroSymbols";

export type InspectorBar = { time: string | number; o: number; h: number; l: number; c: number; v: number };
export type InspectorColumn = { key: string; label: string; tag: string };
/** The chart's own per-bar readout (ChartPanel `indRowsAt`). Missing key = not published at that bar. */
export type ValuesAt = (time: string | number) => Record<string, number | null | undefined> | undefined;

/** Upper bound for one range selection and for one export. Larger requests are refused, never truncated. */
export const MAX_SCOPE_ROWS = 50_000;

const MARKET_ZONE = {
  us: "America/New_York",
  ca: "America/Toronto",
  cn: "Asia/Shanghai",
  hk: "Asia/Hong_Kong",
  crypto: "UTC",
} as const;

/** IANA zone of the wall clock an intraday bar's display epoch is written in. */
export function exchangeZone(symbol: string): string {
  return isMacroSymbol(symbol) ? macroDisplayTz(symbol) : MARKET_ZONE[classify(symbol)];
}

export type TimeBasis =
  | { kind: "session" }
  | { kind: "intraday"; zone: string; seconds: boolean };

export function timeBasis(symbol: string, timeframe: string, bars: readonly InspectorBar[]): TimeBasis {
  const first = bars[0];
  const intraday = first ? typeof first.time === "number" : isIntradayTf(timeframe);
  if (!intraday) return { kind: "session" };
  const seconds = isSecondTf(timeframe) || bars.some((b) => typeof b.time === "number" && b.time % 60 !== 0);
  return { kind: "intraday", zone: exchangeZone(symbol), seconds };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Exact, zone-free label for one bar: "2026-10-03 09:35" intraday, "2026-10-03" for a session. */
export function formatBarTime(time: string | number, basis: TimeBasis): string {
  if (typeof time === "number") {
    if (!Number.isFinite(time)) return String(time);
    const d = new Date(time * 1000);
    const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const clock = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    return basis.kind === "intraday" && basis.seconds ? `${day} ${clock}:${pad(d.getUTCSeconds())}` : `${day} ${clock}`;
  }
  const s = String(time);
  return DAY_RE.test(s.slice(0, 10)) ? s.slice(0, 10) : s;
}

export const rowKey = (time: string | number): string => String(time);
export const generationKey = (symbol: string, timeframe: string): string => `${symbol}|${timeframe}`;

export type InspectorRow = {
  /** canonical identity — the bar's own time key */
  key: string;
  time: string | number;
  /** chronological position in THIS publication; ordering and bar counts only, never identity */
  seq: number;
  bar: InspectorBar;
  /** close minus the previous plotted close; null for the first plotted bar */
  change: number | null;
  changePct: number | null;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Rows in chronological order, one per published bar. */
export function buildRows(bars: readonly InspectorBar[]): InspectorRow[] {
  const out: InspectorRow[] = [];
  let prevClose: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const change = prevClose != null && finite(bar.c) ? bar.c - prevClose : null;
    const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
    out.push({ key: rowKey(bar.time), time: bar.time, seq: i, bar, change, changePct });
    prevClose = finite(bar.c) ? bar.c : null;
  }
  return out;
}

export function indexRows(rows: readonly InspectorRow[]): Map<string, number> {
  return new Map(rows.map((r, i) => [r.key, i]));
}

export type SortDir = "desc" | "asc";
/** Presentation order only; identity is unchanged by it. */
export function orderRows(rowsAsc: readonly InspectorRow[], dir: SortDir): readonly InspectorRow[] {
  return dir === "asc" ? rowsAsc : [...rowsAsc].reverse();
}

// ── Selection ─────────────────────────────────────────────────────────────────────────────────

export type Selection = {
  /** symbol|timeframe the keys belong to; a different generation never inherits them */
  readonly generation: string;
  readonly keys: ReadonlySet<string>;
  /** start of a range gesture (Shift+click, Shift+arrow, touch range mode) */
  readonly anchor: string | null;
};

export const emptySelection = (generation: string): Selection => ({ generation, keys: new Set(), anchor: null });

/**
 * Carry a selection onto a new publication of the bars. Keys still present keep their identity even
 * when every row index moved; keys the chart no longer plots (a replay step back, a retired bar) are
 * dropped rather than re-pointed at a neighbour. A new symbol/timeframe starts empty.
 */
export function reconcileSelection(sel: Selection, generation: string, index: ReadonlyMap<string, number>): Selection {
  if (sel.generation !== generation) return emptySelection(generation);
  let dropped = false;
  const keys = new Set<string>();
  for (const k of sel.keys) {
    if (index.has(k)) keys.add(k);
    else dropped = true;
  }
  const anchor = sel.anchor != null && index.has(sel.anchor) ? sel.anchor : null;
  if (!dropped && anchor === sel.anchor) return sel;
  return { generation, keys, anchor };
}

export function toggleKey(sel: Selection, key: string): Selection {
  const keys = new Set(sel.keys);
  if (keys.has(key)) keys.delete(key);
  else keys.add(key);
  return { generation: sel.generation, keys, anchor: key };
}

export type RangeResult = { ok: true; selection: Selection } | { ok: false; count: number };

/**
 * Select every bar between the anchor and `toKey` inclusive, in CHRONOLOGICAL order — the same bars
 * whichever way the table is sorted. Refused (not truncated) above `cap`.
 */
export function selectRange(
  sel: Selection,
  index: ReadonlyMap<string, number>,
  rowsAsc: readonly InspectorRow[],
  toKey: string,
  cap = MAX_SCOPE_ROWS,
): RangeResult {
  const to = index.get(toKey);
  if (to == null) return { ok: true, selection: sel };
  const anchorKey = sel.anchor != null && index.has(sel.anchor) ? sel.anchor : toKey;
  const from = index.get(anchorKey)!;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const count = hi - lo + 1;
  if (count > cap) return { ok: false, count };
  const keys = new Set<string>();
  for (let i = lo; i <= hi; i++) keys.add(rowsAsc[i].key);
  return { ok: true, selection: { generation: sel.generation, keys, anchor: anchorKey } };
}

/** The selected rows, chronological, read from the CURRENT publication (so corrections are current). */
export function selectedRows(rowsAsc: readonly InspectorRow[], sel: Selection): InspectorRow[] {
  if (!sel.keys.size) return [];
  return rowsAsc.filter((r) => sel.keys.has(r.key));
}

// ── Jump ──────────────────────────────────────────────────────────────────────────────────────

/** Parse a typed/picked time in the table's own basis. null = incomplete or not a real instant. */
export function parseJump(text: string, basis: TimeBasis): string | number | null {
  const s = text.trim();
  if (basis.kind === "session") {
    const m = DAY_RE.exec(s.slice(0, 10));
    if (!m || s.length > 10) return null;
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return new Date(ms).toISOString().slice(0, 10) === s ? s : null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = [+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0];
  if (h > 23 || mi > 59 || se > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, se);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms / 1000;
}

export type JumpTarget =
  | { kind: "exact"; key: string }
  /** no bar at that time — the nearest bars on each side are offered, never substituted */
  | { kind: "missing"; before: string | null; after: string | null };

const before = (a: string | number, b: string | number): boolean =>
  typeof a === "number" && typeof b === "number" ? a < b : String(a) < String(b);

export function resolveJump(rowsAsc: readonly InspectorRow[], time: string | number): JumpTarget {
  let lo = 0;
  let hi = rowsAsc.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = rowsAsc[mid].time;
    if (rowKey(t) === rowKey(time)) return { kind: "exact", key: rowsAsc[mid].key };
    if (before(t, time)) lo = mid + 1;
    else hi = mid - 1;
  }
  // lo is the first row after `time`; hi the last row before it.
  return {
    kind: "missing",
    before: hi >= 0 ? rowsAsc[hi].key : null,
    after: lo < rowsAsc.length ? rowsAsc[lo].key : null,
  };
}

// ── Difference ────────────────────────────────────────────────────────────────────────────────

export type DiffUnit = "price" | "volume" | "study";
export type DiffField = {
  id: string;
  tag: string;
  unit: DiffUnit;
  earlier: number | null;
  later: number | null;
  /** later − earlier; null when either side has no value */
  delta: number | null;
  /** percent change for prices and volume only; studies are compared in their own units */
  pct: number | null;
};
export type RowDiff = { earlier: InspectorRow; later: InspectorRow; barsApart: number; fields: DiffField[] };

export const PRICE_FIELDS = [
  ["o", "open"],
  ["h", "high"],
  ["l", "low"],
  ["c", "close"],
] as const;

function field(id: string, tag: string, unit: DiffUnit, a: unknown, b: unknown): DiffField {
  const earlier = finite(a) ? a : null;
  const later = finite(b) ? b : null;
  const delta = earlier != null && later != null ? later - earlier : null;
  const pct = unit !== "study" && delta != null && earlier ? (delta / Math.abs(earlier)) * 100 : null;
  return { id, tag, unit, earlier, later, delta, pct };
}

/** Deterministic two-row difference: always LATER minus EARLIER, whatever order they were picked in. */
export function diffRows(
  x: InspectorRow,
  y: InspectorRow,
  columns: readonly InspectorColumn[],
  valuesAt?: ValuesAt,
): RowDiff {
  const [earlier, later] = x.seq <= y.seq ? [x, y] : [y, x];
  const ve = valuesAt?.(earlier.time) ?? {};
  const vl = valuesAt?.(later.time) ?? {};
  const fields: DiffField[] = [
    ...PRICE_FIELDS.map(([k, id]) => field(id, id, "price", earlier.bar[k], later.bar[k])),
    field("volume", "volume", "volume", earlier.bar.v, later.bar.v),
    ...columns.map((c) => field(c.key, c.tag, "study", ve[c.key], vl[c.key])),
  ];
  return { earlier, later, barsApart: later.seq - earlier.seq, fields };
}

/** Columns the chart actually publishes a value key for, on at least one plotted bar. */
export function publishedColumns(
  rowsAsc: readonly InspectorRow[],
  columns: readonly InspectorColumn[],
  valuesAt?: ValuesAt,
): Set<string> {
  const out = new Set<string>();
  if (!valuesAt || !columns.length) return out;
  for (const r of rowsAsc) {
    const values = valuesAt(r.time);
    if (!values) continue;
    for (const c of columns) if (c.key in values) out.add(c.key);
    if (out.size === columns.length) break;
  }
  return out;
}

// ── CSV ───────────────────────────────────────────────────────────────────────────────────────

/**
 * One text cell. A leading = + - @ TAB or CR makes spreadsheet apps evaluate the cell as a formula,
 * so such text is prefixed with an apostrophe; cells holding a comma, quote or line break are quoted.
 * Numbers never pass through here — they are written by `num()` and cannot carry a formula.
 */
export function csvText(value: string): string {
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const num = (v: unknown): string => (finite(v) ? String(v) : "");
/**
 * One "# key: value" preamble line. It always starts with "#", so it can never be read as a formula
 * and a reader drops the whole preamble with one prefix filter; separators and line breaks inside a
 * value (a symbol, a feed label) are flattened so the line stays a single unquoted cell.
 */
const metaLine = (key: string, value: string): string =>
  `# ${key}: ${value.replace(/[\r\n]+/g, " ").replace(/[",]/g, ";").slice(0, 200)}`;
const timeCell = (time: string | number): string =>
  typeof time === "number" ? num(time) : DAY_RE.test(String(time)) ? String(time) : csvText(String(time));

export type ExportScope = "selected" | "all";
export type ExportMeta = {
  symbol: string;
  timeframe: string;
  basis: TimeBasis;
  /** the header's feed label at export time (LIVE / DELAYED / EOD …); null when unknown */
  feedBasis: string | null;
  replay: boolean;
  scope: ExportScope;
  /** every plotted row in this publication — the denominator of a selected scope */
  plottedRows: number;
  order: SortDir;
  /** newest plotted bar of the publication (the replay cursor under replay) */
  asOf: string | number | null;
  exportedAt: Date;
};

export type CsvResult =
  | { ok: true; csv: string; rows: number; filename: string }
  | { ok: false; reason: "empty" | "too-many"; count: number };

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 64) || "chart";

export function exportFilename(symbol: string, timeframe: string, scope: ExportScope): string {
  return `${safeName(symbol)}_${safeName(timeframe)}${scope === "selected" ? "_selection" : ""}.csv`;
}

/**
 * The export, exactly `rows` (already in the order they should be written) plus a metadata preamble.
 * The file opens with a UTF-8 byte-order mark (so spreadsheet apps read Chinese study names) and a
 * "#" preamble; the first data column is the canonical bar time key, the second its exact label.
 */
export function buildCsv(
  rows: readonly InspectorRow[],
  columns: readonly InspectorColumn[],
  valuesAt: ValuesAt | undefined,
  meta: ExportMeta,
  cap = MAX_SCOPE_ROWS,
): CsvResult {
  if (!rows.length) return { ok: false, reason: "empty", count: 0 };
  if (rows.length > cap) return { ok: false, reason: "too-many", count: rows.length };
  const basisLine = meta.basis.kind === "intraday"
    ? `exchange wall clock in ${meta.basis.zone}; the time column is the chart time key in seconds`
    : "trading session date; no time of day";
  const preamble = [
    ["export", "Mastermind Terminal chart data"],
    ["symbol", meta.symbol],
    ["timeframe", meta.timeframe],
    ["time_basis", basisLine],
    ["source", "bars and study values as plotted on the chart; nothing recomputed"],
    ["feed_basis", meta.feedBasis ?? "unknown"],
    ["as_of", meta.asOf == null ? "unknown" : formatBarTime(meta.asOf, meta.basis)],
    ["replay", meta.replay ? "on; rows end at the replay cursor" : "off"],
    ["scope", meta.scope === "selected" ? `selected rows (${rows.length} of ${meta.plottedRows})` : `all plotted rows (${rows.length})`],
    ["order", meta.order === "desc" ? "newest first" : "oldest first"],
    ["missing_value", "empty cell = no value at this bar"],
    ["exported_at", meta.exportedAt.toISOString()],
  ].map(([k, v]) => metaLine(k, v));
  const header = [
    "time", "time_label", "open", "high", "low", "close", "change", "change_pct", "volume",
    ...columns.map((c) => c.tag),
  ].map(csvText).join(",");
  const lines = [...preamble, header];
  for (const r of rows) {
    const values = valuesAt?.(r.time) ?? {};
    lines.push([
      timeCell(r.time),
      csvText(formatBarTime(r.time, meta.basis)),
      num(r.bar.o), num(r.bar.h), num(r.bar.l), num(r.bar.c),
      num(r.change), num(r.changePct), num(r.bar.v),
      ...columns.map((c) => num(values[c.key])),
    ].join(","));
  }
  return { ok: true, csv: `\uFEFF${lines.join("\n")}`, rows: rows.length, filename: exportFilename(meta.symbol, meta.timeframe, meta.scope) };
}
