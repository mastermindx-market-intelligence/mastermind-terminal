import { describe, expect, it } from "vitest";
import { ALL_MARKETS } from "@/lib/markets";
import {
  ASSET_VALUES, classifyRow, compileFilters, normalizeDefinition, type ScreenDefinition, type ScreenRow, type ScreenerFilters,
} from "@/lib/smartScreen/predicate";
import {
  bucketOf, buildReview, diffScreen, MAX_REVIEW_MATCHES, normalizeReview, REVIEW_BUCKETS, SCREEN_UNIVERSE,
  type ReviewSnapshot, type ScreenChange,
} from "@/lib/smartScreen/review";

// ── fixtures ────────────────────────────────────────────────────────────────────────────

const AT = "2026-10-10T12:00:00.000Z";
const D1 = "2026-10-09";
const D2 = "2026-10-10";

function screen(where: unknown, scope: unknown = { markets: "all", asset: "Equities", unpriced: false }) {
  const result = normalizeDefinition({ grammar: 1, scope, where });
  if (!result.ok) throw new Error(result.error);
  return result;
}

/** chg ≥ 3 AND dollar volume ≥ $1M, US/HK/... equities only. */
const MOMENTUM = screen({ all: [{ f: "chg", op: "gte", v: 3 }, { f: "dv", op: "gte", v: 1e6 }] });

const row = (sym: string, patch: Partial<ScreenRow> = {}): ScreenRow => ({
  sym, sec: "Equities", mktId: "us", last: 50, chg: 5, dv: 2e6, mcap: 1e9, offHi: -10, offLo: 30,
  verdict: "BUY", gics: "Energy", regimeBull: true, ...patch,
});

function review(def: ScreenDefinition, hash: string, rows: ScreenRow[], asOf = D1): ReviewSnapshot {
  const built = buildReview(def, hash, rows, { asOf, at: AT });
  if (!built.ok) throw new Error(built.error);
  return built.review;
}

function diff(def: { def: ScreenDefinition; hash: string }, reviewed: ReviewSnapshot | null, rows: ScreenRow[], asOf: string | null = D2, dataReady = true) {
  return diffScreen(def.def, def.hash, reviewed, rows, { asOf, dataReady });
}

function okDiff(result: ReturnType<typeof diff>) {
  if (!result.ok) throw new Error(`not comparable: ${result.reason}`);
  return result;
}

const bySym = (changes: ScreenChange[]) => Object.fromEntries(changes.map((change) => [change.sym, change]));

/** A symbol (other than `sym`) that lands in the same review bucket. */
function bucketMate(sym: string, prefix: string, skip = new Set<string>()): string {
  for (let i = 0; i < 100_000; i++) {
    const candidate = `${prefix}${i}`;
    if (candidate !== sym && !skip.has(candidate) && bucketOf(candidate) === bucketOf(sym)) return candidate;
  }
  throw new Error("no bucket mate");
}

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)];

// ── the reviewed reference ──────────────────────────────────────────────────────────────

describe("buildReview — the minimal retained reference", () => {
  const rows = [row("AAA"), row("BBB", { chg: 1 }), row("CCC", { chg: null }), row("DDD", { last: null }), row("EEE", { sec: "Funds" })];

  it("keeps only the definition hash, universe, generation, match list and bucket digests", () => {
    const built = buildReview(MOMENTUM.def, MOMENTUM.hash, rows, { asOf: D1, at: AT });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built.review).sort()).toEqual(["asOf", "at", "d", "hash", "m", "pop", "u", "v"]);
    expect(built.review).toMatchObject({ v: 1, hash: MOMENTUM.hash, u: SCREEN_UNIVERSE, asOf: D1, at: AT, m: "AAA" });
    // Population = evaluated rows only (match, fail, unknown): the unpriced and the
    // out-of-scope rows are not part of what the screen judged.
    expect(built.review.pop).toBe(3);
    expect(built.review.d).toHaveLength(REVIEW_BUCKETS * 8);
    // No row data is retained.
    expect(JSON.stringify(built.review)).not.toMatch(/2000000|Energy|BUY"/);
  });

  it("is deterministic: row order does not change the reference", () => {
    const a = buildReview(MOMENTUM.def, MOMENTUM.hash, rows, { asOf: D1, at: AT });
    const b = buildReview(MOMENTUM.def, MOMENTUM.hash, [...rows].reverse(), { asOf: D1, at: AT });
    expect(b).toEqual(a);
  });

  it("refuses rather than truncating", () => {
    expect(buildReview(MOMENTUM.def, MOMENTUM.hash, rows, { asOf: null })).toEqual({ ok: false, error: "generation_unknown" });
    expect(buildReview(MOMENTUM.def, MOMENTUM.hash, rows, { asOf: "yesterday" })).toEqual({ ok: false, error: "generation_unknown" });
    const many = Array.from({ length: MAX_REVIEW_MATCHES + 1 }, (_, i) => row(`M${i}`));
    expect(buildReview(MOMENTUM.def, MOMENTUM.hash, many, { asOf: D1 })).toEqual({ ok: false, error: "too_many_matches", count: MAX_REVIEW_MATCHES + 1 });
    expect(buildReview(MOMENTUM.def, MOMENTUM.hash, [row("A,B")], { asOf: D1 })).toEqual({ ok: false, error: "bad_symbol" });
  });

  it("validates an untrusted reference against the definition it claims", () => {
    const built = review(MOMENTUM.def, MOMENTUM.hash, rows);
    expect(normalizeReview(built, MOMENTUM.hash)).toEqual({ ok: true, review: built });
    expect(normalizeReview(built, "00000000000000")).toEqual({ ok: false, error: "hash_mismatch" });
    expect(normalizeReview({ ...built, v: 2 }, MOMENTUM.hash)).toEqual({ ok: false, error: "unsupported" });
    expect(normalizeReview({ ...built, prices: [1] }, MOMENTUM.hash)).toEqual({ ok: false, error: "bad_field" });
    expect(normalizeReview({ ...built, m: "ZZZ,AAA" }, MOMENTUM.hash)).toEqual({ ok: false, error: "bad_field" });
    expect(normalizeReview({ ...built, d: built.d.slice(1) }, MOMENTUM.hash)).toEqual({ ok: false, error: "bad_field" });
    expect(normalizeReview({ ...built, pop: 0 }, MOMENTUM.hash)).toEqual({ ok: false, error: "bad_field" });
  });
});

// ── AC-E04-05: comparability is declared, not assumed ───────────────────────────────────

describe("comparability", () => {
  const rows = [row("AAA"), row("BBB", { chg: 1 })];
  const reviewed = review(MOMENTUM.def, MOMENTUM.hash, rows);
  const other = screen({ all: [{ f: "chg", op: "gte", v: 4 }] });

  const cases: [string, () => ReturnType<typeof diff>, string][] = [
    ["the current data failed to load", () => diff(MOMENTUM, reviewed, rows, D2, false), "data_unavailable"],
    ["nothing was reviewed", () => diff(MOMENTUM, null, rows), "no_review"],
    ["the reference format is newer", () => diff(MOMENTUM, { ...reviewed, v: 2 } as unknown as ReviewSnapshot, rows), "review_unsupported"],
    ["the definition changed after the review", () => diff(other, reviewed, rows), "definition_changed"],
    ["the universe changed", () => diff(MOMENTUM, { ...reviewed, u: "terminal.other" }, rows), "universe_changed"],
    ["the current generation is unknown", () => diff(MOMENTUM, reviewed, rows, null), "generation_unknown"],
    ["the current generation is unparseable", () => diff(MOMENTUM, reviewed, rows, "not-a-date"), "generation_unknown"],
    ["the current data is OLDER than the review", () => diff(MOMENTUM, reviewed, rows, "2026-10-08"), "older_data"],
  ];
  for (const [label, run, reason] of cases) {
    it(`refuses a diff when ${label} (${reason})`, () => {
      expect(run()).toEqual({ ok: false, reason });
    });
  }

  it("labels a same-generation re-read as a correction, on the diff and on every change", () => {
    const result = okDiff(diff(MOMENTUM, reviewed, [row("AAA", { chg: 1 }), row("BBB")], D1));
    expect(result.correction).toBe(true);
    expect(result.changes.length).toBe(2);
    for (const change of result.changes) expect(change.correction).toBe(true);
    const next = okDiff(diff(MOMENTUM, reviewed, [row("AAA", { chg: 1 }), row("BBB")], D2));
    expect(next.correction).toBe(false);
    for (const change of next.changes) expect(change.correction).toBe(false);
  });
});

// ── the diff: every change kind, with its reason ────────────────────────────────────────

describe("diffScreen — classifies every membership change", () => {
  const gen1 = [
    row("STAY"),
    row("EXIT"),
    row("NOTEVAL"),
    row("LOST"),
    row("UNPRICED"),
    row("MOVED"),
    row("ENTER", { chg: 1 }),
    row("NEWEVAL", { chg: null }),
    row("GAINED2", { last: null }),
    row("FILLER1", { chg: -2 }),
    row("FILLER2", { dv: 10 }),
  ];
  const gen2 = [
    row("STAY"),
    row("EXIT", { chg: 1.25 }),
    row("NOTEVAL", { chg: null }),
    row("UNPRICED", { last: null }),
    row("MOVED", { sec: "Funds" }),
    row("ENTER", { chg: 4 }),
    row("NEWEVAL", { chg: 4 }),
    row("GAINED"),
    row("GAINED2"),
    row("FILLER1", { chg: -2 }),
    row("FILLER2", { dv: 10 }),
  ];
  const reviewed = review(MOMENTUM.def, MOMENTUM.hash, gen1);
  const result = okDiff(diff(MOMENTUM, reviewed, gen2));
  const changes = bySym(result.changes);

  it("calls a name an exit only when current data proves a condition now fails — and says which", () => {
    expect(changes.EXIT).toMatchObject({ kind: "exited", group: "exited", direction: "out", now: "fail" });
    expect(changes.EXIT.because).toEqual([{ f: "chg", op: "gte", v: 3, value: 1.25, result: false }]);
    expect(changes.EXIT.trace).toEqual([
      { f: "chg", op: "gte", v: 3, value: 1.25, result: false },
      { f: "dv", op: "gte", v: 1e6, value: 2e6, result: true },
    ]);
  });

  it("reports a missing field as not evaluable, never as an exit", () => {
    expect(changes.NOTEVAL).toMatchObject({ kind: "not_evaluable", group: "coverage", direction: "out", now: "unknown" });
    expect(changes.NOTEVAL.because).toEqual([{ f: "chg", op: "gte", v: 3, value: null, result: null }]);
  });

  it("reports names that left the data, lost their price or changed scope as coverage changes", () => {
    expect(changes.LOST).toMatchObject({ kind: "coverage_lost", group: "coverage", now: "absent", trace: [], because: [] });
    expect(changes.UNPRICED).toMatchObject({ kind: "coverage_lost", group: "coverage", now: "unpriced" });
    expect(changes.MOVED).toMatchObject({ kind: "out_of_scope", group: "coverage", now: "out_of_scope" });
  });

  it("proves the prior state of every entry from the bucket digests", () => {
    expect(changes.ENTER).toMatchObject({ kind: "entered", group: "entered", direction: "in", now: "match" });
    expect(changes.ENTER.because.map((leaf) => leaf.result)).toEqual([true, true]);
    expect(changes.NEWEVAL).toMatchObject({ kind: "newly_evaluable", group: "coverage", direction: "in" });
    expect(changes.GAINED).toMatchObject({ kind: "coverage_gained", group: "coverage", direction: "in" });
    expect(changes.GAINED2).toMatchObject({ kind: "coverage_gained", group: "coverage", direction: "in" });
  });

  it("accounts for every name: then = stayed + exits, now = stayed + entries", () => {
    expect(Object.keys(changes).sort()).toEqual(["ENTER", "EXIT", "GAINED", "GAINED2", "LOST", "MOVED", "NEWEVAL", "NOTEVAL", "UNPRICED"]);
    const outs = result.changes.filter((change) => change.direction === "out").length;
    const ins = result.changes.filter((change) => change.direction === "in").length;
    expect(result.stayed).toBe(1);
    expect(result.stayed + outs).toBe(reviewed.m.split(",").length);
    expect(result.stayed + ins).toBe(result.matchesNow);
    expect(result).toMatchObject({ fromAsOf: D1, toAsOf: D2, reviewedAt: AT, populationThen: 10, correction: false });
  });

  it("orders entered, exited, coverage, unverified — then by symbol", () => {
    expect(result.changes.map((change) => change.sym)).toEqual([
      "ENTER", "EXIT", "GAINED", "GAINED2", "LOST", "MOVED", "NEWEVAL", "NOTEVAL", "UNPRICED",
    ]);
  });

  it("an unchanged generation has no changes", () => {
    const same = okDiff(diff(MOMENTUM, reviewed, gen1, D2));
    expect(same.changes).toEqual([]);
    expect(same.stayed).toBe(reviewed.m.split(",").length);
  });
});

describe("diffScreen — says 'unverified' instead of guessing", () => {
  it("when another name in the entrant's bucket also changed state", () => {
    const entrant = "ZQX";
    const mate = bucketMate(entrant, "MATE");
    const gen1 = [row("AAA"), row(entrant, { chg: 1 }), row(mate, { chg: 1 })];
    // The mate goes from evaluated-false to unknown: still not a match, but the bucket no
    // longer reproduces — the entrant's prior state cannot be proven, so it is not claimed.
    const gen2 = [row("AAA"), row(entrant, { chg: 4 }), row(mate, { chg: null })];
    const result = okDiff(diff(MOMENTUM, review(MOMENTUM.def, MOMENTUM.hash, gen1), gen2));
    expect(result.changes).toEqual([
      expect.objectContaining({ sym: entrant, kind: "unverified", group: "unverified", direction: "in" }),
    ]);
  });

  it("proves several entrants in one bucket, and refuses a mixed bucket it cannot enumerate", () => {
    const first = "BKT0";
    const skip = new Set<string>();
    const mates: string[] = [first];
    while (mates.length < 5) { const next = bucketMate(first, "BKT", skip); skip.add(next); mates.push(next); }
    // Five entrants in one bucket that were all evaluated-false: the uniform hypothesis proves it.
    const allFalse = okDiff(diff(
      MOMENTUM,
      review(MOMENTUM.def, MOMENTUM.hash, mates.map((sym) => row(sym, { chg: 0 }))),
      mates.map((sym) => row(sym)),
    ));
    expect(allFalse.changes.map((change) => change.kind)).toEqual(["entered", "entered", "entered", "entered", "entered"]);
    // Mixed prior states (false and unknown) across five entrants: not enumerated → unverified.
    const mixed = okDiff(diff(
      MOMENTUM,
      review(MOMENTUM.def, MOMENTUM.hash, mates.map((sym, i) => row(sym, { chg: i % 2 ? null : 0 }))),
      mates.map((sym) => row(sym)),
    ));
    expect(new Set(mixed.changes.map((change) => change.kind))).toEqual(new Set(["unverified"]));
  });
});

// ── AC-E04-02 + the falsifier, as properties over random generations ────────────────────

const SECTORS = ["Energy", "Health Care", "Real Estate"];

function randomRows(rand: () => number, n: number): ScreenRow[] {
  const maybe = <T,>(value: T): T | null => (rand() < 0.15 ? null : value);
  return Array.from({ length: n }, (_, i) => ({
    sym: `R${i}`,
    sec: pick(rand, ["Equities", "Equities", "Equities", ...ASSET_VALUES]),
    mktId: pick(rand, ALL_MARKETS),
    last: maybe(1 + Math.round(rand() * 1000)),
    chg: maybe(Math.round((rand() - 0.5) * 2000) / 100),
    dv: maybe(pick(rand, [0, 1e6, 5e6, 2e7]) * (0.5 + rand())),
    mcap: maybe(pick(rand, [3e8, 2e9, 1e10]) * (0.5 + rand())),
    offHi: maybe(-Math.round(rand() * 6000) / 100),
    offLo: maybe(Math.round(rand() * 6000) / 100),
    verdict: maybe(pick(rand, ["BUY", "SELL", "REBUY", "CUT"])),
    gics: maybe(pick(rand, SECTORS)),
    regimeBull: pick(rand, [true, false, null]),
  }));
}

function randomFilters(rand: () => number): ScreenerFilters {
  return {
    market: pick(rand, ["all", "all", "us", "hk"] as const),
    asset: pick(rand, ["all", "Equities"]),
    sector: pick(rand, ["all", "all", ...SECTORS]),
    signal: pick(rand, ["any", "any", "buy", "sell", "tracked"] as const),
    uptrend: rand() < 0.3,
    liq: pick(rand, [0, 0, 1e6, 5e6]),
    mcap: pick(rand, [0, 0, 2e9]),
    w52: pick(rand, ["any", "any", "nearHigh", "within15", "dd30", "nearLow"] as const),
    move: pick(rand, ["any", "any", "up3", "down3", "abs5"] as const),
    unpriced: rand() < 0.2,
  };
}

const NULLABLE: (keyof ScreenRow)[] = ["last", "chg", "dv", "mcap", "offHi", "offLo", "verdict", "gics", "regimeBull"];

/** The falsifier, as a checkable statement: every change carries the retained predicate's
 *  leaves and the current values that decide it, and the stated kind follows from them. */
function assertExplainable(change: ScreenChange, def: ScreenDefinition, rowsNow: Map<string, ScreenRow>) {
  const now = rowsNow.get(change.sym);
  if (change.direction === "out") {
    if (change.kind === "exited") {
      expect(change.because.length).toBeGreaterThan(0);
      for (const leaf of change.because) { expect(leaf.result).toBe(false); expect(leaf.value).not.toBeNull(); }
      expect(now && classifyRow(def, now).status).toBe("fail");
    } else if (change.kind === "not_evaluable") {
      expect(change.because.length).toBeGreaterThan(0);
      for (const leaf of change.because) { expect(leaf.result).toBeNull(); expect(leaf.value).toBeNull(); }
    } else {
      expect(["coverage_lost", "out_of_scope"]).toContain(change.kind);
      expect(change.because).toEqual([]);
    }
  } else {
    expect(now && classifyRow(def, now).status).toBe("match");
    expect(change.trace).toEqual(now ? classifyRow(def, now).trace : []);
  }
}

describe("properties", () => {
  it("removing data (nulling fields, dropping prices or rows) never manufactures an exit", () => {
    const rand = prng(4242);
    let exitsSeen = 0;
    let coverageSeen = 0;
    for (let round = 0; round < 120; round++) {
      const f = randomFilters(rand);
      const compiled = compileFilters(f, { prefsEnabled: null, showAllMarkets: false });
      if (!compiled.ok) throw new Error("compile failed");
      const gen1 = randomRows(rand, 160);
      const reviewed = buildReview(compiled.def, compiled.hash, gen1, { asOf: D1, at: AT });
      if (!reviewed.ok) continue;
      // Generation 2 only LOSES information: no value changes, just missing data.
      const gen2 = gen1
        .filter(() => rand() > 0.08)
        .map((r) => {
          const next = { ...r } as Record<string, unknown>;
          for (const key of NULLABLE) if (rand() < 0.2) next[key] = null;
          return next as ScreenRow;
        });
      const result = okDiff(diffScreen(compiled.def, compiled.hash, reviewed.review, gen2, { asOf: D2, dataReady: true }));
      for (const change of result.changes) {
        expect(change.kind, JSON.stringify({ f, change })).not.toBe("exited");
        if (change.direction === "out") coverageSeen++;
      }
      exitsSeen += result.changes.filter((change) => change.kind === "exited").length;
    }
    expect(exitsSeen).toBe(0);
    // The property must be exercised, not vacuously true.
    expect(coverageSeen).toBeGreaterThan(200);
  });

  it("every change is explainable from the retained predicate and current data, and every name is accounted for", () => {
    const rand = prng(777);
    const kinds = new Set<string>();
    for (let round = 0; round < 120; round++) {
      const f = randomFilters(rand);
      const compiled = compileFilters(f, { prefsEnabled: null, showAllMarkets: false });
      if (!compiled.ok) throw new Error("compile failed");
      const gen1 = randomRows(rand, 160);
      const reviewed = buildReview(compiled.def, compiled.hash, gen1, { asOf: D1, at: AT });
      if (!reviewed.ok) continue;
      // Generation 2: some values move, some go missing, some names leave, some arrive.
      const moved = randomRows(rand, 160);
      const gen2 = gen1
        .filter(() => rand() > 0.05)
        .map((r, i) => (rand() < 0.25 ? { ...moved[i], sym: r.sym } : r))
        .concat(randomRows(rand, 12).map((r, i) => ({ ...r, sym: `NEW${round}_${i}` })));
      const rowsNow = new Map(gen2.map((r) => [r.sym, r]));
      const result = okDiff(diffScreen(compiled.def, compiled.hash, reviewed.review, gen2, { asOf: D2, dataReady: true }));
      for (const change of result.changes) {
        kinds.add(change.kind);
        assertExplainable(change, compiled.def, rowsNow);
      }
      const priorCount = reviewed.review.m ? reviewed.review.m.split(",").length : 0;
      expect(result.stayed + result.changes.filter((c) => c.direction === "out").length).toBe(priorCount);
      expect(result.stayed + result.changes.filter((c) => c.direction === "in").length).toBe(result.matchesNow);
    }
    // All the kinds a real generation change produces were exercised.
    for (const kind of ["exited", "not_evaluable", "coverage_lost", "out_of_scope", "entered", "coverage_gained"]) {
      expect(kinds, kind).toContain(kind);
    }
  });
});
