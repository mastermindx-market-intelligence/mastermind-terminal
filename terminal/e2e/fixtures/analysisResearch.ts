/** Synthetic research inputs shared by the standalone and Beta browser journeys. */
import type { FundAnalyst, FundEstimates, Insider, Transcript } from "../../lib/fund";
export const overviewFundFixture = {
  schema: "mastermind.fund/v1",
  ticker: "NVDA",
  asof: "2026-09-23",
  quote_currency: "USD",
  stmt_currency: "USD",
  src: { statements: "fixture", estimates: null, dividends: "fixture" },
  profile: {
    website: "https://www.nvidia.com",
    employees: 36000,
    sector: "Technology",
    industry: "Semiconductors",
    description: "NVIDIA designs accelerated computing platforms for graphics, data center, networking, and AI workloads.",
    founded: "1993",
    hq: "Santa Clara, CA",
  },
  stats: {
    mktcap: 4_000_000_000_000,
    shares_out: 24_000_000_000,
    float_shares: 23_500_000_000,
    inst_pct: 0.68,
    insider_pct: 0.04,
    beta: 1.9,
    num_holders: 6400,
  },
  statements: {
    annual: {
      periods: ["FY2023", "FY2024", "FY2025"],
      period_end: ["2024-01-28", "2025-01-26", "2026-01-25"],
      source_market: "us",
      source_family: "industrial",
      source_family_by_period: ["industrial", "industrial", "industrial"],
      reporting_cadence: "annual",
      flow_basis: "as_reported",
      normalization_method: ["as_reported", "as_reported", "as_reported"],
      income: {
        revenue: [60_000_000_000, 90_000_000_000, 130_000_000_000],
        cogs: [18_000_000_000, 25_000_000_000, 32_000_000_000],
        gross_profit: [42_000_000_000, 65_000_000_000, 98_000_000_000],
        opex: [11_000_000_000, 15_000_000_000, 20_000_000_000],
        op_income: [31_000_000_000, 50_000_000_000, 78_000_000_000],
        nonop_income: [1_000_000_000, 1_100_000_000, 1_200_000_000],
        pretax_income: [32_000_000_000, 51_100_000_000, 79_200_000_000],
        taxes: [4_000_000_000, 6_000_000_000, 9_000_000_000],
        net_income: [28_000_000_000, 45_100_000_000, 70_200_000_000],
        eps_basic: [1.2, 1.9, 2.95],
        eps_diluted: [1.18, 1.86, 2.9],
        ebitda: [34_000_000_000, 54_000_000_000, 83_000_000_000],
      },
      balance: {
        assets: [70_000_000_000, 95_000_000_000, 125_000_000_000],
        assets_st: [35_000_000_000, 48_000_000_000, 65_000_000_000],
        assets_lt: [35_000_000_000, 47_000_000_000, 60_000_000_000],
        liabilities: [30_000_000_000, 38_000_000_000, 45_000_000_000],
        liab_st: [12_000_000_000, 15_000_000_000, 18_000_000_000],
        liab_lt: [18_000_000_000, 23_000_000_000, 27_000_000_000],
        equity: [40_000_000_000, 57_000_000_000, 80_000_000_000],
        debt: [11_000_000_000, 10_000_000_000, 9_000_000_000],
        net_debt: [-3_000_000_000, -9_000_000_000, -18_000_000_000],
        cash: [14_000_000_000, 19_000_000_000, 27_000_000_000],
      },
      cashflow: {
        cfo: [25_000_000_000, 43_000_000_000, 69_000_000_000],
        cfi: [-8_000_000_000, -11_000_000_000, -15_000_000_000],
        cff: [-10_000_000_000, -14_000_000_000, -20_000_000_000],
        capex: [4_000_000_000, 5_000_000_000, 7_000_000_000],
        fcf: [21_000_000_000, 38_000_000_000, 62_000_000_000],
      },
    },
    quarterly: null,
  },
  ratios: {
    periods: ["FY2021", "FY2022", "FY2023", "FY2024", "FY2025"],
    pe: [28, 24, 31, 36, 42],
    ps: [12, 10, 16, 21, 27],
    pb: [18, 17, 21, 28, 34],
    pcf: [25, 22, 30, 35, 40],
    ev: [],
    ev_ebitda: [24, 21, 28, 33, 38],
    current: {
      pe_ttm: 42,
      pe_fwd: 35,
      ps: 27,
      pb: 34,
      ev_ebitda: 38,
      ev_sales: 26,
      ev_ebit: 44,
      p_fcf: 39,
      div_yield: 0.0003,
      payout: 0.012,
      gross_margin: 0.75,
      net_margin: 0.54,
      roe: 0.62,
      roa: 0.41,
      debt_to_equity: 0.11,
      current_ratio: 3.1,
    },
  },
  earnings: { next_date: null, next_period: null, next_eps_est: null, next_rev_est: null, q: [], fy: [] },
  estimates: null,
  analyst: null,
  dividends: { never_paid: false, yield_ttm: 0.0003, payout_ratio: 0.012, events: [], splits: [] },
  ownership: { free_float_pct: 0.95, closely_held_pct: 0.05, top_inst: [] },
  guidance: null,
  segments: null,
};

/** Populated detail views; these synthetic figures are never market evidence. */
export const detailFundFixture = {
  ...overviewFundFixture,
  src: { ...overviewFundFixture.src, estimates: "synthetic_fixture", estimates_acquired_at: "2026-09-23T12:00:00Z" },
  analyst: {
    dist: { strongBuy: 4, buy: 8, hold: 2, sell: 1, strongSell: 0 },
    rating_label: "Buy", target: { mean: 250, high: 300, low: 180, n: 15 },
  } satisfies FundAnalyst,
  estimates: {
    eps_fy: { periods: ["FY2026", "FY2027"], avg: [4.5, 5.8], high: [5.1, 6.4], low: [3.9, 5.2], n: [15, 12] },
    rev_fy: { periods: ["FY2026", "FY2027"], avg: [170e9, 210e9], high: [185e9, 225e9], low: [155e9, 195e9], n: [15, 12] },
    eps_q: { periods: ["Q3 2026", "Q4 2026"], avg: [1.1, 1.3], high: [1.2, 1.4], low: [1, 1.2], n: [15, 12] },
    growth: { rev_yoy: 0.30, eps_yoy: 0.40 },
  } satisfies FundEstimates,
  earnings: {
    ...overviewFundFixture.earnings,
    fy: [
      { period: "FY2024", eps_a: 1.9, eps_e: 1.8, rev_a: 90e9, rev_e: 88e9, surp_pct: 5.56 },
      { period: "FY2025", eps_a: 2.95, eps_e: 2.8, rev_a: 130e9, rev_e: 125e9, surp_pct: 5.36 },
    ],
    q: [
      { period: "Q1 2026", end: "2026-03-31", report_date: "2026-05-20", eps_a: 0.8, eps_e: 0.75, rev_a: 32e9, rev_e: 30e9, surp_pct: 6.67, tx: "2026Q1" },
      { period: "Q2 2026", end: "2026-06-30", report_date: "2026-08-20", eps_a: 0.95, eps_e: 0.9, rev_a: 36e9, rev_e: 35e9, surp_pct: 5.56, tx: "2026Q2" },
    ],
  },
  dividends: {
    ...overviewFundFixture.dividends,
    events: [
      { ex: "2026-03-12", amount: 0.01, pay: "2026-04-02", type: "regular" },
      { ex: "2026-06-11", amount: 0.01, pay: "2026-07-02", type: "regular" },
      { ex: "2026-09-10", amount: 0.01, pay: "2026-10-01", type: "regular" },
    ],
  },
};

export const insiderActivityFixture: Insider = {
  ticker: "NVDA", asof: "2026-09-23", window_days: 360,
  score: 50, signal: "NEUTRAL", confidence: "None", analysis: "Synthetic reported activity",
  insider_buy: false, insider_sell: false, buyers: 1, sellers: 1,
  buy_usd: 200_000, sell_usd: 300_000, net_usd: -100_000,
  buy_shares: 1_000, sell_shares: 1_500, last_trade_age_d: 13,
  series: [
    { month: "2026-06", buy_usd: 200_000, sell_usd: 0, net_usd: 200_000, buy_shares: 1_000, sell_shares: 0 },
    { month: "2026-09", buy_usd: 0, sell_usd: 300_000, net_usd: -300_000, buy_shares: 0, sell_shares: 1_500 },
  ],
  trades: [
    { date: "2026-09-10", trade_date: "2026-09-08", code: "S", side: "sell", role: "Officer", title: "Chief Financial Officer", shares: 1_500, price: 200, usd: 300_000, weight: 1 },
    { date: "2026-06-11", trade_date: "2026-06-09", code: "P", side: "buy", role: "Director", title: "Director", shares: 1_000, price: 200, usd: 200_000, weight: 1 },
  ],
};

export const archiveCallsFixture: Transcript[] = [
  {
    schema: "mastermind.tx/v1", ticker: "NVDA", id: "2026Q1", period: "Q1 FY2026", date: "2026-05-20", title: "NVIDIA Earnings Call Q1 FY2026",
    segments: [
      { speaker: "Jordan Lee", role: "Chief Financial Officer", text: "Reported revenue grew across the synthetic reporting period." },
      { speaker: "Operator", role: "Operator", text: "Our first question comes from Morgan Chen." },
      { speaker: "Morgan Chen", role: "Analyst", text: "How did capacity change during the period?" },
    ],
  },
  {
    schema: "mastermind.tx/v1", ticker: "NVDA", id: "2025Q4", period: "Q4 FY2025", date: "2026-02-19", title: "NVIDIA Earnings Call Q4 FY2025",
    segments: [{ speaker: "Alex Rivera", role: "Chief Executive Officer", text: "This prepared update establishes the prior-period capacity baseline." }],
  },
];

export function marketBarsFixture() {
  const bars: [string, number, number, number, number, number][] = [];
  let close = 100;
  for (let year = 2020; year <= 2026; year++) {
    const monthCount = year === 2026 ? 6 : 12;
    for (let month = 1; month <= monthCount; month++) {
      for (const day of [5, 12, 19, 26]) {
        const seasonal = Math.sin((month / 12) * Math.PI * 2) * 0.004;
        const drift = 0.0045 + seasonal + ((year - 2020) * 0.00008);
        const open = close;
        close = close * (1 + drift);
        const high = Math.max(open, close) * 1.012;
        const low = Math.min(open, close) * 0.988;
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        bars.push([date, open, high, low, close, 1_000_000 + bars.length * 2_500]);
      }
    }
  }
  return { bars };
}

