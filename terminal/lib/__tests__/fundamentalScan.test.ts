// E02 — the fundamental-scan consumer contract (lib/fundamentalScan.ts): parsing, per-field
// coverage classification, the ONE unit-scaling boundary, three-valued predicates and the
// explainable tally. Rows come from the real projector over independently constructed fund
// documents, so a contract change on either side reds here.
import { describe, expect, it } from "vitest";
import { SCREENER_SCAN_SCHEMA } from "@/lib/screenerScan";
import {
  accountFundamentalCoverage,
  classifyFundamental,
  createFundamentalTally,
  describeRange,
  evaluateFundamentalScreen,
  FISCAL_PERIOD_MAX_AGE_DAYS,
  formatFundamentalValue,
  FUNDAMENTAL_FIELD_IDS,
  FUNDAMENTAL_FIELD_REASONS,
  FUNDAMENTAL_GENERATION_MAX_AGE_DAYS,
  FUNDAMENTAL_ROW_REASONS,
  fundamentalReferenceDate,
  fundamentalStatementsHref,
  fundArtifactUrl,
  matchFundamentalPredicate,
  nextFundamentalSource,
  parseFundamentalScan,
  parseFundamentalScreen,
  parseTypedBound,
  readFundamentalScanResponse,
  SNAPSHOT_MAX_AGE_DAYS,
  summarizeFundamentalField,
  toDisplayNumber,
  toStoredThreshold,
  type FundamentalFieldId,
  type FundamentalPredicate,
  type FundamentalScan,
  type FundamentalScanSource,
} from "@/lib/fundamentalScan";
import { projectFundamental } from "@/lib/fundamentalScanProducer";
import { fundDoc, JUNCO_ANNUAL, SEPCO_ANNUAL, type Col } from "./fixtures/fundamentalScan/fundDoc";

const NOW = Date.parse("2026-10-11T00:00:00Z");
const GEN = NOW / 1000 - 3600;
const DAY = 86_400_000;

const BANK: Col[] = [
  { label: "2024", end: "2024-12-31", revenue: 160, ni: 50, equity: 300 },
  { label: "2025", end: "2025-12-31", revenue: 170, ni: 54, equity: 360 },
];
const LOSS: Col[] = [
  { label: "2024", end: "2024-12-31", revenue: 400, gp: 40, ni: -100, equity: 500 },
  { label: "2025", end: "2025-12-31", revenue: 500, gp: 25, ni: -250, equity: 250 },
];
const projected = (sym: string, doc: unknown) => ({ sym, ...projectFundamental(sym, doc).observation });

function rawRows(): Record<string, unknown>[] {
  return [
    projected("SEPCO", fundDoc("SEPCO", { pe: 25.5, annual: SEPCO_ANNUAL })),
    projected("JUNCO", fundDoc("JUNCO", { pe: 14, annual: JUNCO_ANNUAL })),
    projected("BANKCO", fundDoc("BANKCO", { family: "bank", pe: 9, annual: BANK })),
    projected("LOSSCO", fundDoc("LOSSCO", { pe: -3, annual: LOSS })),
    projected("0700.HK", fundDoc("0700.HK", { quote: "HKD", stmt: "CNY", pe: 14.5, annual: SEPCO_ANNUAL })),
    { sym: "BTC-USD", status: "unsupported", reason: "asset_class_not_covered" },
    { sym: "GONE", status: "unavailable", reason: "fund_absent" },
  ];
}

function scanDoc(rows: Record<string, unknown>[] = rawRows(), patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SCREENER_SCAN_SCHEMA,
    family: "fundamental",
    family_version: 1,
    generation: GEN,
    generated_at: new Date(GEN * 1000).toISOString(),
    complete: true,
    universe: { source: "manifest", as_of: "2026-10-09", count: rows.length },
    fields: [...FUNDAMENTAL_FIELD_IDS],
    rows,
    ...patch,
  };
}

function ready(doc: Record<string, unknown> = scanDoc()): FundamentalScanSource {
  const parsed = parseFundamentalScan(doc);
  if (!parsed.ok) throw new Error(parsed.error);
  return { kind: "ready", scan: parsed.value };
}

describe("parseFundamentalScan", () => {
  it("accepts the producer's rows; one row per requested symbol", () => {
    const parsed = parseFundamentalScan(scanDoc());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.rows.size).toBe(7);
    expect(parsed.value.fields).toEqual(FUNDAMENTAL_FIELD_IDS);
    expect([...parsed.value.rows.values()].every((r) => r.kind === "row")).toBe(true);
  });

  it.each([
    ["fields_invalid", { fields: [] }],
    ["fields_invalid", { fields: undefined }],
    ["field_unknown", { fields: ["fund.dividend_yield"] }],
    ["field_duplicate", { fields: ["fund.pe_ttm", "fund.pe_ttm"] }],
    ["family_mismatch", { family: "technical" }],
    ["row_count_mismatch", { universe: { source: "manifest", as_of: "2026-10-09", count: 99 } }],
  ])("rejects the whole document: %s", (error, patch) => {
    expect(parseFundamentalScan(scanDoc(rawRows(), patch))).toEqual({ ok: false, error });
  });

  it("refuses complete:true while a row is not_processed", () => {
    const rows = [...rawRows(), { sym: "LATE", status: "unavailable", reason: "not_processed" }];
    expect(parseFundamentalScan(scanDoc(rows))).toEqual({ ok: false, error: "complete_with_not_processed" });
    expect(parseFundamentalScan(scanDoc(rows, { complete: false })).ok).toBe(true);
  });

  type MutRow = { f: Record<string, unknown>; fy: Record<string, unknown> | null; [k: string]: unknown };
  const sepco = () => rawRows()[0] as MutRow;
  it.each<[string, (r: MutRow) => void]>([
    ["fund.pe_ttm:value_invalid", (r) => { r.f["fund.pe_ttm"] = { v: "25.5" }; }],
    ["fund.pe_ttm:value_invalid", (r) => { r.f["fund.pe_ttm"] = { v: null }; }],
    ["fund.roe_fy:field_invalid", (r) => { delete r.f["fund.roe_fy"]; }],
    ["fund.roe_fy:reason_reserved", (r) => { r.f["fund.roe_fy"] = { s: "unavailable", r: "scan_absent" }; }],
    ["fund.roe_fy:reason_status_mismatch", (r) => { r.f["fund.roe_fy"] = { s: "unavailable", r: "family_not_applicable" }; }],
    ["fund.roe_fy:field_status_invalid", (r) => { r.f["fund.roe_fy"] = { s: "stale", r: "aged" }; }],
    ["fund.gross_margin_fy:fy_missing", (r) => { r.fy = null; r.prior = null; r.f["fund.revenue_growth_fy"] = { s: "unavailable", r: "no_comparable_prior" }; }],
    ["fund.revenue_growth_fy:prior_missing", (r) => { r.prior = null; }],
    ["prior_not_earlier", (r) => { r.prior = { label: "2026", end: "2026-09-26" }; }],
    ["asof_invalid", (r) => { r.asof = "2026-10"; }],
    ["ccy_invalid", (r) => { r.ccy = "USD"; }],
    ["fy_end_invalid", (r) => { r.fy!.end = "2025-02-30"; }],
    ["fy_filed_invalid", (r) => { r.fy!.filed = "yesterday"; }],
    ["fy_family_invalid", (r) => { r.fy!.fam = ""; }],
    ["reason_status_mismatch", (r) => { r.reason = "fund_absent"; }],
    ["status_invalid", (r) => { r.status = "evaluated"; }],
  ])("keeps a bad row as malformed (%s) — the universe still sums", (error, mutate) => {
    const rows = rawRows();
    const r = sepco();
    mutate(r);
    rows[0] = r;
    const parsed = parseFundamentalScan(scanDoc(rows));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.rows.get("SEPCO")).toEqual({ kind: "malformed", sym: "SEPCO", error });
    expect(parsed.value.rows.size).toBe(7);
  });

  it("refuses a row-level reserved reason and a row reason under the wrong status", () => {
    const rows = rawRows();
    rows[6] = { sym: "GONE", status: "unavailable", reason: "not_in_scan" };
    rows[5] = { sym: "BTC-USD", status: "unavailable", reason: "asset_class_not_covered" };
    const parsed = parseFundamentalScan(scanDoc(rows));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.rows.get("GONE")).toMatchObject({ kind: "malformed", error: "reason_reserved" });
    expect(parsed.value.rows.get("BTC-USD")).toMatchObject({ kind: "malformed", error: "reason_status_mismatch" });
  });

  it("every producer reason is a valid reason code with exactly one status", () => {
    for (const spec of [FUNDAMENTAL_FIELD_REASONS, FUNDAMENTAL_ROW_REASONS]) {
      const all = [...spec.unsupported, ...spec.unavailable];
      expect(new Set(all).size).toBe(all.length);
      for (const r of all) expect(r).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    }
  });
});

describe("classifyFundamental — first matching rule wins", () => {
  const src = ready();

  it("absent and failed reads are unavailable, never empty or zero", () => {
    expect(classifyFundamental({ kind: "absent" }, "SEPCO", "fund.pe_ttm", NOW).coverage).toEqual({ status: "unavailable", reason: "scan_absent" });
    expect(classifyFundamental({ kind: "error", error: "http_503" }, "SEPCO", "fund.pe_ttm", NOW).coverage).toEqual({ status: "unavailable", reason: "scan_unavailable" });
  });

  it("a field this generation did not produce is unsupported", () => {
    const partial = ready(scanDoc(rawRows().map((r) => {
      if (r.status !== "observed") return r;
      const f = { ...(r.f as Record<string, unknown>) };
      delete f["fund.roe_fy"];
      return { ...r, f };
    }), { fields: FUNDAMENTAL_FIELD_IDS.filter((f) => f !== "fund.roe_fy") }));
    expect(classifyFundamental(partial, "SEPCO", "fund.roe_fy", NOW).coverage).toEqual({ status: "unsupported", reason: "field_not_produced" });
    expect(classifyFundamental(partial, "SEPCO", "fund.pe_ttm", NOW).coverage.status).toBe("evaluated");
  });

  it("exact symbol identity: a symbol outside the scan is not_in_scan", () => {
    expect(classifyFundamental(src, "sepco", "fund.pe_ttm", NOW).coverage).toEqual({ status: "unavailable", reason: "not_in_scan" });
  });

  it("row-level and field-level withheld states carry their own reasons", () => {
    expect(classifyFundamental(src, "BTC-USD", "fund.pe_ttm", NOW).coverage).toEqual({ status: "unsupported", reason: "asset_class_not_covered" });
    expect(classifyFundamental(src, "GONE", "fund.pe_ttm", NOW).coverage).toEqual({ status: "unavailable", reason: "fund_absent" });
    const bank = classifyFundamental(src, "BANKCO", "fund.net_margin_fy", NOW);
    expect(bank.coverage).toEqual({ status: "unsupported", reason: "family_not_applicable" });
    expect(bank.value).toBeNull();
    // the withheld cell still names the period/family the company was judged on (AC-E02-04/05)
    expect(bank.row?.fy).toMatchObject({ label: "2025", end: "2025-12-31", fam: "bank" });
    expect(classifyFundamental(src, "LOSSCO", "fund.pe_ttm", NOW).coverage).toEqual({ status: "unavailable", reason: "earnings_nonpositive" });
    expect(classifyFundamental(src, "0700.HK", "fund.pe_ttm", NOW).coverage).toEqual({ status: "unsupported", reason: "currency_basis_unverified" });
  });

  it("an evaluated value carries its period and source date, not the build clock", () => {
    const c = classifyFundamental(src, "SEPCO", "fund.net_margin_fy", NOW);
    expect(c).toMatchObject({ coverage: { status: "evaluated", reason: "ok" }, value: 0.15 });
    expect(c.row?.fy?.end).toBe("2025-09-27");
    expect(c.row?.asof).toBe("2026-10-01");
  });

  it(`a generation older than ${FUNDAMENTAL_GENERATION_MAX_AGE_DAYS} days is stale — value kept for display, never filtered on`, () => {
    const later = NOW + (FUNDAMENTAL_GENERATION_MAX_AGE_DAYS + 1) * DAY;
    const c = classifyFundamental(src, "SEPCO", "fund.net_margin_fy", later);
    expect(c.coverage).toEqual({ status: "stale", reason: "generation_stale" });
    expect(c.value).toBe(0.15);
    expect(matchFundamentalPredicate(c, { field: "fund.net_margin_fy", op: "range", gte: 0.1 })).toBe("unknown");
  });

  it(`a TTM snapshot older than ${SNAPSHOT_MAX_AGE_DAYS} days is snapshot_aged; fiscal-year fields are unaffected`, () => {
    const rows = rawRows();
    rows[0] = projected("SEPCO", fundDoc("SEPCO", { pe: 25.5, asof: "2026-09-01", annual: SEPCO_ANNUAL }));
    const s = ready(scanDoc(rows));
    expect(classifyFundamental(s, "SEPCO", "fund.pe_ttm", NOW).coverage).toEqual({ status: "stale", reason: "snapshot_aged" });
    expect(classifyFundamental(s, "SEPCO", "fund.net_margin_fy", NOW).coverage.status).toBe("evaluated");
  });

  it(`a fiscal year that ended more than ${FISCAL_PERIOD_MAX_AGE_DAYS} days ago is fiscal_period_aged`, () => {
    const old = SEPCO_ANNUAL.map((c, i) => ({ ...c, label: String(2021 + i), end: `${2021 + i}-09-30` }));
    const rows = rawRows();
    rows[0] = projected("SEPCO", fundDoc("SEPCO", { pe: 25.5, annual: old }));
    const s = ready(scanDoc(rows));
    expect(classifyFundamental(s, "SEPCO", "fund.net_margin_fy", NOW).coverage).toEqual({ status: "stale", reason: "fiscal_period_aged" });
    expect(classifyFundamental(s, "SEPCO", "fund.pe_ttm", NOW).coverage.status).toBe("evaluated");
  });

  it("a malformed row is unavailable/malformed_row", () => {
    const rows = rawRows();
    rows[0] = { ...rows[0], asof: "bad" };
    expect(classifyFundamental(ready(scanDoc(rows)), "SEPCO", "fund.pe_ttm", NOW).coverage).toEqual({ status: "unavailable", reason: "malformed_row" });
  });

  it("coverage partitions the requested universe: the four populations always sum", () => {
    const ids = ["SEPCO", "JUNCO", "BANKCO", "LOSSCO", "0700.HK", "BTC-USD", "GONE", "NEWIPO", "SEPCO"];
    for (const field of FUNDAMENTAL_FIELD_IDS) {
      const a = accountFundamentalCoverage(ids, src, field, NOW);
      expect(a.total).toBe(8);
      expect(a.evaluated + a.stale + a.unsupported + a.unavailable).toBe(8);
    }
    const margins = accountFundamentalCoverage(ids, src, "fund.net_margin_fy", NOW);
    expect(margins.byReason).toEqual({
      evaluated: { ok: 4 },
      stale: {},
      unsupported: { family_not_applicable: 1, asset_class_not_covered: 1 },
      unavailable: { fund_absent: 1, not_in_scan: 1 },
    });
  });
});

describe("units — the one scaling boundary (AC-E02-01)", () => {
  it("a source fraction 0.15 displays as 15% and is compared to a typed 15% exactly once", () => {
    const field: FundamentalFieldId = "fund.net_margin_fy";
    expect(formatFundamentalValue(field, 0.15)).toBe("15%");
    expect(toStoredThreshold(field, 15)).toBe(0.15);
    expect(parseTypedBound(field, "15")).toBe(0.15);
    expect(parseTypedBound(field, "15%")).toBe(0.15);
    const c = classifyFundamental(ready(), "SEPCO", field, NOW);
    expect(c.value).toBe(0.15);
    const at = (typed: number) => matchFundamentalPredicate(c, { field, op: "range", gte: toStoredThreshold(field, typed) });
    expect(at(15)).toBe("pass");
    expect(at(15.01)).toBe("fail");
    // double scaling would compare 0.15 against 15 (always fail) or 0.0015 (always pass)
    expect(at(0.15)).toBe("pass");
    expect(matchFundamentalPredicate(c, { field, op: "range", gte: 15 })).toBe("fail");
    expect(describeRange(field, { gte: toStoredThreshold(field, 15) })).toBe("≥ 15%");
  });

  it("typed percents round-trip without binary noise", () => {
    for (const typed of [0, 0.1, 1, 7.5, 14.3, 15, 33.3, 99.9, 100, -12.5, 250]) {
      const stored = toStoredThreshold("fund.gross_margin_fy", typed);
      expect(toDisplayNumber("fund.gross_margin_fy", stored)).toBe(typed);
    }
    expect(toStoredThreshold("fund.gross_margin_fy", 14.3)).toBe(0.143);
  });

  it("a multiple is never percent-scaled", () => {
    expect(toStoredThreshold("fund.pe_ttm", 15)).toBe(15);
    expect(toDisplayNumber("fund.pe_ttm", 37.8373)).toBe(37.8373);
    expect(formatFundamentalValue("fund.pe_ttm", 37.8373)).toBe("37.84×");
    expect(formatFundamentalValue("fund.pe_ttm", 9)).toBe("9.0×");
    expect(parseTypedBound("fund.pe_ttm", "20x")).toBe(20);
  });

  it("an empty bound is 'no bound'; junk is invalid, never zero", () => {
    expect(parseTypedBound("fund.roe_fy", "  ")).toBeUndefined();
    expect(parseTypedBound("fund.roe_fy", "abc")).toBeNull();
    expect(formatFundamentalValue("fund.roe_fy", Number.NaN)).toBe("—");
    expect(formatFundamentalValue("fund.roe_fy", -0.5)).toBe("-50%");
  });

  it("a comma is only a thousands separator; a decimal comma is invalid, never re-read", () => {
    // "1,5" meant 1.5 in a decimal-comma locale; stripping the comma silently turned it into 15
    expect(parseTypedBound("fund.pe_ttm", "1,5")).toBeNull();
    expect(parseTypedBound("fund.pe_ttm", "15,00")).toBeNull();
    expect(parseTypedBound("fund.pe_ttm", "1,5000")).toBeNull();
    expect(parseTypedBound("fund.pe_ttm", ",500")).toBeNull();
    expect(parseTypedBound("fund.pe_ttm", "1,500,")).toBeNull();
    expect(parseTypedBound("fund.pe_ttm", "1,500")).toBe(1500);
    expect(parseTypedBound("fund.pe_ttm", "1,500.25")).toBe(1500.25);
    expect(parseTypedBound("fund.pe_ttm", " -1,500 ")).toBe(-1500);
    expect(parseTypedBound("fund.pe_ttm", "12,345,678")).toBe(12345678);
    expect(parseTypedBound("fund.pe_ttm", "1.5")).toBe(1.5);
    expect(parseTypedBound("fund.net_margin_fy", "1,5%")).toBeNull();
    expect(parseTypedBound("fund.net_margin_fy", "1.5%")).toBe(0.015);
    expect(parseTypedBound("fund.net_margin_fy", " 15 % ")).toBe(0.15);
  });
});

describe("predicates — unknown never satisfies a threshold unless explicitly selected", () => {
  const src = ready();
  const syms = ["SEPCO", "JUNCO", "BANKCO", "LOSSCO", "0700.HK", "BTC-USD", "GONE"];
  const run = (preds: FundamentalPredicate[]) =>
    Object.fromEntries(syms.map((s) => [s, evaluateFundamentalScreen(src, s, preds, NOW).match]));

  it("net margin ≥ 15%: known failures fail, withheld values are unknown", () => {
    expect(run([{ field: "fund.net_margin_fy", op: "range", gte: 0.15 }])).toEqual({
      SEPCO: "pass", JUNCO: "fail", BANKCO: "unknown", LOSSCO: "fail", "0700.HK": "pass", "BTC-USD": "unknown", GONE: "unknown",
    });
  });

  it("include-unknown is an explicit opt-in per predicate", () => {
    expect(run([{ field: "fund.net_margin_fy", op: "range", gte: 0.15, includeUnknown: true }])).toEqual({
      SEPCO: "pass", JUNCO: "fail", BANKCO: "pass", LOSSCO: "fail", "0700.HK": "pass", "BTC-USD": "pass", GONE: "pass",
    });
  });

  it("the explicit 'value unknown' predicate selects exactly the withheld rows", () => {
    expect(run([{ field: "fund.pe_ttm", op: "unknown" }])).toEqual({
      SEPCO: "fail", JUNCO: "fail", BANKCO: "fail", LOSSCO: "pass", "0700.HK": "pass", "BTC-USD": "pass", GONE: "pass",
    });
  });

  it("a negative P/E never passes a 'cheap' P/E ≤ 15× screen", () => {
    expect(run([{ field: "fund.pe_ttm", op: "range", lte: 15 }])).toEqual({
      SEPCO: "fail", JUNCO: "pass", BANKCO: "pass", LOSSCO: "unknown", "0700.HK": "unknown", "BTC-USD": "unknown", GONE: "unknown",
    });
  });

  it("predicates combine with Kleene AND: a known failure outranks missing evidence", () => {
    const m = run([
      { field: "fund.net_margin_fy", op: "range", gte: 0.15 },
      { field: "fund.roe_fy", op: "range", gte: 0.1 },
    ]);
    expect(m).toMatchObject({ SEPCO: "pass", "0700.HK": "unknown", LOSSCO: "fail", BANKCO: "unknown" });
  });
});

describe("createFundamentalTally — explainable filtered result (AC-E02-05)", () => {
  it("counts matched / failed / excluded-unknown / included-unknown and the per-field reasons", () => {
    const src = ready();
    const preds: FundamentalPredicate[] = [{ field: "fund.net_margin_fy", op: "range", gte: 0.15 }];
    const tally = createFundamentalTally(preds);
    for (const s of ["SEPCO", "JUNCO", "BANKCO", "LOSSCO", "0700.HK", "BTC-USD", "GONE", "SEPCO"]) {
      tally.record(s, evaluateFundamentalScreen(src, s, preds, NOW));
    }
    const t = tally.result();
    expect(t).toMatchObject({ population: 7, matched: 2, failed: 2, excludedUnknown: 3, includedUnknown: 0 });
    expect(t.matched + t.failed + t.excludedUnknown).toBe(t.population);
    expect(t.byField["fund.net_margin_fy"]?.byReason.unsupported).toEqual({ family_not_applicable: 1, asset_class_not_covered: 1 });
    expect(t.byField["fund.net_margin_fy"]?.byReason.unavailable).toEqual({ fund_absent: 1 });

    const opt: FundamentalPredicate[] = [{ field: "fund.net_margin_fy", op: "range", gte: 0.15, includeUnknown: true }];
    const t2 = createFundamentalTally(opt);
    for (const s of ["SEPCO", "BANKCO", "GONE", "JUNCO"]) t2.record(s, evaluateFundamentalScreen(src, s, opt, NOW));
    expect(t2.result()).toMatchObject({ population: 4, matched: 3, includedUnknown: 2, failed: 1, excludedUnknown: 0 });
  });
});

describe("summarizeFundamentalField — coverage + reference period of the screened population (AC-E02-04/05)", () => {
  const src = ready();
  const POP = ["SEPCO", "JUNCO", "BANKCO", "LOSSCO", "0700.HK", "BTC-USD", "GONE", "SEPCO"];
  const classify = (field: FundamentalFieldId) => (id: string) => classifyFundamental(src, id, field, NOW);

  it("a fiscal-year field spans the fiscal-year ENDS of its evaluated values, never the build clock", () => {
    const s = summarizeFundamentalField(POP, classify("fund.net_margin_fy"), "fund.net_margin_fy");
    // JUNCO FY2025 ends 2025-06-30, SEPCO / 0700.HK 2025-09-27, LOSSCO 2025-12-31
    expect(s).toMatchObject({ refMin: "2025-06-30", refMax: "2025-12-31" });
    expect(s.coverage).toMatchObject({ total: 7, evaluated: 4, stale: 0, unsupported: 2, unavailable: 1 });
    expect(s.coverage.byReason.unsupported).toEqual({ family_not_applicable: 1, asset_class_not_covered: 1 });
    expect(s.coverage.evaluated + s.coverage.stale + s.coverage.unsupported + s.coverage.unavailable).toBe(s.coverage.total);
  });

  it("a TTM snapshot field reports the snapshot (asof) date, and withheld values do not widen the span", () => {
    const s = summarizeFundamentalField(POP, classify("fund.pe_ttm"), "fund.pe_ttm");
    expect(s).toMatchObject({ refMin: "2026-10-01", refMax: "2026-10-01" });
    expect(s.coverage.byReason.unavailable).toMatchObject({ earnings_nonpositive: 1, fund_absent: 1 });
    expect(s.coverage.byReason.unsupported).toMatchObject({ currency_basis_unverified: 1 });
  });

  it("no evaluated value → no reference span (an absent scan is not dated by anything)", () => {
    const s = summarizeFundamentalField(POP, (id) => classifyFundamental({ kind: "absent" }, id, "fund.roe_fy", NOW), "fund.roe_fy");
    expect(s).toMatchObject({ refMin: null, refMax: null });
    expect(s.coverage).toMatchObject({ total: 7, unavailable: 7 });
    expect(s.coverage.byReason.unavailable).toEqual({ scan_absent: 7 });
  });

  it("fundamentalReferenceDate picks the basis-correct date per field", () => {
    const sep = (f: FundamentalFieldId) => fundamentalReferenceDate(f, classifyFundamental(src, "SEPCO", f, NOW));
    expect(sep("fund.pe_ttm")).toBe("2026-10-01");
    expect(sep("fund.gross_margin_fy")).toBe("2025-09-27");
    expect(sep("fund.revenue_growth_fy")).toBe("2025-09-27");
    expect(fundamentalReferenceDate("fund.pe_ttm", classifyFundamental(src, "GONE", "fund.pe_ttm", NOW))).toBeNull();
  });
});

describe("reader state — failure-state truth", () => {
  it("maps HTTP outcomes: 404 absent, non-2xx error, rejected body error", () => {
    expect(readFundamentalScanResponse(404, null)).toEqual({ kind: "absent" });
    expect(readFundamentalScanResponse(503, null)).toEqual({ kind: "error", error: "http_503" });
    expect(readFundamentalScanResponse(200, { schema: "x" })).toEqual({ kind: "error", error: "schema_unsupported" });
    expect(readFundamentalScanResponse(200, scanDoc()).kind).toBe("ready");
  });

  it("a failed refresh keeps the held generation and labels it", () => {
    const held = ready();
    const next = nextFundamentalSource(held, { kind: "error", error: "http_500" });
    expect(next.source).toMatchObject({ kind: "ready", refreshFailed: true });
    expect((next.source as { scan: FundamentalScan }).scan.generation).toBe(GEN);
    expect(nextFundamentalSource(null, { kind: "absent" }).source).toEqual({ kind: "absent" });
  });

  it("adopts a newer complete generation, never an older one or an incomplete one over complete", () => {
    const held = ready();
    const newer = ready(scanDoc(rawRows(), { generation: GEN + 60, generated_at: new Date((GEN + 60) * 1000).toISOString() }));
    const older = ready(scanDoc(rawRows(), { generation: GEN - 60, generated_at: new Date((GEN - 60) * 1000).toISOString() }));
    const partial = ready(scanDoc(rawRows(), { generation: GEN + 120, generated_at: new Date((GEN + 120) * 1000).toISOString(), complete: false }));
    expect(nextFundamentalSource(held, newer).decision).toEqual({ adopt: true, reason: "newer_complete" });
    const back = nextFundamentalSource(held, older);
    expect(back.decision).toEqual({ adopt: false, reason: "not_newer" });
    expect((back.source as { scan: FundamentalScan }).scan.generation).toBe(GEN);
    expect(nextFundamentalSource(held, partial).decision).toEqual({ adopt: false, reason: "incomplete_over_complete" });
  });
});

describe("parseFundamentalScreen", () => {
  it("round-trips valid predicates and rejects anything that would silently widen a screen", () => {
    const ok: FundamentalPredicate[] = [
      { field: "fund.pe_ttm", op: "range", lte: 15 },
      { field: "fund.roe_fy", op: "range", gte: 0.1, lte: 0.5, includeUnknown: true },
      { field: "fund.gross_margin_fy", op: "unknown" },
    ];
    expect(parseFundamentalScreen(ok)).toEqual({ ok: true, value: ok });
    expect(parseFundamentalScreen([{ field: "fund.pe_ttm", op: "range" }])).toEqual({ ok: false, error: "predicate_range_invalid" });
    expect(parseFundamentalScreen([{ field: "fund.pe_ttm", op: "range", gte: 20, lte: 10 }])).toEqual({ ok: false, error: "predicate_range_invalid" });
    expect(parseFundamentalScreen([{ field: "fund.pe_ttm", op: "range", gte: "10" }])).toEqual({ ok: false, error: "predicate_range_invalid" });
    expect(parseFundamentalScreen([{ field: "pe", op: "range", gte: 1 }])).toEqual({ ok: false, error: "predicate_field_unknown" });
    expect(parseFundamentalScreen([{ field: "fund.pe_ttm", op: "eq", gte: 1 }])).toEqual({ ok: false, error: "predicate_op_invalid" });
    expect(parseFundamentalScreen({})).toEqual({ ok: false, error: "screen_invalid" });
  });
});

describe("statement drilldown links", () => {
  it("names the exact company and refuses unsafe symbols", () => {
    expect(fundamentalStatementsHref("0700.HK")).toBe("/terminal?pane=statements&sym=0700.HK");
    expect(fundArtifactUrl("0700.HK")).toBe("/data/0700.HK.fund.json");
    expect(fundArtifactUrl("../manifest")).toBeNull();
    expect(fundamentalStatementsHref("")).toBeNull();
  });
});
