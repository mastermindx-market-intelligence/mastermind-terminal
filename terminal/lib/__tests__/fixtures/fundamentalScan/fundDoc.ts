// Independently constructed `mastermind.fund/v1` documents for the E02 fundamental-scan tests.
// Every company here is synthetic: its numbers are chosen so each expected ratio can be checked
// by hand (no production artifact is copied), and only the keys the projector may read — plus
// the TTM `ratios.current` decoys it must NEVER read — are populated.

export type Col = {
  label: string;
  end: string | null;
  revenue?: number | null;
  cogs?: number | null;
  gp?: number | null;
  ni?: number | null;
  equity?: number | null;
  kind?: string;
  fiscalYear?: string;
  periodNumber?: number;
  fam?: string;
  src?: string;
  filed?: string | null;
  restated?: boolean;
};

export type DocOpts = {
  asof?: string;
  quote?: string | null;
  stmt?: string | null;
  pe?: number | null;
  sector?: string;
  /** statements.annual.source_family (producer taxonomy). */
  family?: string;
  annual?: Col[] | null;
  quarterly?: Col[] | null;
  /** Extra ratios.current keys (TTM vendor snapshot — decoys the projector must ignore). */
  ratios?: Record<string, unknown>;
  srcStatements?: string;
};

const pick = <K extends keyof Col>(cols: Col[], k: K) =>
  cols.some((c) => c[k] !== undefined) ? cols.map((c) => (c[k] === undefined ? null : c[k])) : undefined;

export function periodSet(cols: Col[], family?: string): Record<string, unknown> {
  const set: Record<string, unknown> = {
    periods: cols.map((c) => c.label),
    period_end: cols.map((c) => c.end),
    income: {
      revenue: cols.map((c) => c.revenue ?? null),
      net_income: cols.map((c) => c.ni ?? null),
      ...(pick(cols, "cogs") ? { cogs: pick(cols, "cogs") } : {}),
      ...(pick(cols, "gp") ? { gross_profit: pick(cols, "gp") } : {}),
    },
    balance: { equity: cols.map((c) => c.equity ?? null) },
  };
  const opt: [string, keyof Col][] = [
    ["period_kind", "kind"],
    ["fiscal_year", "fiscalYear"],
    ["period_number", "periodNumber"],
    ["source_family_by_period", "fam"],
    ["src_by_period", "src"],
    ["filed_by_period", "filed"],
    ["restated_by_period", "restated"],
  ];
  for (const [key, col] of opt) {
    const arr = pick(cols, col);
    if (arr) set[key] = arr;
  }
  if (family) set.source_family = family;
  return set;
}

export function fundDoc(sym: string, o: DocOpts = {}): Record<string, unknown> {
  return {
    schema: "mastermind.fund/v1",
    ticker: sym,
    asof: o.asof ?? "2026-10-01",
    quote_currency: o.quote === undefined ? "USD" : o.quote,
    stmt_currency: o.stmt === undefined ? "USD" : o.stmt,
    src: { statements: o.srcStatements ?? "vendor_x" },
    profile: { sector: o.sector ?? "Technology" },
    ratios: { current: { pe_ttm: o.pe === undefined ? 20 : o.pe, ...(o.ratios ?? {}) } },
    statements: {
      annual: o.annual === null ? null : periodSet(o.annual ?? [], o.family),
      quarterly: o.quarterly ? periodSet(o.quarterly) : null,
    },
  };
}

/** SEPCO — September fiscal year (52/53-week ends), USD, industrial. Hand-checkable:
 *  FY2025 revenue 1200, gross profit 300 (25%), net income 180 (15%), equity 900 (20%),
 *  FY2024 revenue 1000 → growth 20%. P/E 25.5. */
export const SEPCO_ANNUAL: Col[] = [
  { label: "2023", end: "2023-09-30", revenue: 900, cogs: 650, gp: 250, ni: 120, equity: 800 },
  { label: "2024", end: "2024-09-28", revenue: 1000, cogs: 720, gp: 280, ni: 150, equity: 850 },
  { label: "2025", end: "2025-09-27", revenue: 1200, cogs: 900, gp: 300, ni: 180, equity: 900 },
];

/** JUNCO — June fiscal year with explicit fiscal identity and filing metadata. */
export const JUNCO_ANNUAL: Col[] = [
  {
    label: "FY2024", end: "2024-06-30", revenue: 500, gp: 350, ni: 100, equity: 400,
    kind: "full_year", fiscalYear: "2024", periodNumber: 0, fam: "industrial", src: "10-K", filed: "2024-08-20", restated: false,
  },
  {
    label: "FY2025", end: "2025-06-30", revenue: 450, gp: 297, ni: 45, equity: 450,
    kind: "full_year", fiscalYear: "2025", periodNumber: 0, fam: "industrial", src: "10-K", filed: "2025-08-19", restated: true,
  },
];
