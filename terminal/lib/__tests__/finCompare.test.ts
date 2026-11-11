/**
 * E11 · the comparability gate behind Financials · Compare.
 *
 * The fixtures under ./fixtures/fin-compare are minified copies of the PRODUCTION artifacts
 * (`https://app.mastermind-x.com/data/<SYM>.fund.json`, fetched 2026-10-11) — not hand-made
 * shapes. Synthetic sets appear only where production carries no example (restatement receipts,
 * half-year cadences, mixed flow bases, a fiscal-year change).
 *
 * The falsifier the feature is specified against: "a match on metric display name alone
 * authorizes a cross-family or cross-period comparison". Every block below that is tagged
 * FALSIFIER fails if the gate is reduced to matching the label or the data key.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  admitPeer,
  buildComparison,
  calendarPlacement,
  COMPARE_METRICS,
  markPeerRefreshFailed,
  MAX_COMPARE_PEERS,
  peerLoadFromOutcome,
  periodsOfKind,
  removePeer,
  requestPeer,
  resolvePeer,
  type CompareAlignment,
  type CompareCell,
  type CompareMetricId,
  type CompareResult,
  type PeerSlot,
} from "../finCompare";
import { applyLegacyStatementFamilyFallback, type Fund, type StatementPeriodSet } from "../fund";
import { incomeTopLineLabel, incomeView, type StatementBasis } from "../finStatementMath";
import { netMarginPct } from "../finSeries";

const FIXTURES = path.join(__dirname, "fixtures", "fin-compare");

/** A production artifact as `getFund` hands it to the page (legacy family fallback applied). */
function fund(sym: string): Fund {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES, `${sym}.fund.json`), "utf8")) as Fund;
  return applyLegacyStatementFamilyFallback(raw);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function peer(sym: string, f: Fund | null = fund(sym), gen = 1): PeerSlot {
  return { sym, gen, load: f ? { status: "data", fund: f, stale: null } : { status: "absent" } };
}

function compare(
  anchor: string | { sym: string; fund: Fund | null },
  peers: PeerSlot[],
  basis: StatementBasis,
  alignment: CompareAlignment,
  metrics: CompareMetricId[] = ["revenue", "net_income"],
): CompareResult {
  const a = typeof anchor === "string" ? { sym: anchor, fund: fund(anchor) } : anchor;
  return buildComparison({ anchor: a, peers, basis, alignment, metrics });
}

function row(result: CompareResult, metric: CompareMetricId, sym: string) {
  const table = result.tables.find((t) => t.metric.id === metric);
  if (!table) throw new Error(`no ${metric} table`);
  const r = table.rows.find((x) => x.sym === sym);
  if (!r) throw new Error(`no ${sym} row in ${metric}`);
  return r;
}

function cell(result: CompareResult, metric: CompareMetricId, sym: string, column: string): CompareCell {
  const c = row(result, metric, sym).cells.find((x) => x.column === column);
  if (!c) throw new Error(`no ${sym} cell in ${metric}/${column}`);
  return c;
}

// ── FALSIFIER · family ──────────────────────────────────────────────────────────────────────

describe("statement family is decided by the producer's receipt, never the line label", () => {
  it("FALSIFIER: a bank's top line never sits beside an industrial revenue line (live JPM vs NVDA)", () => {
    const result = compare("NVDA", [peer("JPM")], "annual", "fiscal");
    expect(result.frame?.family).toBe("industrial");
    const nvda = cell(result, "revenue", "NVDA", "F0");
    const jpm = cell(result, "revenue", "JPM", "F0");
    expect(nvda.status).toBe("ok");
    expect(jpm.status).toBe("noncomparable");
    expect(jpm.reason).toBe("family_mismatch");
    expect(jpm.value).toBeNull();
    // Both rows live under the same data key `revenue` and the bank row HAS a number there —
    // only the family receipt refuses it.
    const jpmAnnual = fund("JPM").statements.annual!;
    expect(jpmAnnual.income.revenue[jpm.source!.index]).toBeGreaterThan(100e9);
    expect(jpm.source?.family).toBe("financial_services");
    // A one-row column is not ranked against a refusal.
    expect(nvda.rank).toBeNull();
    // The labels the two Statements tabs print differ; the gate never consulted them.
    expect(incomeTopLineLabel(jpmAnnual.source_family!, false)).toBe("Total operating income");
  });

  it("FALSIFIER: the same data key with a bank receipt is refused even when every number is identical", () => {
    const twin = clone(fund("NVDA"));
    twin.statements.annual!.source_family = "bank";
    const result = compare("NVDA", [peer("TWIN", twin)], "annual", "fiscal", ["revenue", "op_income", "cfo"]);
    for (const metric of ["revenue", "op_income", "cfo"] as const) {
      const c = cell(result, metric, "TWIN", "F0");
      expect(c.status).toBe("noncomparable");
      expect(c.reason).toBe("family_mismatch");
    }
  });

  it("admits format-independent lines across families and ranks only those", () => {
    const result = compare("NVDA", [peer("JPM"), peer("AMD")], "annual", "fiscal", ["net_income", "assets"]);
    const ni = ["NVDA", "JPM", "AMD"].map((s) => cell(result, "net_income", s, "F0"));
    expect(ni.map((c) => c.status)).toEqual(["ok", "ok", "ok"]);
    // NVDA FY2026 120.07B > JPM 2025 57.05B > AMD 2025 4.33B.
    expect(ni.map((c) => c.rank)).toEqual([1, 2, 3]);
    expect(ni.every((c) => c.rankOf === 3)).toBe(true);
  });

  it("keeps two financial formats apart: a bank is not an insurer", () => {
    const bank = clone(fund("JPM"));
    bank.statements.annual!.source_family = "bank";
    const insurer = clone(fund("JPM"));
    insurer.statements.annual!.source_family = "insurer";
    const result = compare({ sym: "BANK", fund: bank }, [peer("INSR", insurer)], "annual", "fiscal");
    expect(result.frame?.family).toBe("bank");
    expect(cell(result, "revenue", "INSR", "F0").reason).toBe("family_mismatch");
    expect(cell(result, "net_income", "INSR", "F0").status).toBe("ok");
  });

  it("marks an industrial-only line not applicable when the frame is a financial format", () => {
    const result = compare("JPM", [peer("NVDA")], "annual", "fiscal", ["gross_profit", "revenue"]);
    expect(result.frame?.family).toBe("financial_services");
    const gp = result.tables.find((t) => t.metric.id === "gross_profit")!;
    expect(gp.applicability).toBe("industrial_only");
    expect(gp.rows.every((r) => r.cells.length === 0)).toBe(true);
    expect(cell(result, "revenue", "NVDA", "F0").reason).toBe("family_mismatch");
  });

  it("refuses family-specific lines on an ambiguous receipt but keeps net income", () => {
    const amb = clone(fund("AMD"));
    amb.statements.annual!.source_family = "ambiguous";
    const result = compare("NVDA", [peer("AMB", amb)], "annual", "fiscal");
    expect(cell(result, "revenue", "AMB", "F0")).toMatchObject({ status: "unavailable", reason: "family_ambiguous" });
    expect(cell(result, "net_income", "AMB", "F0").status).toBe("ok");
  });

  it("follows a per-period family receipt across a schema change", () => {
    const switched = clone(fund("AMD"));
    const n = switched.statements.annual!.periods.length;
    switched.statements.annual!.source_family_by_period = Array.from({ length: n }, (_, i) =>
      i === n - 1 ? "industrial" : "bank",
    );
    const result = compare("NVDA", [peer("SWX", switched)], "annual", "fiscal");
    expect(cell(result, "revenue", "SWX", "F0").status).toBe("ok");
    expect(cell(result, "revenue", "SWX", "F1").reason).toBe("family_mismatch");
  });
});

// ── FALSIFIER · period ──────────────────────────────────────────────────────────────────────

describe("periods align by their end dates and kinds, never by their labels", () => {
  it("FALSIFIER: NVIDIA's \"Q2 '26\" and AMD's \"Q2 '26\" are a year apart and never share a column", () => {
    const nvda = fund("NVDA").statements.quarterly!;
    const amd = fund("AMD").statements.quarterly!;
    const nvdaQ226 = nvda.periods.indexOf("Q2 '26");
    const amdQ226 = amd.periods.indexOf("Q2 '26");
    expect(nvda.period_end[nvdaQ226]).toBe("2025-07-31");
    expect(amd.period_end[amdQ226]).toBe("2026-06-30");

    for (const alignment of ["fiscal", "calendar"] as const) {
      const result = compare("NVDA", [peer("AMD")], "quarterly", alignment);
      for (const column of result.columns) {
        const a = cell(result, "revenue", "NVDA", column.key);
        const b = cell(result, "revenue", "AMD", column.key);
        if (a.source?.label === "Q2 '26" && b.source?.label === "Q2 '26") {
          throw new Error(`${alignment}: label-matched column ${column.key}`);
        }
        if (a.source && b.source) {
          const gap = Math.abs(Date.parse(a.source.end) - Date.parse(b.source.end)) / 86_400_000;
          expect(gap).toBeLessThan(45);
        }
      }
      // AMD's Q2 '26 sits beside NVIDIA's Q2 '27 — the quarter that actually overlaps it.
      const col = result.columns.find((c) => cell(result, "revenue", "AMD", c.key).source?.label === "Q2 '26")!;
      expect(cell(result, "revenue", "NVDA", col.key).source?.label).toBe("Q2 '27");
    }
  });

  it("puts a different label on the same period in one column (AMD Q2 '26 = MSFT Q4 '26)", () => {
    const result = compare("AMD", [peer("MSFT")], "quarterly", "calendar");
    const amd = cell(result, "revenue", "AMD", "2026-Q2");
    const msft = cell(result, "revenue", "MSFT", "2026-Q2");
    expect([amd.source?.label, msft.source?.label]).toEqual(["Q2 '26", "Q4 '26"]);
    expect(amd.source?.end).toBe(msft.source?.end);
  });

  it("never mixes annual and interim: a missing annual basis is a row state, not quarters", () => {
    const quarterlyOnly = clone(fund("AMD"));
    (quarterlyOnly.statements as { annual: StatementPeriodSet | null }).annual = null;
    const result = compare("NVDA", [peer("QONLY", quarterlyOnly)], "annual", "fiscal");
    const r = row(result, "revenue", "QONLY");
    expect(r.state.status).toBe("basis_absent");
    expect(r.cells).toEqual([]);
  });

  it("never mixes a half-year with a quarter", () => {
    const half = clone(fund("0700.HK"));
    const q = half.statements.quarterly!;
    // Keep two complete half-years with their declared six-month spans.
    q.periods = ["H1 2025", "H2 2025"];
    q.period_end = ["2025-06-30", "2025-12-31"];
    q.period_start = ["2025-01-01", "2025-07-01"];
    q.period_kind = ["half_year", "half_year"];
    q.reporting_cadence = "semiannual";
    for (const block of [q.income, q.balance, q.cashflow] as unknown as Record<string, unknown[]>[]) {
      for (const key of Object.keys(block)) block[key] = block[key].slice(-2);
    }
    q.is_cumulative = [false, false];
    q.normalization_method = ["as_reported", "difference_from_prior_ytd"];
    q.source_family_by_period = undefined;
    const result = compare("0700.HK", [peer("HALF", half)], "quarterly", "fiscal");
    expect(result.frame?.kind).toBe("quarter");
    expect(row(result, "revenue", "HALF").state).toEqual({ status: "kind_mismatch", kinds: ["half_year"] });

    // …and a half-year anchor frames half-years: the quarterly peer is the mismatch.
    const asAnchor = compare({ sym: "HALF", fund: half }, [peer("0700.HK")], "quarterly", "fiscal");
    expect(asAnchor.frame?.kind).toBe("half_year");
    expect(row(asAnchor, "revenue", "0700.HK").state).toEqual({ status: "kind_mismatch", kinds: ["quarter"] });
  });

  it("drops a column whose declared span is not the kind it claims (a nine-month stub)", () => {
    const stub = clone(fund("0700.HK"));
    const q = stub.statements.quarterly!;
    const last = q.periods.length - 1;
    q.period_start![last] = "2025-10-01"; // ends 2026-06-30 → 273 days, not a quarter
    const periods = periodsOfKind(q, "quarterly", "quarter");
    expect(periods.map((p) => p.index)).not.toContain(last);
  });

  it("never selects a year-to-date column", () => {
    const ytd = clone(fund("0700.HK"));
    const a = ytd.statements.annual!;
    a.period_kind![a.period_kind!.length - 1] = "year_to_date";
    const periods = periodsOfKind(a, "annual", "full_year");
    expect(periods.at(-1)?.end).toBe("2024-12-31");
  });

  it("leaves a missing quarter empty instead of shifting older quarters forward", () => {
    const gappy = clone(fund("AMD"));
    const q = gappy.statements.quarterly!;
    const drop = q.periods.indexOf("Q4 '25");
    q.periods.splice(drop, 1);
    q.period_end.splice(drop, 1);
    for (const block of [q.income, q.balance, q.cashflow] as unknown as Record<string, unknown[]>[]) {
      for (const key of Object.keys(block)) block[key].splice(drop, 1);
    }
    const result = compare("NVDA", [peer("GAP", gappy)], "quarterly", "fiscal");
    expect(cell(result, "revenue", "GAP", "F0").source?.label).toBe("Q2 '26");
    expect(cell(result, "revenue", "GAP", "F1").source?.label).toBe("Q1 '26");
    expect(cell(result, "revenue", "GAP", "F2")).toMatchObject({ status: "unavailable", reason: "no_period", source: null });
    expect(cell(result, "revenue", "GAP", "F3").source?.label).toBe("Q3 '25");
  });
});

// ── fiscal-relative vs calendar ─────────────────────────────────────────────────────────────

describe("fiscal-relative and calendar views are distinct, explicit frames", () => {
  it("fiscal-relative: each company's own latest year, whatever month it ends", () => {
    const result = compare("NVDA", [peer("MSFT"), peer("AAPL")], "annual", "fiscal");
    expect(result.columns.map((c) => c.key)).toEqual(["F3", "F2", "F1", "F0"]);
    expect(["NVDA", "MSFT", "AAPL"].map((s) => cell(result, "revenue", s, "F0").source?.end)).toEqual([
      "2026-01-31",
      "2026-06-30",
      "2025-09-30",
    ]);
  });

  it("calendar: a period goes where most of it falls; a fiscal year split in half goes nowhere", () => {
    const result = compare("NVDA", [peer("MSFT"), peer("AAPL")], "annual", "calendar");
    expect(result.columns.every((c) => c.type === "calendar")).toBe(true);
    // NVIDIA's fiscal 2026 (Feb 2025–Jan 2026) is calendar 2025; Apple's FY2025 (Oct–Sep) too.
    expect(cell(result, "revenue", "NVDA", "CY2025").source?.label).toBe("2026");
    expect(cell(result, "revenue", "AAPL", "CY2025").source?.label).toBe("2025");
    // Microsoft's July–June year is ~50% in each calendar year: never placed, never guessed.
    for (const column of result.columns) {
      const c = cell(result, "revenue", "MSFT", column.key);
      expect(c.status).not.toBe("ok");
    }
    expect(cell(result, "revenue", "MSFT", "CY2025")).toMatchObject({ status: "unavailable", reason: "calendar_straddle" });
  });

  it("measures the overlap from the declared start, else from the period kind", () => {
    const msft = periodsOfKind(fund("MSFT").statements.annual!, "annual", "full_year").at(-1)!;
    expect(msft.startEstimated).toBe(true);
    const placed = calendarPlacement(msft);
    expect(placed.share).toBeLessThan(0.6);
    const tencent = periodsOfKind(fund("0700.HK").statements.quarterly!, "quarterly", "quarter").at(-1)!;
    expect(tencent.startEstimated).toBe(false);
    expect(calendarPlacement(tencent)).toMatchObject({ share: 1, bucket: { key: "2026-Q2" } });
  });

  it("refuses two periods of one company in one calendar slot", () => {
    const changed = clone(fund("AMD"));
    const a = changed.statements.annual!;
    // A fiscal-year change: a year ending November 2025 beside the old December 2025 year.
    a.periods = ["2024", "FY Nov 2025", "2025"];
    a.period_end = ["2024-12-31", "2025-11-30", "2025-12-31"];
    for (const block of [a.income, a.balance, a.cashflow] as unknown as Record<string, unknown[]>[]) {
      for (const key of Object.keys(block)) block[key] = block[key].slice(-3);
    }
    const result = compare("NVDA", [peer("CHG", changed)], "annual", "calendar");
    expect(cell(result, "revenue", "CHG", "CY2025")).toMatchObject({ status: "unavailable", reason: "calendar_collision" });
  });

  it("fiscal-relative refuses a peer a whole generation behind; the calendar view still places it", () => {
    const behind = clone(fund("AMD"));
    const a = behind.statements.annual!;
    a.periods = a.periods.slice(0, -1);
    a.period_end = a.period_end.slice(0, -1);
    for (const block of [a.income, a.balance, a.cashflow] as unknown as Record<string, unknown[]>[]) {
      for (const key of Object.keys(block)) block[key] = block[key].slice(0, -1);
    }
    const fiscal = compare("NVDA", [peer("LAG", behind)], "annual", "fiscal");
    expect(row(fiscal, "revenue", "LAG").state).toEqual({
      status: "generation_gap",
      latestEnd: "2024-12-31",
      frameEnd: "2026-01-31",
    });
    const calendar = compare("NVDA", [peer("LAG", behind)], "annual", "calendar");
    expect(row(calendar, "revenue", "LAG").state.status).toBe("ready");
    expect(cell(calendar, "revenue", "LAG", "CY2024").status).toBe("ok");
  });
});

// ── unit / currency ─────────────────────────────────────────────────────────────────────────

describe("a currency amount is compared only in the frame's reporting currency", () => {
  it("refuses a CNY total beside a USD total, but admits a unit-free margin", () => {
    const result = compare("NVDA", [peer("0700.HK")], "annual", "fiscal", ["revenue", "net_margin"]);
    expect(result.frame?.currency).toBe("USD");
    expect(cell(result, "revenue", "0700.HK", "F0")).toMatchObject({ status: "noncomparable", reason: "currency_mismatch" });
    const margins = ["NVDA", "0700.HK"].map((s) => cell(result, "net_margin", s, "F0"));
    expect(margins.map((c) => c.status)).toEqual(["ok", "ok"]);
    expect(margins[1].source?.currency).toBe("CNY");
    expect(margins[0].rank).not.toBeNull();
  });

  it("an unknown statement currency is unavailable, not assumed", () => {
    const unknown = clone(fund("AMD"));
    unknown.stmt_currency = null;
    const result = compare("NVDA", [peer("NOCUR", unknown)], "annual", "fiscal");
    expect(cell(result, "revenue", "NOCUR", "F0")).toMatchObject({ status: "unavailable", reason: "currency_unknown" });
  });

  it("an anchor with no statement currency compares no amounts at all", () => {
    const unknown = clone(fund("NVDA"));
    unknown.stmt_currency = "  ";
    const result = compare({ sym: "NVDA", fund: unknown }, [peer("AMD")], "annual", "fiscal", ["revenue", "net_margin"]);
    expect(result.frame?.currency).toBeNull();
    expect(cell(result, "revenue", "AMD", "F0").reason).toBe("currency_unknown");
    expect(cell(result, "net_margin", "AMD", "F0").status).toBe("ok");
  });
});

// ── flow basis / normalized-statement agreement ─────────────────────────────────────────────

describe("every number is the one the Statements tab prints", () => {
  it("a legacy cumulative-YTD A-share is compared on its DIFFERENCED quarters (600519.SS)", () => {
    const moutai = fund("600519.SS");
    const set = moutai.statements.quarterly!;
    const view = incomeView("600519.SS", set, "quarterly");
    const result = compare("600519.SS", [], "quarterly", "fiscal", ["revenue", "eps_diluted", "cfo"]);
    for (const column of result.columns) {
      const c = cell(result, "revenue", "600519.SS", column.key);
      expect(c.status).toBe("ok");
      expect(c.value).toBe(view.income.revenue[c.source!.index]);
      expect(c.source?.derivation).toBe(set.periods[c.source!.index].startsWith("Q1") ? "as_reported" : "differenced_ytd");
    }
    const q2 = cell(result, "revenue", "600519.SS", result.columns.find((col) => cell(result, "revenue", "600519.SS", col.key).source?.label === "Q4 2025")!.key);
    // 172.05B YTD at Q4 minus 130.90B at Q3 — not the cumulative 172.05B.
    expect(q2.value! / 1e9).toBeCloseTo(41.15, 1);
    // A cumulative per-share figure cannot be differenced: no fabricated EPS after Q1.
    const eps = row(result, "eps_diluted", "600519.SS").cells;
    expect(eps.filter((c) => c.status === "ok").every((c) => c.source!.label.startsWith("Q1"))).toBe(true);
    expect(eps.some((c) => c.reason === "no_value")).toBe(true);
    // Cash flow carries no normalization receipt for a legacy CN file — refused, not guessed.
    expect(row(result, "cfo", "600519.SS").cells.every((c) => c.reason === "flow_basis_unknown")).toBe(true);
  });

  it("a producer-normalized HK Q1 (\"as_reported_ytd\" under discrete_period) is a quarter", () => {
    const tencent = fund("0700.HK");
    const set = tencent.statements.quarterly!;
    const q1 = set.periods.indexOf("Q1 2026");
    expect(set.normalization_method?.[q1]).toBe("as_reported_ytd");
    expect(set.is_cumulative?.[q1]).toBe(true);
    const result = compare("0700.HK", [], "quarterly", "calendar", ["revenue", "net_margin"]);
    const c = cell(result, "revenue", "0700.HK", "2026-Q1");
    expect(c.status).toBe("ok");
    expect(c.value).toBe(set.income.revenue[q1]);
    const margin = cell(result, "net_margin", "0700.HK", "2026-Q1");
    expect(margin.value).toBe(netMarginPct(set.income.revenue, set.income.net_income)[q1]);
  });

  it("refuses a cumulative or unbased interim flow but keeps a period-end balance", () => {
    const mixed = clone(fund("0700.HK"));
    const q = mixed.statements.quarterly!;
    const last = q.periods.length - 1;
    q.flow_basis = "mixed_period";
    q.period_start = undefined; // no declared span to verify
    q.normalization_method![last] = "as_reported_ytd";
    q.normalization_method![last - 1] = "unavailable_missing_base";
    const result = compare({ sym: "0700.HK", fund: mixed }, [], "quarterly", "fiscal", ["revenue", "cfo", "equity"]);
    expect(cell(result, "revenue", "0700.HK", "F0")).toMatchObject({ status: "noncomparable", reason: "cumulative_flow" });
    expect(cell(result, "cfo", "0700.HK", "F0").reason).toBe("cumulative_flow");
    expect(cell(result, "revenue", "0700.HK", "F1")).toMatchObject({ status: "unavailable", reason: "missing_base" });
    expect(cell(result, "equity", "0700.HK", "F0").status).toBe("ok");
  });

  it("every catalog metric is the Statements value at the same column", () => {
    const set = fund("NVDA").statements.annual!;
    const view = incomeView("NVDA", set, "annual");
    const result = compare("NVDA", [], "annual", "fiscal", COMPARE_METRICS.map((m) => m.id));
    const expected: Record<CompareMetricId, (i: number) => number | null> = {
      revenue: (i) => view.income.revenue[i],
      gross_profit: (i) => view.income.gross_profit[i],
      op_income: (i) => view.income.op_income[i],
      net_income: (i) => view.income.net_income[i],
      eps_diluted: (i) => view.income.eps_diluted[i],
      net_margin: (i) => netMarginPct(view.income.revenue, view.income.net_income)[i],
      assets: (i) => set.balance.assets[i],
      equity: (i) => set.balance.equity[i],
      cfo: (i) => set.cashflow.cfo[i],
      fcf: (i) => set.cashflow.fcf[i],
    };
    for (const table of result.tables) {
      for (const c of table.rows[0].cells) {
        if (c.status !== "ok") continue;
        expect(c.value).toBe(expected[table.metric.id](c.source!.index));
      }
    }
  });

  it("reads income only through the normalized view", () => {
    const code = readFileSync(path.join(__dirname, "..", "finCompare.ts"), "utf8");
    const raw = (code.match(/[A-Za-z_$][\w$]*\??\.income\b/g) ?? []).filter((m) => !/[Vv]iew\??\.income$/.test(m));
    // The single raw read is the cumulative-SHAPE probe that mirrors incomeView's own test.
    expect(raw).toEqual(["set.income"]);
    expect(code).toContain("isCumulativeShape(set.income?.revenue)");
    // No label is ever an alignment or comparability key.
    expect(code).not.toMatch(/periods\[[^\]]+\]\s*===|label\s*===|\.label\s*==/);
  });
});

// ── restatement ─────────────────────────────────────────────────────────────────────────────

describe("restated values keep their source version", () => {
  it("carries the restatement flag and the filing the figure came from", () => {
    const restated = clone(fund("INTC"));
    const a = restated.statements.annual!;
    const i = a.periods.indexOf("2024");
    a.filed_by_period = a.periods.map((_, j) => (j === i ? "2026-01-30" : null));
    a.restated_by_period = a.periods.map((_, j) => j === i);
    const result = compare("NVDA", [peer("INTC", restated)], "annual", "calendar");
    const c = cell(result, "revenue", "INTC", "CY2024");
    expect(c.status).toBe("ok");
    expect(c.source).toMatchObject({ restated: true, filed: "2026-01-30", label: "2024", end: "2024-12-31" });
    // The shown figure is the latest filing's, exactly as Statements prints it.
    expect(c.value).toBe(a.income.revenue[i]);
    const other = cell(result, "revenue", "INTC", "CY2025");
    expect(other.source).toMatchObject({ restated: false, filed: null });
  });
});

// ── peers: missing / failed / stale ─────────────────────────────────────────────────────────

describe("a missing or failed peer is a state, never a zero or a rank", () => {
  it("maps the three read outcomes honestly", () => {
    expect(peerLoadFromOutcome({ status: "absent", httpStatus: 404 })).toEqual({ status: "absent" });
    expect(peerLoadFromOutcome({ status: "unavailable", reason: "server", httpStatus: 500 })).toEqual({
      status: "unavailable",
      reason: "server",
    });
    expect(peerLoadFromOutcome({ status: "data", data: { ticker: "X" } })).toEqual({
      status: "unavailable",
      reason: "malformed",
    });
    expect(peerLoadFromOutcome({ status: "data", data: null })).toEqual({ status: "unavailable", reason: "malformed" });
  });

  it("applies the legacy family fallback to a peer exactly as getFund does for the anchor", () => {
    const raw = JSON.parse(readFileSync(path.join(FIXTURES, "JPM.fund.json"), "utf8"));
    const load = peerLoadFromOutcome({ status: "data", data: raw });
    expect(load.status).toBe("data");
    if (load.status === "data") {
      expect(load.fund.statements.annual?.source_family).toBe("financial_services");
      expect(load.stale).toBeNull();
    }
    const stale = peerLoadFromOutcome({
      status: "data",
      data: raw,
      stale: { ageMs: 1, source: "disk", revalidation: Promise.resolve("ok") },
    });
    expect(stale.status === "data" && stale.stale).toBe("revalidating");
  });

  it("ranks only the comparable cells; loading, absent and failed peers hold no cells", () => {
    const peers: PeerSlot[] = [
      peer("AMD"),
      { sym: "ZZZZ", gen: 1, load: { status: "absent" } },
      { sym: "FAIL", gen: 1, load: { status: "unavailable", reason: "network" } },
      { sym: "SLOW", gen: 1, load: { status: "loading" } },
      peer("INTC"),
    ];
    const result = compare("NVDA", peers, "annual", "fiscal");
    expect(row(result, "revenue", "ZZZZ")).toMatchObject({ state: { status: "absent" }, cells: [] });
    expect(row(result, "revenue", "FAIL")).toMatchObject({ state: { status: "unavailable", reason: "network" }, cells: [] });
    expect(row(result, "revenue", "SLOW")).toMatchObject({ state: { status: "loading" }, cells: [] });
    const ranked = ["NVDA", "AMD", "INTC"].map((s) => cell(result, "revenue", s, "F0"));
    expect(ranked.map((c) => c.rankOf)).toEqual([3, 3, 3]);
    // Pin order is preserved for display.
    expect(result.tables[0].rows.map((r) => r.sym)).toEqual(["NVDA", "AMD", "ZZZZ", "FAIL", "SLOW", "INTC"]);
  });

  it("uses competition ranks for ties", () => {
    const tie = clone(fund("AMD"));
    const nv = fund("NVDA").statements.annual!;
    const last = tie.statements.annual!.periods.length - 1;
    tie.statements.annual!.income.revenue[last] = nv.income.revenue[nv.periods.length - 1];
    const result = compare("NVDA", [peer("TIE", tie), peer("INTC")], "annual", "fiscal");
    expect(["NVDA", "TIE", "INTC"].map((s) => cell(result, "revenue", s, "F0").rank)).toEqual([1, 1, 3]);
  });

  it("ignores a response for a superseded or removed request", () => {
    let peers = requestPeer([], "AMD", 1);
    peers = requestPeer(peers, "AMD", 2); // a retry supersedes generation 1
    const late = resolvePeer(peers, "AMD", 1, { status: "absent" });
    expect(late).toBe(peers);
    const current = resolvePeer(peers, "AMD", 2, { status: "data", fund: fund("AMD"), stale: "revalidating" });
    expect(current[0].load.status).toBe("data");
    const failed = markPeerRefreshFailed(current, "AMD", 2);
    expect(failed[0].load).toMatchObject({ stale: "refresh_failed" });
    expect(markPeerRefreshFailed(current, "AMD", 1)).toBe(current);
    const removed = removePeer(current, "AMD");
    expect(resolvePeer(removed, "AMD", 2, { status: "absent" })).toBe(removed);
  });

  it("admits a peer only once, never the anchor, and at most five", () => {
    expect(admitPeer([], "NVDA", null)).toEqual({ ok: false, reason: "invalid" });
    expect(admitPeer([], "NVDA", "NVDA")).toEqual({ ok: false, reason: "anchor" });
    const one = requestPeer([], "AMD", 1);
    expect(admitPeer(one, "NVDA", "AMD")).toEqual({ ok: false, reason: "duplicate" });
    let full: PeerSlot[] = [];
    for (let i = 0; i < MAX_COMPARE_PEERS; i++) full = requestPeer(full, `P${i}`, 1);
    expect(admitPeer(full, "NVDA", "INTC")).toEqual({ ok: false, reason: "limit" });
    expect(admitPeer(one, "NVDA", "INTC")).toEqual({ ok: true, sym: "INTC" });
  });

  it("states why there is no frame instead of rendering an empty grid", () => {
    expect(buildComparison({ anchor: { sym: "X", fund: null }, peers: [], basis: "annual", alignment: "fiscal", metrics: ["revenue"] }).frameIssue).toBe("anchor_absent");
    const noAnnual = clone(fund("NVDA"));
    (noAnnual.statements as { annual: StatementPeriodSet | null }).annual = null;
    expect(compare({ sym: "NVDA", fund: noAnnual }, [], "annual", "fiscal").frameIssue).toBe("anchor_basis_absent");
  });
});
