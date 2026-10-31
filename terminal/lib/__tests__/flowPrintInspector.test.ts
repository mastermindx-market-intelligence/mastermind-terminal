/**
 * flowPrintInspector.test.ts — W3A print-inspector projector contract.
 *
 * The flow owner (FlowEvent) is contract-level and carries NO receipt clock,
 * conditions, lineage, quote context or confidence (W3A field-policy amendment,
 * 2026-10-21). The projector must never invent them — not even from `ts` — and
 * must return null rather than a partial view when identity/premium is malformed.
 */
import { describe, expect, it } from "vitest";
import {
  compareTape,
  flowCoverage,
  projectFlowPrint,
  type FlowPrintInput,
} from "@/lib/flowPrintInspector";

// e1 of the W3A fixture tape: 6,000 × $0.84 × 100 = $504,000; oi 3,680 → 1.63×.
const E1: FlowPrintInput = {
  id: "w3a-e1",
  ts: "2026-10-21T14:40:12.117Z",
  root: "AAPL",
  exp: "2026-10-23",
  strike: 230,
  right: "C",
  side: "~buy",
  signing_source: "tape",
  n_prints: 4,
  size: 6000,
  avg_price: 0.84,
  premium: 504000,
  premium_z: null,
  baseline_source: "z252",
  vol_gt_oi: true,
  repeated: false,
  zerodte: false,
  oi: 3680,
};

// The 9-row W3A fixture tape (e5's premium deliberately does NOT reproduce:
// 4,100 × $0.95 × 100 = $389,500 ≠ $395,000; e3 carries an owner side value
// outside the Side union, so its premium is unknown for classification).
const TAPE: FlowPrintInput[] = [
  E1,
  { ...E1, id: "w3a-e2", ts: "2026-10-21T14:40:12.119Z", strike: 235, size: 6000, avg_price: 0.36, premium: 216000, oi: undefined },
  { ...E1, id: "w3a-e3", ts: "2026-10-21T14:39:58Z", right: "P", strike: 225, side: "unclassified", size: 2500, avg_price: 1.42, premium: 355000 },
  { ...E1, id: "w3a-e4", ts: "2026-10-21T14:38:10Z", side: "~sell", signing_source: "floor", size: 3200, avg_price: 0.81, premium: 259200 },
  { ...E1, id: "w3a-e5", ts: "2026-10-21T14:37:41Z", right: "P", strike: 220, side: "mixed", size: 4100, avg_price: 0.95, premium: 395000 },
  { ...E1, id: "w3a-e6", ts: "2026-10-21T14:36:05Z", size: 2900, avg_price: 0.92, premium: 266800 },
  { ...E1, id: "w3a-e7", ts: "2026-10-21T14:35:00Z", exp: "2026-11-20", strike: 240, size: 1500, avg_price: 2.1, premium: 315000 },
  { ...E1, id: "w3a-e8", ts: "2026-10-21T14:34:30Z", root: "NVDA", strike: 190, side: "~sell", size: 2000, avg_price: 3.4, premium: 680000 },
  { ...E1, id: "w3a-e9", ts: "2026-10-21T14:36:05Z", size: 1000, avg_price: 0.8, premium: 80000 },
];

function without(row: FlowPrintInput, key: string): FlowPrintInput {
  const next = { ...row } as Record<string, unknown>;
  delete next[key];
  return next;
}

describe("projectFlowPrint", () => {
  it("returns null, never a partial view, when root, exp, strike, right, ts or premium is missing", () => {
    expect(projectFlowPrint({})).toBeNull();
    for (const key of ["root", "exp", "strike", "right", "ts", "premium"]) {
      expect(projectFlowPrint(without(E1, key)), `missing ${key}`).toBeNull();
    }
    // Malformed values reject the whole row — no partial projection.
    expect(projectFlowPrint({ ...E1, root: "" })).toBeNull();
    expect(projectFlowPrint({ ...E1, strike: "230" })).toBeNull();
    expect(projectFlowPrint({ ...E1, strike: Number.NaN })).toBeNull();
    expect(projectFlowPrint({ ...E1, right: "X" })).toBeNull();
    expect(projectFlowPrint({ ...E1, ts: 1730000000000 })).toBeNull();
    expect(projectFlowPrint({ ...E1, premium: -1 })).toBeNull();
    expect(projectFlowPrint({ ...E1, premium: "504000" })).toBeNull();
    expect(projectFlowPrint(null as unknown as FlowPrintInput)).toBeNull();
  });

  it("maps ~buy, ~sell and mixed to bought, sold and mixed estimates and anything else to unknown", () => {
    expect(projectFlowPrint(E1)?.side.estimate).toBe("bought");
    expect(projectFlowPrint({ ...E1, side: "~sell" })?.side.estimate).toBe("sold");
    expect(projectFlowPrint({ ...E1, side: "mixed" })?.side.estimate).toBe("mixed");
    // e3's owner value sits outside the Side union — unknown, never coerced.
    expect(projectFlowPrint({ ...E1, side: "unclassified" })?.side.estimate).toBe("unknown");
    expect(projectFlowPrint(without(E1, "side"))?.side.estimate).toBe("unknown");
  });

  it("names the classification method from signing_source and carries no confidence", () => {
    expect(projectFlowPrint(E1)?.side.method).toBe("tape");
    expect(projectFlowPrint({ ...E1, signing_source: "floor" })?.side.method).toBe("floor");
    expect(projectFlowPrint({ ...E1, signing_source: "psychic" })?.side.method).toBe("unknown");
    expect(projectFlowPrint(without(E1, "signing_source"))?.side.method).toBe("unknown");
    // No owner carries a confidence — the field stays null on every row.
    expect(projectFlowPrint(E1)?.side.confidence).toBeNull();
    expect(projectFlowPrint({ ...E1, confidence: 0.99 })?.side.confidence).toBeNull();
  });

  it("leaves receipt clock, conditions, lineage and quote context null and never fills them from ts", () => {
    // Decoy owner-looking fields must not be promoted into the print view.
    const decoy: FlowPrintInput = {
      ...E1,
      receipt_ts: "2026-10-21T14:40:13Z",
      receiptTs: "2026-10-21T14:40:13Z",
      conditions: { exchange: "CBOE", flag: "intermarket_sweep" },
      lineage: "corrected",
      correction_of: "w3a-e0",
      quote: { bid: 0.83, ask: 0.85 },
    };
    const view = projectFlowPrint(decoy);
    expect(view).not.toBeNull();
    expect(view?.receiptTs).toBeNull();
    expect(view?.conditions).toBeNull();
    expect(view?.lineage).toBeNull();
    expect(view?.quote).toBeNull();
    // The event clock is passed through untouched — never reused as a receipt clock.
    expect(view?.eventTs).toBe(E1.ts);
  });

  it("shows the multiplier arithmetic only when it reproduces the owner's premium", () => {
    const ok = projectFlowPrint(E1);
    expect(ok?.arithmeticReproduces).toBe(true);
    expect(ok?.multiplier).toBe(100);
    // e5: aggregated prints — 4,100 × $0.95 × 100 = $389,500 ≠ $395,000 (0.5% band = $1,975).
    const agg = projectFlowPrint(TAPE[4]);
    expect(agg?.arithmeticReproduces).toBe(false);
    // Missing size or avg_price never renders a fabricated arithmetic; the
    // supplied twin stays finite while the missing one is NaN (rendered as words).
    const noSize = projectFlowPrint(without(E1, "size"));
    expect(noSize?.arithmeticReproduces).toBe(false);
    expect(Number.isNaN(noSize?.size as number)).toBe(true);
    expect(noSize?.avgPrice).toBe(0.84);
    const noPx = projectFlowPrint(without(E1, "avg_price"));
    expect(noPx?.arithmeticReproduces).toBe(false);
    expect(noPx?.size).toBe(6000);
    expect(Number.isNaN(noPx?.avgPrice as number)).toBe(true);
    // Inside the 0.5% band still reproduces; past it does not.
    expect(projectFlowPrint({ ...E1, premium: 505500 })?.arithmeticReproduces).toBe(true);
    expect(projectFlowPrint({ ...E1, premium: 506600 })?.arithmeticReproduces).toBe(false);
  });

  it("computes the dated contracts-over-prior-open-interest ratio only when oi is present", () => {
    const dated = projectFlowPrint(E1, { oiAsOf: "2026-10-20" });
    expect(dated?.ratio?.value).toBeCloseTo(6000 / 3680, 10);
    expect(dated?.ratio?.oiAsOf).toBe("2026-10-20");
    expect(projectFlowPrint(E1)?.ratio?.oiAsOf).toBeNull();
    // No oi (e4), zero, negative, or malformed oi → no ratio at all.
    expect(projectFlowPrint(without(E1, "oi"))?.ratio).toBeNull();
    expect(projectFlowPrint({ ...E1, oi: 0 })?.ratio).toBeNull();
    expect(projectFlowPrint({ ...E1, oi: -3680 })?.ratio).toBeNull();
    expect(projectFlowPrint({ ...E1, oi: "3680" })?.ratio).toBeNull();
  });
});

describe("flowCoverage", () => {
  it("keeps unknown premium in the denominator of the classified share", () => {
    const cov = flowCoverage(TAPE);
    expect(cov.total).toBe(3_071_000);
    expect(cov.rows).toBe(9);
    // e3's $355K (owner value "unclassified") stays in the denominator.
    expect(cov.unknown).toBe(355_000);
    expect(cov.classified).toBe(2_716_000);
    expect(cov.classifiedShare).toBeCloseTo(2_716_000 / 3_071_000, 10);
    expect(cov.unknownShare).toBeCloseTo(355_000 / 3_071_000, 10);
    expect(cov.classifiedShare! + cov.unknownShare!).toBeCloseTo(1, 10);
  });

  it("totals call and put premium unsigned and separately from side", () => {
    const cov = flowCoverage(TAPE);
    expect(cov.callPremium).toBe(2_321_000);
    expect(cov.putPremium).toBe(750_000);
    // Unsigned means side never bleeds into the C/P split: flip every side and
    // the two totals are unchanged.
    const flipped = TAPE.map((row) => ({ ...row, side: row.side === "~buy" ? "~sell" : "~buy" }));
    expect(flowCoverage(flipped).callPremium).toBe(2_321_000);
    expect(flowCoverage(flipped).putPremium).toBe(750_000);
  });

  it("reports no shares when there is no eligible premium", () => {
    expect(flowCoverage([]).total).toBe(0);
    expect(flowCoverage([]).classifiedShare).toBeNull();
    expect(flowCoverage([]).unknownShare).toBeNull();
    const noPremium = flowCoverage([{ ...E1, premium: Number.NaN }, {}]);
    expect(noPremium.total).toBe(0);
    expect(noPremium.classifiedShare).toBeNull();
    expect(noPremium.unknownShare).toBeNull();
  });
});

describe("compareTape", () => {
  it("orders the tape by the chosen key then by id so equal timestamps keep a stable order", () => {
    // NEW: ts descending…
    const e6 = TAPE[5];
    const e9 = TAPE[8];
    expect(compareTape(e1First(), E1, "NEW")).toBeGreaterThan(0); // older row sorts after
    // …and equal timestamps fall back to ascending id: e6 before e9 even when the
    // payload delivers e9 first.
    expect(compareTape(e6, e9, "NEW")).toBeLessThan(0);
    expect(compareTape(e9, e6, "NEW")).toBeGreaterThan(0);
    // Invalid ts never wins the tape; it sinks below every valid row.
    const bad = { id: "w3a-zz", ts: "not-a-date", premium: 1 };
    expect(compareTape(E1, bad, "NEW")).toBeLessThan(0);
    expect(compareTape(bad, E1, "NEW")).toBeGreaterThan(0);
    // Two invalid rows still order by id.
    expect(compareTape(bad, { id: "w3a-zzz", ts: "also-bad" }, "NEW")).toBeLessThan(0);

    // SCORE: score descending first (missing = 0), then ts, then id.
    const scored = { ...e9, flowScore: { score: 80 } };
    expect(compareTape(scored, e6, "SCORE")).toBeLessThan(0);
    expect(compareTape(e6, scored, "SCORE")).toBeGreaterThan(0);
    expect(compareTape(e6, e9, "SCORE")).toBeLessThan(0);
    // A malformed score is a missing score, not a crash.
    expect(compareTape({ ...e6, flowScore: { score: "x" } }, e9, "SCORE")).toBeLessThan(0);

    // A full NEW sort of the fixture tape is deterministic regardless of input order.
    const forward = [...TAPE].sort((a, b) => compareTape(a, b, "NEW")).map((r) => r.id);
    const backward = [...TAPE].reverse().sort((a, b) => compareTape(a, b, "NEW")).map((r) => r.id);
    expect(forward).toEqual(backward);
    // Newest first; e2's tape receipt lands 2 ms after e1's; the e6/e9 tie breaks
    // by ascending id even though the payload could deliver either order.
    expect(forward).toEqual([
      "w3a-e2", "w3a-e1", "w3a-e3", "w3a-e4", "w3a-e5", "w3a-e6", "w3a-e9", "w3a-e7", "w3a-e8",
    ]);
  });
});

function e1First(): FlowPrintInput {
  return { ...E1, ts: "2026-10-21T14:34:30Z" };
}
