/** Synthetic research inputs shared by the standalone and Beta browser journeys. */
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

