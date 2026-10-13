// Pinned BUY / SELL / CUT / RE-BUY marks of the shipped signal scripts on real sessions.
//
// ORACLE_V1_PINE (the chart's client-side signal fallback) and FLAGSHIP_PINE (the proprietary
// indicator) both read higher timeframes through request.security(): the confirm timeframe one
// step above the chart (D → 3D, 3D → 1W, W → 1M), the 3D anchor and the 1D moving average. Any
// change to how the engine builds or publishes those timeframes moves these marks, so the exact
// mark dates and labels are pinned here on committed copies of real daily sessions
// (fixtures/flagship_marks/<SYM>.json, copied from terminal/public/data — never read from
// public/data directly, whose tree is pinned by release preflight).
//
// Chart bars are built with ChartPanel.resampleTf and the published session_anchor, and every run
// passes exactly what ChartPanel passes today ({ timeframe, symbol }). Marks are labelled the way
// ChartPanel.oracleSignals labels them (★ below the bar = BUY, ★ above = SELL, CUT, RE-BUY).
//
// The golden file is fixtures/flagship_marks/marks.golden.json. Updating it (vitest -u) changes
// which signals users see and needs the signal owner's acceptance, recorded on the pull request.
//
// The second block records the reviewed difference from the previous engine, which bucket-mapped
// 3D by calendar days and read a higher-timeframe group before it had closed (PR #874):
//   D chart  — the 3D confirm gate now uses the canonical session grid and never reads an unclosed
//              3D group (SPY 97 → 100 marks, NVDA 81 → 80, AAPL 98 → 96);
//   3D chart — the 1W confirm gate is refused (a 3D bar can straddle two weeks), so marks that
//              needed it are gone (SPY 33 → 29);
//   W chart  — the 1M confirm gate is refused for the same reason (SPY 15 → 14).
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { runPine, type Bar } from "../pine-engine";
import { FLAGSHIP_PINE, ORACLE_V1_PINE } from "../pine";
import { parseSessionAnchor } from "../sessionBars";
import { resampleTf } from "@/components/ChartPanel";

const FIXTURES = path.join(__dirname, "fixtures", "flagship_marks");
const SYMBOLS = ["SPY", "NVDA", "AAPL"] as const;
const TIMEFRAMES = ["D", "3D", "W"] as const;
const SCRIPTS = { ORACLE_V1: ORACLE_V1_PINE, FLAGSHIP: FLAGSHIP_PINE } as const;

type Row = [string, number, number, number, number, number];
type DailyRow = Parameters<typeof resampleTf>[0][number];
function loadDaily(sym: string): { daily: DailyRow[]; anchor: ReturnType<typeof parseSessionAnchor> } {
  const doc = JSON.parse(readFileSync(path.join(FIXTURES, `${sym}.json`), "utf8")) as { session_anchor: unknown; bars: Row[] };
  return {
    daily: doc.bars.map(([time, o, h, l, c, v]) => ({ time, o, h, l, c, v })),
    anchor: parseSessionAnchor(doc.session_anchor),
  };
}

const label = (s: { text?: string; position: string }) =>
  s.text === "★" ? (s.position === "aboveBar" ? "SELL" : "BUY") : s.text === "CUT" ? "CUT" : s.text === "RE-BUY" ? "REBUY" : null;

type Pinned = { bars: number; marks: string[]; warnings: string[] };
function computeAll(): Record<string, Pinned> {
  const out: Record<string, Pinned> = {};
  for (const sym of SYMBOLS) {
    const { daily, anchor } = loadDaily(sym);
    for (const tf of TIMEFRAMES) {
      const bars = resampleTf(daily, tf, anchor) as unknown as Bar[];
      for (const [name, src] of Object.entries(SCRIPTS)) {
        // A generous wall budget: this pins marks, not speed, and must not flake under a loaded runner.
        const res = runPine(src, bars, { timeframe: tf, symbol: sym, budgetMs: 120_000 });
        expect(res.ok, `${name} ${sym} ${tf}: ${JSON.stringify(res.errors)}`).toBe(true);
        const marks = res.result!.shapes.flatMap((s) => { const l = label(s); return l ? [`${String(s.time)} ${l}`] : []; });
        out[`${name}|${sym}|${tf}`] = { bars: bars.length, marks, warnings: Array.from(new Set(res.result!.warnings)).sort() };
      }
    }
  }
  return out;
}

describe("signal marks of the shipped scripts on real sessions are pinned", () => {
  let all: Record<string, Pinned> | null = null;
  const get = () => (all ??= computeAll());

  it("ORACLE_V1 and FLAGSHIP marks at D, 3D and W on SPY, NVDA and AAPL match the reviewed golden file", async () => {
    const got = get();
    expect(Object.keys(got)).toHaveLength(SYMBOLS.length * TIMEFRAMES.length * Object.keys(SCRIPTS).length);
    for (const [k, v] of Object.entries(got)) expect(v.marks.length, k).toBeGreaterThan(0);
    await expect(JSON.stringify(got, null, 1) + "\n").toMatchFileSnapshot(path.join(FIXTURES, "marks.golden.json"));
  }, 240_000);

  it("the reviewed difference from the bucket-mapped engine is exactly the disclosed one", () => {
    const got = get();
    const has = (k: string, m: string) => got[k].marks.includes(m);
    for (const name of Object.keys(SCRIPTS)) {
      const k = (sym: string, tf: string) => `${name}|${sym}|${tf}`;
      expect(got[k("SPY", "D")].marks).toHaveLength(100);
      expect(got[k("NVDA", "D")].marks).toHaveLength(80);
      expect(got[k("AAPL", "D")].marks).toHaveLength(96);
      expect(got[k("SPY", "3D")].marks).toHaveLength(29);
      expect(got[k("SPY", "W")].marks).toHaveLength(14);
      // removed (they relied on a calendar-day 3D bucket, or on an unclosed 3D / 1W / 1M group)
      for (const [sym, tf, m] of [["SPY", "D", "2022-03-15 BUY"], ["SPY", "D", "2025-02-05 BUY"], ["NVDA", "D", "2022-03-15 BUY"],
        ["AAPL", "D", "2023-05-23 SELL"], ["AAPL", "D", "2026-02-24 BUY"], ["AAPL", "D", "2026-02-27 CUT"],
        ["SPY", "3D", "2023-05-17 BUY"], ["SPY", "3D", "2023-05-22 CUT"], ["SPY", "3D", "2023-05-25 BUY"], ["SPY", "3D", "2026-01-16 SELL"],
        ["SPY", "W", "2023-03-31 BUY"]]) expect(has(k(sym, tf), m), `${name} ${sym} ${tf} must not show ${m}`).toBe(false);
      // added (the canonical session grid, with the 3D value shown only once its group has closed)
      for (const [sym, tf, m] of [["SPY", "D", "2022-03-14 SELL"], ["SPY", "D", "2022-03-15 REBUY"], ["SPY", "D", "2023-05-18 BUY"],
        ["SPY", "D", "2023-05-26 BUY"], ["SPY", "D", "2025-09-09 BUY"], ["AAPL", "D", "2023-03-15 BUY"]]) expect(has(k(sym, tf), m), `${name} ${sym} ${tf} must show ${m}`).toBe(true);
      // the refused confirm gates say why
      expect(got[k("SPY", "3D")].warnings.some((w) => w.includes("'1W'") && w.includes("returning na")), JSON.stringify(got[k("SPY", "3D")].warnings)).toBe(true);
      expect(got[k("SPY", "W")].warnings.some((w) => w.includes("'1M'") && w.includes("returning na")), JSON.stringify(got[k("SPY", "W")].warnings)).toBe(true);
    }
  }, 240_000);
});
