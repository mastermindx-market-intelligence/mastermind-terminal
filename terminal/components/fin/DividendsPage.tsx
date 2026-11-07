"use client"
/**
 * DividendsPage — TradingView-parity Dividends tab (BUILD-SPEC §3.4 FE2b,
 * spec/stats-earn-rev-div.md §4). Two states:
 *   • never_paid = true  → TV-exact empty state with ticker copy
 *   • never_paid = false → yield/payout summary cards + events table
 *
 * Props: {sym, fund, zh}
 */
import type { Fund, DividendEvent } from "../../lib/fund"
import { fmtNum, fmtPct, fmtDate, pick } from "../../lib/finFormat"

export interface DividendsPageProps {
  sym: string
  fund: Fund | null
  zh?: boolean
}

// ── no-dividend SVG icon (crossed-out coin/money bag) ────────────────────────
function NoDivIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" className="fin-empty-icon" aria-hidden>
      <circle cx="28" cy="28" r="22" stroke="currentColor" strokeWidth="2" />
      <text x="28" y="34" textAnchor="middle" fontSize="18" fill="currentColor" fontWeight="700">$</text>
      {/* diagonal slash */}
      <line x1="12" y1="12" x2="44" y2="44" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────────

function yieldFmt(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—"
  // UNIT RULING: yield_ttm is a 0..1 FRACTION in the fund.json contract
  // (emitter divides yfinance's percent-form by 100, consistent with the
  // gross_margin/roe/payout siblings). Plain fmtPct (default ×100) renders it:
  // AAPL 0.0035 → "0.35%".
  return fmtPct(v)
}

function payoutFmt(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—"
  // payout_ratio: 0.1259 → 12.59%
  return fmtPct(v, { alreadyPct: false })
}

// Find the most recent future (or most recent past) ex-dividend date
function nextExDate(events: DividendEvent[], today: string): DividendEvent | null {
  // upcoming: ex >= today
  const upcoming = events.filter((e) => e.ex >= today).sort((a, b) => a.ex.localeCompare(b.ex))
  if (upcoming.length) return upcoming[0]
  // fallback: most recent past
  const past = [...events].sort((a, b) => b.ex.localeCompare(a.ex))
  return past[0] ?? null
}

// ── main component ────────────────────────────────────────────────────────────

export default function DividendsPage({ sym, fund, zh }: DividendsPageProps) {
  // Null-guard: no fund data at all
  if (!fund) {
    return (
      <div className="fin-body">
        <div className="fin-empty fin-empty-lg" role="status">
          <span className="fin-empty-title">{pick(!!zh, "Fundamentals not yet covered", "尚未覆盖基本面数据")}</span>
          <span className="fin-empty-why">{pick(!!zh,
            `Dividend data for ${sym} hasn't been collected yet.`,
            `${sym} 的股息数据尚未采集。`
          )}</span>
        </div>
      </div>
    )
  }

  const div = fund.dividends

  // ── Empty state: never paid ──────────────────────────────────────────────
  if (!div || div.never_paid) {
    return (
      <div className="fin-body">
        <div className="fin-empty fin-empty-lg" role="status">
          <NoDivIcon />
          <div className="fin-empty-title">{pick(!!zh, "No dividends on record", "无股息记录")}</div>
          <div className="fin-empty-why">
            {pick(
              !!zh,
              `${sym} has never declared a dividend, and no distribution is currently planned. This is a company policy, not a gap in the data.`,
              `${sym} 从未宣派股息，目前也没有派息计划。这是公司政策，并非数据缺失。`
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Populated state ──────────────────────────────────────────────────────
  const events = div.events ?? []
  const today = new Date().toISOString().slice(0, 10)
  const nextEx = nextExDate(events, today)
  // The selector deliberately falls back to history. Do not call that past event "next".
  // Invalid/missing dates carry no temporal claim; keep the existing event and values intact.
  const ex = nextEx?.ex
  const exInstant = ex && /^\d{4}-\d{2}-\d{2}$/.test(ex) ? new Date(`${ex}T00:00:00Z`) : null
  const validEx = exInstant != null && Number.isFinite(exInstant.getTime()) && exInstant.toISOString().slice(0, 10) === ex
  const exLabel = !validEx ? pick(!!zh, "Ex-date", "除息日")
    : ex! >= today ? pick(!!zh, "Next ex-date", "下次除息日")
    : pick(!!zh, "Last ex-date", "上次除息日")

  // Most recent event for "Last dividend" card
  const lastEvent = [...events].sort((a, b) => b.ex.localeCompare(a.ex))[0]

  // Compute annual dividend: sum of events in the last 12 months
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const annualDiv = events
    .filter((e) => e.ex >= cutoffStr && e.amount != null)
    .reduce((a, e) => a + (e.amount ?? 0), 0)

  const ccy = fund.quote_currency ?? "USD"

  return (
    <div className="fin-body">
      {/* ── Summary KPI tiles ── */}
      <div className="fin-sec">
        <div className="fin-eyebrow">{pick(!!zh, "SHAREHOLDER YIELD", "股东回报")}</div>
        <div
          className="fin-sec-h fin-rail fin-rule"
          style={{ "--rail": "var(--brand)" } as React.CSSProperties}
        >
          {pick(!!zh, "Dividends", "股息")}
        </div>
        <div className="fin-kpis fin-div-cards">
          <div className="fin-kpi">
            <span className="k">{pick(!!zh, "Dividend yield (TTM)", "股息率（近12月）")}</span>
            <span className="v">{yieldFmt(div.yield_ttm)}</span>
          </div>
          <div className="fin-kpi">
            <span className="k">{pick(!!zh, "Annual dividend", "年度股息")}</span>
            <span className="v">{annualDiv > 0 ? fmtNum(annualDiv) : "—"}</span>
            {annualDiv > 0 && <span className="s">{ccy}</span>}
          </div>
          <div className="fin-kpi">
            <span className="k">{pick(!!zh, "Payout ratio", "派息比率")}</span>
            <span className="v">{payoutFmt(div.payout_ratio)}</span>
          </div>
          <div className="fin-kpi">
            <span className="k">{exLabel}</span>
            <span className="v">{nextEx ? fmtDate(nextEx.ex) : "—"}</span>
            {nextEx?.amount != null && (
              <span className="s">
                {pick(!!zh, `${fmtNum(nextEx.amount, { decimals: 4 })} ${ccy} per share`, `每股 ${fmtNum(nextEx.amount, { decimals: 4 })} ${ccy}`)}
              </span>
            )}
          </div>
        </div>
        {fund.asof && (
          <div className="fin-asof">
            {pick(!!zh,
              `Dividend record · as of ${fmtDate(fund.asof)}`,
              `股息记录 · 截至 ${fmtDate(fund.asof)}`
            )}
          </div>
        )}
      </div>

      {/* ── Events table ── */}
      {events.length > 0 && (
        <div className="fin-sec">
          <div
            className="fin-sec-h fin-rail fin-rule"
            style={{ "--rail": "var(--brand)" } as React.CSSProperties}
          >
            {pick(!!zh, "Dividend history", "股息历史")}
          </div>
          <div className="fin-table-scroll">
            <table className="fin-table">
              <thead>
                <tr>
                  <th className="fin-cell fin-cell-sticky fin-cell-corner" scope="col">
                    {pick(!!zh, "Ex-date", "除息日")}
                  </th>
                  <th className="fin-cell fin-cell-num fin-cell-head" scope="col">
                    {pick(!!zh, "Amount", "金额")}
                  </th>
                  <th className="fin-cell fin-cell-num fin-cell-head" scope="col">
                    {pick(!!zh, "Pay date", "派息日")}
                  </th>
                  <th className="fin-cell fin-cell-num fin-cell-head" scope="col">
                    {pick(!!zh, "Type", "类型")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Show most recent first, limit to 40 rows to avoid DOM bloat */}
                {[...events]
                  .sort((a, b) => b.ex.localeCompare(a.ex))
                  .slice(0, 40)
                  .map((ev, i) => (
                    <tr key={i} className="fin-row">
                      <th className="fin-cell fin-cell-sticky" scope="row">
                        {fmtDate(ev.ex)}
                      </th>
                      <td className="fin-cell fin-cell-num">
                        {ev.amount != null ? fmtNum(ev.amount, { decimals: 4 }) + " " + ccy : "—"}
                      </td>
                      <td className="fin-cell fin-cell-num">
                        {ev.pay ? fmtDate(ev.pay) : "—"}
                      </td>
                      <td className="fin-cell fin-cell-num fin-div-type">
                        {ev.type ?? "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {events.length > 40 && (
            <div className="fin-div-more">
              {pick(!!zh, `Showing 40 of ${events.length} events`, `显示 40 / ${events.length} 条记录`)}
            </div>
          )}
        </div>
      )}

      {/* ── Splits table (if any) ── */}
      {div.splits && div.splits.length > 0 && (
        <div className="fin-sec">
          <div
            className="fin-sec-h fin-rail fin-rule"
            style={{ "--rail": "var(--brand)" } as React.CSSProperties}
          >
            {pick(!!zh, "Stock splits", "股票分拆")}
          </div>
          <div className="fin-table-scroll">
            <table className="fin-table">
              <thead>
                <tr>
                  <th className="fin-cell fin-cell-sticky fin-cell-corner" scope="col">
                    {pick(!!zh, "Date", "日期")}
                  </th>
                  <th className="fin-cell fin-cell-num fin-cell-head" scope="col">
                    {pick(!!zh, "Ratio", "比例")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...div.splits]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((sp, i) => (
                    <tr key={i} className="fin-row">
                      <th className="fin-cell fin-cell-sticky" scope="row">{fmtDate(sp.date)}</th>
                      <td className="fin-cell fin-cell-num">{sp.ratio}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
