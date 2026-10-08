import { isMatrixDocForRoot } from "@/components/gexdesk/matrixDoc";

export type ResearchMetric = "volume" | "openInterest" | "deltaOi";
export type ResearchRow = {
  /** A source coordinate, NOT an exchange-qualified instrument ID. */
  key: string; root: string; expiry: string; strike: number; side: "call" | "put";
  volume: number | null; openInterest: number | null; deltaOi: number | null;
};
export type ResearchSelection = { selected: string | null; comparisons: string[] };
export type ResearchMatrix = {
  status: "available" | "unavailable"; root: string; rows: ResearchRow[];
  exposures: { strike: number; expiry: string; netGexDollars: number | null }[];
  session: string | null; builtAt: string | null; oiSession: null; availableAt: null; spot: number | null;
  excluded: { duplicate: number; invalidIdentity: number; invalidMetric: number };
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

/** Pure consumer of the admitted matrix contract. Missing metadata is never imputed. */
export function adaptResearchMatrix(raw: unknown, expectedRoot: string): ResearchMatrix {
  const root = expectedRoot.trim().toUpperCase();
  const result: ResearchMatrix = { status: "unavailable", root, rows: [], exposures: [], session: null,
    builtAt: null, oiSession: null, availableAt: null, spot: null,
    excluded: { duplicate: 0, invalidIdentity: 0, invalidMetric: 0 } };
  if (!isMatrixDocForRoot(raw, root)) return result;
  result.status = "available";
  result.session = date(raw._build_meta?.asof_date) ? raw._build_meta.asof_date : null;
  result.builtAt = typeof raw.asof === "string" && Number.isFinite(Date.parse(raw.asof)) ? raw.asof : null;
  result.spot = finite(raw.spot) && raw.spot > 0 ? raw.spot : null;
  const cells = (raw.cells as unknown[]).filter((c): c is Record<string, unknown> => {
    if (object(c) && finite(c.strike) && c.strike > 0 && date(c.expiry)) return true;
    result.excluded.invalidIdentity++; return false;
  });
  const identity = (c: Record<string, unknown>) => `${c.expiry}|${c.strike}`;
  const counts = new Map<string, number>();
  for (const c of cells) counts.set(identity(c), (counts.get(identity(c)) ?? 0) + 1);
  const quantity = (v: unknown, signed = false): number | null => {
    if (v == null) return null;
    if (finite(v) && (signed || v >= 0)) return v;
    result.excluded.invalidMetric++; return null;
  };
  for (const c of cells) {
    if (counts.get(identity(c))! > 1) { result.excluded.duplicate++; continue; }
    const expiry = c.expiry as string, strike = c.strike as number;
    result.exposures.push({ expiry, strike, netGexDollars: quantity(c.gex, true) });
    for (const side of ["call", "put"] as const) {
      result.rows.push({ key: `${root}|${expiry}|${side}|${strike}`, root, expiry, strike, side,
        volume: quantity(c[`${side}_vol`]), openInterest: quantity(c[`${side}_oi`]),
        deltaOi: quantity(object(c.delta_oi) ? c.delta_oi[side] : null, true) });
    }
  }
  result.rows.sort((a,b) => a.expiry.localeCompare(b.expiry) || a.strike-b.strike || a.side.localeCompare(b.side));
  return result;
}
export function filterResearchRows(rows: ResearchRow[], filter: { side: "all" | "call" | "put"; expiry: string }) {
  return rows.filter(r => (filter.side === "all" || r.side === filter.side) && (filter.expiry === "all" || r.expiry === filter.expiry));
}
export function reconcileResearchSelection(selection: ResearchSelection, rows: ResearchRow[]): ResearchSelection {
  const valid = new Set(rows.map(r => r.key));
  return { selected: selection.selected && valid.has(selection.selected) ? selection.selected : null,
    comparisons: selection.comparisons.filter(k => valid.has(k)).slice(0, 3) };
}
export function toggleComparison(keys: string[], key: string): string[] {
  return keys.includes(key) ? keys.filter(k => k !== key) : keys.length < 3 ? [...keys, key] : keys;
}
export type ResearchMark = { key: string; strike: number; expiry: string; side: "call" | "put"; value: number };
export type ResearchDomain = { minStrike: number; maxStrike: number; maxValue: number; expiries: string[] };
/** Full admitted snapshot owns the axes. Filtering never silently rescales comparisons. */
export function buildResearchDomain(rows: ResearchRow[], metric: ResearchMetric): ResearchDomain {
  let minStrike = Infinity, maxStrike = -Infinity, maxValue = 0;
  for (const row of rows) {
    minStrike = Math.min(minStrike, row.strike); maxStrike = Math.max(maxStrike, row.strike);
    maxValue = Math.max(maxValue, Math.abs(row[metric] ?? 0));
  }
  return { minStrike: rows.length ? minStrike : 0, maxStrike: rows.length ? maxStrike : 0,
    maxValue, expiries: [...new Set(rows.map(r => r.expiry))].sort() };
}
export function buildResearchMarks(rows: ResearchRow[], metric: ResearchMetric): ResearchMark[] {
  return rows.flatMap(r => {
    const value = r[metric];
    return value == null || value === 0 ? [] : [{ key: r.key, strike: r.strike, expiry: r.expiry, side: r.side, value }];
  });
}
/** Strictly one conversion for a percent-valued producer; a ratio is not accepted here. */
export function ivPercentToRatio(value: unknown, unit: "percent"): number | null {
  return unit === "percent" && finite(value) && value >= 0 ? value / 100 : null;
}
