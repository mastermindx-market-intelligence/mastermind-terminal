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
import { pick, fmtNum, fmtPct, fmtDate, statementCurrencyLabel } from "../../lib/finFormat";
import type { Fund, StatementNormalizationMethod, StatementPeriodSet, StatementSourceFamily } from "../../lib/fund";
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

function sourceMarketLabel(market: StatementPeriodSet["source_market"], zh: boolean): string {
  if (market === "us") return pick(zh, "United States", "美国");
  if (market === "cn") return pick(zh, "China", "中国");
  if (market === "hk") return pick(zh, "Hong Kong", "香港");
  if (market === "ca") return pick(zh, "Canada", "加拿大");
  if (market === "crypto") return pick(zh, "Crypto", "加密资产");
  if (market === "intl") return pick(zh, "International", "国际");
  return pick(zh, "Not published", "未发布");
}

function sourceFamilyLabel(family: StatementSourceFamily | undefined, zh: boolean): string {
  if (family === "industrial") return pick(zh, "Industrial", "工业企业");
  if (family === "bank") return pick(zh, "Bank", "银行");
  if (family === "insurer") return pick(zh, "Insurer", "保险");
  if (family === "financial_services") return pick(zh, "Financial services", "金融服务");
  if (family === "ambiguous") return pick(zh, "Mixed / ambiguous", "混合 / 不明确");
  if (family === "other") return pick(zh, "Other", "其他");
  return pick(zh, "Not published", "未发布");
}

function normalizationLabel(method: StatementNormalizationMethod | undefined, zh: boolean): string {
  if (method === "as_reported") return pick(zh, "As reported", "按原始披露");
  if (method === "as_reported_ytd") return pick(zh, "As-reported year to date", "按原始年初至今披露");
  if (method === "difference_from_prior_ytd") return pick(zh, "Discrete period from prior YTD", "由上期年初至今差分为单期");
  if (method === "unavailable_missing_base") return pick(zh, "Unavailable — comparison base missing", "不可用 — 缺少比较基期");
  return pick(zh, "Not published", "未发布");
}

function flowBasisLabel(basis: StatementPeriodSet["flow_basis"], zh: boolean): string {
  if (basis === "as_reported") return pick(zh, "As reported", "按原始披露");
  if (basis === "cumulative_ytd") return pick(zh, "Cumulative year to date", "累计年初至今");
  if (basis === "discrete_period") return pick(zh, "Discrete reporting period", "独立报告期");
  if (basis === "mixed_period") return pick(zh, "Mixed reporting periods", "混合报告期");
  return pick(zh, "Not published", "未发布");
}

function atIndex(values: (number | null)[] | undefined, index: number): number | null {
  return index >= 0 ? values?.[index] ?? null : null;
}

function ratioPct(numerator: number | null, denominator: number | null): number | null {
  return numerator != null && denominator != null && denominator !== 0
    ? numerator / denominator * 100
    : null;
}

export interface StatementsPageProps {
  sym: string;
  fund: Fund | null;
  name?: string | null;
  /** Open the transcript drawer for a defeatbeta fiscal id. */
  onOpenTx: (txId: string) => void;
}

type Stmt = "income" | "balance" | "cashflow";
type AQ = "annual" | "quarterly";

export default function StatementsPage({ sym, fund, onOpenTx }: StatementsPageProps) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [stmt, setStmt] = useState<Stmt>("income");
  const [requestedAQ, setAQ] = useState<AQ>("annual");
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

  const latestIndex = (set?.periods?.length ?? 0) - 1;
  const latestPeriod = latestIndex >= 0 ? set?.periods?.[latestIndex] ?? "" : "";
  const summaryChange = (values: (number | null)[] | undefined) => {
    const changes = comparablePeriodChanges(values ?? [], set, aq);
    return latestIndex >= 0 ? changes[latestIndex] ?? null : null;
  };
  const revenue = atIndex(view.income.revenue, latestIndex);
  const grossProfit = isIndustrialIncomeView(view) ? atIndex(view.income.gross_profit, latestIndex) : null;
  const operatingIncome = atIndex(view.income.op_income, latestIndex);
  const freeCashFlow = atIndex(set?.cashflow?.fcf, latestIndex);
  const grossMargin = ratioPct(grossProfit, revenue);
  const operatingMargin = ratioPct(operatingIncome, revenue);
  const summaryMetrics = [
    {
      id: "revenue",
      label: incomeViewTopLineLabel(view, zh),
      value: revenue,
      change: summaryChange(view.income.revenue),
      detail: pick(zh, `${ccyLabel} · ${latestPeriod || "latest period"}`, `${ccyLabel} · ${latestPeriod || "最近报告期"}`),
    },
    {
      id: "gross-profit",
      label: pick(zh, "Gross profit", "毛利"),
      value: grossProfit,
      change: isIndustrialIncomeView(view) ? summaryChange(view.income.gross_profit) : null,
      detail: grossMargin == null
        ? pick(zh, "Not applicable / unavailable", "不适用 / 不可用")
        : pick(zh, `${fmtPct(grossMargin, { alreadyPct: true })} gross margin`, `毛利率 ${fmtPct(grossMargin, { alreadyPct: true })}`),
    },
    {
      id: "operating-income",
      label: pick(zh, "Operating income", "营业利润"),
      value: operatingIncome,
      change: summaryChange(view.income.op_income),
      detail: operatingMargin == null
        ? pick(zh, "Margin unavailable", "利润率不可用")
        : pick(zh, `${fmtPct(operatingMargin, { alreadyPct: true })} operating margin`, `营业利润率 ${fmtPct(operatingMargin, { alreadyPct: true })}`),
    },
    {
      id: "free-cash-flow",
      label: pick(zh, "Free cash flow", "自由现金流"),
      value: freeCashFlow,
      change: summaryChange(set?.cashflow?.fcf),
      detail: freeCashFlow == null
        ? pick(zh, "Not available in the financials record", "财务记录中暂无该值")
        : pick(zh, "From the financials record", "来自财务记录"),
    },
  ];
  const latestNormalization = latestIndex >= 0 ? set?.normalization_method?.[latestIndex] : undefined;
  const latestCash = atIndex(set?.balance?.cash, latestIndex);
  const latestDebt = atIndex(set?.balance?.debt, latestIndex);
  const latestNetDebt = atIndex(set?.balance?.net_debt, latestIndex);
  const latestCfo = atIndex(set?.cashflow?.cfo, latestIndex);
  const latestCapex = atIndex(set?.cashflow?.capex, latestIndex);

  type SnapshotRow = {
    id: string;
    label: string;
    values: (number | null)[];
    bold?: boolean;
    fmt?: (value: number) => string;
  };
  const snapshotCount = Math.min(4, periods.length);
  const snapshotPeriods = snapshotCount > 0 ? periods.slice(-snapshotCount) : [];
  const snapshotValues = (values: (number | null | undefined)[] | undefined): (number | null)[] => (
    snapshotCount > 0 ? (values ?? []).slice(-snapshotCount).map((value) => value ?? null) : []
  );
  const snapshotRows: SnapshotRow[] = stmt === "income"
    ? [
        {
          id: "top-line",
          label: incomeViewTopLineLabel(view, zh),
          values: snapshotValues(view.income.revenue),
          bold: true,
        },
        ...(isIndustrialIncomeView(view)
          ? [{
              id: "gross-profit",
              label: pick(zh, "Gross profit", "毛利"),
              values: snapshotValues(view.income.gross_profit),
            }]
          : []),
        {
          id: "operating-income",
          label: pick(zh, "Operating income", "营业利润"),
          values: snapshotValues(view.income.op_income),
        },
        {
          id: "net-income",
          label: pick(zh, "Net income", "净利润"),
          values: snapshotValues(view.income.net_income),
          bold: true,
        },
        ...(isIndustrialIncomeView(view)
          ? [{
              id: "ebitda",
              label: pick(zh, "EBITDA", "EBITDA"),
              values: snapshotValues(view.income.ebitda),
            }]
          : []),
        {
          id: "diluted-eps",
          label: pick(zh, "Diluted EPS", "稀释每股收益"),
          values: snapshotValues(view.income.eps_diluted),
          fmt: (value: number) => fmtNum(value, { decimals: 2 }),
        },
      ]
    : stmt === "balance"
      ? [
          { id: "assets", label: pick(zh, "Total assets", "总资产"), values: snapshotValues(set?.balance?.assets), bold: true },
          { id: "liabilities", label: pick(zh, "Total liabilities", "总负债"), values: snapshotValues(set?.balance?.liabilities), bold: true },
          { id: "equity", label: pick(zh, "Total equity", "股东权益"), values: snapshotValues(set?.balance?.equity) },
          { id: "debt", label: pick(zh, "Total debt", "总债务"), values: snapshotValues(set?.balance?.debt) },
          { id: "net-debt", label: pick(zh, "Net debt", "净债务"), values: snapshotValues(set?.balance?.net_debt) },
          { id: "cash", label: pick(zh, "Cash & equivalents", "现金及等价物"), values: snapshotValues(set?.balance?.cash) },
        ]
      : [
          { id: "cfo", label: pick(zh, "Operating cash flow", "经营现金流"), values: snapshotValues(set?.cashflow?.cfo), bold: true },
          { id: "cfi", label: pick(zh, "Investing cash flow", "投资现金流"), values: snapshotValues(set?.cashflow?.cfi) },
          { id: "cff", label: pick(zh, "Financing cash flow", "筹资现金流"), values: snapshotValues(set?.cashflow?.cff) },
          { id: "capex", label: pick(zh, "Capital expenditure", "资本支出"), values: snapshotValues(set?.cashflow?.capex) },
          { id: "fcf", label: pick(zh, "Free cash flow", "自由现金流"), values: snapshotValues(set?.cashflow?.fcf), bold: true },
        ];
  const trajectorySeries: Series[] = chartSeries.slice(0, 1).map((series) => ({
    ...series,
    values: snapshotValues(series.values),
  }));

  return (
    <div className="fin-stmts" data-financials-vnext="">
      <section className="fin-financials-head" data-financials-vnext-head="">
        <div>
          <span>{pick(zh, "FINANCIAL STATEMENTS", "财务报表")}</span>
          <h2>{pick(zh, "Reported fundamentals with source-aware period handling", "保留来源与报告期语义的已披露基本面")}</h2>
          <p>{basisLine}</p>
        </div>
        <div className="fin-financials-controls">
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
          <div className="fin-toggle fin-stmt-pills">
            <button className={stmt === "income" ? "on" : ""} onClick={() => setStmt("income")}>{pick(zh, "Income", "利润")}</button>
            <button className={stmt === "balance" ? "on" : ""} onClick={() => setStmt("balance")}>{pick(zh, "Balance", "资产负债")}</button>
            <button className={stmt === "cashflow" ? "on" : ""} onClick={() => setStmt("cashflow")}>{pick(zh, "Cash flow", "现金流")}</button>
          </div>
        </div>
      </section>

      <section className="fin-financials-summary" data-financials-vnext-summary="" aria-label={pick(zh, "Financial summary", "财务摘要")}>
        {summaryMetrics.map((metric) => (
          <article key={metric.id}>
            <div>
              <strong>{metric.label}</strong>
              {metric.change != null ? <span className={metric.change >= 0 ? "up" : "down"}>{pick(zh, `${fmtPct(metric.change, { alreadyPct: true })} year over year`, `同比 ${fmtPct(metric.change, { alreadyPct: true })}`)}</span> : null}
            </div>
            <b className="num">{metric.value == null ? "—" : fmtNum(metric.value)}</b>
            <small>{metric.detail}</small>
          </article>
        ))}
      </section>

      <section className="fin-financials-core-grid" data-financials-vnext-explorer="">
        <article className="fin-card fin-financials-trajectory">
          <header className="fin-financials-card-head">
            <div>
              <span>{pick(zh, "TRAJECTORY", "趋势")}</span>
              <h3>
                {stmt === "income"
                  ? pick(zh, "Income trajectory", "利润趋势")
                  : stmt === "balance"
                    ? pick(zh, "Balance-sheet trajectory", "资产负债趋势")
                    : pick(zh, "Cash-flow trajectory", "现金流趋势")}
              </h3>
            </div>
            <small>{pick(zh, "Latest four normalized periods", "最近四个标准化报告期")}</small>
          </header>
          {snapshotPeriods.length > 0 && trajectorySeries.length > 0 ? (
            <Bars labels={snapshotPeriods} series={trajectorySeries} fmtY={fmtNum} zh={zh} height={190} />
          ) : (
            <div className="fin-empty fin-empty-lg" role="status">
              <div className="fin-empty-title">{pick(zh, "No trajectory available", "暂无趋势数据")}</div>
              <div className="fin-empty-why">
                {pick(zh, "The selected statement basis has no published periods.", "当前所选报表口径没有已发布报告期。")}
              </div>
            </div>
          )}
        </article>

        <article className="fin-card fin-financials-statement-snapshot">
          <header className="fin-financials-card-head">
            <div>
              <span>{pick(zh, "STATEMENT SNAPSHOT", "报表快照")}</span>
              <h3>{stmtTitle}</h3>
            </div>
            <small>{pick(zh, "Normalized · oldest → latest", "标准化 · 最早 → 最新")}</small>
          </header>
          {snapshotPeriods.length > 0 ? (
            <div className="fin-financials-snapshot-scroll">
              <table className="fin-financials-snapshot-table">
                <thead>
                  <tr>
                    <th scope="col">{pick(zh, "Metric", "指标")}</th>
                    {snapshotPeriods.map((period) => <th scope="col" key={period}>{period}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {snapshotRows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row" className={row.bold ? "strong" : ""}>{row.label}</th>
                      {row.values.map((value, index) => (
                        <td className={row.bold ? "strong num" : "num"} key={snapshotPeriods[index] ?? index}>
                          {value == null ? "—" : row.fmt ? row.fmt(value) : fmtNum(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="fin-empty fin-empty-lg" role="status">
              <div className="fin-empty-title">{pick(zh, "No statement snapshot", "暂无报表快照")}</div>
              <div className="fin-empty-why">
                {pick(zh, "The selected statement basis has no published periods.", "当前所选报表口径没有已发布报告期。")}
              </div>
            </div>
          )}
        </article>
      </section>

      <section className="fin-financials-integrity" data-financials-vnext-integrity="">
        <article>
          <header><strong>{pick(zh, "Balance-sheet snapshot", "资产负债表快照")}</strong><span>{pick(zh, "latest selected period", "当前所选最新报告期")}</span></header>
          <div className="fin-financials-integrity-metrics">
            <span><small>{pick(zh, "Cash", "现金")}</small><b className="num">{latestCash == null ? "—" : fmtNum(latestCash)}</b></span>
            <span><small>{pick(zh, "Debt", "债务")}</small><b className="num">{latestDebt == null ? "—" : fmtNum(latestDebt)}</b></span>
            <span><small>{pick(zh, "Net debt", "净债务")}</small><b className="num">{latestNetDebt == null ? "—" : fmtNum(latestNetDebt)}</b></span>
          </div>
          <p>{pick(zh, "Balance rows are period-end snapshots; they are never differenced.", "资产负债表行是期末快照；绝不进行差分处理。")}</p>
        </article>
        <article>
          <header><strong>{pick(zh, "Cash conversion", "现金转换")}</strong><span>{pick(zh, "cash-flow rows", "现金流行")}</span></header>
          <div className="fin-financials-integrity-metrics">
            <span><small>{pick(zh, "Operating cash flow", "经营现金流")}</small><b className="num">{latestCfo == null ? "—" : fmtNum(latestCfo)}</b></span>
            <span><small>{pick(zh, "Capital expenditure", "资本支出")}</small><b className="num">{latestCapex == null ? "—" : fmtNum(latestCapex)}</b></span>
            <span><small>{pick(zh, "Free cash flow", "自由现金流")}</small><b className="num">{freeCashFlow == null ? "—" : fmtNum(freeCashFlow)}</b></span>
          </div>
          <p>{pick(zh, "This page uses the free-cash-flow value in the financials record; it does not recompute a missing value.", "本页使用财务记录中的自由现金流值；字段缺失时不会在页面重算。")}</p>
        </article>
        <article>
          <header><strong>{pick(zh, "Source & normalization", "来源与标准化")}</strong><span>{pick(zh, "selected basis", "当前所选口径")}</span></header>
          <dl className="fin-financials-source">
            <div><dt>{pick(zh, "Source market", "来源市场")}</dt><dd>{sourceMarketLabel(set?.source_market, zh)}</dd></div>
            <div><dt>{pick(zh, "Statement family", "报表类型")}</dt><dd>{sourceFamilyLabel(view.sourceFamily, zh)}</dd></div>
            <div><dt>{pick(zh, "Reporting cadence", "报告频率")}</dt><dd>{statementCadenceLabel(set, aq, zh)}</dd></div>
            <div><dt>{pick(zh, "Normalization", "标准化")}</dt><dd>{normalizationLabel(latestNormalization, zh)}</dd></div>
            <div><dt>{pick(zh, "Flow basis", "流量口径")}</dt><dd>{flowBasisLabel(set?.flow_basis, zh)}</dd></div>
            <div><dt>{pick(zh, "Currency", "货币")}</dt><dd>{ccyLabel}</dd></div>
          </dl>
        </article>
      </section>


      {/* ── documents row: doc-icon per period that has a transcript ── */}
      {periods.length > 0 && (
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
              `Deep history is taken from company filings. Filings before ${gapNotice.fullFrom ?? "that point"} report statement totals only. Not reported there: ${listJoin(gapNotice.rows, false)} — those cells show a dash rather than an estimate.`,
              `深度历史取自公司备案文件。${gapNotice.fullFrom ?? "更早"}之前的备案仅披露报表总额，其中未披露：${listJoin(gapNotice.rows, true)}——这些单元格显示为短横线，而非估算值。`,
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
    const rows: MiniRow[] = [mk(incomeViewTopLineLabel(view, zh), inc.revenue, { bold: true })];
    if (isIndustrialIncomeView(view)) {
      rows.push(
        mk(pick(zh, "Cost of goods sold", "营业成本"), inc.cogs),
        mk(pick(zh, "Gross profit", "毛利"), inc.gross_profit, { bold: true }),
      );
    }
    rows.push(
      mk(
        incomeViewOperatingExpenseLabel(view, zh),
        view.operatingExpenses,
      ),
      mk(pick(zh, "Operating income", "营业利润"), inc.op_income, { bold: true }),
      mk(pick(zh, "Non-operating income (total)", "营业外收入（合计）"), inc.nonop_income),
      mk(pick(zh, "Pretax income", "税前利润"), inc.pretax_income, { bold: true }),
      mk(pick(zh, "Taxes", "税项"), inc.taxes),
      mk(pick(zh, "Net income", "净利润"), inc.net_income, { bold: true }),
    );
    if (isIndustrialIncomeView(view)) {
      rows.push(mk(pick(zh, "EBITDA", "EBITDA"), inc.ebitda));
    }
    rows.push(
      // EPS rows ride the same normalized block, so they stay internally consistent with
      // revenue / net income on a differenced cumulative-YTD statement.
      { label: pick(zh, "Basic EPS", "基本每股收益"), values: inc.eps_basic, fmt: epsFmt },
      { label: pick(zh, "Diluted EPS", "稀释每股收益"), values: inc.eps_diluted, fmt: epsFmt },
    );
    return rows;
  }

  if (stmt === "balance")
    return [
      mk(pick(zh, "Total assets", "总资产"), bal.assets, {
        bold: true,
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
      mk(pick(zh, "Total equity", "股东权益"), bal.equity, { bold: true }),
      { label: pick(zh, "Total debt", "总债务"), values: bal.debt },
      { label: pick(zh, "Net debt", "净债务"), values: bal.net_debt },
      { label: pick(zh, "Cash & equivalents", "现金及等价物"), values: bal.cash },
    ];

  return [
    mk(pick(zh, "Cash flow from operating activities", "经营活动现金流"), cf.cfo, { bold: true }),
    mk(pick(zh, "Cash flow from investing activities", "投资活动现金流"), cf.cfi, { bold: true }),
    mk(pick(zh, "Cash flow from financing activities", "筹资活动现金流"), cf.cff, { bold: true }),
    { label: pick(zh, "Capital expenditure", "资本支出"), values: cf.capex },
    { label: pick(zh, "Free cash flow", "自由现金流"), values: cf.fcf },
  ];
}
