import { describe, expect, it } from "vitest";
import {
  COVERAGE_STATUSES,
  SCREENER_SCAN_SCHEMA,
  accountCoverage,
  adoptGeneration,
  combineAll,
  generationAgeDays,
  knownCell,
  matchCell,
  matchIn,
  matchRange,
  matchUnknown,
  parseScanEnvelope,
  passes,
  unknownCell,
  type Coverage,
  type ScanMatch,
} from "../screenerScan";

describe("screenerScan — unknown never passes a filter", () => {
  const unknown = unknownCell<number>("unavailable", "not_in_scan");
  const stale = unknownCell<number>("stale", "engine_mismatch");

  it("an unknown cell is 'unknown', never 'pass', without an explicit opt-in", () => {
    expect(matchCell(unknown, () => true)).toBe("unknown");
    expect(matchCell(unknown, () => true, {})).toBe("unknown");
    expect(matchCell(unknown, () => true, { includeUnknown: false })).toBe("unknown");
    expect(matchCell(stale, () => true)).toBe("unknown");
    expect(passes(matchCell(unknown, () => true))).toBe(false);
  });

  it("includeUnknown:true is the only way an unknown value passes", () => {
    expect(matchCell(unknown, () => false, { includeUnknown: true })).toBe("pass");
  });

  it("known values pass or fail on the test alone", () => {
    expect(matchCell(knownCell(3), (v) => v > 2)).toBe("pass");
    expect(matchCell(knownCell(1), (v) => v > 2)).toBe("fail");
    // includeUnknown never turns a known failure into a pass
    expect(matchCell(knownCell(1), (v) => v > 2, { includeUnknown: true })).toBe("fail");
  });

  it("the explicit unknown predicate selects exactly the unknown cells", () => {
    expect(matchUnknown(unknown)).toBe("pass");
    expect(matchUnknown(knownCell(0))).toBe("fail");
  });

  it("ranges are inclusive and a non-finite known number can never satisfy a threshold", () => {
    expect(matchRange(knownCell(0.15), { gte: 0.15 })).toBe("pass");
    expect(matchRange(knownCell(0.15), { lte: 0.15 })).toBe("pass");
    expect(matchRange(knownCell(0.149), { gte: 0.15 })).toBe("fail");
    // stored units are compared verbatim — no double scaling of a fraction (AC-E02-01)
    expect(matchRange(knownCell(0.15), { gte: 15 })).toBe("fail");
    expect(matchRange(knownCell(Number.NaN), { gte: -1e9 })).toBe("unknown");
    expect(matchRange(knownCell(Number.POSITIVE_INFINITY), { gte: 0 })).toBe("unknown");
    expect(matchRange(knownCell(Number.NaN), { gte: 0 }, { includeUnknown: true })).toBe("pass");
    expect(matchRange(knownCell(5), {})).toBe("pass");
    expect(matchRange(unknown, { gte: 0 })).toBe("unknown");
  });

  it("set membership", () => {
    expect(matchIn(knownCell("long"), ["long"])).toBe("pass");
    expect(matchIn(knownCell("flat"), ["long"])).toBe("fail");
    expect(matchIn(unknownCell<string>("evaluated", "field_null"), ["long"])).toBe("unknown");
  });
});

describe("screenerScan — Kleene AND", () => {
  const all: ScanMatch[] = ["pass", "fail", "unknown"];
  const expected = (a: ScanMatch, b: ScanMatch): ScanMatch =>
    a === "fail" || b === "fail" ? "fail" : a === "unknown" || b === "unknown" ? "unknown" : "pass";

  it("matches the three-valued truth table for every pair", () => {
    for (const a of all) for (const b of all) expect(combineAll([a, b])).toBe(expected(a, b));
  });

  it("a known contradiction outranks missing evidence; an empty screen filters nothing", () => {
    expect(combineAll(["unknown", "fail", "unknown"])).toBe("fail");
    expect(combineAll(["pass", "unknown", "pass"])).toBe("unknown");
    expect(combineAll([])).toBe("pass");
  });

  it("only 'pass' admits a row", () => {
    expect(all.filter(passes)).toEqual(["pass"]);
  });
});

describe("screenerScan — coverage accounting sums to the requested universe", () => {
  it("partitions into exactly four disjoint populations", () => {
    const table: Record<string, Coverage> = {
      A: { status: "evaluated", reason: "ok" },
      B: { status: "stale", reason: "engine_mismatch" },
      C: { status: "unsupported", reason: "rate_series" },
      D: { status: "unavailable", reason: "not_in_scan" },
      E: { status: "unavailable", reason: "not_in_scan" },
    };
    const acct = accountCoverage(["A", "B", "C", "D", "E", "A", "D"], (id) => table[id]);
    expect(acct).toEqual({
      total: 5, evaluated: 1, stale: 1, unsupported: 1, unavailable: 2,
      byReason: {
        evaluated: { ok: 1 }, stale: { engine_mismatch: 1 }, unsupported: { rate_series: 1 },
        unavailable: { not_in_scan: 2 },
      },
    });
  });

  it("never drops an id: a bad or throwing classifier counts as unavailable/invalid_coverage", () => {
    const acct = accountCoverage(["X", "Y", "Z", "W"], (id) => {
      if (id === "X") return { status: "bogus" as never, reason: "ok" };
      if (id === "Y") throw new Error("boom");
      if (id === "Z") return { status: "evaluated", reason: "Not A Code" };
      return undefined as unknown as Coverage;
    });
    expect(acct.total).toBe(4);
    expect(acct.unavailable).toBe(4);
    expect(acct.byReason.unavailable).toEqual({ invalid_coverage: 4 });
  });

  it("holds the sum invariant for arbitrary (seeded) universes", () => {
    let seed = 0x9e3779b9;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let trial = 0; trial < 50; trial++) {
      const n = Math.floor(rnd() * 400);
      const ids = Array.from({ length: n }, () => `S${Math.floor(rnd() * 300)}`);
      const pick = new Map<string, Coverage>();
      const acct = accountCoverage(ids, (id) => {
        if (!pick.has(id)) pick.set(id, { status: COVERAGE_STATUSES[Math.floor(rnd() * 4)], reason: "r" });
        return pick.get(id)!;
      });
      expect(acct.total).toBe(new Set(ids).size);
      expect(acct.evaluated + acct.stale + acct.unsupported + acct.unavailable).toBe(acct.total);
      const reasonSum = COVERAGE_STATUSES.reduce((s, st) => s + Object.values(acct.byReason[st]).reduce((a, b) => a + b, 0), 0);
      expect(reasonSum).toBe(acct.total);
    }
  });
});

describe("screenerScan — envelope validation", () => {
  const good = () => ({
    schema: SCREENER_SCAN_SCHEMA,
    family: "technical",
    family_version: 1,
    generation: 1791669600,
    generated_at: "2026-10-10T22:00:00Z",
    complete: true,
    universe: { source: "manifest", as_of: "2026-10-09", count: 2 },
    rows: [{ sym: "AAA" }, { sym: "BBB" }],
  });
  const parse = (raw: unknown) => parseScanEnvelope(raw, "technical", [1]);

  it("accepts a well-formed envelope", () => {
    const r = parse(good());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.generation).toBe(1791669600);
      expect(r.value.generatedAtMs).toBe(Date.parse("2026-10-10T22:00:00Z"));
      expect(r.value.rows.map((x) => x.sym)).toEqual(["AAA", "BBB"]);
    }
  });

  const cases: [string, (d: ReturnType<typeof good>) => unknown, string][] = [
    ["not an object", () => [], "not_an_object"],
    ["unknown schema", (d) => ({ ...d, schema: "mastermind.screener_scan/v2" }), "schema_unsupported"],
    ["other family", (d) => ({ ...d, family: "fundamental" }), "family_mismatch"],
    ["unknown family_version", (d) => ({ ...d, family_version: 2 }), "family_version_unsupported"],
    ["zero generation", (d) => ({ ...d, generation: 0 }), "generation_invalid"],
    ["fractional generation", (d) => ({ ...d, generation: 1.5 }), "generation_invalid"],
    ["string generation", (d) => ({ ...d, generation: "1791669600" }), "generation_invalid"],
    ["unparseable generated_at", (d) => ({ ...d, generated_at: "yesterday" }), "generated_at_invalid"],
    ["non-boolean complete", (d) => ({ ...d, complete: "yes" }), "complete_invalid"],
    ["universe from another source", (d) => ({ ...d, universe: { ...d.universe, source: "flagship" } }), "universe_invalid"],
    ["dropped row", (d) => ({ ...d, universe: { ...d.universe, count: 3 } }), "row_count_mismatch"],
    ["row without sym", (d) => ({ ...d, rows: [{ sym: "AAA" }, { name: "x" }] }), "row_identity_invalid"],
    ["empty sym", (d) => ({ ...d, rows: [{ sym: "AAA" }, { sym: "" }] }), "row_identity_invalid"],
    ["duplicate sym", (d) => ({ ...d, rows: [{ sym: "AAA" }, { sym: "AAA" }] }), "row_identity_duplicate"],
  ];
  for (const [name, mutate, error] of cases) {
    it(`rejects ${name}`, () => {
      expect(parse(mutate(good()))).toEqual({ ok: false, error });
    });
  }

  it("treats listings as exact keys: a case variant is a distinct listing, not a collision", () => {
    const d = { ...good(), rows: [{ sym: "AAA" }, { sym: "aaa" }] };
    expect(parse(d).ok).toBe(true);
  });
});

describe("screenerScan — generation adoption (AC-E01-03)", () => {
  const C = (generation: number) => ({ generation, complete: true });
  const P = (generation: number) => ({ generation, complete: false });

  it("an incomplete generation never supersedes a complete one", () => {
    expect(adoptGeneration(C(100), P(200))).toEqual({ adopt: false, reason: "incomplete_over_complete" });
  });
  it("a newer complete generation is adopted over either kind", () => {
    expect(adoptGeneration(C(100), C(200))).toEqual({ adopt: true, reason: "newer_complete" });
    expect(adoptGeneration(P(100), C(200))).toEqual({ adopt: true, reason: "newer_complete" });
  });
  it("an older or equal generation never replaces what is held", () => {
    expect(adoptGeneration(C(200), C(100))).toEqual({ adopt: false, reason: "not_newer" });
    expect(adoptGeneration(C(200), C(200))).toEqual({ adopt: false, reason: "not_newer" });
    expect(adoptGeneration(P(200), C(150))).toEqual({ adopt: false, reason: "not_newer" });
  });
  it("incomplete replaces incomplete only when newer", () => {
    expect(adoptGeneration(P(100), P(200))).toEqual({ adopt: true, reason: "newer_incomplete" });
  });
  it("the first generation is adopted even if incomplete (it is labelled, not hidden)", () => {
    expect(adoptGeneration(null, P(1))).toEqual({ adopt: true, reason: "first" });
  });
  it("an invalid incoming generation is never adopted", () => {
    expect(adoptGeneration(C(1), null)).toEqual({ adopt: false, reason: "invalid_incoming" });
    expect(adoptGeneration(null, { generation: 0, complete: true })).toEqual({ adopt: false, reason: "invalid_incoming" });
    expect(adoptGeneration(null, { generation: 2.5, complete: true })).toEqual({ adopt: false, reason: "invalid_incoming" });
  });
});

describe("screenerScan — generation age", () => {
  it("measures days since generated_at and clamps the future to 0", () => {
    const env = { generatedAtMs: Date.parse("2026-10-10T00:00:00Z") };
    expect(generationAgeDays(env, Date.parse("2026-10-12T12:00:00Z"))).toBe(2.5);
    expect(generationAgeDays(env, new Date("2026-10-09T00:00:00Z"))).toBe(0);
  });
});
