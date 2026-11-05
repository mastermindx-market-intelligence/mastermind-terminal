import { describe, expect, it } from "vitest";
import {
  REGIONAL_SNAPSHOT_EXCLUDED_FIELDS,
  isRegionalListingSymbol,
  selectRegionalCompanySnapshot,
} from "@/lib/regionalCompanySnapshot";
import type { Fund, StatementPeriodSet } from "@/lib/fund";

/**
 * Every fixture is built to the frozen `mastermind.fund/v1` shape and carries ONLY fields the
 * real artifacts carry. Nothing here is a partial cast that would let a missing key read as a
 * real value — the point of these tests is that an absent field renders as absent.
 */
function annual(over: Partial<StatementPeriodSet> = {}): StatementPeriodSet {
  return {
    periods: ["FY2024", "FY2025"],
    period_end: ["2024-12-31", "2025-12-31"],
    fiscal_year: ["2024", "2025"],
    period_kind: ["full_year", "full_year"],
    period_number: [null, null],
    reporting_cadence: "annual",
    income: {
      revenue: [100, 120], cogs: [60, 70], gross_profit: [40, 50], opex: [20, 22],
      op_income: [20, 28], nonop_income: [0, 0], pretax_income: [20, 28], taxes: [4, 6],
      net_income: [16, 22], eps_basic: [1, 1.4], eps_diluted: [1, 1.4], ebitda: [24, 33],
    },
    balance: {
      assets: [500, 560], assets_st: [200, 220], assets_lt: [300, 340], liabilities: [300, 320],
      liab_st: [120, 130], liab_lt: [180, 190], equity: [200, 240], debt: [80, 75],
      cash: [60, 90], net_debt: [20, -15],
    },
    cashflow: { cfo: [18, 25], cfi: [-5, -6], cff: [0, 0], capex: [-5, -6], fcf: [13, 19] },
    ...over,
  };
}

function fund(over: Partial<Fund> = {}): Fund {
  return {
    schema: "mastermind.fund/v1",
    ticker: "0700.HK",
    asof: "2026-10-20",
    quote_currency: "HKD",
    stmt_currency: "HKD",
    src: { statements: "akshare", estimates: "yfinance", dividends: "yfinance" },
    profile: {
      website: "https://www.tencent.com", employees: null,
      sector: "Communication Services", industry: "Internet Content",
      description: "Internet and value-added services provider.", founded: null, hq: "Shenzhen",
    },
    stats: {
      mktcap: null, shares_out: null, float_shares: null, inst_pct: null,
      insider_pct: null, beta: null, num_holders: null,
    },
    statements: { annual: annual(), quarterly: null },
    ratios: {
      periods: [], pe: [], ps: [], pb: [], pcf: [], ev: [], ev_ebitda: [],
      current: {
        pe_ttm: null, pe_fwd: null, ps: null, pb: null, ev_ebitda: null, ev_sales: null,
        ev_ebit: null, p_fcf: null, div_yield: null, payout: null, gross_margin: null,
        net_margin: null, roe: null, roa: null, debt_to_equity: null, current_ratio: null,
      },
    },
    earnings: { next_date: null, next_period: null, next_eps_est: null, next_rev_est: null, q: [], fy: [] },
    estimates: null,
    analyst: null,
    dividends: { never_paid: false, yield_ttm: null, payout_ratio: null, events: [], splits: [] },
    ownership: { free_float_pct: null, closely_held_pct: null, top_inst: [] },
    guidance: null,
    segments: null,
    ...over,
  } as Fund;
}

const snap = (f: Fund, sym = f.ticker, zh = false) =>
  selectRegionalCompanySnapshot({ sym, fund: f, zh });

describe("regional listing scope", () => {
  it("covers exactly the CN / HK / Canada suffixes this surface composes for", () => {
    for (const sym of ["0700.HK", "600519.SS", "000001.SZ", "430047.BJ", "SHOP.TO", "RY.TO"])
      expect(isRegionalListingSymbol(sym)).toBe(true);
  });

  it("leaves every other symbol to the incumbent event view", () => {
    // `.NE` is a Canada suffix markets.ts routes, but it is NOT in this surface's scope.
    for (const sym of ["AAPL", "MSFT", "SHOP.NE", "MC.PA", "7203.T", "BTC-USD", "", "VOD.L"])
      expect(isRegionalListingSymbol(sym)).toBe(false);
  });
});

describe("exact identity", () => {
  it("refuses a fund belonging to another ticker — the previous symbol's file is not this one", () => {
    // A ticker transition where the fetch resolves late: 0700's file under 0005.SZ.
    expect(snap(fund(), "0005.SZ")).toBeNull();
  });

  it("refuses no fund at all", () => {
    expect(selectRegionalCompanySnapshot({ sym: "0700.HK", fund: null })).toBeNull();
  });

  it("accepts the exact match regardless of the symbol's case or padding", () => {
    expect(snap(fund(), " 0700.hk ")).not.toBeNull();
  });
});

describe("Canada: CAD quote with USD statements stays USD", () => {
  const ca = fund({
    ticker: "SHOP.TO", quote_currency: "CAD", stmt_currency: "USD",
    profile: { website: null, employees: null, sector: "Consumer Cyclical", industry: "Internet Retail", description: "Commerce platform.", founded: null, hq: "Ottawa" },
  });

  it("reports the statement currency and never the trading currency", () => {
    const s = snap(ca)!;
    expect(s.stmtCurrency).toBe("USD");
    expect(s.quoteCurrency).toBe("CAD");
    expect(s.stmtCurrency).not.toBe(s.quoteCurrency);
  });

  it("does not scale or convert a statement figure by the quote currency", () => {
    const s = snap(ca)!;
    // Revenue is 120 in the ARTIFACT's own unit; a CAD-quoted listing does not restate it.
    expect(s.annual!.metrics.find((m) => m.id === "revenue")!.value).toBe(120);
  });
});

describe("Hong Kong: semiannual interims and a non-December fiscal year", () => {
  const hk = fund({
    statements: {
      annual: annual({
        // A 31 March fiscal year end — the period end must survive verbatim, never "corrected"
        // to December, and the annual figures must never be relabelled as a calendar year.
        periods: ["FY2024", "FY2025"], period_end: ["2024-03-31", "2025-03-31"],
        fiscal_year: ["2024", "2025"],
      }),
      quarterly: {
        periods: ["H1 2025", "H2 2025"], period_end: ["2024-09-30", "2025-03-31"],
        fiscal_year: ["2025", "2026"], period_kind: ["half_year", "half_year"],
        period_number: [1, 2], reporting_cadence: "semiannual",
        income: {
          revenue: [50, 60], cogs: [25, 30], gross_profit: [25, 30], opex: [10, 12],
          op_income: [15, 18], nonop_income: [0, 0], pretax_income: [15, 18], taxes: [3, 4],
          net_income: [12, 14], eps_basic: [0.7, 0.8], eps_diluted: [0.7, 0.8], ebitda: [18, 21],
        },
        balance: {
          assets: [500, 560], assets_st: [200, 220], assets_lt: [300, 340], liabilities: [300, 320],
          liab_st: [120, 130], liab_lt: [180, 190], equity: [200, 240], debt: [80, 75],
          cash: [60, 90], net_debt: [20, -15],
        },
        cashflow: { cfo: [9, 12], cfi: [-5, -6], cff: [0, 0], capex: [-5, -6], fcf: [4, 6] },
      },
    },
  });

  it("keeps the reported interim period end visible", () => {
    const s = snap(hk)!;
    expect(s.annual!.periodEnd).toBe("2025-03-31");
    expect(s.interim!.periodEnd).toBe("2025-03-31");
  });

  it("uses the artifact's own cadence rather than forcing a quarterly label", () => {
    expect(snap(hk)!.interim!.cadenceLabel).toBe("Semiannual");
    expect(snap(hk, hk.ticker, true)!.interim!.cadenceLabel).toBe("半年度");
  });

  it("shows interim coverage only and never synthesizes interim figures", () => {
    const s = snap(hk)!;
    // The metrics belong to the ANNUAL column. Nothing from the H1/H2 ladder reaches them.
    const revenue = s.annual!.metrics.find((m) => m.id === "revenue")!;
    expect(revenue.value).toBe(120);
    expect(snap(hk)!.annual!.periodLabel).toBe("FY2025");
  });

  it("does not subtract EPS across a cumulative ladder to invent a quarter", () => {
    const s = snap(hk)!;
    expect(s.annual!.metrics.some((m) => m.id === "revenue" && m.value === 10)).toBe(false);
  });
});

describe("mainland China: an old period stays visible and freshness is never fabricated", () => {
  const cn = fund({
    ticker: "600519.SS", asof: "2026-01-05", quote_currency: "CNY", stmt_currency: "CNY",
    profile: { website: null, employees: null, sector: "Consumer Staples", industry: "Beverages", description: "Baijiu producer.", founded: null, hq: "Kaili" },
    statements: {
      annual: annual({ periods: ["FY2023", "FY2024"], period_end: ["2023-12-31", "2024-12-31"], fiscal_year: ["2023", "2024"] }),
      quarterly: null,
    },
  });

  it("displays the old period instead of hiding it", () => {
    expect(snap(cn)!.annual!.periodEnd).toBe("2024-12-31");
  });

  it("labels the artifact date as generated, and never as fresh or updated today", () => {
    const s = snap(cn)!;
    expect(s.artifactGenerated).toBe("2026-01-05");
    expect(s.sourceRetrieval).toBeNull();
    expect(Object.keys(s)).not.toContain("fresh");
    expect(Object.keys(s)).not.toContain("freshness");
  });
});

describe("annual year-over-year: only where it is genuinely supported", () => {
  const metric = (s: ReturnType<typeof snap>, id: string) =>
    s!.annual!.metrics.find((m) => m.id === id)!;

  it("computes the change against the comparable prior fiscal period", () => {
    // FY2025 revenue 120 against FY2024 revenue 100.
    expect(metric(snap(fund()), "revenue").yoyPct).toBeCloseTo(20, 6);
  });

  it("emits no delta for the first column, which has no prior", () => {
    const single = fund({ statements: { annual: annual({ periods: ["FY2025"], period_end: ["2025-12-31"], fiscal_year: ["2025"] }), quarterly: null } });
    expect(metric(snap(single), "revenue").yoyPct).toBeNull();
  });

  it("emits no delta when the prior value is missing", () => {
    const gapped = fund({
      statements: {
        annual: annual({
          income: { ...annual().income, net_income: [null, 22] },
        }), quarterly: null,
      },
    });
    expect(metric(snap(gapped), "net_income").yoyPct).toBeNull();
    expect(metric(snap(gapped), "revenue").yoyPct).toBeCloseTo(20, 6);
  });

  it("emits no delta when the prior value is zero — division is undefined, not infinite", () => {
    const zeroBase = fund({
      statements: { annual: annual({ income: { ...annual().income, net_income: [0, 22] } }), quarterly: null },
    });
    const net = metric(snap(zeroBase), "net_income");
    expect(net.yoyPct).toBeNull();
    expect(Number.isFinite(net.yoyPct as number)).toBe(false);
  });

  it("emits no delta when a prior value is non-finite", () => {
    const nonFinite = fund({
      statements: { annual: annual({ income: { ...annual().income, net_income: [Number.NaN, 22] } }), quarterly: null },
    });
    expect(metric(snap(nonFinite), "net_income").yoyPct).toBeNull();
  });

  it("emits no delta when the fiscal identity is ambiguous", () => {
    // Two FY2025 observations with the same canonical identity: the comparable column is not
    // uniquely determined, so choosing one would make YoY depend on array order.
    const ambiguous = fund({
      statements: {
        annual: annual({
          periods: ["FY2024", "FY2025", "FY2025"],
          period_end: ["2024-12-31", "2025-06-30", "2025-12-31"],
          fiscal_year: ["2024", "2025", "2025"],
        }), quarterly: null,
      },
    });
    expect(metric(snap(ambiguous), "revenue").yoyPct).toBeNull();
  });

  it("emits no delta at all when the statement currency is unknown", () => {
    const unknownCurrency = fund({ stmt_currency: null });
    const s = snap(unknownCurrency)!;
    for (const m of s.annual!.metrics) expect(m.yoyPct).toBeNull();
    // The figures themselves still show — a currency label is missing, not the data.
    expect(metric(s, "revenue").value).toBe(120);
    expect(s.sections.performance.state).toBe("unknown_freshness");
  });

  it("keeps a negative prior comparable rather than treating it as a gap", () => {
    const lossToProfit = fund({
      statements: { annual: annual({ income: { ...annual().income, net_income: [-10, 10] } }), quarterly: null },
    });
    // (−10 → 10) on an absolute-value denominator is +200%.
    expect(metric(snap(lossToProfit), "net_income").yoyPct).toBeCloseTo(200, 6);
  });
});

describe("bank statement family", () => {
  const bank = fund({
    statements: {
      annual: annual({
        source_family: "bank",
        income: { ...annual().income, revenue: [4000, 4400] },
      }),
      quarterly: null,
    },
  });

  it("labels the top line as operating income, never as revenue", () => {
    const s = snap(bank)!;
    const revenue = s.annual!.metrics.find((m) => m.id === "revenue")!;
    expect(revenue.label).toBe("Total operating income");
    expect(snap(bank, bank.ticker, true)!.annual!.metrics.find((m) => m.id === "revenue")!.label).toBe("经营收入总额");
  });

  it("keeps the family's own top-line figure", () => {
    expect(snap(bank)!.annual!.metrics.find((m) => m.id === "revenue")!.value).toBe(4400);
  });

  it("labels an industrial artifact as revenue", () => {
    expect(snap(fund())!.annual!.metrics.find((m) => m.id === "revenue")!.label).toBe("Revenue");
  });
});

describe("missing values and sources", () => {
  it("renders a missing metric as absent rather than zero", () => {
    const noCash = fund({
      statements: { annual: annual({ balance: { ...annual().balance, cash: [null, null] } }), quarterly: null },
    });
    const cash = snap(noCash)!.annual!.metrics.find((m) => m.id === "cash")!;
    expect(cash.value).toBeNull();
    // A null is not a zero, and it is not silently absent from the row set either.
    expect(cash.value).not.toBe(0);
    expect(snap(noCash)!.annual!.metrics).toHaveLength(5);
  });

  it("marks the performance section partial when a figure is absent", () => {
    const noCash = fund({
      statements: { annual: annual({ balance: { ...annual().balance, cash: [null, null] } }), quarterly: null },
    });
    expect(snap(noCash)!.sections.performance.state).toBe("partial");
    expect(snap(noCash)!.sections.performance.reasons).toContain("metric_missing");
  });

  it("reports performance unavailable when the artifact carries no annual transport", () => {
    const none = fund({ statements: { annual: null, quarterly: null } });
    const s = snap(none)!;
    expect(s.annual).toBeNull();
    expect(s.sections.performance.state).toBe("unavailable");
    expect(s.sections.performance.reasons).toContain("no_valid_annual_period");
  });

  it("drops an artifact with no dated annual period rather than inventing one", () => {
    const undated = fund({ statements: { annual: annual({ period_end: ["", ""] }), quarterly: null } });
    expect(snap(undated)!.annual).toBeNull();
  });

  it("reports business unavailable when the profile is empty, and available when complete", () => {
    const empty = fund({ profile: { website: null, employees: null, sector: null, industry: null, description: null, founded: null, hq: null } });
    expect(snap(empty)!.sections.business.state).toBe("unavailable");
    expect(snap(fund())!.sections.business.state).toBe("unknown_freshness");
  });

  it("keeps only an http(s) company website", () => {
    const bad = fund({ profile: { ...fund().profile, website: "javascript:alert(1)" } });
    expect(snap(bad)!.website).toBeNull();
    expect(snap(fund())!.website).toBe("https://www.tencent.com/");
  });

  it("links the internal public data object for the exact symbol", () => {
    expect(snap(fund())!.evidenceHref).toBe("/data/0700.HK.fund.json");
    expect(snap(fund({ ticker: "600519.SS" }))!.evidenceHref).toBe("/data/600519.SS.fund.json");
  });
});

describe("estimates: vendor figures only", () => {
  const withEstimates = fund({
    estimates: {
      eps_fy: { periods: ["0y", "+1y"], avg: [12, 14], high: [15, 16], low: [10, 12], n: [20, 18] },
      rev_fy: { periods: ["0y", "+1y"], avg: [900, 1000], high: [950, 1100], low: [880, 950], n: [20, 18] },
      eps_q: { periods: [], avg: [], high: [], low: [], n: [] },
      growth: { rev_yoy: null, eps_yoy: null },
    },
  });

  it("shows the forward fiscal year with its analyst count when the artifact carries one", () => {
    const s = snap(withEstimates)!;
    expect(s.estimates!.fiscalPeriod).toBe("+1y");
    expect(s.estimates!.items.map((i) => i.value)).toEqual([1000, 14]);
    expect(s.estimates!.items[0].analystCount).toBe(18);
    expect(s.estimates!.source).toBe("yfinance");
  });

  it("shows nothing for an artifact with no estimates — Canada carries none", () => {
    const s = snap(fund())!;
    expect(s.estimates).toBeNull();
    expect(s.sections.estimates.reasons).toContain("no_forward_estimate");
  });

  it("shows nothing when the period label is missing even though a number exists", () => {
    const orphan = fund({
      estimates: {
        ...withEstimates.estimates!,
        rev_fy: { periods: [], avg: [900, 1000], high: [], low: [], n: [] },
      },
    });
    expect(snap(orphan)!.estimates!.items.map((item) => item.id)).toEqual(["eps_estimate"]);
  });

  it("shows nothing when the value is non-finite", () => {
    const bad = fund({
      estimates: {
        ...withEstimates.estimates!,
        rev_fy: { periods: ["0y", "+1y"], avg: [900, Number.NaN], high: [], low: [], n: [] },
      },
    });
    expect(snap(bad)!.estimates!.items.map((item) => item.id)).toEqual(["eps_estimate"]);
  });
});

describe("nothing legacy reaches the snapshot", () => {
  it("carries no conviction, entry, sizing, signal, smart-money or score field", () => {
    const withLegacy = fund({
      intel: { conviction: 88, entry: 91, sizing: 4, signals: ["momentum"], smartmoney: { net: 1 }, score: 99 },
    } as Partial<Fund> & { intel: unknown });
    const s = snap(withLegacy as Fund)!;
    const serialized = JSON.stringify(s).toLowerCase();
    for (const field of REGIONAL_SNAPSHOT_EXCLUDED_FIELDS) {
      expect(Object.keys(s)).not.toContain(field);
      // The legacy payload is not in the snapshot's TYPE, so its values cannot be read from it.
      expect(field.includes("_") ? serialized : serialized).not.toContain(`${field}":`);
    }
  });

  it("asserts no issuer identity, CIK, event, transcript or holder", () => {
    const s = snap(fund())!;
    for (const key of ["cik", "issuer_id", "event_id", "transcript", "holders", "ownership"]) {
      expect(Object.keys(s)).not.toContain(key);
    }
    // `ownership` is a Fund block the snapshot does not read: nothing here counts holders.
    expect(JSON.stringify(s)).not.toContain("top_inst");
  });
});

describe("integrated source and period qualification", () => {
  it("rejects an unknown artifact schema", () => {
    expect(snap(fund({ schema: "other/v1" } as unknown as Partial<Fund>))).toBeNull();
  });
  it("rejects impossible calendar dates and withholds growth over missing years", () => {
    expect(snap(fund({ statements: { annual: annual({ period_end: ["2024-02-30", "2025-02-30"] }), quarterly: null } }))!.annual).toBeNull();
    const legacy = annual({ period_end: ["2023-12-31", "2025-12-31"], fiscal_year: undefined,
      period_kind: undefined, period_number: undefined });
    expect(snap(fund({ statements: { annual: legacy, quarterly: null } }))!.annual!.metrics.every((metric) => metric.yoyPct == null)).toBe(true);
  });
  it("shows an annual source acquisition only from aligned observation receipts", () => {
    const stamp = "2026-10-22T05:00:00Z";
    const observed = annual({ period_provenance: {
      income: [null, { acquired_at: stamp }], balance: [null, { acquired_at: stamp }],
      cashflow: [null, { acquired_at: stamp }],
    } });
    const f = fund({ statements: { annual: observed, quarterly: null } });
    expect(snap(f)!.sourceRetrieval).toBe(stamp);
    expect(snap(f)!.sections.performance.state).toBe("available");
    observed.period_provenance!.cashflow![1] = { acquired_at: null };
    expect(snap(f)!.sourceRetrieval).toBeNull();
  });
  it("never labels estimates from different fiscal periods as one observation", () => {
    const f = fund({ estimates: {
      rev_fy: { periods: ["2026", "2027"], avg: [100, 120], high: [], low: [], n: [2, 3] },
      eps_fy: { periods: ["2027", "2028"], avg: [2, 3], high: [], low: [], n: [4, 5] },
      eps_q: {periods: [], avg: [], high: [], low: [], n: []}, growth: { rev_yoy: null, eps_yoy: null },
    } });
    expect(snap(f)!.estimates!.fiscalPeriod).toBe("2027");
    expect(snap(f)!.estimates!.items.map((item) => item.id)).toEqual(["revenue_estimate"]);
    expect(snap(f)!.estimates!.items[0].analystCount).toBe(3);
  });
});
