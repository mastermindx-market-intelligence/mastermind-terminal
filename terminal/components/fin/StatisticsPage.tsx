"use client"
/**
 * StatisticsPage — TradingView-parity Statistics tab (BUILD-SPEC §3.4 FE2b,
 * spec/stats-earn-rev-div.md §1). P/E + P/S bar chart at top; Key stats rows;
 * Valuation-ratios table with live 'Current' column; Profitability-ratios group.
 *
 * Props: {fund, quote, zh}
 * - fund: Fund | null — null renders a graceful empty state
 * - quote: { last: number | null } | null — provides the 'Current' column price
 * - zh: boolean — language selector
 */
import type { Fund, RatiosCurrent } from "../../lib/fund"
import { fmtDate, fmtNum, fmtPct, pick, statementCurrencyLabel } from "../../lib/finFormat"
import {
  incomeView,
  incomeViewFamilyMode,
  isIndustrialIncomeView,
  statementBasisAvailable,
  statementCadenceLabel,
} from "../../lib/finStatementMath"
import { Bars, type Series } from "./FinCharts"
import currentTables from "./StatisticsCurrentTables.module.css"

// ── prop types ──────────────────────────────────────────────────────────────

export interface StatisticsPageProps {
  fund: Fund | null
  quote?: { last: number | null } | null
  zh?: boolean
  sym?: string
}

// ── helpers ─────────────────────────────────────────────────────────────────


function n2(v: number | null | undefined): string {
  return v != null && isFinite(v) ? v.toFixed(2) : "—"
}

// ── ValuationRow definition ──────────────────────────────────────────────────

interface StatRow {
  label: string
  values: (number | null)[]
  current?: number | null
  /** Optional custom formatter */
  fmt?: (v: number) => string
}

// ── main component ──────────────────────────────────────────────────────────

export default function StatisticsPage({ fund, quote, zh, sym }: StatisticsPageProps) {
  const annualAvailable = statementBasisAvailable(fund?.statements?.annual)
  const interimAvailable = statementBasisAvailable(fund?.statements?.quarterly)

  if (!fund) {
    return (
      <div className="fin-body">
        <div className="fin-empty fin-empty-lg" role="status">
          <span className="fin-empty-title">{pick(!!zh, "Fundamentals not yet covered", "尚未覆盖基本面数据")}</span>
          <span className="fin-empty-why">{pick(!!zh,
            `Fundamental data for ${sym ?? "this symbol"} hasn't been collected yet. Coverage is extended nightly by dollar volume.`,
            `${sym ?? "该标的"} 的基本面数据尚未采集。覆盖范围每夜按成交额扩展。`
          )}</span>
        </div>
      </div>
    )
  }

  const cur = fund.ratios?.current ?? ({} as RatiosCurrent)
  const familyReceipt = annualAvailable
    ? fund.statements?.annual
    : interimAvailable
      ? fund.statements?.quarterly
      : null
  const annualIncomeView = incomeView(fund.ticker, familyReceipt, "annual")
  const annualFamilyMode = incomeViewFamilyMode(annualIncomeView)
  const industrialMetricsApply = !!familyReceipt && isIndustrialIncomeView(annualIncomeView)

  // ── top bar chart: P/E + P/S per period ──
  const rPeriods = fund.ratios?.periods ?? []
  const peSeries: Series[] = [
    {
      name: pick(!!zh, "Price to earnings ratio", "市盈率"),
      values: fund.ratios?.pe ?? [],
      color: "var(--brand)",
    },
    ...(industrialMetricsApply
      ? [{
          // Valuation ratio — categorical, not directional. --brand-2 is locale-stable
          // (--up would flip red under the east red-up theme for no semantic reason).
          name: pick(!!zh, "Price to sales ratio", "市销率"),
          values: fund.ratios?.ps ?? [],
          color: "var(--brand-2)",
        }]
      : []),
  ]

  // This feed publishes annual ratio history. Current scalar ratios do not
  // depend on statement cadence, including companies with interim-only statements.
  const chartPeriods = rPeriods
  const chartSeries = peSeries

  // Whether ALL historical ratio series are null (common for CN / newly covered names).
  // In that case: collapse the top chart, hide historical year columns (show only Current).
  const hasHistoricalRatios = (
    (fund.ratios?.pe ?? []).some((v) => v != null && isFinite(v as number)) ||
    (industrialMetricsApply && (fund.ratios?.ps ?? []).some((v) => v != null && isFinite(v as number))) ||
    (fund.ratios?.pb ?? []).some((v) => v != null && isFinite(v as number))
  )

  // ── Key stats rows ──
  // These come from fund.stats (not period-indexed by annual/quarterly in v1)
  // We show them as single current-value rows (no period array per §1.1 — stats.shares_out is a scalar)
  const sharesFmtM = (v: number | null | undefined) =>
    v != null && isFinite(v) ? fmtNum(v) : "—"
  const empFmt = (v: number | null | undefined) =>
    v != null && isFinite(v) ? v.toLocaleString("en-US") : "—"

  // ── Valuation rows aligned to annual ratios.periods (v1 has annual ratios only) ──
  // History follows its own published period labels, independent of current metrics.
  const annualPeriods = rPeriods

  // Build a "Current" column value from live ratios
  const valRows: StatRow[] = [
    { label: pick(!!zh, "Price to earnings ratio", "市盈率"), values: fund.ratios?.pe ?? [], current: cur.pe_ttm },
    ...(industrialMetricsApply
      ? [{ label: pick(!!zh, "Price to sales ratio", "市销率"), values: fund.ratios?.ps ?? [], current: cur.ps }]
      : []),
    { label: pick(!!zh, "Price to book ratio", "市净率"), values: fund.ratios?.pb ?? [], current: cur.pb },
    { label: pick(!!zh, "Price to cash flow ratio", "市现率"), values: fund.ratios?.pcf ?? [], current: null },
    ...(industrialMetricsApply
      ? [{ label: pick(!!zh, "Enterprise value to EBITDA", "EV/EBITDA"), values: fund.ratios?.ev_ebitda ?? [], current: cur.ev_ebitda }]
      : []),
    { label: pick(!!zh, "Price to earnings forward", "预期市盈率"), values: [], current: cur.pe_fwd },
    ...(industrialMetricsApply
      ? [{ label: pick(!!zh, "EV to sales", "EV/销售额"), values: [], current: cur.ev_sales }]
      : []),
    { label: pick(!!zh, "EV to EBIT", "EV/息税前利润"), values: [], current: cur.ev_ebit },
    ...(industrialMetricsApply
      ? [{ label: pick(!!zh, "Price to FCF", "价格/自由现金流"), values: [], current: cur.p_fcf }]
      : []),
  ]

  // ── Profitability rows from ratios.current (no period series in v1) ──
  const profRows: { label: string; value: string }[] = [
    ...(industrialMetricsApply
      ? [{ label: pick(!!zh, "Gross margin", "毛利率"), value: cur.gross_margin != null ? fmtPct(cur.gross_margin) : "—" }]
      : []),
    { label: pick(!!zh, "Net margin", "净利率"), value: cur.net_margin != null ? fmtPct(cur.net_margin) : "—" },
    { label: pick(!!zh, "Return on equity", "净资产收益率"), value: cur.roe != null ? fmtPct(cur.roe) : "—" },
    { label: pick(!!zh, "Return on assets", "总资产收益率"), value: cur.roa != null ? fmtPct(cur.roa) : "—" },
    { label: pick(!!zh, "Dividend yield", "股息率"), value: cur.div_yield != null ? fmtPct(cur.div_yield) : "—" },
    { label: pick(!!zh, "Payout ratio", "派息比率"), value: cur.payout != null ? fmtPct(cur.payout) : "—" },
    { label: pick(!!zh, "Debt to equity", "债股比"), value: cur.debt_to_equity != null ? n2(cur.debt_to_equity) : "—" },
    { label: pick(!!zh, "Current ratio", "流动比率"), value: cur.current_ratio != null ? n2(cur.current_ratio) : "—" },
  ]

  // Provenance: every table on this page dates itself off the one snapshot date.
  const asofD = fund.asof ? fmtDate(fund.asof) : ""
  const asofTxt = asofD ? pick(!!zh, `as of ${asofD}`, `截至 ${asofD}`) : ""

  return (
    <div className="fin-body">
      {/* Current metrics and annual ratio history share one compact heading. */}
      {/* `rule` rides the ROW (not the title) so the hairline spans the header
          width instead of stopping under the word — same shape the Earnings
          module header uses for a title+control row. */}
      <div className="fin-stats-hdr fin-rule">
        <div className="fin-sec-h fin-rail" style={{ "--rail": "var(--brand)" } as React.CSSProperties}>
          {pick(!!zh, "Statistics", "统计数据")}
        </div>
        <span className="fin-asof">{pick(!!zh, "Current snapshot · annual ratio history", "当前快照 · 年度估值历史")}</span>
      </div>

      {/* ── Top bar chart: P/E + P/S — hidden when all historical series null ── */}
      {hasHistoricalRatios && (
        <div className="fin-sec">
          <Bars
            labels={chartPeriods}
            series={chartSeries}
            fmtY={(v) => v.toFixed(2)}
            height={160}
            zh={zh}
          />
        </div>
      )}
      {!hasHistoricalRatios && (
        <div className="fin-sec">
          <div className="fin-chart-note" style={{ marginTop: 0 }}>
            {industrialMetricsApply
              ? pick(!!zh,
                  "Historical ratio series (P/E, P/S, P/B) are not yet available for this security.",
                  "该证券历史估值比率（市盈率、市销率、市净率）数据暂不可用。"
                )
              : pick(!!zh,
                  "Historical P/E and P/B series are not yet available for this security.",
                  "该证券历史估值比率（市盈率、市净率）数据暂不可用。"
                )}
          </div>
        </div>
      )}

      {/* ── Key stats ── */}
      <div className="fin-sec">
        <div className="fin-table-scroll">
          <table className={`fin-table fin-stats-tbl ${currentTables.currentTable}`}>
            <thead>
              <tr>
                <th className="fin-cell fin-cell-sticky fin-cell-corner" scope="col">
                  {pick(!!zh, "Metrics", "指标")}
                </th>
                <th className="fin-cell fin-cell-num fin-cell-head" scope="col">
                  {pick(!!zh, "Current", "当前")}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="fin-row fin-stats-grp-hdr">
                <th colSpan={2} className="fin-cell fin-cell-grp" scope="rowgroup">
                  {pick(!!zh, "Key stats", "关键指标")}
                </th>
              </tr>
              <tr className="fin-row">
                <th className="fin-cell fin-cell-sticky" scope="row">
                  {pick(!!zh, "Total shares outstanding", "总股本")}
                </th>
                <td className="fin-cell fin-cell-num">{sharesFmtM(fund.stats?.shares_out)}</td>
              </tr>
              <tr className="fin-row">
                <th className="fin-cell fin-cell-sticky" scope="row">
                  {pick(!!zh, "Free float", "自由流通股本")}
                </th>
                <td className="fin-cell fin-cell-num">{sharesFmtM(fund.stats?.float_shares)}</td>
              </tr>
              <tr className="fin-row">
                <th className="fin-cell fin-cell-sticky" scope="row">
                  {pick(!!zh, "Number of employees", "员工人数")}
                </th>
                <td className="fin-cell fin-cell-num">{empFmt(fund.profile?.employees)}</td>
              </tr>
              <tr className="fin-row">
                <th className="fin-cell fin-cell-sticky" scope="row">
                  {pick(!!zh, "Number of shareholders", "股东人数")}
                </th>
                <td className="fin-cell fin-cell-num">{empFmt(fund.stats?.num_holders)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* the old header meta line reads as provenance — it now sits below the
            data it describes, as the standard as-of row */}
        <div className="fin-stats-meta fin-asof">
          {asofTxt && <span>{asofTxt}</span>}
        </div>
      </div>

      {/* ── Valuation ratios (annual series + live Current column) ── */}
      <div className="fin-sec">
        {!industrialMetricsApply && (
          <div className="fin-chart-note" style={{ marginTop: 0, marginBottom: 8 }}>
            {!familyReceipt
              ? pick(!!zh,
                  "Sales-, EBITDA- and free-cash-flow-based ratios are omitted because no statement-family receipt is available.",
                  "由于暂无报表类型来源凭证，因此不显示基于销售额、EBITDA 及自由现金流的估值比率。"
                )
              : annualFamilyMode === "mixed"
              ? pick(!!zh,
                  "Sales-, EBITDA- and free-cash-flow-based ratios are omitted because this history crosses industrial and financial-services statement formats.",
                  "该历史区间跨越工业企业与金融服务报表格式，因此不显示基于销售额、EBITDA 及自由现金流的估值比率。"
                )
              : pick(!!zh,
                  "Sales-, EBITDA- and free-cash-flow-based ratios are omitted for financial-services statement formats.",
                  "金融服务报表格式不显示基于销售额、EBITDA 及自由现金流的估值比率。"
                )}
          </div>
        )}
          <div className="fin-table-scroll">
            <table className={`fin-table fin-stats-tbl ${!hasHistoricalRatios ? currentTables.currentTable : ""}`}>
              <thead>
                <tr>
                  <th className="fin-cell fin-cell-sticky fin-cell-corner" scope="col">
                    {pick(!!zh, "Metrics", "指标")}
                  </th>
                  {/* Hide historical period columns when all ratio series are null */}
                  {hasHistoricalRatios && annualPeriods.slice(-6).map((p, i) => (
                    <th key={i} className="fin-cell fin-cell-num fin-cell-head" scope="col">{p}</th>
                  ))}
                  <th className="fin-cell fin-cell-num fin-cell-head fin-cell-current" scope="col">
                    {pick(!!zh, "Current", "当前")}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="fin-row fin-stats-grp-hdr">
                  <th colSpan={(hasHistoricalRatios ? annualPeriods.slice(-6).length : 0) + 2} className="fin-cell fin-cell-grp" scope="rowgroup">
                    {pick(!!zh, "Valuation ratios", "估值比率")}
                    {!hasHistoricalRatios && (
                      <span style={{ fontWeight: 500, fontSize: "var(--fs-micro)", color: "var(--muted)", marginLeft: "8px" }}>
                        {pick(!!zh, "— historical series not yet available", "— 历史数据暂不可用")}
                      </span>
                    )}
                  </th>
                </tr>
                {valRows.map((row, ri) => {
                  const periodSlice = row.values.slice(-6) // annual series only
                  return (
                    <tr key={ri} className="fin-row">
                      <th className="fin-cell fin-cell-sticky" scope="row">{row.label}</th>
                      {hasHistoricalRatios && annualPeriods.slice(-6).map((_, ci) => (
                        <td key={ci} className="fin-cell fin-cell-num">
                          {periodSlice[ci] != null && isFinite(periodSlice[ci] as number)
                            ? (periodSlice[ci] as number).toFixed(2)
                            : "—"}
                        </td>
                      ))}
                      <td className="fin-cell fin-cell-num fin-cell-current">
                        {row.current != null && isFinite(row.current) ? row.current.toFixed(2) : "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        {asofTxt && (
          <div className="fin-stats-meta fin-asof">
            <span>{pick(!!zh, "Annual fiscal periods", "年度财季")}</span>
            <span>{asofTxt}</span>
          </div>
        )}
      </div>

      {/* ── Profitability ratios ── */}
      <div className="fin-sec">
        {!industrialMetricsApply && (
          <div className="fin-chart-note" style={{ marginTop: 0, marginBottom: 8 }}>
            {!familyReceipt
              ? pick(!!zh,
                  "Gross margin is omitted because no statement-family receipt is available to establish an industrial COGS and gross-profit structure.",
                  "由于暂无报表类型来源凭证，无法确认工业企业的营业成本与毛利结构，因此不显示毛利率。"
                )
              : annualFamilyMode === "mixed"
              ? pick(!!zh,
                  "Gross margin is omitted because this history crosses statement formats without one comparable COGS and gross-profit structure.",
                  "该历史区间跨越不同报表格式，不存在单一可比的营业成本与毛利结构，因此不显示毛利率。"
                )
              : pick(!!zh,
                  "Gross margin is omitted for financial-services statement formats because industrial COGS and gross profit do not apply.",
                  "金融服务报表格式不适用工业企业的营业成本与毛利结构，因此不显示毛利率。"
                )}
          </div>
        )}
        <div className="fin-table-scroll">
          <table className={`fin-table fin-stats-tbl ${currentTables.currentTable}`}>
            <thead>
              <tr>
                <th className="fin-cell fin-cell-sticky fin-cell-corner" scope="col">
                  {pick(!!zh, "Metrics", "指标")}
                </th>
                <th className="fin-cell fin-cell-num fin-cell-head fin-cell-current" scope="col">
                  {pick(!!zh, "Current", "当前")}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="fin-row fin-stats-grp-hdr">
                <th colSpan={2} className="fin-cell fin-cell-grp" scope="rowgroup">
                  {pick(!!zh, "Profitability ratios", "盈利比率")}
                </th>
              </tr>
              {profRows.map((row, ri) => (
                <tr key={ri} className="fin-row">
                  <th className="fin-cell fin-cell-sticky" scope="row">{row.label}</th>
                  <td className="fin-cell fin-cell-num fin-cell-current">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {asofTxt && (
          <div className="fin-stats-meta fin-asof">
            <span>{pick(!!zh, "Latest reported ratios", "最新报告比率")}</span>
            <span>{asofTxt}</span>
          </div>
        )}
      </div>
      <details className="fin-details" data-statistics-statement-source="">
        <summary>{pick(!!zh, "Statement source", "报表来源")}</summary>
        <div className="fin-stats-meta fin-asof">
          <span>{familyReceipt
            ? `${pick(!!zh, "Source cadence", "来源频率")}: ${statementCadenceLabel(familyReceipt, annualAvailable ? "annual" : "quarterly", !!zh)}`
            : pick(!!zh, "Statement source unavailable", "报表来源不可用")}</span>
          <span>{statementCurrencyLabel(fund.stmt_currency, !!zh)}</span>
        </div>
      </details>
    </div>
  )
}
