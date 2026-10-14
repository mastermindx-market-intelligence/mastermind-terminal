// E02 × E04 — a saved smart screen carries the screener's fundamental conditions (grammar 2).
// Repair round 1 (PR #950 MINOR 1): "Save current" used to compile only the manifest filters,
// so a screen saved while "Net margin ≥ 15%" was on the table re-opened WITHOUT it and matched
// more names than were saved. These tests pin the save → open round-trip, the strict grammar,
// the unchanged grammar-1 hashes, the table-equal evaluation and the refused review.
import { describe, expect, it } from "vitest";
import { SCREENER_SCAN_SCHEMA } from "@/lib/screenerScan";
import {
  FUNDAMENTAL_FIELD_IDS,
  parseFundamentalScan,
  type FundamentalPredicate,
  type FundamentalScanSource,
} from "@/lib/fundamentalScan";
import { projectFundamental } from "@/lib/fundamentalScanProducer";
import {
  canonicalDefinition, compileFilters, decompileToFilters, DEFAULT_SCREENER_FILTERS, fundOf,
  GRAMMAR_VERSION, normalizeDefinition, type ScreenRow, type ScreenerFilters,
} from "@/lib/smartScreen/predicate";
import { classifyScreenRow, countScreenMatches, type FundamentalContext } from "@/lib/smartScreen/fundamental";
import { buildReview, diffScreen, reviewableDefinition } from "@/lib/smartScreen/review";
import { parseScreenRecord } from "@/lib/smartScreen/record";
import { fundDoc, JUNCO_ANNUAL, SEPCO_ANNUAL } from "./fixtures/fundamentalScan/fundDoc";

const NOW = Date.parse("2026-10-11T00:00:00Z");
const GEN = NOW / 1000 - 3600;
const CTX = { prefsEnabled: null, showAllMarkets: false };
const SCOPE = { markets: "all", asset: null, unpriced: false };
const NET15: FundamentalPredicate = { field: "fund.net_margin_fy", op: "range", gte: 0.15 };
const PE: FundamentalPredicate = { field: "fund.pe_ttm", op: "range", lte: 30 };

const filters = (patch: Partial<ScreenerFilters> = {}): ScreenerFilters => ({ ...DEFAULT_SCREENER_FILTERS, ...patch });
const ok = (input: unknown) => {
  const result = normalizeDefinition(input);
  if (!result.ok) throw new Error(`expected ok, got ${result.error} at ${result.path}`);
  return result;
};
const rejects = (input: unknown) => {
  const result = normalizeDefinition(input);
  if (result.ok) throw new Error("expected a rejection");
  return result;
};

function source(): FundamentalScanSource {
  const projected = (sym: string, doc: unknown) => ({ sym, ...projectFundamental(sym, doc).observation });
  const rows = [
    projected("SEPCO", fundDoc("SEPCO", { pe: 25.5, annual: SEPCO_ANNUAL })),   // net margin 15.0%
    projected("JUNCO", fundDoc("JUNCO", { pe: 14, annual: JUNCO_ANNUAL })),     // net margin 10.0%
    { sym: "GONE", status: "unavailable", reason: "fund_absent" },
  ];
  const parsed = parseFundamentalScan({
    schema: SCREENER_SCAN_SCHEMA, family: "fundamental", family_version: 1, generation: GEN,
    generated_at: new Date(GEN * 1000).toISOString(), complete: true,
    universe: { source: "manifest", as_of: "2026-10-09", count: rows.length },
    fields: [...FUNDAMENTAL_FIELD_IDS], rows,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return { kind: "ready", scan: parsed.value };
}

const row = (sym: string, patch: Partial<ScreenRow> = {}): ScreenRow => ({
  sym, sec: "Equities", mktId: "us", last: 10, chg: 1, dv: 5e6, mcap: 2e9, offHi: -10, offLo: 20,
  verdict: "BUY", gics: "Energy", regimeBull: true, ...patch,
});
const ROWS = [row("SEPCO"), row("JUNCO"), row("GONE"), row("NOFUND")];

describe("save → open keeps the fundamental conditions (the MINOR 1 falsifier)", () => {
  it("Save current compiles the table's fundamental conditions into the definition", () => {
    const saved = compileFilters(filters({ liq: 1e7 }), CTX, [NET15]);
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.def.grammar).toBe(2);
    expect(fundOf(saved.def)).toEqual([NET15]);
  });

  it("opening the saved screen puts back exactly the filters AND the fundamental conditions", () => {
    const saved = compileFilters(filters({ liq: 1e7, sector: "Energy" }), CTX, [NET15, PE]);
    if (!saved.ok) throw new Error(saved.error);
    // The stored record is the JSON definition; the client re-normalizes it on read.
    const stored = ok(JSON.parse(JSON.stringify(saved.def)));
    expect(stored.hash).toBe(saved.hash);
    const back = decompileToFilters(stored.def);
    expect(back).not.toBeNull();
    expect(back?.filters).toEqual(filters({ liq: 1e7, sector: "Energy" }));
    expect(back?.fund).toEqual([NET15, PE].sort((a, b) => (a.field < b.field ? -1 : 1)));
    // Re-saving what was opened is the same screen (duplicate detection sees it).
    const again = compileFilters(back!.filters, CTX, back!.fund);
    expect(again.ok && again.hash).toBe(saved.hash);
  });

  it("the duplicate check distinguishes a fundamental condition, its bound and its opt-in", () => {
    const hash = (fund: FundamentalPredicate[]) => {
      const r = compileFilters(filters(), CTX, fund);
      if (!r.ok) throw new Error(r.error);
      return r.hash;
    };
    const plain = hash([]);
    const net15 = hash([NET15]);
    expect(net15).not.toBe(plain);
    expect(hash([{ ...NET15, gte: 0.2 }])).not.toBe(net15);
    expect(hash([{ ...NET15, includeUnknown: true }])).not.toBe(net15);
    expect(hash([{ field: "fund.net_margin_fy", op: "unknown" }])).not.toBe(net15);
    // An explicit includeUnknown:false is the default, not a different screen.
    expect(hash([{ ...NET15, includeUnknown: false }])).toBe(net15);
  });
});

describe("grammar 2 — strict, canonical, backward compatible", () => {
  it("a screen without fundamental conditions is still grammar 1 with the E04 canonical form", () => {
    const r = compileFilters(filters({ move: "up3" }), CTX, []);
    if (!r.ok) throw new Error(r.error);
    expect(r.def.grammar).toBe(1);
    expect(r.canonical).toBe('{"grammar":1,"scope":{"markets":"all","asset":null,"unpriced":false},"where":{"all":[{"f":"chg","op":"gte","v":3}]}}');
    expect(decompileToFilters(r.def)?.fund).toEqual([]);
  });

  it("orders, de-signs and re-reads fundamental conditions into one canonical form", () => {
    const a = ok({ grammar: 2, scope: SCOPE, where: { all: [] }, fund: [PE, { ...NET15, gte: -0 }] });
    const b = ok({ grammar: 2, scope: SCOPE, where: { all: [] }, fund: [{ gte: 0, op: "range", field: "fund.net_margin_fy" }, PE] });
    expect(a.canonical).toBe(b.canonical);
    expect(a.hash).toBe(b.hash);
    expect(a.def.grammar === 2 && a.def.fund.map((p) => p.field)).toEqual(["fund.net_margin_fy", "fund.pe_ttm"]);
    expect(ok(JSON.parse(JSON.stringify(a.def))).canonical).toBe(a.canonical);
    expect(canonicalDefinition(a.def)).toContain('"fund":[{"field":"fund.net_margin_fy","op":"range","gte":0}');
  });

  const where = { all: [] };
  const cases: [string, unknown, string][] = [
    ["fund on a grammar-1 definition", { grammar: 1, scope: SCOPE, where, fund: [NET15] }, "unknown_key"],
    ["grammar 2 without fund", { grammar: 2, scope: SCOPE, where }, "bad_value"],
    ["grammar 2 with an empty fund", { grammar: 2, scope: SCOPE, where, fund: [] }, "bad_value"],
    ["a non-array fund", { grammar: 2, scope: SCOPE, where, fund: NET15 }, "bad_value"],
    ["a non-object condition", { grammar: 2, scope: SCOPE, where, fund: ["net>15"] }, "not_object"],
    ["an unknown fundamental field", { grammar: 2, scope: SCOPE, where, fund: [{ field: "fund.vibes", op: "range", gte: 1 }] }, "unknown_field"],
    ["an unknown operator", { grammar: 2, scope: SCOPE, where, fund: [{ field: "fund.net_margin_fy", op: "gt", gte: 1 }] }, "unknown_op"],
    ["an extra key on a condition", { grammar: 2, scope: SCOPE, where, fund: [{ ...NET15, note: "x" }] }, "unknown_key"],
    ["a bound on an unknown-only condition", { grammar: 2, scope: SCOPE, where, fund: [{ field: "fund.net_margin_fy", op: "unknown", gte: 1 }] }, "unknown_key"],
    ["a string bound", { grammar: 2, scope: SCOPE, where, fund: [{ ...NET15, gte: "0.15" }] }, "bad_value"],
    ["an inverted range", { grammar: 2, scope: SCOPE, where, fund: [{ ...NET15, gte: 0.3, lte: 0.1 }] }, "bad_value"],
    ["a range with no bound", { grammar: 2, scope: SCOPE, where, fund: [{ field: "fund.net_margin_fy", op: "range" }] }, "bad_value"],
    ["a non-boolean opt-in", { grammar: 2, scope: SCOPE, where, fund: [{ ...NET15, includeUnknown: 1 }] }, "bad_value"],
    ["an unbounded threshold", { grammar: 2, scope: SCOPE, where, fund: [{ ...NET15, gte: 1e16 }] }, "bad_value"],
    ["two conditions on one field", { grammar: 2, scope: SCOPE, where, fund: [NET15, { ...NET15, gte: 0.2 }] }, "bad_value"],
    ["a grammar newer than this client", { grammar: GRAMMAR_VERSION + 1, scope: SCOPE, where, fund: [NET15] }, "grammar_newer"],
  ];
  for (const [label, input, code] of cases) {
    it(`rejects ${label} (${code})`, () => expect(rejects(input).error).toBe(code));
  }

  it("a client that predates grammar 2 shows such a record read-only, never as a looser screen", () => {
    // record.ts: grammar > GRAMMAR_VERSION is "newer"; the pre-E02 client had GRAMMAR_VERSION 1.
    const def = ok({ grammar: 2, scope: SCOPE, where, fund: [NET15] });
    const rec = {
      schema: 1, id: "a".repeat(32), rev: 1, name: "Quality", def: def.def, hash: def.hash, review: null,
      createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z",
    };
    const parsed = parseScreenRecord(rec);
    expect(parsed.kind).toBe("ok");
    const future = parseScreenRecord({ ...rec, def: { ...def.def, grammar: GRAMMAR_VERSION + 1 } });
    expect(future.kind).toBe("newer");
  });
});

describe("the panel evaluates a saved screen exactly as the table does", () => {
  const net15 = (() => {
    const r = compileFilters(filters(), CTX, [NET15]);
    if (!r.ok) throw new Error(r.error);
    return r.def;
  })();
  const ready: FundamentalContext = { source: source(), nowMs: NOW };

  it("keeps only names whose fundamental condition passes, ANDed with the manifest filter", () => {
    expect(ROWS.map((r) => [r.sym, classifyScreenRow(net15, r, ready).status])).toEqual([
      ["SEPCO", "match"], ["JUNCO", "fail"], ["GONE", "unknown"], ["NOFUND", "unknown"],
    ]);
    expect(countScreenMatches(net15, ROWS, ready)).toEqual({ kind: "count", n: 1 });
    // A manifest miss is a miss whatever the fundamentals say.
    const buyNet15 = compileFilters(filters({ signal: "buy" }), CTX, [NET15]);
    if (!buyNet15.ok) throw new Error(buyNet15.error);
    expect(classifyScreenRow(buyNet15.def, row("SEPCO", { verdict: "SELL" }), ready).status).toBe("fail");
  });

  it("an opted-in unknown counts as the table counts it", () => {
    const r = compileFilters(filters(), CTX, [{ ...NET15, includeUnknown: true }]);
    if (!r.ok) throw new Error(r.error);
    expect(countScreenMatches(r.def, ROWS, ready)).toEqual({ kind: "count", n: 3 });
  });

  it("explains each fundamental condition with the value it was judged on", () => {
    const v = classifyScreenRow(net15, row("JUNCO"), ready);
    expect(v.fund).toHaveLength(1);
    expect(v.fund[0].match).toBe("fail");
    expect(v.fund[0].cell?.value).toBeCloseTo(0.1, 6);
  });

  it("never counts before the fundamental scan answers, and never calls a failed read 0 matches", () => {
    expect(countScreenMatches(net15, ROWS, { source: null, nowMs: NOW })).toEqual({ kind: "fund_pending" });
    expect(countScreenMatches(net15, ROWS, { source: { kind: "error", error: "http_500" }, nowMs: NOW })).toEqual({ kind: "fund_unavailable" });
    expect(countScreenMatches(net15, ROWS, { source: { kind: "absent" }, nowMs: NOW })).toEqual({ kind: "fund_unavailable" });
    expect(classifyScreenRow(net15, row("SEPCO"), { source: null, nowMs: NOW }).status).toBe("fund_not_ready");
    // A grammar-1 screen does not wait for fundamentals.
    const plain = compileFilters(filters(), CTX, []);
    if (!plain.ok) throw new Error(plain.error);
    expect(countScreenMatches(plain.def, ROWS, { source: null, nowMs: NOW })).toEqual({ kind: "count", n: 4 });
  });
});

describe("reviews refuse a screen whose membership depends on fundamentals", () => {
  const r = compileFilters(filters(), CTX, [NET15]);
  if (!r.ok) throw new Error(r.error);

  it("buildReview and diffScreen say why instead of storing a manifest-only snapshot", () => {
    expect(reviewableDefinition(r.def)).toBe(false);
    expect(buildReview(r.def, r.hash, ROWS, { asOf: "2026-10-09" })).toEqual({ ok: false, error: "fundamental_conditions" });
    expect(diffScreen(r.def, r.hash, null, ROWS, { asOf: "2026-10-09", dataReady: true })).toEqual({ ok: false, reason: "fundamental_conditions" });
  });

  it("a stored record that pairs fundamental conditions with a review is invalid", () => {
    const plain = compileFilters(filters(), CTX, []);
    if (!plain.ok) throw new Error(plain.error);
    const built = buildReview(plain.def, plain.hash, ROWS, { asOf: "2026-10-09", at: "2026-10-11T00:00:00.000Z" });
    if (!built.ok) throw new Error(built.error);
    // Re-key the reviewed snapshot onto the fundamental screen's hash, as a tampered row would.
    const review = { ...built.review, hash: r.hash };
    const rec = {
      schema: 1, id: "b".repeat(32), rev: 1, name: "x", def: r.def, hash: r.hash, review,
      createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z",
    };
    expect(parseScreenRecord(rec).kind).toBe("invalid");
    expect(parseScreenRecord({ ...rec, review: null }).kind).toBe("ok");
  });
});
