// Mastermind Chart Engine — conformance harness (P2 quality gate).
//
// Runs the SAME behavioural checks against ANY ChartEngine factory so renderer
// parity is measured, not asserted: today the LWC adapter, later the native
// canvas renderer (masterplan P3/P4, docs/CHART_ENGINE_MASTERPLAN.md). The
// harness is deliberately factory-agnostic — it imports the contract
// (./api) and vitest only, NEVER "lightweight-charts" (law 1) — and observes
// engines exclusively through the contract surface plus unwrap()-based
// capability probes. Capabilities an engine does not expose (e.g. a data()
// readback) are reported as SKIP with the reason, never silently passed.
//
// Each check has a stable id ("Q01-C07") so a red id names the broken
// semantic across engines and across time. Two entry points:
//   runEngineConformance(name, factory, opts?) — registers a vitest
//     describe/it suite and prints a pass/skip/fail summary table at the end;
//   collectEngineConformance(factory, opts?)   — runs the same checks
//     headlessly and returns per-id results, so the suite can assert that a
//     deliberately broken engine FAILS (the built-in falsifier).
// Both entry points take the SAME declared skip table (ConformanceOpts.skips):
// a skip must name a real check id and carry a reason, so an opt-out is an
// audited decision (F-16) instead of a free-form id list.
//
// Requires a DOM (jsdom): factories receive a container element and the
// crosshair probe dispatches a real mousemove on it.

import { describe, it, expect, afterAll } from "vitest";

import corpusJson from "../__tests__/fixtures/chart-engine-corpus.json";
import type {
  ChartEngine,
  EngineBar,
  EngineLogicalRange,
  EngineSeriesKind,
  EngineSeriesRow,
  SeriesHandle,
} from "./api";

// ── Corpus ─────────────────────────────────────────────────────────────────────
// The fixture corpus lives in lib/__tests__/fixtures/chart-engine-corpus.json
// (< 100 KB, law: fixtures stay small). The one large fixture (dense40k) is
// stored as a spec and expanded here by a seeded PRNG so the file stays small
// while the code path stays identical for every engine under test.

export type ConformanceCorpusFixture = { kind: EngineSeriesKind; rows: EngineSeriesRow[] };
export type ConformanceGeneratedSpec = {
  kind: EngineSeriesKind;
  count: number;
  seed: number;
  startSec: number;
  stepSec: number;
};
export interface ConformanceCorpus {
  version: number;
  fixtures: Record<string, ConformanceCorpusFixture>;
  generated: Record<string, ConformanceGeneratedSpec>;
}

// Deterministic PRNG (mulberry32) — the same seed yields the same walk on
// every run, engine and machine; that determinism is itself under test.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

// OHLCV walk identical to the corpus generator's (same seed ⇒ same bars).
function ohlcWalk(
  spec: ConformanceGeneratedSpec,
): EngineBar[] {
  if (spec.kind !== "candles") {
    throw new Error(`conformance: generated fixtures only spell "candles" walks, got "${spec.kind}"`);
  }
  const rnd = mulberry32(spec.seed);
  let close = 152.4;
  const rows: EngineBar[] = [];
  for (let i = 0; i < spec.count; i++) {
    const vol = 0.6 + 1.4 * rnd();
    const open = i === 0 ? round2(close * (1 + 0.002 * gauss(rnd))) : round2(close * (1 + 0.001 * gauss(rnd)));
    close = round2(close * (1 + 0.0004 + 0.012 * gauss(rnd) * vol));
    rows.push({
      time: spec.startSec + i * spec.stepSec,
      open,
      high: round2(Math.max(open, close) * (1 + 0.004 * rnd() * vol)),
      low: round2(Math.min(open, close) * (1 - 0.004 * rnd() * vol)),
      close,
    });
  }
  return rows;
}

// Inline fixtures + code-expanded generated specs, keyed by fixture name.
export function loadConformanceCorpus(): Record<string, ConformanceCorpusFixture> {
  const corpus = corpusJson as unknown as ConformanceCorpus;
  if (corpus.version !== 1) throw new Error(`conformance: unsupported corpus version ${corpus.version}`);
  const out: Record<string, ConformanceCorpusFixture> = {};
  for (const [name, fx] of Object.entries(corpus.fixtures)) out[name] = fx;
  for (const [name, spec] of Object.entries(corpus.generated)) {
    out[name] = { kind: spec.kind, rows: ohlcWalk(spec) };
  }
  return out;
}

// ── Check scaffolding ──────────────────────────────────────────────────────────

export type ConformanceStatus = "pass" | "skip" | "fail";
export type ConformanceCheckResult = {
  id: string;
  title: string;
  status: ConformanceStatus;
  detail?: string;
};

// Thrown by CheckHarness.skip; caught by both runners, which translate it to
// a vitest ctx.skip / a "skip" result. Never a failure.
class ConformanceSkipSignal {
  constructor(public readonly reason: string) {}
}

// Declared skip table (F-16). A skip is an audited decision, never a free-form
// opt-out: every entry must name a real check id (an unknown id throws at
// registration, so a typo cannot silently hide a gap) and must carry a
// non-empty reason (an empty reason throws too). `finding` optionally
// attributes the skip to a finding id (e.g. "ACCEPT2-F1") so a later lane can
// correlate the gap with the report that named it. Runtime self-skips
// (CheckHarness.skip) stay allowed and still need a reason; both kinds are
// printed in the summary table with their reason.
export type ConformanceSkip = {
  readonly id: string;
  readonly reason: string;
  readonly finding?: string;
};

// Options shared by the vitest runner and the headless collector.
export type ConformanceOpts = {
  readonly skips?: readonly ConformanceSkip[];
};

interface CheckHarness {
  readonly engine: ChartEngine;
  readonly container: HTMLElement;
  readonly corpus: Record<string, ConformanceCorpusFixture>;
  skip(reason: string): never;
}

type CheckFn = (h: CheckHarness) => void;

interface ConformanceCheck {
  id: string;
  title: string;
  fn: CheckFn;
}

// A whitespace row carries a time and nothing else (api.ts EngineWhitespace).
const isWhitespace = (row: EngineSeriesRow): boolean => !("close" in row) && !("value" in row);

// Capability probe: read the rows a series currently holds. Tries the handle's
// own data() first (LWC's ISeriesApi has one; the contract does not require
// it), then the unwrap() escape hatch. null = the engine exposes no readback.
function rowsOf(series: SeriesHandle): EngineSeriesRow[] | null {
  const direct = series as unknown as { data?: () => unknown };
  if (typeof direct.data === "function") {
    const rows = direct.data() as EngineSeriesRow[] | null | undefined;
    return rows ?? null;
  }
  try {
    const raw = series.unwrap<{ data?: () => unknown }>();
    if (raw && typeof raw.data === "function") {
      const rows = raw.data() as EngineSeriesRow[] | null | undefined;
      return rows ?? null;
    }
  } catch {
    // unwrap is optional in spirit (P0 escape hatch) — treat as unavailable.
  }
  return null;
}

const EMPTY_INVENTORY = {
  alive: false,
  panes: 0,
  series: 0,
  seriesByPane: [],
  priceLines: 0,
  watermarks: 0,
} as const;

// ── The checks ─────────────────────────────────────────────────────────────────
// Shared by the vitest runner and the headless collector — ONE list, so the
// falsifier exercises exactly what the suite exercises.

const CHECKS: ConformanceCheck[] = [
  {
    id: "Q01-C01",
    title: "inventory starts empty and alive",
    fn: (h) => {
      const inv = h.engine.inventory();
      expect(inv.alive).toBe(true);
      expect(inv.series).toBe(0);
      expect(inv.priceLines).toBe(0);
      expect(inv.watermarks).toBe(0);
      expect(inv.seriesByPane.reduce((a, b) => a + b, 0)).toBe(0);
      expect(inv.panes).toBeGreaterThanOrEqual(1);
    },
  },
  {
    id: "Q01-C02",
    title: "all six kinds add with their fixture; inventory counts match",
    fn: (h) => {
      const kinds = new Set<EngineSeriesKind>();
      let added = 0;
      for (const [name, fx] of Object.entries(h.corpus)) {
        if (name === "dense40k") continue; // scale fixture has its own check (Q01-C15)
        const s = h.engine.addSeries(fx.kind);
        expect(s.kind).toBe(fx.kind);
        s.setData(fx.rows);
        added += 1;
        expect(h.engine.inventory().series).toBe(added);
        kinds.add(fx.kind);
      }
      expect(kinds.size).toBe(6); // candles, bars, line, area, histogram, baseline
      expect(h.engine.inventory().seriesByPane.reduce((a, b) => a + b, 0)).toBe(6);
    },
  },
  {
    id: "Q01-C03",
    title: "setData then update(last) does not change the row count",
    fn: (h) => {
      const s = h.engine.addSeries("candles");
      const rows = h.corpus.daily.rows as EngineBar[];
      s.setData(rows);
      const before = rowsOf(s);
      if (!before) h.skip("engine exposes no data() readback (handle.data()/unwrap().data())");
      expect(before).toHaveLength(60);
      const last = rows[rows.length - 1];
      s.update({ ...last, close: round2(last.close + 1.25) });
      const after = rowsOf(s);
      expect(after).toHaveLength(60);
    },
  },
  {
    id: "Q01-C04",
    title: "update with a new time appends",
    fn: (h) => {
      const s = h.engine.addSeries("candles");
      const rows = h.corpus.daily.rows as EngineBar[];
      s.setData(rows);
      const before = rowsOf(s);
      if (!before) h.skip("engine exposes no data() readback (handle.data()/unwrap().data())");
      expect(before).toHaveLength(60);
      // The first business day after the fixture's 2026-10-02 (Fri) close.
      s.update({ time: "2026-10-05", open: 166.3, high: 167.2, low: 165.9, close: 166.95 });
      const after = rowsOf(s);
      expect(after).toHaveLength(61);
    },
  },
  {
    id: "Q01-C05",
    title: "whitespace rows are preserved in the series data",
    fn: (h) => {
      const fx = h.corpus.gapped.rows;
      const s = h.engine.addSeries("area");
      s.setData(fx);
      const rows = rowsOf(s);
      if (!rows) {
        h.skip("engine exposes no data() readback (handle.data()/unwrap().data())");
        return;
      }
      expect(rows).toHaveLength(fx.length);
      const wantWs = fx.filter(isWhitespace).map((r) => r.time);
      expect(wantWs).toHaveLength(3); // the fixture carries exactly 3 mid-series gaps
      const gotWs = rows.filter(isWhitespace).map((r) => r.time);
      expect(gotWs).toEqual(wantWs);
    },
  },
  {
    id: "Q01-C06",
    title: "timeScale logical range set/get round-trips",
    fn: (h) => {
      const s = h.engine.addSeries("candles");
      s.setData(h.corpus.daily.rows);
      const ts = h.engine.timeScale();
      const range: EngineLogicalRange = { from: 2.5, to: 40.25 };
      ts.setVisibleLogicalRange(range);
      expect(ts.getVisibleLogicalRange()).toEqual(range);
    },
  },
  {
    id: "Q01-C07",
    title: "subscribe/unsubscribe symmetry (logical range + crosshair)",
    fn: (h) => {
      // Logical range: a programmatic set must reach subscribers (real LWC fires
      // the logical-range-changed event through its invalidate mask, and the
      // contract expects the same of every renderer), and an unsubscribed
      // handler must not.
      const ts = h.engine.timeScale();
      const seen: EngineLogicalRange[] = [];
      const onRange = (r: EngineLogicalRange | null) => {
        if (r) seen.push({ from: r.from, to: r.to });
      };
      ts.subscribeVisibleLogicalRangeChange(onRange);
      ts.setVisibleLogicalRange({ from: 0, to: 5 });
      ts.unsubscribeVisibleLogicalRangeChange(onRange);
      ts.setVisibleLogicalRange({ from: 1, to: 6 });
      const rangeObservable = seen.length > 0;
      if (rangeObservable) {
        expect(seen).toEqual([{ from: 0, to: 5 }]); // fired once, then detached
      }
      // Crosshair: driven by a real mousemove on the container.
      let crossCalls = 0;
      const onCross = () => {
        crossCalls += 1;
      };
      h.engine.subscribeCrosshairMove(onCross);
      h.container.dispatchEvent(new MouseEvent("mousemove", { clientX: 40, clientY: 30, bubbles: true }));
      const crossWhileSubscribed = crossCalls;
      h.engine.unsubscribeCrosshairMove(onCross);
      h.container.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 35, bubbles: true }));
      const crossObservable = crossWhileSubscribed > 0;
      if (crossObservable) {
        expect(crossCalls).toBe(crossWhileSubscribed); // no calls after unsubscribe
      }
      if (!rangeObservable && !crossObservable) {
        h.skip("engine reports neither logical-range changes (on programmatic set) nor crosshair moves (container mousemove): symmetry is unobservable");
      }
    },
  },
  {
    id: "Q01-C08",
    title: "markers set/replace/clear stay lifecycle-safe",
    fn: (h) => {
      const rows = h.corpus.daily.rows as EngineBar[];
      const s = h.engine.addSeries("candles");
      s.setData(rows);
      const inv0 = h.engine.inventory();
      s.setMarkers([{ time: rows[10].time, position: "aboveBar", shape: "arrowUp", color: "#8a8a8a" }]);
      s.setMarkers([{ time: rows[20].time, position: "belowBar", shape: "arrowDown", color: "#c4c4c4" }]);
      s.setMarkers([]);
      const inv1 = h.engine.inventory();
      expect(inv1.series).toBe(inv0.series);
      expect(inv1.watermarks).toBe(inv0.watermarks);
      expect(inv1.priceLines).toBe(inv0.priceLines);
      // The handle stays fully live after marker churn.
      expect(s.kind).toBe("candles");
      expect(() => s.setData(rows)).not.toThrow();
    },
  },
  {
    id: "Q01-C09",
    title: "price line create/applyOptions/remove is reflected in inventory",
    fn: (h) => {
      const s = h.engine.addSeries("line");
      s.setData(h.corpus.negative.rows);
      const a = s.createPriceLine({ price: -2, color: "#999999", lineStyle: 2 });
      s.createPriceLine({ price: 1 });
      expect(h.engine.inventory().priceLines).toBe(2);
      expect(() => a.applyOptions({ color: "#777777" })).not.toThrow();
      expect(h.engine.inventory().priceLines).toBe(2);
      a.remove();
      expect(h.engine.inventory().priceLines).toBe(1);
      a.remove(); // idempotent
      expect(h.engine.inventory().priceLines).toBe(1);
    },
  },
  {
    id: "Q01-C10",
    title: "watermark re-call replaces, never stacks",
    fn: (h) => {
      h.engine.setWatermark(0, [{ text: "alpha" }]);
      expect(h.engine.inventory().watermarks).toBe(1);
      h.engine.setWatermark(0, { visible: true, horzAlign: "center", vertAlign: "center", lines: [{ text: "beta" }] });
      expect(h.engine.inventory().watermarks).toBe(1); // replaced, not appended
    },
  },
  {
    id: "Q01-C11",
    title: "swapPanes/moveToPane inventory effects",
    fn: (h) => {
      const s1 = h.engine.addSeries("candles");
      s1.setData(h.corpus.daily.rows);
      const s2 = h.engine.addSeries("line");
      s2.setData(h.corpus.negative.rows);
      const s3 = h.engine.addSeries("histogram", {}, 1);
      s3.setData(h.corpus.halted.rows);
      expect(h.engine.inventory()).toMatchObject({ panes: 2, series: 3, seriesByPane: [2, 1] });
      h.engine.swapPanes(0, 1);
      expect(h.engine.inventory()).toMatchObject({ panes: 2, series: 3, seriesByPane: [1, 2] });
      // Series follow their pane: indices swap with the panes.
      expect(s3.paneIndex()).toBe(0);
      expect(s1.paneIndex()).toBe(1);
      // s3 was pane 0's only series. LWC `_internal_moveSeriesToPane` then runs
      // `_cleanupIfPaneIsEmpty` on the pane it left: pane 0 is removed and the
      // surviving pane, now holding all three series, moves up to slot 0.
      s3.moveToPane(1);
      expect(h.engine.inventory()).toMatchObject({ panes: 1, series: 3, seriesByPane: [3] });
      expect(s3.paneIndex()).toBe(0);
      expect(s1.paneIndex()).toBe(0);
    },
  },
  {
    id: "Q01-C11b",
    title: "a PaneHandle follows ITS pane across swapPanes (identity, not slot)",
    fn: (h) => {
      const s0 = h.engine.addSeries("candles", {}, 0);
      s0.setData(h.corpus.daily.rows);
      const s1 = h.engine.addSeries("line", {}, 1);
      s1.setData(h.corpus.negative.rows);
      const s2 = h.engine.addSeries("histogram", {}, 2);
      s2.setData(h.corpus.halted.rows);
      expect(h.engine.inventory()).toMatchObject({ panes: 3, series: 3, seriesByPane: [1, 1, 1] });
      // Hold the same pane two ways: from a series that lives on it, and from the
      // engine's slot list. Both handles must denote ONE pane for their lifetime,
      // and both routes must denote the SAME pane.
      const held0 = s0.pane();
      const held2 = s2.pane();
      const slots = h.engine.panes();
      const slot0 = slots[0];
      const slot2 = slots[2];
      expect(held0.index()).toBe(0);
      expect(held2.index()).toBe(2);
      expect(slot0.index()).toBe(0);
      expect(slot2.index()).toBe(2);
      // Series identity is compared between objects the ENGINE handed out, never
      // against the addSeries return value: the F-16 "no readback" case drives
      // this same list through a Proxy-wrapped series, so `toContain(s0)` is not
      // observable there while pane-resolved identity is.
      const seriesOnHeld0 = held0.getSeries();
      const seriesOnHeld2 = held2.getSeries();
      expect(seriesOnHeld0).toHaveLength(1);
      expect(seriesOnHeld2).toHaveLength(1);
      expect(slot0.getSeries()[0]).toBe(seriesOnHeld0[0]);
      expect(slot2.getSeries()[0]).toBe(seriesOnHeld2[0]);
      // The raw pane object a handle holds is STABLE across the reorder.
      const rawHeld0 = held0.unwrap<unknown>();
      const rawSlot2 = slot2.unwrap<unknown>();
      h.engine.swapPanes(0, 2);
      // index() reports the pane's CURRENT position: the handle followed its pane.
      expect(held0.index()).toBe(2);
      expect(held2.index()).toBe(0);
      expect(slot0.index()).toBe(2);
      expect(slot2.index()).toBe(0);
      expect(held0.unwrap<unknown>()).toBe(rawHeld0);
      expect(slot2.unwrap<unknown>()).toBe(rawSlot2);
      // getSeries() follows the pane: each held handle still resolves the SAME
      // series object it held before the reorder, and that series now reports the
      // pane's new position. A positional handle would hand back the other pane's
      // series here instead.
      const afterHeld0 = held0.getSeries();
      const afterHeld2 = held2.getSeries();
      expect(afterHeld0).toHaveLength(1);
      expect(afterHeld0[0]).toBe(seriesOnHeld0[0]);
      expect(afterHeld2[0]).toBe(seriesOnHeld2[0]);
      expect(afterHeld0[0]).not.toBe(afterHeld2[0]);
      expect(afterHeld0[0].paneIndex()).toBe(2);
      expect(afterHeld2[0].paneIndex()).toBe(0);
      expect(s1.paneIndex()).toBe(1);
      // A write through a held handle lands on the pane that holds that handle's
      // series. It is read back through a FRESH engine.panes() addressed by LIVE
      // index, so a positional handle cannot satisfy this by re-resolving its slot.
      const marker = 7.5; // no pane starts at this stretch factor
      held0.setStretchFactor(marker);
      expect(held0.stretchFactor()).toBe(marker);
      expect(held2.stretchFactor()).not.toBe(marker);
      const after = h.engine.panes();
      expect(after.find((p) => p.index() === 2)?.stretchFactor()).toBe(marker);
      expect(after.find((p) => p.index() === 0)?.stretchFactor()).not.toBe(marker);
    },
  },
  {
    id: "Q01-C12",
    title: "takeScreenshot returns an HTMLCanvasElement synchronously",
    fn: (h) => {
      const s = h.engine.addSeries("candles");
      s.setData(h.corpus.daily.rows);
      const shot = h.engine.takeScreenshot(); // no await: sync by contract
      expect(shot).toBeInstanceOf(HTMLCanvasElement);
    },
  },
  {
    id: "Q01-C13",
    title: "destroy zeroes inventory and neutralizes handles",
    fn: (h) => {
      const s = h.engine.addSeries("candles");
      s.setData(h.corpus.daily.rows);
      s.createPriceLine({ price: 100 });
      h.engine.setWatermark(0, [{ text: "z" }]);
      h.engine.destroy();
      expect(h.engine.inventory()).toEqual(EMPTY_INVENTORY);
      // A handle obtained before destroy is neutralized: it may throw (LWC
      // adapter: "disposed") or silently no-op (a canvas engine's choice) —
      // what the contract forbids is resurrection.
      try {
        s.setData(h.corpus.daily.rows);
      } catch {
        // throwing is the loud form of no-op
      }
      try {
        h.engine.addSeries("line");
      } catch {
        // ditto
      }
      expect(h.engine.inventory()).toEqual(EMPTY_INVENTORY);
    },
  },
  {
    id: "Q01-C14",
    title: "a second destroy is a no-op",
    fn: (h) => {
      h.engine.addSeries("line");
      h.engine.destroy();
      h.engine.destroy();
      expect(h.engine.inventory()).toEqual(EMPTY_INVENTORY);
    },
  },
  {
    id: "Q01-C15",
    title: "dense40k: setData at scale + in-place update preserves rows",
    fn: (h) => {
      const rows = h.corpus.dense40k.rows as EngineBar[];
      expect(rows).toHaveLength(40000);
      const s = h.engine.addSeries("candles");
      s.setData(rows);
      const before = rowsOf(s);
      if (!before) h.skip("engine exposes no data() readback (handle.data()/unwrap().data())");
      expect(before).toHaveLength(40000);
      const last = rows[rows.length - 1];
      s.update({ ...last, close: round2(last.close + 0.5) });
      expect(rowsOf(s)).toHaveLength(40000);
      s.update({ ...last, time: Number(last.time) + 60, close: round2(last.close + 0.75) });
      expect(rowsOf(s)).toHaveLength(40001);
    },
  },
];

// ── Vitest runner ──────────────────────────────────────────────────────────────

const KNOWN_CHECK_IDS: ReadonlySet<string> = new Set(CHECKS.map((c) => c.id));

/**
 * Validates a declared skip table and returns check id -> printed detail.
 * Throws at registration on: an entry that is not an object, an empty or
 * unknown check id, an empty reason, an empty `finding` tag, or the same id
 * declared twice. Exported so a suite can assert the guard without having to
 * register (and therefore run) a whole engine suite.
 */
export function declaredSkipDetails(skips: readonly ConformanceSkip[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of skips ?? []) {
    if (!entry || typeof entry !== "object") {
      throw new Error(`conformance: a skip entry must be an object, got ${String(entry)}`);
    }
    if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
      throw new Error("conformance: every skip entry needs a non-empty check id");
    }
    if (!KNOWN_CHECK_IDS.has(entry.id)) {
      throw new Error(
        `conformance: unknown skip id "${entry.id}" (known ids: ${[...KNOWN_CHECK_IDS].join(", ")})`,
      );
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
      throw new Error(`conformance: skip "${entry.id}" carries an empty reason`);
    }
    if (entry.finding !== undefined && (typeof entry.finding !== "string" || entry.finding.trim().length === 0)) {
      throw new Error(`conformance: skip "${entry.id}" carries an empty finding tag`);
    }
    if (out.has(entry.id)) {
      throw new Error(`conformance: skip "${entry.id}" is declared twice`);
    }
    out.set(entry.id, `declared skip — ${entry.reason}${entry.finding ? ` [finding ${entry.finding}]` : ""}`);
  }
  return out;
}

function printSummary(name: string, marks: Map<string, { status: ConformanceStatus; detail?: string }>): void {
  let pass = 0;
  let skip = 0;
  let fail = 0;
  const lines: string[] = [];
  for (const check of CHECKS) {
    const mark = marks.get(check.id) ?? { status: "fail" as ConformanceStatus, detail: "never ran" };
    if (mark.status === "pass") pass += 1;
    else if (mark.status === "skip") skip += 1;
    else fail += 1;
    lines.push(`${check.id}  ${mark.status.toUpperCase().padEnd(4)}  ${check.title}${mark.detail ? ` — ${mark.detail}` : ""}`);
  }
  console.log(
    [
      "",
      `┌─ engine conformance — ${name}`,
      ...lines.map((l) => `│ ${l}`),
      `└─ ${pass} pass / ${skip} skip / ${fail} fail`,
      "",
    ].join("\n"),
  );
}

const CORPUS = loadConformanceCorpus();

function makeHarness(engine: ChartEngine, container: HTMLElement): CheckHarness {
  return {
    engine,
    container,
    corpus: CORPUS,
    skip: (reason: string): never => {
      throw new ConformanceSkipSignal(reason);
    },
  };
}

/**
 * Registers a vitest suite that runs every conformance check against the
 * engine built by `factory` (a fresh container + engine per check), then
 * prints a pass/skip/fail summary table of the check ids. `opts.skips` is the
 * declared skip table (F-16): every entry must name a real check id and carry
 * a non-empty reason (validation throws at registration), and every skipped
 * check is reported as SKIP with that declared reason, never silently dropped.
 */
export function runEngineConformance(
  name: string,
  factory: (container: HTMLElement) => ChartEngine,
  opts: ConformanceOpts = {},
): void {
  const declared = declaredSkipDetails(opts.skips);
  const marks = new Map<string, { status: ConformanceStatus; detail?: string }>();
  for (const [id, detail] of declared) marks.set(id, { status: "skip", detail });
  describe(`engine conformance: ${name}`, () => {
    for (const check of CHECKS) {
      const register = declared.has(check.id) ? it.skip : it;
      register(`${check.id} — ${check.title}`, (ctx) => {
        const container = document.createElement("div");
        const engine = factory(container);
        try {
          check.fn(makeHarness(engine, container));
          marks.set(check.id, { status: "pass" });
        } catch (err) {
          if (err instanceof ConformanceSkipSignal) {
            marks.set(check.id, { status: "skip", detail: err.reason });
            ctx.skip(); // vitest 2 has no skip(reason); the table carries the reason
            return;
          }
          marks.set(check.id, { status: "fail", detail: err instanceof Error ? err.message : String(err) });
          throw err;
        } finally {
          try {
            engine.destroy();
          } catch {
            // teardown must never mask the verdict
          }
        }
      });
    }
    afterAll(() => printSummary(name, marks));
  });
}

// ── Headless collector (falsifier substrate) ───────────────────────────────────

/**
 * Runs the same checks outside vitest's reporting and returns per-id results
 * instead of throwing. This is how the suite proves the harness goes RED on a
 * broken engine: collectEngineConformance(brokenFactory) must contain "fail"
 * results, and those failures are asserted to exist.
 */
export function collectEngineConformance(
  factory: (container: HTMLElement) => ChartEngine,
  opts: ConformanceOpts = {},
): ConformanceCheckResult[] {
  const declared = declaredSkipDetails(opts.skips);
  const results: ConformanceCheckResult[] = [];
  for (const check of CHECKS) {
    const declaredDetail = declared.get(check.id);
    if (declaredDetail) {
      results.push({ id: check.id, title: check.title, status: "skip", detail: declaredDetail });
      continue;
    }
    const container = document.createElement("div");
    const engine = factory(container);
    try {
      check.fn(makeHarness(engine, container));
      results.push({ id: check.id, title: check.title, status: "pass" });
    } catch (err) {
      if (err instanceof ConformanceSkipSignal) {
        results.push({ id: check.id, title: check.title, status: "skip", detail: err.reason });
      } else {
        results.push({
          id: check.id,
          title: check.title,
          status: "fail",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      try {
        engine.destroy();
      } catch {
        // teardown must never mask the verdict
      }
    }
  }
  return results;
}
