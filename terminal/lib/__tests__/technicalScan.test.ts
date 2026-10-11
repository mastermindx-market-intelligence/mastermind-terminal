/* eslint-disable @typescript-eslint/no-explicit-any -- the golden fixture is mutated as loose JSON to build negative cases */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIELD_NULL_REASON,
  MARKET_LAG_DAYS,
  SCAN_CUTOFF_MAX_AGE_DAYS,
  SCAN_GENERATION_MAX_AGE_DAYS,
  TECHNICAL_SCAN_URL,
  TECHNICAL_STATE_KEYS,
  accountTechnicalCoverage,
  classifyTechnical,
  evaluateTechnicalScreen,
  marketCutoffMax,
  nextTechnicalSource,
  parseTechnicalScan,
  parseTechnicalScreen,
  readTechnicalScanResponse,
  technicalCellOf,
  technicalChartHandover,
  type TechnicalScan,
  type TechnicalScanSource,
  type TechnicalScreen,
} from "../technicalScan";
import { passes } from "../screenerScan";

const FIXTURE = path.join(__dirname, "fixtures/screenerScan/technical.v1.json");
// A fresh deep copy per call — tests mutate freely.
const raw = (): Record<string, any> => JSON.parse(readFileSync(FIXTURE, "utf8"));
const NOW = Date.parse("2026-10-11T12:00:00Z");

function load(doc: unknown = raw()): TechnicalScan {
  const r = parseTechnicalScan(doc);
  if (!r.ok) throw new Error(`fixture rejected: ${r.error}`);
  return r.value;
}
const ready = (scan: TechnicalScan = load()): TechnicalScanSource => ({ kind: "ready", scan });
const row = (doc: Record<string, any>, sym: string) => doc.rows.find((r: any) => r.sym === sym);

// The requested universe the Screener would hold: every scan row plus a manifest name the
// scan never mentions, with a duplicate to prove de-duplication.
const REQUESTED = [
  "NVDA", "ZM", "0700.HK", "QUIET", "OLDENG", "LAGGARD", "7203.T", "BTC-USD",
  "^TNX", "NEWCO", "NOSLICE", "BROKEN", "MISSING", "NVDA",
];

describe("technicalScan — golden fixture classification", () => {
  it("pins the coverage of every fixture row at 3D", () => {
    const src = ready();
    const got = Object.fromEntries([...new Set(REQUESTED)].map((s) => [s, classifyTechnical(src, s, "3D", NOW).coverage]));
    expect(got).toEqual({
      NVDA: { status: "evaluated", reason: "ok" },        // flagship source_hash differs: NOT a mismatch
      ZM: { status: "evaluated", reason: "ok" },
      "0700.HK": { status: "evaluated", reason: "ok" },
      QUIET: { status: "evaluated", reason: "ok" },       // evaluated with null fields
      OLDENG: { status: "stale", reason: "engine_mismatch" },
      LAGGARD: { status: "stale", reason: "cutoff_behind_market" },
      "7203.T": { status: "stale", reason: "cutoff_aged" },
      "BTC-USD": { status: "evaluated", reason: "ok" },
      "^TNX": { status: "unsupported", reason: "rate_series" },
      NEWCO: { status: "unavailable", reason: "insufficient_history" },
      NOSLICE: { status: "unavailable", reason: "no_slice" },
      BROKEN: { status: "unavailable", reason: "malformed_row" },
      MISSING: { status: "unavailable", reason: "not_in_scan" },
    });
  });

  it("AC-E01-02: the four populations sum to the requested universe with no dropped rows", () => {
    const acct = accountTechnicalCoverage(REQUESTED, ready(), "3D", NOW);
    expect(acct.total).toBe(13);
    expect([acct.evaluated, acct.stale, acct.unsupported, acct.unavailable]).toEqual([5, 3, 1, 4]);
    expect(acct.evaluated + acct.stale + acct.unsupported + acct.unavailable).toBe(acct.total);
    expect(acct.byReason.unavailable).toEqual({ insufficient_history: 1, no_slice: 1, malformed_row: 1, not_in_scan: 1 });
  });

  it("a timeframe the producer does not emit is unsupported for every name, never empty", () => {
    for (const tf of ["D", "W", "5m", "bogus"]) {
      const acct = accountTechnicalCoverage(REQUESTED, ready(), tf, NOW);
      expect(acct).toMatchObject({ total: 13, unsupported: 13, evaluated: 0 });
      expect(acct.byReason.unsupported).toEqual({ timeframe_not_produced: 13 });
    }
  });

  it("an absent or failed scan makes every name unavailable with the reader's reason", () => {
    expect(accountTechnicalCoverage(REQUESTED, { kind: "absent" }, "3D", NOW).byReason.unavailable).toEqual({ scan_absent: 13 });
    expect(accountTechnicalCoverage(REQUESTED, { kind: "error", error: "http_500" }, "3D", NOW).byReason.unavailable)
      .toEqual({ scan_unavailable: 13 });
  });

  it("an old generation turns every current observation stale (engine mismatch is reported first)", () => {
    const later = Date.parse("2026-10-10T22:00:00Z") + (SCAN_GENERATION_MAX_AGE_DAYS + 0.01) * 86_400_000;
    const acct = accountTechnicalCoverage(REQUESTED, ready(), "3D", later);
    expect(acct.evaluated).toBe(0);
    expect(acct.byReason.stale).toEqual({ engine_mismatch: 1, generation_stale: 7 });
    // exactly at the limit is still current
    const atLimit = Date.parse("2026-10-10T22:00:00Z") + SCAN_GENERATION_MAX_AGE_DAYS * 86_400_000;
    expect(classifyTechnical(ready(), "ZM", "3D", atLimit).coverage.reason).toBe("ok");
  });

  it("cutoff staleness clocks are the exported constants", () => {
    expect([SCAN_GENERATION_MAX_AGE_DAYS, SCAN_CUTOFF_MAX_AGE_DAYS, MARKET_LAG_DAYS]).toEqual([4, 10, 4]);
    const doc = raw();
    // 4 calendar days behind its market (NYSE max 2026-10-09) is still current; 5 is not.
    row(doc, "LAGGARD").tf["3D"].cutoff.session = "2026-10-05";
    expect(classifyTechnical(ready(load(doc)), "LAGGARD", "3D", NOW).coverage.reason).toBe("ok");
    row(doc, "LAGGARD").tf["3D"].cutoff.session = "2026-10-04";
    expect(classifyTechnical(ready(load(doc)), "LAGGARD", "3D", NOW).coverage.reason).toBe("cutoff_behind_market");
  });

  it("groups market lag through the shared market model (venue + asset class)", () => {
    const max = marketCutoffMax(load(), "3D");
    expect(max.get("us")).toBe("2026-10-09");
    expect(max.get("hk")).toBe("2026-10-09");
    expect(max.get("crypto")).toBe("2026-10-10");
    expect(max.get("intl")).toBe("2026-09-28");
  });
});

describe("technicalScan — contract identity is carried, track record is not", () => {
  it("carries timeframe, cutoff, engine identity and provenance through classification", () => {
    const c = classifyTechnical(ready(), "NVDA", "3D", NOW);
    expect(c.observation?.cutoff).toEqual({ session: "2026-10-09", bar_open: "2026-10-08", bar_closed: false });
    expect(c.engine).toEqual({
      indicator_id: "confluence_rsimacd_stochrsi_mtf",
      engine: "python:signal_layer.confluence_v2@v2",
      signal_era: "gc_v2_wo2",
      source_hash: "sha256:82cac19cc362869202dee4a1b9e70a0a108f088aab46e765dbe3a4f624f5ec5c",
    });
    expect(c.observation?.bar_quality).toBe("synthetic_open_deepstore");
    expect(c.observation?.score_basis).toBe("full");
    expect(c.observation?.state.last_scored_signal).toBe("REBUY");
  });

  it("projects state by allow-list: deprecated `extended` and any wr/pf/cagr/verdict never survive", () => {
    const doc = raw();
    Object.assign(row(doc, "ZM").tf["3D"].state, { wr: 0.6, pf: 3, cagr: 0.4, verdict: "BUY" });
    Object.assign(row(doc, "ZM").tf["3D"], { wr: 0.6, verdict: "BUY" });
    Object.assign(row(doc, "ZM"), { cagr: 0.4, pf: 3 });
    const scan = load(doc);
    for (const r of scan.rows.values()) {
      if (r.kind !== "row") continue;
      for (const o of Object.values(r.tf)) {
        if (o.status !== "observed") continue;
        expect(Object.keys(o.state).sort()).toEqual([...TECHNICAL_STATE_KEYS].sort());
      }
    }
    const blob = JSON.stringify([...scan.rows.values()]);
    for (const banned of ['"extended"', '"wr"', '"pf"', '"cagr"', '"verdict"']) expect(blob).not.toContain(banned);
  });

  it("a stale row still exposes its value for display, but never as a filterable known cell", () => {
    const c = classifyTechnical(ready(), "OLDENG", "3D", NOW);
    expect(c.observation?.state.position_hint).toBe("long");
    expect(technicalCellOf(c, "tech.position")).toEqual({ known: false, status: "stale", reason: "engine_mismatch" });
  });

  it("a null field inside an evaluated row is an unknown cell with reason field_null", () => {
    const c = classifyTechnical(ready(), "QUIET", "3D", NOW);
    expect(technicalCellOf(c, "tech.position")).toEqual({ known: false, status: "evaluated", reason: FIELD_NULL_REASON });
    expect(technicalCellOf(c, "tech.overbought")).toEqual({ known: true, value: false });
    expect(technicalCellOf(classifyTechnical(ready(), "BTC-USD", "3D", NOW), "tech.barClosed"))
      .toEqual({ known: false, status: "evaluated", reason: FIELD_NULL_REASON });
    expect(technicalCellOf(classifyTechnical(ready(), "0700.HK", "3D", NOW), "tech.barClosed")).toEqual({ known: true, value: true });
  });
});

describe("technicalScan — predicates", () => {
  const universe = [...new Set(REQUESTED)];
  const run = (screen: TechnicalScreen, src: TechnicalScanSource = ready()) =>
    universe.filter((s) => passes(evaluateTechnicalScreen(src, s, screen, NOW).match));

  it("unknown never passes: stale, unsupported, unavailable and null rows are excluded by default", () => {
    expect(run({ tf: "3D", predicates: [{ field: "tech.position", op: "in", values: ["long"] }] }))
      .toEqual(["NVDA", "ZM", "BTC-USD"]); // OLDENG/LAGGARD are long but stale; QUIET is null
  });

  it("includeUnknown is an explicit opt-in that admits every non-evaluated row, never a known failure", () => {
    expect(run({ tf: "3D", predicates: [{ field: "tech.position", op: "in", values: ["long"], includeUnknown: true }] }))
      .toEqual(["NVDA", "ZM", "QUIET", "OLDENG", "LAGGARD", "7203.T", "BTC-USD", "^TNX", "NEWCO", "NOSLICE", "BROKEN", "MISSING"]);
    // 0700.HK is known "flat" — it fails regardless of the opt-in
  });

  it("combines predicates with Kleene AND", () => {
    const screen: TechnicalScreen = {
      tf: "3D",
      predicates: [
        { field: "tech.position", op: "in", values: ["long"] },
        { field: "tech.overbought", op: "is", value: true },
      ],
    };
    expect(run(screen)).toEqual(["NVDA"]);
    // QUIET: position unknown, overbought known false ⇒ fail (a known contradiction wins)
    expect(evaluateTechnicalScreen(ready(), "QUIET", screen, NOW).match).toBe("fail");
    // MISSING: everything unknown ⇒ unknown, with its coverage attached for the explanation
    expect(evaluateTechnicalScreen(ready(), "MISSING", screen, NOW))
      .toEqual({ match: "unknown", coverage: { status: "unavailable", reason: "not_in_scan" } });
  });

  it("ranges and the explicit unknown op", () => {
    expect(run({ tf: "3D", predicates: [{ field: "tech.barsSinceSignal", op: "range", lte: 1 }] }))
      .toEqual(["ZM", "0700.HK", "BTC-USD"]);
    expect(run({ tf: "3D", predicates: [{ field: "tech.position", op: "unknown" }] }))
      .toEqual(["QUIET", "OLDENG", "LAGGARD", "7203.T", "^TNX", "NEWCO", "NOSLICE", "BROKEN", "MISSING"]);
  });

  it("a screen on a timeframe the scan does not produce selects nothing (and says why)", () => {
    const screen: TechnicalScreen = { tf: "D", predicates: [{ field: "tech.position", op: "in", values: ["long"] }] };
    expect(run(screen)).toEqual([]);
    expect(evaluateTechnicalScreen(ready(), "NVDA", screen, NOW).coverage).toEqual({ status: "unsupported", reason: "timeframe_not_produced" });
  });

  it("an empty predicate list filters nothing", () => {
    expect(run({ tf: "3D", predicates: [] })).toEqual(universe);
  });
});

describe("technicalScan — document rejection and row-level malformation", () => {
  it("AC-E01-03: a complete claim with not_processed rows is rejected", () => {
    const doc = raw();
    row(doc, "NEWCO").tf["3D"] = { status: "unavailable", reason: "not_processed" };
    expect(parseTechnicalScan(doc)).toEqual({ ok: false, error: "complete_with_not_processed" });
    doc.complete = false;
    const scan = load(doc);
    expect(scan.complete).toBe(false);
    expect(classifyTechnical(ready(scan), "NEWCO", "3D", NOW).coverage).toEqual({ status: "unavailable", reason: "not_processed" });
  });

  const docCases: [string, (d: Record<string, any>) => void, string][] = [
    ["unknown family_version", (d) => { d.family_version = 2; }, "family_version_unsupported"],
    ["dropped row", (d) => { d.rows.pop(); }, "row_count_mismatch"],
    ["duplicate listing", (d) => { d.rows[1].sym = "NVDA"; }, "row_identity_duplicate"],
    ["empty engine table", (d) => { d.engines = {}; }, "engines_invalid"],
    ["engine missing its era", (d) => { delete d.engines.gc_v2.signal_era; }, "engines_invalid"],
    ["non-canonical timeframe key", (d) => { d.timeframes = { "3d": { engine: "gc_v2_wo2" } }; }, "timeframe_unknown"],
    ["timeframe naming an unknown engine", (d) => { d.timeframes["3D"].engine = "nope"; }, "timeframe_engine_unknown"],
  ];
  for (const [name, mutate, error] of docCases) {
    it(`rejects ${name}`, () => {
      const d = raw();
      mutate(d);
      expect(parseTechnicalScan(d)).toEqual({ ok: false, error });
    });
  }

  const rowCases: [string, (o: Record<string, any>) => void, string][] = [
    ["a consumer-reserved reason", (o) => { o.status = "unavailable"; o.reason = "not_in_scan"; }, "3D:reason_reserved"],
    ["a known reason under the wrong status", (o) => { o.status = "unsupported"; o.reason = "not_processed"; }, "3D:reason_status_mismatch"],
    ["observed with a non-ok reason", (o) => { o.reason = "fine"; }, "3D:reason_status_mismatch"],
    ["an inverted cutoff (bar opens after the last consumed session)", (o) => { o.cutoff.bar_open = "2026-10-10"; }, "3D:cutoff_inverted"],
    ["an impossible date", (o) => { o.cutoff.session = "2026-02-30"; }, "3D:cutoff_invalid"],
    ["a missing cutoff", (o) => { delete o.cutoff; }, "3D:cutoff_invalid"],
    ["an unknown engine key", (o) => { o.engine = "gc_v9"; }, "3D:engine_unknown"],
    ["a mistyped state field", (o) => { o.state.overbought = "yes"; }, "3D:state_overbought"],
    ["a negative bar count", (o) => { o.state.bars_since_signal = -1; }, "3D:state_bars_since_signal"],
  ];
  for (const [name, mutate, error] of rowCases) {
    it(`keeps a row with ${name} as unavailable/malformed_row (never dropped)`, () => {
      const d = raw();
      mutate(row(d, "ZM").tf["3D"]);
      const scan = load(d);
      const r = scan.rows.get("ZM");
      expect(r).toMatchObject({ kind: "malformed", error });
      expect(classifyTechnical(ready(scan), "ZM", "3D", NOW).coverage).toEqual({ status: "unavailable", reason: "malformed_row" });
      expect(accountTechnicalCoverage(REQUESTED, ready(scan), "3D", NOW).total).toBe(13);
    });
  }

  it("a row missing an observation for a produced timeframe is malformed", () => {
    expect(load().rows.get("BROKEN")).toMatchObject({ kind: "malformed", error: "3D:observation_invalid" });
  });

  it("accepts a new producer reason under the producer's own status (forward-compatible within v1)", () => {
    const d = raw();
    row(d, "NEWCO").tf["3D"] = { status: "unavailable", reason: "delisted" };
    expect(classifyTechnical(ready(load(d)), "NEWCO", "3D", NOW).coverage).toEqual({ status: "unavailable", reason: "delisted" });
  });

  it("matches listings exactly: no case folding or suffix stripping", () => {
    expect(classifyTechnical(ready(), "nvda", "3D", NOW).coverage.reason).toBe("not_in_scan");
    expect(classifyTechnical(ready(), "0700", "3D", NOW).coverage.reason).toBe("not_in_scan");
  });
});

describe("technicalScan — reader state and generation hold", () => {
  const withGen = (generation: number, complete: boolean) => {
    const d = raw();
    d.generation = generation;
    d.complete = complete;
    return load(d);
  };

  it("adapts HTTP reads: 404 is absent, other failures are errors, valid bodies are ready", () => {
    expect(readTechnicalScanResponse(404, null)).toEqual({ kind: "absent" });
    expect(readTechnicalScanResponse(503, null)).toEqual({ kind: "error", error: "http_503" });
    expect(readTechnicalScanResponse(200, "<html>")).toEqual({ kind: "error", error: "not_an_object" });
    expect(readTechnicalScanResponse(200, raw()).kind).toBe("ready");
  });

  it("holds a complete generation against a newer incomplete one", () => {
    const held: TechnicalScanSource = { kind: "ready", scan: withGen(100, true) };
    const r = nextTechnicalSource(held, { kind: "ready", scan: withGen(200, false) });
    expect(r.decision?.reason).toBe("incomplete_over_complete");
    expect(r.source.kind === "ready" && r.source.scan.generation).toBe(100);
  });

  it("adopts a newer complete generation and refuses an older one", () => {
    const held: TechnicalScanSource = { kind: "ready", scan: withGen(100, true) };
    const newer = nextTechnicalSource(held, { kind: "ready", scan: withGen(200, true) });
    expect(newer.source.kind === "ready" && newer.source.scan.generation).toBe(200);
    const older = nextTechnicalSource(held, { kind: "ready", scan: withGen(50, true) });
    expect(older.decision?.reason).toBe("not_newer");
    expect(older.source.kind === "ready" && older.source.scan.generation).toBe(100);
  });

  it("a failed refresh keeps the held scan and flags it; with nothing held the failure shows", () => {
    const held: TechnicalScanSource = { kind: "ready", scan: withGen(100, true) };
    const r = nextTechnicalSource(held, { kind: "error", error: "http_500" });
    expect(r.source).toMatchObject({ kind: "ready", refreshFailed: true });
    expect(nextTechnicalSource(null, { kind: "absent" }).source).toEqual({ kind: "absent" });
    const first = nextTechnicalSource(null, { kind: "ready", scan: withGen(1, false) });
    expect(first.decision?.reason).toBe("first");
  });
});

describe("technicalScan — saved screen validation", () => {
  it("round-trips a valid screen", () => {
    const screen = {
      tf: "3D",
      predicates: [
        { field: "tech.position", op: "in", values: ["long"] },
        { field: "tech.overbought", op: "is", value: false, includeUnknown: true },
        { field: "tech.barsSinceSignal", op: "range", lte: 3 },
        { field: "tech.weeklyBull", op: "unknown" },
      ],
    };
    expect(parseTechnicalScreen(screen)).toEqual({ ok: true, value: screen });
  });

  const bad: [string, unknown, string][] = [
    ["a non-canonical timeframe", { tf: "3d", predicates: [] }, "screen_tf_invalid"],
    ["an unknown field", { tf: "3D", predicates: [{ field: "tech.rating", op: "is", value: true }] }, "predicate_field_unknown"],
    ["an op that does not fit the field", { tf: "3D", predicates: [{ field: "tech.overbought", op: "range", gte: 1 }] }, "predicate_op_invalid"],
    ["an empty value set", { tf: "3D", predicates: [{ field: "tech.position", op: "in", values: [] }] }, "predicate_op_invalid"],
    ["an unbounded range", { tf: "3D", predicates: [{ field: "tech.barsSinceSignal", op: "range" }] }, "predicate_range_invalid"],
    ["a non-boolean includeUnknown", { tf: "3D", predicates: [{ field: "tech.position", op: "in", values: ["long"], includeUnknown: "yes" }] }, "predicate_include_unknown_invalid"],
  ];
  for (const [name, screen, error] of bad) {
    it(`rejects ${name} rather than silently widening the screen`, () => {
      expect(parseTechnicalScreen(screen)).toEqual({ ok: false, error });
    });
  }
});

describe("technicalScan — chart handover (AC-E01-05)", () => {
  const DAILY = new Set(["D", "2D", "3D", "W", "2W", "1M", "3M"]);

  it("preserves the canonical symbol and the requested timeframe", () => {
    expect(technicalChartHandover("0700.HK", "3D", DAILY)).toEqual({
      href: "/terminal?sym=0700.HK&tf=3D", symbol: "0700.HK", timeframe: "3D", requested: "3D", support: "exact",
    });
    expect(technicalChartHandover("^TNX", "3D", DAILY)?.href).toBe("/terminal?sym=%5ETNX&tf=3D");
    expect(technicalChartHandover(" nvda ", "3D", DAILY)?.symbol).toBe("NVDA");
  });

  it("discloses a timeframe the chart cannot open instead of silently changing it", () => {
    expect(technicalChartHandover("NVDA", "5m", DAILY)).toEqual({
      href: "/terminal?sym=NVDA", symbol: "NVDA", timeframe: null, requested: "5m", support: "unsupported_timeframe",
    });
    expect(technicalChartHandover("NVDA", "3d", DAILY)?.support).toBe("unsupported_timeframe");
    expect(technicalChartHandover("NVDA", undefined, DAILY)).toMatchObject({ requested: null, support: "unsupported_timeframe" });
  });

  it("refuses a symbol the chart route cannot open", () => {
    expect(technicalChartHandover("../etc/passwd", "3D", DAILY)).toBeNull();
    expect(technicalChartHandover("", "3D", DAILY)).toBeNull();
    expect(technicalChartHandover(42, "3D", DAILY)).toBeNull();
  });
});

describe("technicalScan — one bounded read", () => {
  it("names a single scan document under /data/scan/", () => {
    expect(TECHNICAL_SCAN_URL).toBe("/data/scan/technical.json");
  });
});
