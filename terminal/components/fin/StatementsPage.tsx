"use client";
/**
 * StatementsPage — the TradingView "Financials · Statements" tab (BUILD-SPEC
 * §3.4 FE2a, spec/statements-transcript.md). Content stack:
 *   1. Mini bar-chart strip (series swap with the statement type — §1.2)
 *   2. Statement-type pills (Income / Balance / Cash flow) + Annual/Quarterly
 *   3. Full <MiniTable> with the TV row taxonomy (§4–6), PoP%/YoY% sub-values,
 *      and a documents row: a doc-icon per period that HAS a transcript (tx id),
 *      opening the TranscriptDrawer.
 *
 * Transcript ids live on fund.earnings.q[].tx — we map each statement period to
 * its fiscal end-date → the matching earnings quarter → its tx id. Annual
 * columns map to the fiscal-year-end quarter. Icon renders only when a tx exists
 * (absence IS the empty state — §7.5).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang } from "../../lib/i18n";
import { pick, fmtNum, fmtDate, statementCurrencyLabel } from "../../lib/finFormat";
import type { Fund, StatementPeriodSet } from "../../lib/fund";
import { historySpan, vendorGapNotice } from "../../lib/finStatements";
import {
  comparablePeriodChanges,
  cumulativeQuarterNote,
  incomeViewFamilyDisclosure,
  incomeChartValues,
  incomeViewTopLineLabel,
  incomeView,
  isIndustrialIncomeView,
  incomeViewOperatingExpenseLabel,
  resolveStatementBasis,
  statementBasisAvailable,
  statementCadenceLabel,
  statementPeriodCountLabel,
  type IncomeView,
} from "../../lib/finStatementMath";
import { Bars, MiniTable, type Series, type MiniRow } from "./FinCharts";

/** Join row names with the locale's list separator (zh uses the enumeration comma 、). */
function listJoin(items: string[], zh: boolean): string {
  return items.join(zh ? "、" : ", ");
}

export type StatementsStmt = "income" | "balance" | "cashflow";
type Stmt = StatementsStmt;
type AQ = "annual" | "quarterly";

/**
 * A deep link into one exact source cell (Financials · Compare). The page opens on this
 * statement and basis and marks the column whose period END is `periodEnd` — the index is a
 * hint, re-checked against the end date, so a refreshed file can never mark a different period.
 */
export interface StatementsSourceFocus {
  stmt: StatementsStmt;
  basis: AQ;
  index: number;
  periodEnd: string;
  rowId: string | null;
}

export interface StatementsPageProps {
  sym: string;
  fund: Fund | null;
  name?: string | null;
  /**
   * Open the transcript drawer for a defeatbeta fiscal id. Omitted → no transcript strip (a
   * peer's source view inside another company's pane, whose drawer belongs to that company).
   */
  onOpenTx?: (txId: string) => void;
  /** Open on, and mark, one exact source period. */
  focus?: StatementsSourceFocus | null;
}

/** The column `focus` names in `set`, or null when that period is not (or no longer) there. */
export function resolveStatementsFocus(
  focus: StatementsSourceFocus | null | undefined,
  set: StatementPeriodSet | null | undefined,
  stmt: StatementsStmt,
  aq: AQ,
): number | null {
  if (!focus || !set || focus.stmt !== stmt || focus.basis !== aq) return null;
  const ends = set.period_end ?? [];
  if (ends[focus.index] === focus.periodEnd) return focus.index;
  const hits = ends.flatMap((end, i) => (end === focus.periodEnd ? [i] : []));
  return hits.length === 1 ? hits[0] : null;
}

export default function StatementsPage({ sym, fund, onOpenTx, focus = null }: StatementsPageProps) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [stmt, setStmt] = useState<Stmt>(focus?.stmt ?? "income");
  const [requestedAQ, setAQ] = useState<AQ>(focus?.basis ?? "annual");
  const annualAvailable = statementBasisAvailable(fund?.statements?.annual);
  const interimAvailable = statementBasisAvailable(fund?.statements?.quarterly);
  const aq: AQ = resolveStatementBasis(requestedAQ, annualAvailable, interimAvailable);

  // period-end → tx id. Quarterly columns match a quarter's end-date exactly.
  // Annual columns carry the fiscal-YEAR end (e.g. "2026-07-31") which need not
  // string-equal any quarter's end; we map the FY to the LAST quarter that ends
  // in that fiscal year (its Q4 transcript) rather than requiring exact equality.
  // NOTE: these hooks MUST run before any early return — `fund` flips null↔loaded
  // while this pane stays mounted across symbol switches (MegaPane has no key),
  // and a conditional-hook order change would crash the whole route.
  const txQuarters = useMemo(() => {
    // quarters carrying a tx, sorted oldest→newest by end-date
    return (fund?.earnings?.q ?? [])
      .filter((q): q is typeof q & { end: string; tx: string } => !!q.end && !!q.tx)
      .sort((a, b) => a.end.localeCompare(b.end));
  }, [fund?.earnings]);
  const txByEnd = useMemo(() => {
    const m = new Map<string, string>();
    for (const q of txQuarters) m.set(q.end, q.tx);
    return m;
  }, [txQuarters]);

  // The documents strip is a horizontally-scrolling row with one cell per period. At the
  // ~5 periods yfinance supplied it always fit; the Massive backfill takes annual sets to 17
  // and quarterly to ~69, so it now scrolls — and it would open on 2009, where no transcript
  // has ever existed. Park it at the newest end (same "latest first" stance as the table
  // pager) whenever the period set changes. Imperative scroll only; no state, no re-render.
  const docStripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = docStripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [sym, aq, fund?.asof]);

  if (!fund) {
    return (
      <div className="fin-empty fin-empty-lg" role="status">
        <div className="fin-empty-title">{pick(zh, "No statements yet", "暂无财务报表")}</div>
        <div className="fin-empty-why">
          {pick(
            zh,
            `Financial statements for ${sym} haven't been collected yet. Coverage is extended nightly by dollar volume.`,
            `${sym} 的财务报表尚未采集。覆盖范围每夜按成交额扩展。`,
          )}
        </div>
      </div>
    );
  }

  const set: StatementPeriodSet | null | undefined = aq === "annual" ? fund.statements?.annual : fund.statements?.quarterly;
  // Income columns come from the canonical view. The producer may call the interim set
  // half-year, quarter or mixed; consumers never reinterpret those columns from display text.
  const view: IncomeView = incomeView(sym, set, aq);
  const periods = stmt === "income" ? view.periods : (set?.periods ?? []);
  const txForPeriod = (i: number): string | null => {
    const end = set?.period_end?.[i];
    if (!end) return null;
    // exact end-date hit (quarterly, or an annual whose FY-end coincides)
    const exact = txByEnd.get(end);
    if (exact) return exact;
    if (aq !== "annual") return null;
    // annual: last quarter ending in the same fiscal year as this FY-end
    const fyYear = end.slice(0, 4);
    let best: string | null = null;
    for (const q of txQuarters) if (q.end.slice(0, 4) === fyYear && q.end <= end) best = q.tx;
    return best;
  };

  // ── mini bar-chart strip: series swap with statement type ──
  // Cap the plotted window so the x-axis stays readable; the full-history MiniTable below
  // stays paged. Annual gets a deeper window than quarterly because the Massive backfill
  // takes annual sets to ~17 fiscal years — a 12-bar cap would hide the deep history that
  // is the whole point of the backfill, while 69 quarterly bars would crush the axis.
  const CHART_CAP = aq === "annual" ? 20 : 16;
  const chartPeriods = periods.slice(-CHART_CAP);

  // ONE normalization for the whole tab. The chart used to read `set.income.*` raw while the
  // table read a differenced copy, so a cumulative-YTD name plotted 82.9B in the strip and
  // printed 1.6B in the row beneath it. Both now read this object — see
  // lib/finStatementMath.incomeChartValues, whose arrays ARE the table's arrays.
  const chartSeries: Series[] = buildChartSeries(stmt, set, view, zh).map((s) => ({
    ...s,
    values: s.values.slice(-CHART_CAP),
  }));

  // ── table rows: TV taxonomy per statement ──
  const rows: MiniRow[] = buildRows(stmt, set, view, aq, zh);
  const focusIndex = resolveStatementsFocus(focus, set, stmt, aq);

  // Deep-history provenance. `span` evidences the depth on the section header; `gapNotice`
  // names, in plain words, the rows the pre-2021 filings do not carry — so a dash in those
  // columns reads as "the filing does not report this", never as zero or as lost data.
  // Both are null on files that predate the Massive backfill (optional contract fields).
  const span = historySpan(set);
  const gapNotice = vendorGapNotice(set, stmt, zh);

  // Disclosure for a differenced quarterly income statement. Null unless this issuer's market
  // actually files cumulative year-to-date interims, so the sentence can never describe a US
  // filer's numbers with somebody else's reporting convention.
  const cumNote = stmt === "income" ? cumulativeQuarterNote(view, zh) : null;
  const familyNote = stmt === "income" ? incomeViewFamilyDisclosure(view, zh) : null;

  const curLabel = statementCurrencyLabel(fund.stmt_currency, zh);

  // Header title tracks the selected statement so the chart above the pills is
  // never an unlabelled strip; the basis (A/Q + currency + as-of) rides the
  // single provenance row at the foot — one meta line, not two.
  const stmtTitle =
    stmt === "income"
      ? pick(zh, "Income statement", "利润表")
      : stmt === "balance"
        ? pick(zh, "Balance sheet", "资产负债表")
        : pick(zh, "Cash flow", "现金流量表");
  const asofD = fund.asof ? fmtDate(fund.asof) : "";
  const basis = statementCadenceLabel(set, aq, zh);
  const ccyLabel = statementCurrencyLabel(fund.stmt_currency, zh);
  const basisLine = pick(
    zh,
    `${basis} statements · ${ccyLabel}${asofD ? ` · as of ${asofD}` : ""}`,
    `${basis}报表 · ${ccyLabel}${asofD ? ` · 截至 ${asofD}` : ""}`,
  );

  return (
    <div className="fin-stmts">
      {/* ── 1. MINI CHART STRIP ── */}
      <section className="fin-sec">
        <div className="fin-eyebrow">{pick(zh, "FINANCIALS", "财务数据")}</div>
        <div className="fin-sec-h fin-rail fin-rule" style={{ "--rail": "var(--brand)" } as React.CSSProperties}>
          {stmtTitle}
        </div>
        <div className="fin-card">
          <Bars labels={chartPeriods} series={chartSeries} fmtY={fmtNum} zh={zh} height={170} />
        </div>
      </section>

      {/* ── 2. CONTROLS: statement pills + A/Q ── */}
      <div className="fin-stmt-ctrl">
        <div className="fin-toggle fin-stmt-pills">
          <button className={stmt === "income" ? "on" : ""} onClick={() => setStmt("income")}>
            {pick(zh, "Income statement", "利润表")}
          </button>
          <button className={stmt === "balance" ? "on" : ""} onClick={() => setStmt("balance")}>
            {pick(zh, "Balance sheet", "资产负债表")}
          </button>
          <button className={stmt === "cashflow" ? "on" : ""} onClick={() => setStmt("cashflow")}>
            {pick(zh, "Cash flow", "现金流量表")}
          </button>
        </div>
        <div className="fin-toggle fin-aq">
          <button className={aq === "annual" ? "on" : ""} onClick={() => setAQ("annual")} disabled={!annualAvailable}>
            {pick(zh, "Annual", "年度")}
          </button>
          <button
            className={aq === "quarterly" ? "on" : ""}
            onClick={() => setAQ("quarterly")}
            disabled={!interimAvailable}
          >
            {statementCadenceLabel(fund.statements?.quarterly, "quarterly", zh)}
          </button>
        </div>
      </div>

      {/* ── documents row: doc-icon per period that has a transcript ── */}
      {periods.length > 0 && onOpenTx && (
        <div className="fin-doc-strip" role="group" aria-label={pick(zh, "Earnings call transcripts", "财报电话会记录")}>
          <span className="fin-doc-strip-lbl">{pick(zh, "Transcripts", "记录")}</span>
          <div className="fin-doc-strip-cells" ref={docStripRef}>
            {periods.map((p, i) => {
              const tx = txForPeriod(i);
              return (
                <span className="fin-doc-cell" key={i}>
                  <span className="fin-doc-per">{p}</span>
                  {tx ? (
                    <button
                      className="fin-doc-icon"
                      onClick={() => onOpenTx(tx)}
                      aria-label={pick(zh, `Open ${p} transcript`, `打开 ${p} 记录`)}
                      title={pick(zh, "Earnings call transcript", "财报电话会记录")}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden>
                        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                        <path d="M14 3v5h5M9 13h6M9 17h6" />
                      </svg>
                    </button>
                  ) : (
                    <span className="fin-doc-none" aria-hidden>
                      ·
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 3. DATA TABLE ── */}
      <section className="fin-sec">
        <div className="fin-sec-h fin-rail fin-rule" style={{ "--rail": "var(--brand)" } as React.CSSProperties}>
          {pick(zh, "Full history", "完整历史")}
          {span && (
            <span className="fin-sec-sub">
              {pick(
                zh,
                `${statementPeriodCountLabel(set, aq, false)} · ${span.first}–${span.last}`,
                `${statementPeriodCountLabel(set, aq, true)} · ${span.first}–${span.last}`,
              )}
            </span>
          )}
        </div>
        {gapNotice && (
          <div className="fin-chart-note" style={{ marginBottom: 8, marginTop: 0 }}>
            {/* Phrased as a colon-list, not "<rows> show a dash": the list is 1 item on the
                income statement and 3 on the balance sheet, and a verb would have to agree
                with both. */}
            {pick(
              zh,
              `Deep history before ${gapNotice.fullFrom ?? "that point"} is taken from company filings, where some rows are defined differently from the later periods. Not comparable there: ${listJoin(gapNotice.rows, false)} — those cells show a dash rather than an estimate.`,
              `${gapNotice.fullFrom ?? "更早"}之前的深度历史取自公司备案文件，部分项目的口径与之后的期间不同。其中不可比：${listJoin(gapNotice.rows, true)}——这些单元格显示为短横线，而非估算值。`,
            )}
          </div>
        )}
        {cumNote && (
          <div className="fin-chart-note" style={{ marginBottom: 8, marginTop: 0 }}>
            {cumNote}
          </div>
        )}
        {familyNote && (
          <div className="fin-chart-note" style={{ marginBottom: 8, marginTop: 0 }}>
            {familyNote}
          </div>
        )}
        <MiniTable
          periods={periods}
          rows={rows}
          fmt={fmtNum}
          showChange
          pageSize={aq === "annual" ? 6 : 6}
          zh={zh}
          cornerLabel={curLabel}
          focus={focusIndex == null ? null : { index: focusIndex, rowId: focus?.rowId ?? null }}
        />
      </section>

      {/* single provenance row — the old right-aligned currency line, upgraded to
          carry basis + currency + as-of instead of currency alone */}
      <div className="fin-asof">{basisLine}</div>
    </div>
  );
}

/* ── mini-chart series per statement type (§1.2) ── */
function buildChartSeries(
  stmt: Stmt,
  set: StatementPeriodSet | null | undefined,
  view: IncomeView,
  zh: boolean,
): Series[] {
  if (!set) return [];
  const bal = set.balance,
    cf = set.cashflow;
  if (stmt === "income") {
    // The NORMALIZED block — never `set.income`. These arrays are the same objects
    // buildRows prints, so the strip and the table cannot show different numbers.
    const inc = incomeChartValues(view);
    const common: Series[] = [
      { name: incomeViewTopLineLabel(view, zh), values: inc.revenue, color: "var(--brand)" },
      { name: pick(zh, "Operating income", "营业利润"), values: inc.op_income, color: "var(--warn)" },
      { name: pick(zh, "Pretax income", "税前利润"), values: inc.pretax_income, color: "var(--brand-2)" },
      { name: pick(zh, "Net income", "净利润"), values: inc.net_income, color: "var(--code-fn)" },
    ];
    if (isIndustrialIncomeView(view)) {
      common.splice(1, 0, {
        name: pick(zh, "Gross profit", "毛利"),
        values: inc.gross_profit,
        color: "var(--up)",
      });
    }
    return common;
  }
  if (stmt === "balance")
    return [
      { name: pick(zh, "Total assets", "总资产"), values: bal.assets, color: "var(--brand)" },
      { name: pick(zh, "Total liabilities", "总负债"), values: bal.liabilities, color: "var(--up)" },
    ];
  return [
    { name: pick(zh, "Operating", "经营活动"), values: cf.cfo, color: "var(--brand)" },
    { name: pick(zh, "Investing", "投资活动"), values: cf.cfi, color: "var(--up)" },
    { name: pick(zh, "Financing", "筹资活动"), values: cf.cff, color: "var(--warn)" },
  ];
}

/* ── TV row taxonomy per statement (§4–6) ── */
function buildRows(
  stmt: Stmt,
  set: StatementPeriodSet | null | undefined,
  view: IncomeView,
  aq: AQ,
  zh: boolean,
): MiniRow[] {
  if (!set) return [];
  const bal = set.balance,
    cf = set.cashflow;
  const epsFmt = (v: number) => fmtNum(v, { decimals: 2 });

  // Income rows read the NORMALIZED block (lib/finStatementMath.incomeView): the raw contract
  // arrays for a discrete-quarter market, the differenced ones for a cumulative-YTD market.
  // Balance-sheet rows are period-end snapshots and are never differenced; cash-flow rows keep
  // the vendor's own basis.
  const inc = view.income;

  const mk = (label: string, values: (number | null)[], opts?: Partial<MiniRow>): MiniRow => ({
    label,
    values,
    change: comparablePeriodChanges(values, set, aq),
    ...opts,
  });

  if (stmt === "income") {
    const rows: MiniRow[] = [mk(incomeViewTopLineLabel(view, zh), inc.revenue, { bold: true, id: "revenue" })];
    if (isIndustrialIncomeView(view)) {
      rows.push(
        mk(pick(zh, "Cost of goods sold", "营业成本"), inc.cogs),
        mk(pick(zh, "Gross profit", "毛利"), inc.gross_profit, { bold: true, id: "gross_profit" }),
      );
    }
    rows.push(
      mk(
        incomeViewOperatingExpenseLabel(view, zh),
        view.operatingExpenses,
      ),
      mk(pick(zh, "Operating income", "营业利润"), inc.op_income, { bold: true, id: "op_income" }),
      mk(pick(zh, "Non-operating income (total)", "营业外收入（合计）"), inc.nonop_income),
      mk(pick(zh, "Pretax income", "税前利润"), inc.pretax_income, { bold: true }),
      mk(pick(zh, "Taxes", "税项"), inc.taxes),
      mk(pick(zh, "Net income", "净利润"), inc.net_income, { bold: true, id: "net_income" }),
    );
    if (isIndustrialIncomeView(view)) {
      rows.push(mk(pick(zh, "EBITDA", "EBITDA"), inc.ebitda));
    }
    rows.push(
      // EPS rows ride the same normalized block, so they stay internally consistent with
      // revenue / net income on a differenced cumulative-YTD statement.
      { label: pick(zh, "Basic EPS", "基本每股收益"), values: inc.eps_basic, fmt: epsFmt },
      { label: pick(zh, "Diluted EPS", "稀释每股收益"), values: inc.eps_diluted, fmt: epsFmt, id: "eps_diluted" },
    );
    return rows;
  }

  if (stmt === "balance")
    return [
      mk(pick(zh, "Total assets", "总资产"), bal.assets, {
        bold: true,
        id: "assets",
        children: [
          mk(pick(zh, "Current assets", "流动资产"), bal.assets_st, { depth: 1 }),
          mk(pick(zh, "Non-current assets", "非流动资产"), bal.assets_lt, { depth: 1 }),
        ],
      }),
      mk(pick(zh, "Total liabilities", "总负债"), bal.liabilities, {
        bold: true,
        children: [
          mk(pick(zh, "Current liabilities", "流动负债"), bal.liab_st, { depth: 1 }),
          mk(pick(zh, "Non-current liabilities", "非流动负债"), bal.liab_lt, { depth: 1 }),
        ],
      }),
      mk(pick(zh, "Total equity", "股东权益"), bal.equity, { bold: true, id: "equity" }),
      { label: pick(zh, "Total debt", "总债务"), values: bal.debt },
      { label: pick(zh, "Net debt", "净债务"), values: bal.net_debt },
      { label: pick(zh, "Cash & equivalents", "现金及等价物"), values: bal.cash },
    ];

  return [
    mk(pick(zh, "Cash flow from operating activities", "经营活动现金流"), cf.cfo, { bold: true, id: "cfo" }),
    mk(pick(zh, "Cash flow from investing activities", "投资活动现金流"), cf.cfi, { bold: true }),
    mk(pick(zh, "Cash flow from financing activities", "筹资活动现金流"), cf.cff, { bold: true }),
    { label: pick(zh, "Capital expenditure", "资本支出"), values: cf.capex },
    { label: pick(zh, "Free cash flow", "自由现金流"), values: cf.fcf, id: "fcf" },
  ];
}
