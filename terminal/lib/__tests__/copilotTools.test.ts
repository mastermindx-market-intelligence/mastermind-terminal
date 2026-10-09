import { describe, it, expect } from "vitest";
import {
  SYMBOL_RE,
  capJson,
  fracToPct,
  scalarize,
  toBars,
  curatePriceSummary,
  curateTechnicals,
  curateSignals,
  curateOpts,
  curateGex,
  curateFundamentals,
  curateInsiders,
  curateIntel,
  curateMarketRisk,
  curatePlane,
  execTool,
} from "../copilotTools";

type Obj = Record<string, unknown>;

// Frozen "now" for deterministic staleness ages (mirrors signalVerdict.test.ts convention).
// Midnight UTC so date-only signal timestamps land on exact day boundaries
// (verdictIsStale compares FRACTIONAL days > ORACLE_STALE_DAYS).
const NOW = Date.parse("2026-07-14T00:00:00Z");

/** Synthetic raw OHLC file: {bars: [[date,o,h,l,c,v],...]} with a gentle uptrend. */
function mkOhlc(n: number, start = 100) {
  const bars: (string | number)[][] = [];
  const d0 = Date.parse("2025-01-01T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const c = start + i * 0.1 + Math.sin(i / 5);
    const date = new Date(d0 + i * 86_400_000).toISOString().slice(0, 10);
    bars.push([date, c - 0.5, c + 1, c - 1, c, 1000 + i]);
  }
  return { t: "TEST", o: 1, src: "test", bar_quality: "real_ohlc", bars };
}

describe("SYMBOL_RE — fs path allowlist", () => {
  it("accepts real ticker shapes", () => {
    for (const s of ["AAPL", "BRK.B", "BTC-USD", "0700.HK", "spy"]) expect(SYMBOL_RE.test(s)).toBe(true);
  });
  it("rejects traversal and junk (no slashes → '..'-style names can never escape DATA)", () => {
    for (const s of ["../etc", "..\\etc", "a/b", "AAPL;rm", "", "A".repeat(16), "AAPL json"]) expect(SYMBOL_RE.test(s)).toBe(false);
  });
});

describe("execTool guards", () => {
  it("rejects an invalid symbol before touching the filesystem", async () => {
    for (const tool of ["get_price_summary", "get_technicals", "get_signals", "get_fundamentals", "get_insiders", "get_intel"]) {
      expect(await execTool(tool, { symbol: "../../etc/passwd" })).toEqual({ error: "invalid symbol" });
    }
  });
  it("unknown tool name errors", async () => {
    expect(await execTool("get_everything", { symbol: "AAPL" })).toEqual({ error: "unknown tool" });
  });
  it("missing file → explicit no_data, never fabricated values", async () => {
    const r = await execTool("get_fundamentals", { symbol: "ZZZZNOFILE" });
    expect(r.no_data).toBe(true);
    expect(typeof r.reason).toBe("string");
  });
});

describe("capJson — ≤2KB curated-payload contract", () => {
  it("passes small payloads through untouched (no truncated flag)", () => {
    const o = { symbol: "AAPL", last: 283.78 };
    expect(capJson(o)).toBe(o);
    expect(capJson(o).truncated).toBeUndefined();
  });
  it("caps oversized payloads and marks truncated:true", () => {
    const big = { symbol: "AAPL", rows: Array.from({ length: 400 }, (_, i) => ({ i, txt: "x".repeat(24) })) };
    expect(JSON.stringify(big).length).toBeGreaterThan(2000);
    const capped = capJson(big);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(2000);
    expect(capped.truncated).toBe(true);
    expect(capped.symbol).toBe("AAPL"); // identity fields survive
  });
  it("caps even a single giant string field", () => {
    const capped = capJson({ symbol: "X", story: "y".repeat(10_000) });
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(2000);
    expect(capped.truncated).toBe(true);
  });
});

describe("fracToPct / scalarize", () => {
  it("converts 0..1 fractions to labeled percent strings", () => {
    expect(fracToPct(0.465)).toBe("46.5%");
    expect(fracToPct(0.0044, 2)).toBe("0.44%");
    expect(fracToPct(null)).toBeNull();
    expect(fracToPct("0.4")).toBeNull(); // strings are not silently coerced
  });
  it("scalarize keeps scalars + scalar arrays, drops nested blobs", () => {
    const s = scalarize({ a: 1, b: "hi", deep: { x: 1 }, list: [1, 2, 3], objs: [{ x: 1 }] })!;
    expect(s.a).toBe(1);
    expect(s.b).toBe("hi");
    expect(s.list).toEqual([1, 2, 3]);
    expect(s.deep).toBeUndefined();
    expect(s.objs).toBeUndefined();
    expect(scalarize(null)).toBeNull();
  });
});

describe("curatePriceSummary", () => {
  it("no manifest row + no bars → no_data", () => {
    expect(curatePriceSummary(null, null).no_data).toBe(true);
  });
  it("computes returns / ATR / 200-DMA distance from bars alone", () => {
    const out = curatePriceSummary(null, mkOhlc(300));
    expect(out.no_data).toBeUndefined();
    expect(typeof out.last).toBe("number");
    const rets = out.returns_pct as Record<string, number | null>;
    expect(typeof rets.m1).toBe("number");
    expect(rets.m1! > 0).toBe(true); // uptrend fixture
    expect(typeof out.atr14).toBe("number");
    expect(typeof out.avg_vol_20).toBe("number");
    expect(typeof out.dist_200dma_pct).toBe("number");
    expect(out.asof).toBe((mkOhlc(300).bars.at(-1) as (string | number)[])[0]);
  });
  it("manifest row wins for last/chg/today when present", () => {
    const out = curatePriceSummary({ name: "Test Co", last: 999, chg: 1.5, open: 990, high: 1001, low: 985, vol: 5, hi52: 1200, lo52: 800 }, mkOhlc(60));
    expect(out.last).toBe(999);
    expect(out.chg_pct).toBe(1.5);
    expect((out.today as Obj).h).toBe(1001);
    expect(out.hi52).toBe(1200);
  });
});

describe("curateTechnicals", () => {
  it("needs ≥30 bars", () => {
    expect(curateTechnicals(mkOhlc(20)).no_data).toBe(true);
  });
  it("emits verdicts, key values, pivots, supertrend and bollinger", () => {
    const out = curateTechnicals(mkOhlc(250));
    const v = out.verdicts as Obj;
    expect(typeof v.summary).toBe("string");
    expect((v.oscillators as Obj).verdict).toBeTruthy();
    expect((v.moving_averages as Obj).verdict).toBeTruthy();
    const vals = out.values as Obj;
    expect(typeof vals.rsi14).toBe("number");
    expect(typeof vals.macd_hist).toBe("number");
    const piv = out.pivots_classic as Obj;
    expect(typeof piv.P).toBe("number");
    expect(typeof piv.R1).toBe("number");
    expect(["up", "down"]).toContain(out.supertrend);
    expect((out.bollinger as Obj).position).toBeTruthy();
    // curated technicals stay comfortably inside the payload cap
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(2000);
  });
});

describe("curateSignals", () => {
  const slice = {
    indicator: {
      state: { position_hint: "long", last_signal: "RECLAIM", last_scored_ts: "2026-07-13", bars_since_signal: 1, strong_bull: true },
      signals: [
        { ts: "2026-01-01", type: "BUY", price: 90, strength: 0.5, reasons: ["a"] },
        { ts: "2026-03-03", type: "CUT", price: 95, strength: 0.58, reasons: ["fast_reversal_down", "buy_failed"] },
        { ts: "2026-04-06", type: "BUY", price: 258.9, strength: 0.588, reasons: ["macd_bull_cross", "recent_b1", "confirm_bull", "rsi<65", "extra_dropped"] },
        { ts: "2026-07-10", known_ts: "2026-07-13", type: "RECLAIM", price: 280, quality: "A", quality_reason: "reclaimed 50d" },
      ],
    },
    backtest: { metrics: { n_trades: 7, win_rate: 0.5714, profit_factor: 7.36, cagr: 0.0537, sharpe: 0.387, max_dd: -0.3612, expectancy: 0.0326, exposure: 0.2933, vs_buy_hold: { bh_total_return: 1.0661, beats_return: false } }, honest_read: "As-traded after costs." },
  };
  it("passes state verbatim, keeps only the last 3 signals", () => {
    const out = curateSignals(slice, NOW);
    expect(out.state).toEqual(slice.indicator.state);
    const sigs = out.last_signals as Obj[];
    expect(sigs).toHaveLength(3);
    expect(sigs[0].ts).toBe("2026-03-03");
    expect(sigs[2]).toMatchObject({ ts: "2026-07-10", known_ts: "2026-07-13", type: "RECLAIM", quality: "A", reason: "reclaimed 50d" });
    expect(sigs[1].reason).toBe("macd_bull_cross, recent_b1, confirm_bull, rsi<65"); // reasons joined, capped at 4
  });
  it("labels fraction metrics as % and keeps ratios raw", () => {
    const bt = curateSignals(slice, NOW).backtest as Obj;
    expect(bt.win_rate).toBe("57.1%");
    expect(bt.cagr).toBe("5.4%");
    expect(bt.max_dd).toBe("-36.1%");
    expect(bt.profit_factor).toBe(7.36);
    expect(bt.bh_total_return).toBe("106.6%");
    expect(bt.beats_buy_hold).toBe(false);
  });
  it("stale flag follows the 21-day boundary, anchored on the newest non-vetoed signal", () => {
    const fresh = curateSignals(slice, NOW);
    expect(fresh.stale).toBe(false);
    expect(fresh.signal_age_days).toBe(1);
    // staleness anchors on the newest signal the engine did NOT refuse (oracleVerdict's rule) —
    // decay-class RECLAIMs count even when last_scored_ts is older
    const at = (ts: string) => ({ indicator: { ...slice.indicator, signals: [{ ts, type: "SELL", price: 100 }], state: { ...slice.indicator.state, last_scored_ts: ts } } });
    expect(curateSignals(at("2026-06-22"), NOW).stale).toBe(true); // 22d > 21
    expect(curateSignals(at("2026-06-23"), NOW).stale).toBe(false); // exactly 21d — still live
    const decay = { indicator: { ...slice.indicator, state: { ...slice.indicator.state, last_scored_ts: "2026-04-01" } } };
    expect(curateSignals(decay, NOW).stale).toBe(false); // fresh RECLAIM in signals anchors, not state
    const veto = { indicator: { ...slice.indicator, signals: [{ ts: "2026-06-22", type: "SELL", price: 100 }, { ts: "2026-07-13", type: "BUY", price: 1, quality: "regime_blocked" }], state: { ...slice.indicator.state, last_scored_ts: "2026-06-22" } } };
    expect(curateSignals(veto, NOW).stale).toBe(true); // a vetoed marker must not refresh staleness
  });
  it("missing slice → no_data", () => {
    expect(curateSignals(null, NOW).no_data).toBe(true);
  });
});

describe("curateOpts / curateGex", () => {
  it("opts: iv fractions ×100 into iv_pct, slope described; null → no_data", () => {
    const out = curateOpts({
      schema: "mastermind.opts/v1", ticker: "T", asof: "2026-07-10", spot: 100,
      term: [{ label: "1W", dte: 5, expiry: "e", iv: 0.412 }, { label: "1M", dte: 30, expiry: "e", iv: 0.35 }],
      smile: { expiry: "e", dte: 30, strikes: [90, 100, 110], iv: [0.45, 0.4, 0.38] },
    });
    expect((out.iv_term as Obj[])[0]).toMatchObject({ label: "1W", iv_pct: 41.2 });
    expect(String(out.term_slope)).toContain("inverted");
    expect((out.skew_summary as Obj).skew_pts_90_110_moneyness).toBe(7);
    expect(curateOpts(null).no_data).toBe(true);
  });
  it("gex: walls top-3 by gamma, state fields folded in; both absent → no_data", () => {
    const gex = {
      asof: "2026-07-05", spot_ref: 135.7, net_gex_bn: -1.24, gamma_flip: 130, call_wall: 150, put_wall: 120,
      by_strike: [
        { strike: 100, gamma_call: 0.01, gamma_put: -0.06 },
        { strike: 110, gamma_call: 0.05, gamma_put: -0.01 },
        { strike: 120, gamma_call: 0.02, gamma_put: -0.09 },
        { strike: 130, gamma_call: 0.08, gamma_put: -0.02 },
        { strike: 140, gamma_call: 0.03, gamma_put: -0.005 },
      ],
    };
    const state = { asof: "2026-07-10", spot: 136, net_gex_bn: -1.1, gamma_regime: "SLIDE", pin_probability: 0.41, magnet: 135, max_pain: 132, dist_to_flip_pct: 0.4, gamma_flip: 131, call_wall: 150, put_wall: 120 };
    const out = curateGex(gex, state);
    expect((out.call_walls as Obj[]).map((w) => w.strike)).toEqual([130, 110, 140]);
    expect((out.put_walls as Obj[]).map((w) => w.strike)).toEqual([120, 100, 130]);
    expect(out.gamma_regime).toBe("SLIDE");
    expect(out.net_gex_bn).toBe(-1.1); // gexstate (fresher, curated) wins
    expect(curateGex(null, null).no_data).toBe(true);
  });
});

describe("curateFundamentals — units contract (0..1 fractions → %, d/e raw ratio)", () => {
  const fund = {
    schema: "mastermind.fund/v1", ticker: "TEST", asof: "2026-07-01", quote_currency: "USD",
    profile: { sector: "Technology", industry: "Semis", hq: "Somewhere, CA", employees: 100, description: "Makes chips." },
    stats: { mktcap: 3_020_000_000_000, beta: 1.21, shares_out: 15_000_000_000 },
    ratios: { current: { pe_ttm: 31.2, pe_fwd: 28.4, ps: 8.1, pb: 45.2, gross_margin: 0.465, net_margin: 0.243, roe: 1.472, roa: 0.28, debt_to_equity: 1.87, div_yield: 0.0044 } },
    earnings: {
      next_date: "2026-08-01",
      q: [
        // surp_pct is already percent points in real fund.json (the units-contract exception)
        { period: "Q2 2025", eps_e: 1.0, eps_a: 1.1, surp_pct: 10.0 },
        { period: "Q3 2025", eps_e: 1.2, eps_a: 1.25, surp_pct: 4.17 },
        { period: "Q4 2025", eps_e: 1.3, eps_a: 1.28, surp_pct: -1.54 },
        { period: "Q1 2026", eps_e: 1.4, eps_a: 1.5, surp_pct: 7.14 },
        { period: "Q2 2026", eps_e: 1.5, eps_a: 1.6, surp_pct: 6.67 },
      ],
    },
    analyst: { dist: { strongBuy: 10, buy: 20, hold: 5, sell: 1, strongSell: 0 }, rating_label: "Buy", target: { mean: 250, high: 300, low: 180, n: 36 } },
    dividends: { never_paid: false, yield_ttm: 0.0044, payout_ratio: 0.15, events: [], splits: [] },
    ownership: {},
  };
  it("converts margins and yield, labels debt_to_equity as raw ratio", () => {
    const out = curateFundamentals(fund);
    const m = out.margins as Obj;
    expect(m.gross).toBe("46.5%");
    expect(m.net).toBe("24.3%");
    expect(m.roe).toBe("147.2%");
    expect(out.debt_to_equity).toBe("1.87 (raw ratio, not %)");
    expect(out.div_yield).toBe("0.44%");
  });
  it("keeps last 4 earnings with % surprises and the analyst target", () => {
    const out = curateFundamentals(fund);
    const q = out.last_earnings as Obj[];
    expect(q).toHaveLength(4);
    expect(q[0].period).toBe("Q3 2025");
    expect(q[3]).toMatchObject({ period: "Q2 2026", eps_est: 1.5, eps_act: 1.6, surprise: "6.7%" });
    expect((out.analyst as Obj).pt_mean).toBe(250);
    expect((out.analyst as Obj).rating).toBe("Buy");
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(2000);
  });
  it("missing file → no_data", () => {
    expect(curateFundamentals(null).no_data).toBe(true);
  });
});

describe("curateInsiders / curateIntel", () => {
  it("insiders: compact read with rounded net dollars", () => {
    const out = curateInsiders({ ticker: "T", asof: "2026-03-31", window_days: 365, score: 2.8, signal: "SELL", confidence: "High", analysis: "SELL SIGNAL", buyers: 0, sellers: 7, net_usd: -129956707.31 });
    expect(out).toMatchObject({ score: 2.8, signal: "SELL", confidence: "High", n_buyers: 0, n_sellers: 7, net_usd: -129956707, window_days: 365 });
    expect(curateInsiders(null).no_data).toBe(true);
  });
  it("intel: curates cards/tape into ≤2KB, trims driver lists, never dumps raw", () => {
    const intel = {
      tape: { asof: "2026-07-10", ai_lean: { dir: "BULL", band: "high", entry: "await_confluence", score: 72 }, sector_pulse: { theme: "AI capex", heat: 80, reco: "hold winners" } },
      cards: {
        ai_judgment: { verdict: "Constructive", gloss: "Timing acceptable here.", size_pct: 3 },
        conviction: { score: 85, band: "high", drivers: ["d1", "d2", "d3", "d4", "d5-dropped"], cautions: ["c1"] },
        levels: { support: [100, 95], resistance: [110, 112], magnet: 105 },
        smart_money: { n_holders: 12, n_buying: 7, n_selling: 2, is_vip: true, holders: [{ name: "Fund A" }, { name: "Fund B" }, { name: "Fund C" }, { name: "Fund D" }] },
      },
      analysis: { confluence: "3D confluence constructive above the 50d." },
      tech: { events: { signals: { huge: "blob".repeat(500) } } }, // must NOT leak through
    };
    const out = curateIntel(intel);
    expect((out.ai_judgment as Obj).verdict).toBe("Constructive");
    expect((out.conviction as Obj).drivers).toHaveLength(4);
    expect((out.key_levels as Obj).support).toEqual([100, 95]);
    expect((out.smart_money_summary as Obj).top_holders).toEqual(["Fund A", "Fund B", "Fund C"]);
    expect(out.confluence_take).toBe("3D confluence constructive above the 50d.");
    expect(JSON.stringify(out)).not.toContain("blobblob");
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(2000);
    expect(curateIntel(null).no_data).toBe(true);
  });
});

describe("curateMarketRisk / curatePlane", () => {
  it("market risk: verdict and actual source-session freshness", () => {
    const fresh = curateMarketRisk({ nightly_asof: "2026-07-13", built: "2026-07-13T06:00:00Z", display: { verdict: "RISK_ON", score: 71.4, label_en: "Risk on" } }, NOW);
    expect(fresh).toMatchObject({ verdict: "RISK_ON", score: 71, label: "Risk on", stale: false });
    const old = curateMarketRisk({ built: "2026-07-10T06:00:00Z", display: { verdict: "RISK_ON", score: 71 } }, NOW);
    expect(old.stale).toBe(true);
    expect(curateMarketRisk(null, NOW).no_data).toBe(true);
    expect(curateMarketRisk({ display: {} }, NOW).no_data).toBe(true);
  });
  it("plane: headline regime fields + producer staleness contract", () => {
    const out = curatePlane({ asof: "2026-07-13", verdict: { verdict: "RISK_ON", score: 0.6, label_en: "Risk on" }, regime: { quad: "Q2", quad_name: "Reflation", confidence: 0.8, cycle_tag: "mid", transition_state: "stable" }, vol: { regime: "calm", risk_score: 22 }, liquidity_plumbing: { state: "ample", netliq_bn: 6210 }, contradiction_count: 1 }, NOW);
    expect((out.regime as Obj).quad).toBe("Reflation");
    expect(out.stale).toBe(false);
    expect(curatePlane({ asof: "2026-07-01" }, NOW).stale).toBe(true); // >4d producer contract
    expect(curatePlane(null, NOW).no_data).toBe(true);
  });
});

describe("execTool end-to-end against checked-in fixtures (public/data)", () => {
  it("get_signals AAPL: curated, capped, honest", async () => {
    const out = await execTool("get_signals", { symbol: "aapl" }); // lower-case in, upper-case fs read
    expect(out.symbol).toBe("AAPL");
    expect(out.state).toBeTruthy();
    expect((out.last_signals as Obj[]).length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(2000);
  });
  it("get_price_summary AAPL: manifest row + bars tail, never raw bars", async () => {
    const out = await execTool("get_price_summary", { symbol: "AAPL" });
    expect(typeof out.last).toBe("number");
    expect(out.returns_pct).toBeTruthy();
    const s = JSON.stringify(out);
    expect(s.length).toBeLessThanOrEqual(2000);
    expect(s).not.toContain("bars"); // raw OHLC array never reaches the model
  });
  it("toBars maps [date,o,h,l,c,v] rows to Bar objects", () => {
    const bars = toBars({ bars: [["2026-06-26", 275, 285.95, 274.21, 283.78, 261774853]] });
    expect(bars[0]).toEqual({ time: "2026-06-26", o: 275, h: 285.95, l: 274.21, c: 283.78, v: 261774853 });
    expect(toBars(null)).toEqual([]);
  });
});
