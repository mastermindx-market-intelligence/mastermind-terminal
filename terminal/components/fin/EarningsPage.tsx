"use client"
/**
 * EarningsPage — TradingView-parity Earnings tab (BUILD-SPEC §3.4 FE2b,
 * spec/stats-earn-rev-div.md §2). Two stacked modules: EPS + Revenue.
 *
 * JUDGE-FIXED constraints:
 *   - Revenue Reported/Estimate/Surprise table renders a designed EMPTY STATE when
 *     all rev_a are null (US/HK case). CN: shows actuals-only variant.
 *   - Estimates are max 2 FY periods (yfinance 0y/+1y only).
 *   - Summary strip includes next report date, report period, EPS estimate,
 *     revenue estimate.
 *   - A/Q toggles are PER MODULE (independent).
 *
 * Props: {fund, zh}
 */
import { useState } from "react"
import type { Fund, EarningsQuarter, EarningsFY } from "../../lib/fund"
import {
  fmtNum,
  fmtDate,
  nextDateCountdown,
  periodLabel,
  pick,
  statementCurrencyCode,
  statementCurrencyLabel,
} from "../../lib/finFormat"
// The statements EPS fallback reads the SAME normalized block the Statements tab prints — see
// lib/finStatementMath's header for the two defects the page-private copy of this math carried.
import {
  cumulativeQuarterNote,
  incomeView,
  statementCadenceLabel,
  type IncomeView,
} from "../../lib/finStatementMath"
import { Dumbbell, type DumbbellPoint } from "./FinCharts"

// DumbbellPoint carries pre-computed surp_pct + report date so table rows and
// the chart tooltip never re-index the raw qs/fys arrays by display position.
type DumbbellPointWithSurp = DumbbellPoint

export interface EarningsPageProps {
  fund: Fund | null
  zh?: boolean
  sym?: string
}

// ── helpers ──────────────────────────────────────────────────────────────────

export type Mode = "annual" | "quarterly"

/** Keep the selected basis valid when an issuer has annual statements only. */
export function resolveEarningsMode(requested: Mode, interimAvailable: boolean): Mode {
  return requested === "quarterly" && !interimAvailable ? "annual" : requested
}

/** Surprise tables must preserve direction as well as color. */
export function formatSurprisePercent(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`
}

/** A period label by itself is not data and must not suppress a statement fallback. */
function hasPointData(point: DumbbellPointWithSurp): boolean {
  return point.actual != null || point.estimate != null
}

function estimateSeriesHasValue(series: { avg?: (number | null)[] } | null | undefined): boolean {
  return !!series?.avg?.some((value) => value != null && isFinite(value))
}

/** Build DumbbellPointWithSurp[] from quarterly or annual data.
 *  surp_pct is carried ON each point at build time — table rows must read
 *  p.surp_pct and never re-index the raw qs/fys arrays by display index. */
export function buildEpsDumbbell(
  qs: EarningsQuarter[],
  fys: EarningsFY[],
  mode: Mode,
  estimates: Fund["estimates"]
): DumbbellPointWithSurp[] {
  if (mode === "quarterly") {
    const pts: DumbbellPointWithSurp[] = qs.map((q) => {
      // Compute surprise from the source row, not deferred to display time.
      let surp_pct: number | null = q.surp_pct ?? null
      if (surp_pct == null && q.eps_a != null && q.eps_e != null && q.eps_e !== 0) {
        surp_pct = ((q.eps_a - q.eps_e) / Math.abs(q.eps_e)) * 100
      }
      return { label: periodLabel(q.period), date: q.report_date, actual: q.eps_a, estimate: q.eps_e, surp_pct }
    })
    // Append the NEXT forward quarter estimate only (TV parity: the quarterly
    // chart shows one estimate-only column; the +1q estimate lives in Forecast)
    const eq = estimates?.eps_q
    if (eq) {
      eq.periods.slice(0, 1).forEach((p, i) => {
        // Avoid duplicating a quarter already in qs
        const label = periodLabel(p)
        if (!pts.some((pt) => pt.label === label)) {
          pts.push({ label, actual: null, estimate: eq.avg[i] ?? null, surp_pct: null })
        }
      })
    }
    return pts.filter(hasPointData).slice(-10) // show last 10 meaningful periods
  } else {
    const pts: DumbbellPointWithSurp[] = fys.map((fy) => ({
      label: fy.period,
      actual: fy.eps_a,
      estimate: fy.eps_e,
      surp_pct: fy.surp_pct ?? null,
    }))
    // Append FY forward estimates (max 2)
    const ef = estimates?.eps_fy
    if (ef) {
      ef.periods.slice(0, 2).forEach((p, i) => {
        if (!pts.some((pt) => pt.label === p)) {
          pts.push({ label: p, actual: null, estimate: ef.avg[i] ?? null, surp_pct: null })
        }
      })
    }
    return pts.filter(hasPointData)
  }
}

export function buildRevDumbbell(
  qs: EarningsQuarter[],
  fys: EarningsFY[],
  mode: Mode,
  estimates: Fund["estimates"]
): DumbbellPointWithSurp[] {
  if (mode === "quarterly") {
    const pts: DumbbellPointWithSurp[] = qs.map((q) => {
      let surp_pct: number | null = null
      if (q.rev_a != null && q.rev_e != null && q.rev_e !== 0) {
        surp_pct = ((q.rev_a - q.rev_e) / Math.abs(q.rev_e)) * 100
      }
      return { label: periodLabel(q.period), date: q.report_date, actual: q.rev_a, estimate: q.rev_e, surp_pct }
    })
    // no per-quarter rev estimates in spec
    return pts.filter(hasPointData).slice(-10)
  } else {
    const pts: DumbbellPointWithSurp[] = fys.map((fy) => {
      let surp_pct: number | null = null
      if (fy.rev_a != null && fy.rev_e != null && fy.rev_e !== 0) {
        surp_pct = ((fy.rev_a - fy.rev_e) / Math.abs(fy.rev_e)) * 100
      }
      return { label: fy.period, actual: fy.rev_a, estimate: fy.rev_e, surp_pct }
    })
    const rf = estimates?.rev_fy
    if (rf) {
      rf.periods.slice(0, 2).forEach((p, i) => {
        if (!pts.some((pt) => pt.label === p)) {
          pts.push({ label: p, actual: null, estimate: rf.avg[i] ?? null, surp_pct: null })
        }
      })
    }
    return pts.filter(hasPointData)
  }
}

// ── Revenue section — designed empty state when all rev_a null ────────────────

function RevenueModule({
  fund,
  zh,
}: {
  fund: Fund
  zh?: boolean
}) {
  const [requestedMode, setMode] = useState<Mode>("quarterly")
  const qs = fund.earnings?.q ?? []
  const fys = fund.earnings?.fy ?? []
  const estimates = fund.estimates

  const stmtInterim = fund.statements?.quarterly
  const stmtRevenueView = incomeView(fund.ticker, stmtInterim, "quarterly")
  const canonicalInterimRevenue = buildRevenueFromStatements(stmtRevenueView)
  const hasQuarterlyRevenueContract = qs.some((q) => q.rev_a != null || q.rev_e != null)
  const interimAvailable = hasQuarterlyRevenueContract || canonicalInterimRevenue.length > 0
  const mode = resolveEarningsMode(requestedMode, interimAvailable)
  const rawPts = buildRevDumbbell(qs, fys, mode, estimates)
  const statementFallback = mode === "quarterly" && rawPts.length === 0
    ? canonicalInterimRevenue
    : []
  const pts = rawPts.length > 0 ? rawPts : statementFallback
  const usingStatementFallback = rawPts.length === 0 && statementFallback.length > 0
  const ccy = fund.stmt_currency
  const interimLabel = hasQuarterlyRevenueContract
    ? pick(!!zh, "Quarterly", "季度")
    : stmtInterim
      ? statementCadenceLabel(stmtInterim, "quarterly", !!zh)
      : pick(!!zh, "Interim", "中期")
  const actualsOnly = pts.some((point) => point.actual != null) && !pts.some((point) => point.estimate != null)
  const statementCumNote = usingStatementFallback ? cumulativeQuarterNote(stmtRevenueView, !!zh) : null

  return (
    <div className="fin-sec fin-earn-module">
      <div className="fin-earn-module-hdr fin-rule">
        <div
          className="fin-sec-h fin-rail fin-earn-module-title"
          style={{ "--rail": "var(--brand)" } as React.CSSProperties}
        >
          {pick(!!zh, "Revenue", "营收")}
        </div>
        <div className="fin-toggle">
          <button className={mode === "annual" ? "on" : ""} onClick={() => setMode("annual")}>
            {pick(!!zh, "Annual", "年度")}
          </button>
          <button
            className={mode === "quarterly" ? "on" : ""}
            onClick={() => setMode("quarterly")}
            disabled={!interimAvailable}
            title={!interimAvailable ? pick(!!zh, "No interim revenue available", "暂无中期营收数据") : undefined}
          >
            {interimLabel}
          </button>
        </div>
      </div>

      {usingStatementFallback && (
        <div className="fin-chart-note" style={{ marginTop: 0, marginBottom: 8 }}>
          {pick(!!zh, "Derived from reported financial statements.", "来自已报告财务报表。")}
        </div>
      )}
      {statementCumNote && (
        <div className="fin-chart-note" style={{ marginTop: 0, marginBottom: 8 }}>
          {statementCumNote}
        </div>
      )}

      {/* Dumbbell chart — TV parity: dots color by beat/miss via surp_pct */}
      {pts.length > 0 && (
        <Dumbbell
          points={pts}
          fmtY={(v) => fmtNum(v)}
          height={260}
          zh={zh}
        />
      )}

      {pts.length === 0 && (
        <div className="fin-empty fin-empty-lg fin-earn-rev-empty" role="status">
          <div className="fin-empty-title">{pick(!!zh, "No revenue for this basis", "该口径暂无营收数据")}</div>
          <div className="fin-empty-why">
            {pick(
              !!zh,
              mode === "annual"
                ? "Neither reported annual revenue nor annual analyst estimates are available."
                : "No reported or estimated interim revenue is available for this security.",
              mode === "annual"
                ? "暂无已报告年度营收或年度分析师预期。"
                : "该证券暂无已报告或预期的中期营收数据。",
            )}
          </div>
        </div>
      )}

      {/* Table: Reported / Estimate / Surprise */}
      {pts.length > 0 && <><div className="fin-earn-meta">
        <span>{pick(!!zh, "Metrics", "指标")}</span>
        <span className="fin-earn-ccy">{statementCurrencyLabel(ccy, !!zh)}</span>
      </div>
      <div className="fin-table-scroll">
        <table className="fin-table">
          <thead>
            <tr>
              <th className="fin-cell fin-cell-sticky fin-cell-corner" scope="col">
                {pick(!!zh, "Metrics", "指标")}
              </th>
              {pts.map((p, i) => (
                <th key={i} className="fin-cell fin-cell-num fin-cell-head" scope="col">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="fin-row fin-row-b">
              <th className="fin-cell fin-cell-sticky" scope="row">
                {pick(!!zh, "Reported", "实际")}
              </th>
              {pts.map((p, i) => (
                <td key={i} className="fin-cell fin-cell-num">
                  {p.actual != null ? fmtNum(p.actual) : "—"}
                </td>
              ))}
            </tr>
            {/* Only show Estimate row if we have estimate data */}
            {!actualsOnly && (
              <tr className="fin-row">
                <th className="fin-cell fin-cell-sticky fin-earn-est-row" scope="row">
                  {pick(!!zh, "Estimate", "预期")}
                </th>
                {pts.map((p, i) => (
                  <td key={i} className="fin-cell fin-cell-num fin-earn-est-row">
                    {p.estimate != null ? fmtNum(p.estimate) : "—"}
                  </td>
                ))}
              </tr>
            )}
            {!actualsOnly && (
              <tr className="fin-row">
                <th className="fin-cell fin-cell-sticky" scope="row">
                  {pick(!!zh, "Surprise", "超预期")}
                </th>
                {pts.map((p, i) => {
                  // surp_pct is pre-computed on each point at build time —
                  // NEVER re-index raw qs/fys by display index (they diverge after slice)
                  const surp = (p as DumbbellPointWithSurp).surp_pct ?? null
                  return (
                    <td key={i} className="fin-cell fin-cell-num">
                      {surp != null ? (
                        <span className={surp >= 0 ? "fin-cell-surp up" : "fin-cell-surp down"}>
                          {formatSurprisePercent(surp)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  )
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  )
}

/** Build EPS history from interim statements when earnings.q is empty.
 *  CN + many HK names report EPS in statements but not in the earnings table.
 *
 *  The EPS array arrives ALREADY NORMALIZED, off the same `incomeView` the Statements tab's
 *  Basic-EPS row prints — so a reporting period cannot read one way here and another way there. This
 *  used to be a private reimplementation of the differencing (`discreteEps` + `isCumulativeEps`)
 *  and it had drifted out of date on both halves: the detector was the shape-only heuristic with
 *  NO market gate, which ordinary secular growth satisfies once the Massive backfill takes a US
 *  name to ~69 quarters, and the differencer kept the RAW cumulative value whenever the
 *  difference came out negative — putting a year-to-date total in a row of discrete quarters and
 *  hiding the loss quarter that produced it. Both defects are described in
 *  lib/finStatementMath's header, which is now the only copy of this math.
 *
 *  Returns DumbbellPointWithSurp[] with actual=EPS, estimate=null (history-only). */
export function buildEpsFromStatements(
  view: IncomeView,
): DumbbellPointWithSurp[] {
  const eps = view.income.eps_basic
  if (view.periods.length === 0 || eps.every((v) => v == null)) return []
  return view.periods.map((p, i) => ({
    label: p,
    actual: eps[i] ?? null,
    estimate: null,
    surp_pct: null,
  })).slice(-12)
}

/** Canonical reported revenue used when earnings.q has no meaningful revenue payload. */
export function buildRevenueFromStatements(view: IncomeView): DumbbellPointWithSurp[] {
  const revenue = view.income.revenue
  if (view.periods.length === 0 || revenue.every((value) => value == null)) return []
  return view.periods.map((period, index) => ({
    label: period,
    actual: revenue[index] ?? null,
    estimate: null,
    surp_pct: null,
  })).slice(-12)
}

// ── main component ────────────────────────────────────────────────────────────

export default function EarningsPage({ fund, zh, sym }: EarningsPageProps) {
  const [requestedEpsMode, setEpsMode] = useState<Mode>("quarterly")

  if (!fund) {
    return (
      <div className="fin-body">
        <div className="fin-empty fin-empty-lg" role="status">
          <span className="fin-empty-title">{pick(!!zh, "Fundamentals not yet covered", "尚未覆盖基本面数据")}</span>
          <span className="fin-empty-why">{pick(!!zh,
            `Earnings data for ${sym ?? "this symbol"} hasn't been collected yet.`,
            `${sym ?? "该标的"} 的盈利数据尚未采集。`
          )}</span>
        </div>
      </div>
    )
  }

  const earn = fund.earnings
  const estimates = fund.estimates
  const qs = earn?.q ?? []
  const fys = earn?.fy ?? []
  const ccy = fund.stmt_currency
  const ccyCode = statementCurrencyCode(ccy)
  const fmtStatementEstimate = (value: number | null | undefined) => {
    if (value == null) return "—"
    return ccyCode
      ? `${fmtNum(value)} ${ccyCode}`
      : `${fmtNum(value)} · ${statementCurrencyLabel(ccy, !!zh)}`
  }

  // ── Summary strip ──
  const rawNextDate = earn?.next_date
  const daysAway = nextDateCountdown(rawNextDate)
  const nextDate = daysAway == null ? null : rawNextDate
  const nextPeriod = earn?.next_period
  const nextEps = earn?.next_eps_est
  const nextRev = earn?.next_rev_est

  // ── EPS dumbbell ──
  // The statement axis is the reported-history authority. A future quarterly estimate is a
  // different cadence and must not replace semiannual actuals or rename them "Quarterly".
  const stmtQtr = fund.statements?.quarterly
  const stmtEpsView = incomeView(sym ?? fund.ticker, stmtQtr, "quarterly")
  const canonicalInterimEps = buildEpsFromStatements(stmtEpsView)
  const hasReportedQuarterlyEps = qs.some((q) => q.eps_a != null)
  const hasQuarterlyEstimate =
    qs.some((q) => q.eps_e != null) || estimateSeriesHasValue(estimates?.eps_q)
  const epsInterimAvailable = hasReportedQuarterlyEps || hasQuarterlyEstimate || canonicalInterimEps.length > 0
  const epsMode = resolveEarningsMode(requestedEpsMode, epsInterimAvailable)
  const epsPtsRaw = buildEpsDumbbell(qs, fys, epsMode, estimates)
  const preferReportedStatementHistory =
    epsMode === "quarterly" && canonicalInterimEps.length > 0 && !hasReportedQuarterlyEps
  const stmtEpsFallback = preferReportedStatementHistory
    ? canonicalInterimEps
    : []
  const epsPts = stmtEpsFallback.length > 0 ? stmtEpsFallback : epsPtsRaw
  const usingStmtFallback = stmtEpsFallback.length > 0
  // Null unless this issuer's market actually files cumulative year-to-date interims AND the
  // columns really were differenced — the old note asserted the differencing unconditionally,
  // so a US filer's discrete quarters were described with somebody else's reporting convention.
  const stmtEpsCumNote = cumulativeQuarterNote(stmtEpsView, !!zh)

  // Estimates-only is a property of the points currently displayed, not the mere presence of
  // an estimates object (some HK payloads carry period labels with entirely null arrays).
  const estimatesOnlyEps = epsPts.length > 0 &&
    epsPts.every((point) => point.actual == null) &&
    epsPts.some((point) => point.estimate != null)
  const epsInterimLabel = hasReportedQuarterlyEps
    ? pick(!!zh, "Quarterly", "季度")
    : canonicalInterimEps.length > 0 && stmtQtr
      ? statementCadenceLabel(stmtQtr, "quarterly", !!zh)
      : hasQuarterlyEstimate
        ? pick(!!zh, "Quarterly", "季度")
        : pick(!!zh, "Interim", "中期")

  return (
    <div className="fin-body">
      {/* ── Summary strip ── */}
      <div className="fin-sec">
        <div className="fin-eyebrow">{pick(!!zh, "EARNINGS CALENDAR", "财报日历")}</div>
        <div
          className="fin-sec-h fin-rail fin-rule"
          style={{ "--rail": "var(--brand)" } as React.CSSProperties}
        >
          {pick(!!zh, "Next report", "下次财报")}
        </div>
        <div className="fin-grid4 fin-earn-strip">
          <div className="fin-fact">
            <span className="k">{pick(!!zh, "Next report date", "下次报告日期")}</span>
            <span className="v fin-earn-next">
              <span>{nextDate ? "~ " + fmtDate(nextDate) : "—"}</span>
              {daysAway != null && daysAway > 0 && (
                <span
                  className="fin-tag num fin-earn-days"
                  style={{ "--c": "var(--brand-2)" } as React.CSSProperties}
                >
                  {pick(!!zh, "in " + daysAway + "d", daysAway + "天后")}
                </span>
              )}
            </span>
          </div>
          <div className="fin-fact">
            <span className="k">{pick(!!zh, "Report period", "报告期")}</span>
            <span className="v">{nextPeriod ?? "—"}</span>
          </div>
          <div className="fin-fact">
            <span className="k">{pick(!!zh, "EPS estimate", "每股盈利预期")}</span>
            <span className="v">{fmtStatementEstimate(nextEps)}</span>
          </div>
          <div className="fin-fact">
            <span className="k">{pick(!!zh, "Revenue estimate", "营收预期")}</span>
            <span className="v">
              {fmtStatementEstimate(nextRev)}
            </span>
          </div>
        </div>
      </div>

      {/* ── EPS Module ── */}
      <div className="fin-sec fin-earn-module">
        <div className="fin-earn-module-hdr fin-rule">
          <div
            className="fin-sec-h fin-rail fin-earn-module-title"
            style={{ "--rail": "var(--brand)" } as React.CSSProperties}
          >
            {pick(!!zh, "EPS", "每股盈利")}
          </div>
          <div className="fin-toggle">
            <button className={epsMode === "annual" ? "on" : ""} onClick={() => setEpsMode("annual")}>
              {pick(!!zh, "Annual", "年度")}
            </button>
            <button
              className={epsMode === "quarterly" ? "on" : ""}
              onClick={() => setEpsMode("quarterly")}
              disabled={!epsInterimAvailable}
              title={!epsInterimAvailable ? pick(!!zh, "No interim EPS available", "暂无中期每股盈利数据") : undefined}
            >
              {epsInterimLabel}
            </button>
          </div>
        </div>

        {/* Estimates-only state: no reported history but estimates available */}
        {estimatesOnlyEps && (
          <div className="fin-empty fin-empty-lg fin-earn-rev-empty" role="status">
            <div className="fin-empty-title">{pick(!!zh, "No reported EPS history", "暂无已报告每股盈利历史")}</div>
            <div className="fin-empty-why">
              {pick(!!zh,
                "This security has not filed a reported EPS series yet — the columns below are forward analyst estimates only.",
                "该证券尚未披露已报告每股盈利序列——下方各列仅为分析师前瞻预期。"
              )}
            </div>
          </div>
        )}

        {/* Statements fallback note. Provenance is unconditional; the differencing sentence is
            not — it rides cumulativeQuarterNote, which speaks only when the columns on screen
            really were derived from cumulative year-to-date totals. Same two-note stack the
            Statements tab uses. */}
        {usingStmtFallback && (
          <>
            <div className="fin-chart-note" style={{ marginTop: 0, marginBottom: 8 }}>
              {pick(!!zh,
                "Derived from reported financial statements.",
                "来自已报告财务报表。"
              )}
            </div>
            {stmtEpsCumNote && (
              <div className="fin-chart-note" style={{ marginTop: 0, marginBottom: 8 }}>
                {stmtEpsCumNote}
              </div>
            )}
          </>
        )}

        {/* EPS dumbbell chart — TV parity: dots color by beat/miss via surp_pct */}
        {epsPts.length > 0 ? (
          <Dumbbell
            points={epsPts}
            fmtY={(v) => v.toFixed(2)}
            estimateColor="var(--text-2)"
            height={260}
            zh={zh}
          />
        ) : !estimatesOnlyEps ? (
          <div className="fin-empty fin-empty-lg fin-earn-rev-empty" role="status">
            <div className="fin-empty-title">{pick(!!zh, "No EPS data", "暂无每股盈利数据")}</div>
            <div className="fin-empty-why">
              {pick(!!zh,
                "Neither the earnings table nor the interim statements carry an EPS series for this security.",
                "该证券的财报表与中期报表中均无每股盈利序列。"
              )}
            </div>
          </div>
        ) : null}

        {/* EPS table: Reported / Estimate / Surprise */}
        {epsPts.length > 0 && (
          <>
            <div className="fin-earn-meta">
              <span>{pick(!!zh, "Metrics", "指标")}</span>
              <span className="fin-earn-ccy">{statementCurrencyLabel(ccy, !!zh)}</span>
            </div>
            <div className="fin-table-scroll">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th className="fin-cell fin-cell-sticky fin-cell-corner" scope="col">
                      {pick(!!zh, "Metrics", "指标")}
                    </th>
                    {epsPts.map((p, i) => (
                      <th key={i} className="fin-cell fin-cell-num fin-cell-head" scope="col">
                        {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="fin-row fin-row-b">
                    <th className="fin-cell fin-cell-sticky" scope="row">
                      {pick(!!zh, "Reported", "实际")}
                    </th>
                    {epsPts.map((p, i) => (
                      <td key={i} className="fin-cell fin-cell-num">
                        {p.actual != null ? p.actual.toFixed(2) : "—"}
                      </td>
                    ))}
                  </tr>
                  <tr className="fin-row">
                    <th className="fin-cell fin-cell-sticky fin-earn-est-row" scope="row">
                      {pick(!!zh, "Estimate", "预期")}
                    </th>
                    {epsPts.map((p, i) => (
                      <td key={i} className="fin-cell fin-cell-num fin-earn-est-row">
                        {p.estimate != null ? p.estimate.toFixed(2) : "—"}
                      </td>
                    ))}
                  </tr>
                  <tr className="fin-row">
                    <th className="fin-cell fin-cell-sticky" scope="row">
                      {pick(!!zh, "Surprise", "超预期")}
                    </th>
                    {epsPts.map((p, i) => {
                      // surp_pct is pre-computed on each point at build time —
                      // NEVER re-index raw qs/fys by display index (they diverge after slice)
                      const surp = (p as DumbbellPointWithSurp).surp_pct ?? null
                      return (
                        <td key={i} className="fin-cell fin-cell-num">
                          {surp != null ? (
                            <span className={surp >= 0 ? "fin-cell-surp up" : "fin-cell-surp down"}>
                              {formatSurprisePercent(surp)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── Revenue Module ── */}
      <RevenueModule fund={fund} zh={zh} />

      {fund.asof && (
        <div className="fin-asof">
          {pick(!!zh,
            `Earnings & estimates · as of ${fmtDate(fund.asof)}`,
            `财报与预期数据 · 截至 ${fmtDate(fund.asof)}`
          )}
        </div>
      )}
    </div>
  )
}
