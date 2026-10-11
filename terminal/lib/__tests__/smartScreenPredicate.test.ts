import { describe, expect, it } from "vitest";
import { ALL_MARKETS, type MarketId } from "@/lib/markets";
import {
  ASSET_VALUES, classifyRow, compileFilters, decompileToFilters, DEFAULT_SCREENER_FILTERS, MAX_LEAVES,
  normalizeDefinition, type MarketContext, type ScreenRow, type ScreenerFilters,
} from "@/lib/smartScreen/predicate";

// ── helpers ─────────────────────────────────────────────────────────────────────────────

const def = (where: unknown, scope: unknown = { markets: "all", asset: null, unpriced: false }) =>
  ({ grammar: 1, scope, where });

const ok = (input: unknown) => {
  const result = normalizeDefinition(input);
  if (!result.ok) throw new Error(`expected ok, got ${result.error} at ${result.path}`);
  return result;
};

const row = (patch: Partial<ScreenRow> = {}): ScreenRow => ({
  sym: "AAA", sec: "Equities", mktId: "us", last: 10, chg: 1, dv: 5e6, mcap: 2e9, offHi: -10, offLo: 20,
  verdict: "BUY", gics: "Energy", regimeBull: true, ...patch,
});

/** Deterministic PRNG (mulberry32) so a parity failure is reproducible. */
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

// ── AC-E04-01: deterministic, bounded representation; unknown input rejects ─────────────

describe("normalizeDefinition — rejects instead of ignoring", () => {
  const leaf = { f: "chg", op: "gte", v: 3 };
  const cases: [string, unknown, string][] = [
    ["not an object", "chg > 3", "not_object"],
    ["a newer grammar", { ...def({ all: [leaf] }), grammar: 2 }, "grammar_newer"],
    ["a missing grammar", { scope: { markets: "all", asset: null, unpriced: false }, where: { all: [leaf] } }, "grammar_invalid"],
    ["an unknown top-level key", { ...def({ all: [leaf] }), score: "x" }, "unknown_key"],
    ["an unknown field", def({ all: [{ f: "pe", op: "gte", v: 3 }] }), "unknown_field"],
    ["an unknown operator", def({ all: [{ f: "chg", op: "gt", v: 3 }] }), "unknown_op"],
    ["a code-like operator", def({ all: [{ f: "chg", op: "expr", v: "x>1" }] }), "unknown_op"],
    ["an extra leaf key", def({ all: [{ f: "chg", op: "gte", v: 3, w: 1 }] }), "unknown_key"],
    ["a string number", def({ all: [{ f: "chg", op: "gte", v: "3" }] }), "bad_value"],
    ["a NaN threshold", def({ all: [{ f: "chg", op: "gte", v: Number.NaN }] }), "bad_value"],
    ["an unbounded threshold", def({ all: [{ f: "dv", op: "gte", v: 1e16 }] }), "bad_value"],
    ["a verdict typo", def({ all: [{ f: "verdict", op: "in", v: ["BYU"] }] }), "bad_value"],
    ["an empty value list", def({ all: [{ f: "verdict", op: "in", v: [] }] }), "bad_value"],
    ["a string on a boolean field",def({ all: [{ f: "regimeBull", op: "is", v: "yes" }] }), "bad_value"],
    ["an empty OR root", def({ any: [] }), "empty_group"],
    ["an empty nested group", def({ all: [leaf, { any: [] }] }), "empty_group"],
    ["an unknown market", def({ all: [leaf] }, { markets: ["us", "mars"], asset: null, unpriced: false }), "bad_scope"],
    ["an unknown asset", def({ all: [leaf] }, { markets: "all", asset: "Stocks", unpriced: false }), "bad_scope"],
    ["an unknown scope key", def({ all: [leaf] }, { markets: "all", asset: null, unpriced: false, region: "x" }), "unknown_key"],
    ["too deep", def({ all: [{ any: [{ all: [{ any: [leaf, { f: "chg", op: "lte", v: -3 }] }, { f: "dv", op: "gte", v: 1 }] }, { f: "mcap", op: "gte", v: 1 }] }] }), "too_deep"],
  ];
  for (const [label, input, code] of cases) {
    it(`rejects ${label} (${code})`, () => {
      const result = normalizeDefinition(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(code);
    });
  }

  it(`rejects more than ${MAX_LEAVES} conditions`, () => {
    const leaves = Array.from({ length: MAX_LEAVES + 1 }, (_, i) => ({ f: "dv", op: "gte", v: i + 1 }));
    const result = normalizeDefinition(def({ any: [{ all: leaves.slice(0, 9) }, { all: leaves.slice(9) }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("too_many_leaves");
  });
});

describe("normalizeDefinition — one canonical form and hash", () => {
  it("is independent of operand order, duplicates, nesting spelling and market order", () => {
    const a = ok(def(
      { all: [{ f: "chg", op: "gte", v: 3 }, { f: "verdict", op: "in", v: ["REBUY", "BUY"] }, { f: "dv", op: "gte", v: 1e6 }] },
      { markets: ["hk", "us"], asset: "Equities", unpriced: false },
    ));
    const b = ok(def(
      { all: [{ all: [{ f: "dv", op: "gte", v: 1e6 }, { f: "verdict", op: "in", v: ["BUY", "REBUY", "BUY"] }] }, { f: "chg", op: "gte", v: 3 }, { f: "chg", op: "gte", v: 3 }] },
      { markets: ["us", "hk", "us"], asset: "Equities" },
    ));
    expect(b.canonical).toBe(a.canonical);
    expect(b.hash).toBe(a.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{14}$/);
  });

  it("is idempotent: normalizing the normalized definition changes nothing", () => {
    const first = ok(def({ any: [{ f: "chg", op: "gte", v: 5 }, { f: "chg", op: "lte", v: -5 }] }));
    const again = ok(first.def);
    expect(again.canonical).toBe(first.canonical);
    expect(again.hash).toBe(first.hash);
    expect(JSON.parse(JSON.stringify(first.def))).toEqual(first.def);
  });

  it("spells every-market as 'all' so both spellings are the same population", () => {
    expect(ok(def({ all: [] }, { markets: [...ALL_MARKETS], asset: null, unpriced: false })).hash)
      .toBe(ok(def({ all: [] })).hash);
  });

  it("distinguishes definitions that mean different things", () => {
    const hashes = new Set([
      ok(def({ all: [{ f: "chg", op: "gte", v: 3 }] })).hash,
      ok(def({ all: [{ f: "chg", op: "lte", v: 3 }] })).hash,
      ok(def({ all: [{ f: "chg", op: "gte", v: 3.5 }] })).hash,
      ok(def({ any: [{ f: "chg", op: "gte", v: 3 }, { f: "dv", op: "gte", v: 1 }] })).hash,
      ok(def({ all: [{ f: "chg", op: "gte", v: 3 }, { f: "dv", op: "gte", v: 1 }] })).hash,
      ok(def({ all: [{ f: "chg", op: "gte", v: 3 }] }, { markets: ["us"], asset: null, unpriced: false })).hash,
      ok(def({ all: [{ f: "chg", op: "gte", v: 3 }] }, { markets: "all", asset: null, unpriced: true })).hash,
    ]);
    expect(hashes.size).toBe(7);
  });
});

// ── AC-E04-02: missing data is UNKNOWN, never false ─────────────────────────────────────

describe("three-valued evaluation", () => {
  const leaves: [string, unknown, keyof ScreenRow][] = [
    ["gte", { f: "dv", op: "gte", v: 1 }, "dv"],
    ["lte", { f: "offHi", op: "lte", v: -30 }, "offHi"],
    ["in", { f: "verdict", op: "in", v: ["BUY"] }, "verdict"],
    ["nin", { f: "verdict", op: "nin", v: ["BUY"] }, "verdict"],
    ["present", { f: "verdict", op: "present" }, "verdict"],
    ["is", { f: "regimeBull", op: "is", v: true }, "regimeBull"],
  ];
  for (const [op, leaf, field] of leaves) {
    it(`a missing field is unknown for '${op}' (never a quiet false)`, () => {
      const verdict = classifyRow(ok(def({ all: [leaf] })).def, row({ [field]: null } as Partial<ScreenRow>));
      expect(verdict.status).toBe("unknown");
      expect(verdict.trace).toEqual([expect.objectContaining({ value: null, result: null })]);
    });
  }

  it("AND: false beats unknown; unknown beats true", () => {
    const and = ok(def({ all: [{ f: "dv", op: "gte", v: 1 }, { f: "chg", op: "gte", v: 3 }] })).def;
    expect(classifyRow(and, row({ dv: null, chg: 0 })).status).toBe("fail");
    expect(classifyRow(and, row({ dv: null, chg: 5 })).status).toBe("unknown");
    expect(classifyRow(and, row({ dv: 2, chg: 5 })).status).toBe("match");
  });

  it("OR: true beats unknown; unknown beats false", () => {
    const or = ok(def({ any: [{ f: "dv", op: "gte", v: 1 }, { f: "chg", op: "gte", v: 3 }] })).def;
    expect(classifyRow(or, row({ dv: null, chg: 5 })).status).toBe("match");
    expect(classifyRow(or, row({ dv: null, chg: 0 })).status).toBe("unknown");
    expect(classifyRow(or, row({ dv: 0, chg: 0 })).status).toBe("fail");
  });

  it("traces every leaf (no short-circuit) so a verdict is always explainable", () => {
    const and = ok(def({ all: [{ f: "dv", op: "gte", v: 1 }, { f: "chg", op: "gte", v: 3 }, { f: "gics", op: "in", v: ["Energy"] }] })).def;
    const verdict = classifyRow(and, row({ dv: 0, chg: null }));
    expect(verdict.trace.map((leaf) => [leaf.f, leaf.result])).toEqual([["chg", null], ["dv", false], ["gics", true]]);
  });

  it("keeps out-of-scope and unpriced rows out of the evaluated population", () => {
    const screen = ok(def({ all: [] }, { markets: ["hk"], asset: "Equities", unpriced: false })).def;
    expect(classifyRow(screen, row({ mktId: "us" })).status).toBe("out_of_scope");
    expect(classifyRow(screen, row({ mktId: "hk", sec: "Funds" })).status).toBe("out_of_scope");
    expect(classifyRow(screen, row({ mktId: "hk", last: null })).status).toBe("unpriced");
    expect(classifyRow(screen, row({ mktId: "hk" })).status).toBe("match");
    const thin = ok(def({ all: [] }, { markets: ["hk"], asset: null, unpriced: true })).def;
    expect(classifyRow(thin, row({ mktId: "hk", last: null })).status).toBe("match");
  });
});

// ── the filter bar ⇄ grammar: row-for-row parity with the table ─────────────────────────

/**
 * The table's predicate, transcribed from ScreenerView's `base` filter (search excluded; the
 * device-market gate applied the way `gateByPrefs` + `isSymbolVisible` apply it, on the row's
 * precomputed `mktId`). If ScreenerView's filter changes, this transcription and
 * compileFilters must change together — the e2e journey re-checks the count on the real table.
 */
const isBuy = (v: string | null) => v === "BUY" || v === "REBUY" || v === "RECLAIM";
function tableKeeps(r: ScreenRow, f: ScreenerFilters, ctx: MarketContext): boolean {
  const explicitMkt = f.market !== "all";
  const gate = !explicitMkt && ctx.prefsEnabled !== null && !ctx.showAllMarkets && ctx.prefsEnabled.length < ALL_MARKETS.length;
  if (!f.unpriced && r.last == null) return false;
  if (explicitMkt && r.mktId !== f.market) return false;
  if (f.asset !== "all" && r.sec !== f.asset) return false;
  if (f.sector !== "all" && r.gics !== f.sector) return false;
  if (f.signal === "buy" && !isBuy(r.verdict)) return false;
  if (f.signal === "sell" && (r.verdict == null || isBuy(r.verdict))) return false;
  if (f.signal === "tracked" && r.verdict == null) return false;
  if (f.uptrend && r.regimeBull !== true) return false;
  if (f.liq > 0 && (r.dv == null || r.dv < f.liq)) return false;
  if (f.mcap > 0 && (r.mcap == null || r.mcap < f.mcap)) return false;
  if (f.w52 === "nearHigh" && (r.offHi == null || r.offHi < -5)) return false;
  if (f.w52 === "within15" && (r.offHi == null || r.offHi < -15)) return false;
  if (f.w52 === "dd30" && (r.offHi == null || r.offHi > -30)) return false;
  if (f.w52 === "nearLow" && (r.offLo == null || r.offLo > 10)) return false;
  if (f.move !== "any") {
    if (r.chg == null) return false;
    if (f.move === "up3" && r.chg < 3) return false;
    if (f.move === "down3" && r.chg > -3) return false;
    if (f.move === "abs5" && Math.abs(r.chg) < 5) return false;
  }
  if (gate && !(ctx.prefsEnabled as MarketId[]).includes(r.mktId)) return false;
  return true;
}

const SECTORS = ["Energy", "Health Care", "Information Technology", "Real Estate"];
const VERDICTS = [null, "BUY", "REBUY", "RECLAIM", "SELL", "CUT", "EARLY", "STOP", "HOLD"];

function makeRows(rand: () => number, n: number): ScreenRow[] {
  const maybe = <T,>(value: T): T | null => (rand() < 0.18 ? null : value);
  // Positive prices only here: a 0 price is the one disclosed divergence (tested separately).
  return Array.from({ length: n }, (_, i) => ({
    sym: `S${i}`,
    sec: pick(rand, ASSET_VALUES),
    mktId: pick(rand, ALL_MARKETS),
    last: maybe(Math.round(rand() * 50000) / 100 + 0.01),
    chg: maybe(pick(rand, [-5, -3, 3, 5, 0]) + (rand() < 0.5 ? 0 : Math.round((rand() - 0.5) * 2000) / 100)),
    dv: maybe(pick(rand, [0, 1e6, 5e6, 20e6, 100e6]) * (rand() < 0.5 ? 1 : 1 + rand())),
    mcap: maybe(pick(rand, [0, 3e8, 2e9, 1e10, 2e11]) * (rand() < 0.5 ? 1 : 1 + rand())),
    offHi: maybe(pick(rand, [-5, -15, -30, 0, -60]) + (rand() < 0.5 ? 0 : Math.round((rand() - 0.5) * 2000) / 100)),
    offLo: maybe(pick(rand, [10, 0, 50]) + (rand() < 0.5 ? 0 : Math.round(rand() * 2000) / 100)),
    verdict: pick(rand, VERDICTS),
    gics: maybe(pick(rand, SECTORS)),
    regimeBull: pick(rand, [true, false, null]),
  }));
}

function randomFilters(rand: () => number): ScreenerFilters {
  return {
    market: pick(rand, ["all", "all", "all", ...ALL_MARKETS] as const),
    asset: pick(rand, ["all", "all", ...ASSET_VALUES]),
    sector: pick(rand, ["all", "all", ...SECTORS]),
    signal: pick(rand, ["any", "buy", "sell", "tracked"] as const),
    uptrend: rand() < 0.3,
    liq: pick(rand, [0, 0, 1e6, 5e6, 20e6, 100e6]),
    mcap: pick(rand, [0, 0, 3e8, 2e9, 1e10, 2e11]),
    w52: pick(rand, ["any", "any", "nearHigh", "within15", "dd30", "nearLow"] as const),
    move: pick(rand, ["any", "any", "up3", "down3", "abs5"] as const),
    unpriced: rand() < 0.3,
  };
}

const CONTEXTS: MarketContext[] = [
  { prefsEnabled: null, showAllMarkets: false },
  { prefsEnabled: [...ALL_MARKETS], showAllMarkets: false },
  { prefsEnabled: ["us", "hk"], showAllMarkets: false },
  { prefsEnabled: ["cn"], showAllMarkets: false },
  { prefsEnabled: ["us", "hk"], showAllMarkets: true },
];

describe("compileFilters ⇄ the screener table", () => {
  it("selects exactly the rows the table shows, for 1,500 filter × market-context combinations", () => {
    const rand = prng(20261011);
    const rows = makeRows(rand, 600);
    let compared = 0;
    let nonEmpty = 0;
    for (let i = 0; i < 300; i++) {
      const f = randomFilters(rand);
      for (const ctx of CONTEXTS) {
        const compiled = compileFilters(f, ctx);
        expect(compiled.ok).toBe(true);
        if (!compiled.ok) continue;
        const table = rows.filter((r) => tableKeeps(r, f, ctx)).map((r) => r.sym);
        const screen = rows.filter((r) => classifyRow(compiled.def, r).status === "match").map((r) => r.sym);
        expect(screen, JSON.stringify({ f, ctx })).toEqual(table);
        compared++;
        if (table.length) nonEmpty++;
      }
    }
    expect(compared).toBe(1500);
    // The comparison must actually exercise matches, not agree on empty sets.
    expect(nonEmpty).toBeGreaterThan(300);
  });

  it("agrees for every single-control change from the defaults", () => {
    const rows = makeRows(prng(7), 400);
    const variants: Partial<ScreenerFilters>[] = [
      {}, { market: "hk" }, { asset: "Funds" }, { sector: "Energy" }, { signal: "buy" }, { signal: "sell" },
      { signal: "tracked" }, { uptrend: true }, { liq: 5e6 }, { mcap: 2e9 }, { w52: "nearHigh" }, { w52: "within15" },
      { w52: "dd30" }, { w52: "nearLow" }, { move: "up3" }, { move: "down3" }, { move: "abs5" }, { unpriced: true },
    ];
    for (const patch of variants) {
      const f = { ...DEFAULT_SCREENER_FILTERS, ...patch };
      const ctx = CONTEXTS[2];
      const compiled = compileFilters(f, ctx);
      if (!compiled.ok) throw new Error("compile failed");
      expect(rows.filter((r) => classifyRow(compiled.def, r).status === "match").map((r) => r.sym), JSON.stringify(patch))
        .toEqual(rows.filter((r) => tableKeeps(r, f, ctx)).map((r) => r.sym));
    }
  });

  it("DISCLOSED divergence: a 0 price on an asset that cannot trade at 0 is unpriced, not a match", () => {
    const f = { ...DEFAULT_SCREENER_FILTERS };
    const compiled = compileFilters(f, CONTEXTS[0]);
    if (!compiled.ok) throw new Error("compile failed");
    const zero = row({ last: 0, sec: "Equities" });
    expect(tableKeeps(zero, f, CONTEXTS[0])).toBe(true);
    expect(classifyRow(compiled.def, zero).status).toBe("unpriced");
    // A legitimately non-positive print (an FX/futures spread) is still evaluated.
    expect(classifyRow(compiled.def, row({ last: -1.5, sec: "Futures" })).status).toBe("match");
  });

  it("round-trips through the filter bar, naming a device-market subset explicitly", () => {
    const rand = prng(99);
    for (let i = 0; i < 200; i++) {
      const f = randomFilters(rand);
      const ctx = CONTEXTS[i % CONTEXTS.length];
      const compiled = compileFilters(f, ctx);
      if (!compiled.ok) throw new Error("compile failed");
      const back = decompileToFilters(compiled.def);
      expect(back).not.toBeNull();
      const gated = f.market === "all" && ctx.prefsEnabled !== null && !ctx.showAllMarkets && ctx.prefsEnabled.length < ALL_MARKETS.length;
      const enabled = (ctx.prefsEnabled ?? []) as MarketId[];
      // A one-market device gate is the same population as picking that market explicitly.
      expect(back?.filters).toEqual(gated && enabled.length === 1 ? { ...f, market: enabled[0] } : f);
      if (gated && enabled.length > 1) expect(back?.marketSubset).toEqual([...enabled].sort());
      else expect(back?.marketSubset).toBeNull();
    }
  });

  it("refuses to open a definition the bar cannot show instead of approximating it", () => {
    expect(decompileToFilters(ok(def({ all: [{ f: "chg", op: "gte", v: 4 }] })).def)).toBeNull();
    expect(decompileToFilters(ok(def({ any: [{ f: "dv", op: "gte", v: 1 }, { f: "mcap", op: "gte", v: 1 }] })).def)).toBeNull();
    expect(decompileToFilters(ok(def({ all: [{ f: "verdict", op: "in", v: ["SELL"] }] })).def)).toBeNull();
  });
});
