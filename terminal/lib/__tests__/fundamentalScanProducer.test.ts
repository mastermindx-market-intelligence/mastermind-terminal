// E02 — the fund.json → fundamental-scan projector (lib/fundamentalScanProducer.ts).
// Independently constructed companies (lib/__tests__/fixtures/fundamentalScan/fundDoc.ts):
// divergent fiscal years, negative earnings, negative equity, sparse statements, non-industrial
// statement families and cross-currency listings. Each expected value is hand-computed.
import { describe, expect, it } from "vitest";
import { FUNDAMENTAL_FIELD_IDS, type FundamentalFieldCell, type FundamentalObserved } from "@/lib/fundamentalScan";
import { projectFundamental } from "@/lib/fundamentalScanProducer";
import { fundDoc, JUNCO_ANNUAL, SEPCO_ANNUAL, type Col } from "./fixtures/fundamentalScan/fundDoc";

const observed = (sym: string, doc: unknown): FundamentalObserved => {
  const { observation } = projectFundamental(sym, doc);
  if (observation.status !== "observed") throw new Error(`expected observed, got ${observation.status}/${observation.reason}`);
  return observation;
};
const cell = (o: FundamentalObserved, field: (typeof FUNDAMENTAL_FIELD_IDS)[number]): FundamentalFieldCell => o.f[field];

describe("projectFundamental — values and periods", () => {
  it("SEPCO (September FY): every field is a hand-checkable function of the latest annual column", () => {
    const o = observed("SEPCO", fundDoc("SEPCO", { pe: 25.5, annual: SEPCO_ANNUAL }));
    expect(o.f).toEqual({
      "fund.pe_ttm": { v: 25.5 },
      "fund.gross_margin_fy": { v: 0.25 },
      "fund.net_margin_fy": { v: 0.15 },
      "fund.roe_fy": { v: 0.2 },
      "fund.revenue_growth_fy": { v: 0.2 },
    });
    expect(o.fy).toEqual({
      label: "2025", end: "2025-09-27", fiscal_year: null, kind: null, fam: "other",
      src: null, filed: null, restated: null,
    });
    expect(o.prior).toEqual({ label: "2024", end: "2024-09-28" });
    expect(o.asof).toBe("2026-10-01");
    expect(o.ccy).toEqual({ quote: "USD", stmt: "USD" });
    expect(o.src).toBe("vendor_x");
  });

  it("JUNCO (June FY): explicit fiscal identity, filing date and restatement flag ride with the values", () => {
    const o = observed("JUNCO", fundDoc("JUNCO", { annual: JUNCO_ANNUAL }));
    expect(o.fy).toEqual({
      label: "FY2025", end: "2025-06-30", fiscal_year: "2025", kind: "full_year", fam: "industrial",
      src: "10-K", filed: "2025-08-19", restated: true,
    });
    expect(o.prior).toEqual({ label: "FY2024", end: "2024-06-30" });
    expect(cell(o, "fund.revenue_growth_fy")).toEqual({ v: -0.1 });
    expect(cell(o, "fund.gross_margin_fy")).toEqual({ v: 0.66 });
    expect(cell(o, "fund.net_margin_fy")).toEqual({ v: 0.1 });
    expect(cell(o, "fund.roe_fy")).toEqual({ v: 0.1 });
  });

  it("two companies both labelled '2025' keep their own period ends (no shared build clock)", () => {
    const a = observed("SEPCO", fundDoc("SEPCO", { annual: SEPCO_ANNUAL }));
    const b = observed("JUNCO", fundDoc("JUNCO", { annual: JUNCO_ANNUAL.map((c) => ({ ...c, label: c.label.slice(2) })) }));
    expect(a.fy?.label).toBe("2025");
    expect(b.fy?.label).toBe("2025");
    expect(a.fy?.end).toBe("2025-09-27");
    expect(b.fy?.end).toBe("2025-06-30");
  });
});

describe("projectFundamental — negative and undefined denominators (AC-E02-03)", () => {
  const LOSS: Col[] = [
    { label: "2024", end: "2024-12-31", revenue: 400, gp: 40, ni: -100, equity: 500 },
    { label: "2025", end: "2025-12-31", revenue: 500, gp: 25, ni: -250, equity: 250 },
  ];

  it("a loss-making company keeps its NEGATIVE margins and ROE — they are real, comparable values", () => {
    const o = observed("LOSSCO", fundDoc("LOSSCO", { pe: null, annual: LOSS }));
    expect(cell(o, "fund.net_margin_fy")).toEqual({ v: -0.5 });
    expect(cell(o, "fund.roe_fy")).toEqual({ v: -1 });
    expect(cell(o, "fund.gross_margin_fy")).toEqual({ v: 0.05 });
    expect(cell(o, "fund.revenue_growth_fy")).toEqual({ v: 0.25 });
  });

  it.each([
    [-12.4, { s: "unavailable", r: "earnings_nonpositive" }],
    [0, { s: "unavailable", r: "earnings_nonpositive" }],
    [null, { s: "unavailable", r: "not_reported" }],
  ])("P/E %s never becomes a cheap multiple", (pe, expected) => {
    const o = observed("LOSSCO", fundDoc("LOSSCO", { pe, annual: LOSS }));
    expect(cell(o, "fund.pe_ttm")).toEqual(expected);
  });

  it("negative equity withholds ROE instead of producing a sign-flipped return", () => {
    const o = observed("BUYBK", fundDoc("BUYBK", {
      annual: [
        { label: "2024", end: "2024-12-31", revenue: 100, gp: 60, ni: 20, equity: -10 },
        { label: "2025", end: "2025-12-31", revenue: 110, gp: 66, ni: 22, equity: -50 },
      ],
    }));
    expect(cell(o, "fund.roe_fy")).toEqual({ s: "unavailable", r: "denominator_nonpositive" });
    expect(cell(o, "fund.net_margin_fy")).toEqual({ v: 0.2 });
  });

  it("zero or negative revenue withholds margins and growth", () => {
    const o = observed("ZERO", fundDoc("ZERO", {
      annual: [
        { label: "2024", end: "2024-12-31", revenue: 0, gp: 0, ni: -5, equity: 50 },
        { label: "2025", end: "2025-12-31", revenue: 0, gp: 0, ni: -5, equity: 45 },
      ],
    }));
    expect(cell(o, "fund.gross_margin_fy")).toEqual({ s: "unavailable", r: "denominator_nonpositive" });
    expect(cell(o, "fund.net_margin_fy")).toEqual({ s: "unavailable", r: "denominator_nonpositive" });
    expect(cell(o, "fund.revenue_growth_fy")).toEqual({ s: "unavailable", r: "denominator_nonpositive" });
    const prior0 = observed("ZERO", fundDoc("ZERO", {
      annual: [
        { label: "2024", end: "2024-12-31", revenue: 0, gp: 0, ni: -5, equity: 50 },
        { label: "2025", end: "2025-12-31", revenue: 80, gp: 30, ni: 5, equity: 55 },
      ],
    }));
    expect(cell(prior0, "fund.revenue_growth_fy")).toEqual({ s: "unavailable", r: "denominator_nonpositive" });
    expect(cell(prior0, "fund.gross_margin_fy")).toEqual({ v: 0.375 });
  });
});

describe("projectFundamental — sparse statements never borrow another period (AC-E02-02)", () => {
  it("a missing latest revenue withholds the ratios; an OLDER year never stands in", () => {
    const o = observed("SPARSE", fundDoc("SPARSE", {
      annual: [
        { label: "2024", end: "2024-12-31", revenue: 100, gp: 40, ni: 10, equity: 80 },
        { label: "2025", end: "2025-12-31", revenue: null, gp: 44, ni: 12, equity: null },
      ],
    }));
    expect(cell(o, "fund.gross_margin_fy")).toEqual({ s: "unavailable", r: "input_missing" });
    expect(cell(o, "fund.net_margin_fy")).toEqual({ s: "unavailable", r: "input_missing" });
    expect(cell(o, "fund.revenue_growth_fy")).toEqual({ s: "unavailable", r: "input_missing" });
    expect(cell(o, "fund.roe_fy")).toEqual({ s: "unavailable", r: "input_missing" });
    expect(o.fy?.end).toBe("2025-12-31");
  });

  it("a misaligned input array is its own explainable state", () => {
    const doc = fundDoc("MISAL", { annual: SEPCO_ANNUAL }) as { statements: { annual: { income: { revenue: number[] } } } };
    doc.statements.annual.income.revenue = [1000, 1200];
    const o = observed("MISAL", doc);
    expect(cell(o, "fund.gross_margin_fy")).toEqual({ s: "unavailable", r: "input_misaligned" });
    expect(cell(o, "fund.net_margin_fy")).toEqual({ s: "unavailable", r: "input_misaligned" });
    expect(cell(o, "fund.roe_fy")).toEqual({ v: 0.2 });
  });

  it("an interim set is never used for a fiscal-year field, even when no annual set exists", () => {
    const quarterly: Col[] = [
      { label: "Q1 2026", end: "2025-12-27", revenue: 400, gp: 200, ni: 100, equity: 950 },
      { label: "Q2 2026", end: "2026-03-28", revenue: 420, gp: 210, ni: 105, equity: 960 },
    ];
    const withAnnual = projectFundamental("SEPCO", fundDoc("SEPCO", { annual: SEPCO_ANNUAL, quarterly }));
    expect((withAnnual.observation as FundamentalObserved).f["fund.gross_margin_fy"]).toEqual({ v: 0.25 });
    expect(withAnnual.inputs?.latestInterimEnd).toBe("2026-03-28");
    const noAnnual = observed("QONLY", fundDoc("QONLY", { annual: null, quarterly }));
    for (const id of FUNDAMENTAL_FIELD_IDS) {
      if (id === "fund.pe_ttm") continue;
      expect(cell(noAnnual, id)).toEqual({ s: "unavailable", r: "no_annual_statements" });
    }
    expect(noAnnual.fy).toBeNull();
    expect(cell(noAnnual, "fund.pe_ttm")).toEqual({ v: 20 });
  });

  it("the TTM vendor snapshot (ratios.current margins/ROE) never substitutes for a fiscal-year value", () => {
    const ratios = { gross_margin: 0.48653, net_margin: 0.27619, roe: 1.48751 };
    const o = observed("SEPCO", fundDoc("SEPCO", { annual: SEPCO_ANNUAL, ratios }));
    expect(cell(o, "fund.gross_margin_fy")).toEqual({ v: 0.25 });
    expect(cell(o, "fund.net_margin_fy")).toEqual({ v: 0.15 });
    expect(cell(o, "fund.roe_fy")).toEqual({ v: 0.2 });
    const none = observed("SEPCO", fundDoc("SEPCO", { annual: null, ratios }));
    expect(cell(none, "fund.gross_margin_fy")).toEqual({ s: "unavailable", r: "no_annual_statements" });
    expect(cell(none, "fund.roe_fy")).toEqual({ s: "unavailable", r: "no_annual_statements" });
  });
});

describe("projectFundamental — period integrity", () => {
  const base = (patch: (cols: Col[]) => Col[]) => fundDoc("PER", { annual: patch(SEPCO_ANNUAL.map((c) => ({ ...c }))) });
  const fyCells = (o: FundamentalObserved) => FUNDAMENTAL_FIELD_IDS.filter((id) => id !== "fund.pe_ttm").map((id) => o.f[id]);

  it("an invalid latest period end withholds every FY field", () => {
    const o = observed("PER", base((c) => { c[2].end = "2025-13-01"; return c; }));
    expect(new Set(fyCells(o).map((x) => JSON.stringify(x)))).toEqual(new Set([JSON.stringify({ s: "unavailable", r: "period_end_missing" })]));
  });

  it("a latest column that is not the newest period end is refused", () => {
    const o = observed("PER", base((c) => { c[0].end = "2026-01-31"; return c; }));
    expect(fyCells(o)[0]).toEqual({ s: "unavailable", r: "period_order_invalid" });
  });

  it("a misaligned period axis is refused", () => {
    const doc = base((c) => c) as { statements: { annual: { period_end: string[] } } };
    doc.statements.annual.period_end = ["2024-09-28", "2025-09-27"];
    expect(fyCells(observed("PER", doc))[0]).toEqual({ s: "unavailable", r: "period_axis_misaligned" });
  });

  it("an annual column whose kind is not a full fiscal year is unsupported, not relabelled", () => {
    const o = observed("PER", base((c) => c.map((x, i) => ({ ...x, kind: i === 2 ? "transition" : "full_year" }))));
    expect(fyCells(o)[0]).toEqual({ s: "unsupported", r: "period_not_annual" });
    expect(o.fy).toBeNull();
  });

  it("a gap year never passes as 'last year' (lag-1 fallback guarded by a 330–400 day window)", () => {
    const o = observed("GAP", fundDoc("GAP", {
      annual: [
        { label: "2022", end: "2022-12-31", revenue: 100, gp: 50, ni: 10, equity: 100 },
        { label: "2024", end: "2024-12-31", revenue: 150, gp: 60, ni: 15, equity: 100 },
      ],
    }));
    expect(cell(o, "fund.revenue_growth_fy")).toEqual({ s: "unavailable", r: "no_comparable_prior" });
    expect(o.prior).toBeNull();
    expect(cell(o, "fund.gross_margin_fy")).toEqual({ v: 0.4 });
  });

  it("a fiscal-year-end transition (short gap) is not a comparable prior", () => {
    const o = observed("TRANS", fundDoc("TRANS", {
      annual: [
        { label: "FY Jun-2024", end: "2024-06-30", revenue: 100, gp: 50, ni: 10, equity: 100 },
        { label: "FY Dec-2024", end: "2024-12-31", revenue: 60, gp: 30, ni: 6, equity: 100 },
      ],
    }));
    expect(cell(o, "fund.revenue_growth_fy")).toEqual({ s: "unavailable", r: "no_comparable_prior" });
  });

  it("a single fiscal year has no comparable prior", () => {
    const o = observed("ONE", fundDoc("ONE", { annual: [SEPCO_ANNUAL[2]] }));
    expect(cell(o, "fund.revenue_growth_fy")).toEqual({ s: "unavailable", r: "no_comparable_prior" });
    expect(cell(o, "fund.net_margin_fy")).toEqual({ v: 0.15 });
  });
});

describe("projectFundamental — statement families never borrow industrial ratios", () => {
  const BANK: Col[] = [
    { label: "2024", end: "2024-12-31", revenue: 160, ni: 50, equity: 300 },
    { label: "2025", end: "2025-12-31", revenue: 170, ni: 54, equity: 360 },
  ];

  it("a bank: margins and revenue growth are withheld; ROE is family-neutral", () => {
    const o = observed("BANKCO", fundDoc("BANKCO", { family: "bank", annual: BANK }));
    expect(cell(o, "fund.gross_margin_fy")).toEqual({ s: "unsupported", r: "family_not_applicable" });
    expect(cell(o, "fund.net_margin_fy")).toEqual({ s: "unsupported", r: "family_not_applicable" });
    expect(cell(o, "fund.revenue_growth_fy")).toEqual({ s: "unsupported", r: "family_not_applicable" });
    expect(cell(o, "fund.roe_fy")).toEqual({ v: 0.15 });
    expect(o.fy?.fam).toBe("bank");
  });

  it.each(["Financial Services", "Financials"])("legacy fallback: sector %s with no industrial structure → financial_services", (sector) => {
    const o = observed("LEGFIN", fundDoc("LEGFIN", { sector, annual: BANK }));
    expect(o.fy?.fam).toBe("financial_services");
    expect(cell(o, "fund.net_margin_fy")).toEqual({ s: "unsupported", r: "family_not_applicable" });
  });

  it("no taxonomy and no industrial structure (no COGS, no gross profit) → family_unverified", () => {
    const o = observed("UNVER", fundDoc("UNVER", { sector: "Technology", annual: BANK }));
    expect(o.fy?.fam).toBe("other");
    expect(cell(o, "fund.gross_margin_fy")).toEqual({ s: "unsupported", r: "family_unverified" });
    expect(cell(o, "fund.revenue_growth_fy")).toEqual({ s: "unsupported", r: "family_unverified" });
    expect(cell(o, "fund.roe_fy")).toEqual({ v: 0.15 });
  });

  it("an ambiguous family withholds margins, growth AND ROE", () => {
    const o = observed("AMB", fundDoc("AMB", { family: "ambiguous", annual: SEPCO_ANNUAL }));
    for (const id of ["fund.gross_margin_fy", "fund.net_margin_fy", "fund.revenue_growth_fy", "fund.roe_fy"] as const) {
      expect(cell(o, id)).toEqual({ s: "unsupported", r: "family_ambiguous" });
    }
  });

  it("an unknown family label is unverified, never treated as industrial", () => {
    const o = observed("ODD", fundDoc("ODD", { family: "reit", annual: SEPCO_ANNUAL }));
    expect(cell(o, "fund.net_margin_fy")).toEqual({ s: "unsupported", r: "family_unverified" });
    expect(cell(o, "fund.roe_fy")).toEqual({ s: "unsupported", r: "family_unverified" });
  });

  it("growth against a prior year of a different family is family_changed; the margins stand", () => {
    const cols = SEPCO_ANNUAL.map((c, i) => ({ ...c, fam: i === 2 ? "industrial" : "financial_services" }));
    const o = observed("CHG", fundDoc("CHG", { annual: cols }));
    expect(cell(o, "fund.revenue_growth_fy")).toEqual({ s: "unsupported", r: "family_changed" });
    expect(cell(o, "fund.gross_margin_fy")).toEqual({ v: 0.25 });
  });
});

describe("projectFundamental — cross-market bases (E02 falsifier)", () => {
  // HK/CN vendor `ratios.current` margins and ROE are PERCENT-FORM (56.7 = 56.7%). A projector that
  // read them would publish 56.7 (a 5,670% margin) or, rescaled, a TTM number standing in for a
  // fiscal-year one. The fiscal-year value must be the statements' own fraction — or withheld.
  const HK_ANNUAL: Col[] = [
    { label: "2024", end: "2024-12-31", revenue: 660, gp: 350, ni: 190, equity: 1000, kind: "full_year", fiscalYear: "2024", periodNumber: 4, fam: "industrial" },
    { label: "2025", end: "2025-12-31", revenue: 750, gp: 420, ni: 225, equity: 1100, kind: "full_year", fiscalYear: "2025", periodNumber: 4, fam: "industrial" },
  ];
  const PERCENT_FORM = { gross_margin: 56.7, net_margin: 29.87, roe: 19.91 };

  it("HK listing, CNY statements: margins from statements (fractions); P/E and ROE withheld", () => {
    const o = observed("0700.HK", fundDoc("0700.HK", { quote: "HKD", stmt: "CNY", pe: 14.48, annual: HK_ANNUAL, ratios: PERCENT_FORM }));
    expect(cell(o, "fund.gross_margin_fy")).toEqual({ v: 0.56 });
    expect(cell(o, "fund.net_margin_fy")).toEqual({ v: 0.3 });
    expect(cell(o, "fund.revenue_growth_fy")).toEqual({ v: 0.136364 });
    expect(cell(o, "fund.pe_ttm")).toEqual({ s: "unsupported", r: "currency_basis_unverified" });
    expect(cell(o, "fund.roe_fy")).toEqual({ s: "unsupported", r: "equity_basis_unverified" });
    for (const id of FUNDAMENTAL_FIELD_IDS) {
      const c = cell(o, id);
      if ("v" in c) expect(Math.abs(c.v)).toBeLessThan(5);
    }
  });

  it("HK listing with no annual statements withholds — it never falls back to percent-form ratios", () => {
    const o = observed("0005.HK", fundDoc("0005.HK", { quote: "HKD", stmt: "HKD", pe: 9.1, annual: null, ratios: PERCENT_FORM }));
    expect(cell(o, "fund.gross_margin_fy")).toEqual({ s: "unavailable", r: "no_annual_statements" });
    expect(cell(o, "fund.net_margin_fy")).toEqual({ s: "unavailable", r: "no_annual_statements" });
    expect(cell(o, "fund.roe_fy")).toEqual({ s: "unavailable", r: "no_annual_statements" });
    expect(cell(o, "fund.pe_ttm")).toEqual({ v: 9.1 });
  });

  it("CN listing: P/E is withheld even in matching currencies (the emitter may fall back to LYR)", () => {
    const o = observed("600519.SS", fundDoc("600519.SS", { quote: "CNY", stmt: "CNY", pe: 21.3, annual: HK_ANNUAL, ratios: PERCENT_FORM }));
    expect(cell(o, "fund.pe_ttm")).toEqual({ s: "unsupported", r: "pe_basis_unverified" });
    expect(cell(o, "fund.roe_fy")).toEqual({ s: "unsupported", r: "equity_basis_unverified" });
    expect(cell(o, "fund.net_margin_fy")).toEqual({ v: 0.3 });
  });

  it.each([
    ["USD", null],
    [null, "USD"],
    ["USD", "EUR"],
  ])("US-style listing, quote %s / statements %s: P/E basis unproven → withheld", (quote, stmt) => {
    const o = observed("ADRX", fundDoc("ADRX", { quote, stmt, pe: 11, annual: SEPCO_ANNUAL }));
    expect(cell(o, "fund.pe_ttm")).toEqual({ s: "unsupported", r: "currency_basis_unverified" });
    expect(cell(o, "fund.net_margin_fy")).toEqual({ v: 0.15 });
  });
});

describe("projectFundamental — malformed documents", () => {
  it.each([
    ["not an object", null],
    ["an array", []],
    ["wrong schema", { ...fundDoc("SEPCO", { annual: SEPCO_ANNUAL }), schema: "other/v1" }],
    ["ticker mismatch", fundDoc("OTHER", { annual: SEPCO_ANNUAL })],
    ["invalid asof", { ...fundDoc("SEPCO", { annual: SEPCO_ANNUAL }), asof: "2026-02-30" }],
  ])("%s → unavailable/fund_malformed, never throws", (_label, doc) => {
    expect(projectFundamental("SEPCO", doc)).toEqual({ observation: { status: "unavailable", reason: "fund_malformed" }, inputs: null });
  });

  it("an income block that is not an object is treated as no annual set, not a crash", () => {
    const doc = fundDoc("SEPCO", { annual: SEPCO_ANNUAL }) as { statements: { annual: Record<string, unknown> } };
    doc.statements.annual.income = "n/a";
    const o = observed("SEPCO", doc);
    expect(cell(o, "fund.net_margin_fy")).toEqual({ s: "unavailable", r: "no_annual_statements" });
  });
});

describe("projectFundamental — input trace for the evidence panel", () => {
  it("names the exact column and raw inputs each value was computed from", () => {
    const { inputs } = projectFundamental("SEPCO", fundDoc("SEPCO", { pe: 25.5, annual: SEPCO_ANNUAL }));
    expect(inputs).toEqual({
      market: "us", index: 2, priorIndex: 1,
      revenue: 1200, grossProfit: 300, netIncome: 180, equity: 900, priorRevenue: 1000,
      peTtm: 25.5, latestInterimEnd: null,
    });
  });
});
