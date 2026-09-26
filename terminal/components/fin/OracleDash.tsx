"use client"
/**
 * Stock Intelligence — one responsive workspace over the existing source systems.
 *
 * Research and Oracle remain independent reads; historical performance is not a forecast.
 *
 * Props (FROZEN + new onOpenFull?):
 *   {sym, row, slice, intel, bars, zh?, onClose?, onJump?, onOpenFull?}
 */
import { useEffect, useId, useMemo, useRef, useState } from "react"
import styles from "./StockIntelligence.module.css"
import { pick, fmtPct, fmtDate } from "../../lib/finFormat"
import { LineSeries } from "./FinCharts"
import { getJSON } from "../../lib/dataCache"
import { oracleVerdict, deskVerdict, signalKnownTs, isBlockedSignal, isBottomWatch, isRetroOverride, isStopSweepReclaim, isStructureStop, retroLegendCopy, sliceSignalBasis } from "../../lib/signalVerdict"
import { computeTrendState } from "../../lib/trend"
import { computeRatings, verdictFromScore } from "../../lib/techRating"
import type { Bar } from "../../lib/fund"

/* ── staleness helper: days since intel.asof (returns 0 when missing/unparseable) ── */
function intelStaleDays(asof?: string | null): number {
  if (!asof) return 0
  const m = asof.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return 0
  const asofNoon = new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0)
  const todayNoon = new Date(); todayNoon.setHours(12, 0, 0, 0)
  return Math.max(0, Math.round((todayNoon.getTime() - asofNoon.getTime()) / 86_400_000))
}

/** Signal-history dates carry a year and obey the active language. */
function signalHistoryDate(ts: string, zh: boolean): string {
  if (!zh) return fmtDate(ts)
  const parsed = Date.parse(ts.length <= 10 ? `${ts}T00:00:00Z` : ts)
  if (!Number.isFinite(parsed)) return fmtDate(ts)
  return new Date(parsed).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

/* ── tech verdict → bilingual plain-word label ──────────────────────── */
function techVerdictLabel(v: string, zh: boolean): string {
  switch (v) {
    case "Strong buy": return zh ? "强烈买入" : "Strong buy"
    case "Buy": return zh ? "买入" : "Buy"
    case "Sell": return zh ? "卖出" : "Sell"
    case "Strong sell": return zh ? "强烈卖出" : "Strong sell"
    default: return zh ? "中性" : "Neutral"
  }
}

/* ── types (narrow; only what we consume) ────────────────────────────── */

interface ManifestRow {
  verdict?: string | null
  wr?: number | null
  pf?: number | null
  cagr?: number | null
  regimeBull?: boolean | null
}

interface Signal {
  ts: string
  /** session when the signal became observable; ts remains its 3D chart-bar coordinate */
  known_ts?: string | null
  type: "BUY" | "SELL" | "REBUY" | "CUT" | string
  strength?: number | null
  price?: number | null
  reasons?: string[]
  regime?: Record<string, boolean>
  // GC v2 keeper/recipe grading (BUY|REBUY only; absent on v1 slices, null tier/score for
  // regime_blocked). "override_take" is not a keeper verdict at all — it is the washout-
  // override ENTRY class (signal era gc_v2_wo1), which bypasses the keeper by design.
  // "reclaim_override_take" IS a keeper verdict (era gc_v2_wo2): the keeper graded the fire
  // and the ratified waiver dropped one of its two counter-trend legs.
  quality?: "take" | "block" | "pending" | "regime_blocked" | "override_take"
    | "reclaim_override_take" | string | null
  quality_reason?: string | null
  tier?: "aplus" | "quality" | "base" | string | null
  score?: number | null
  score_basis?: "full" | "partial" | string | null
  // CUT: scored:false — a caution, not a scored exit
  scored?: boolean | null
  // HK-O1 truth-in-labeling. `basis` names the machine: every SELL here is the ARM→CONFIRM
  // structure break (a trailing stop on a swing-low break), never a momentum/oracle exit.
  // `blocked` marks an entry the regime gate REFUSED — type still reads BUY/REBUY for
  // back-compat, so this flag is what the render must key on.
  basis?: "structure_stop" | string | null
  blocked?: boolean | null
  stop_level?: number | null
  prior_stop_level?: number | null
  sweep_low?: number | null
  subtype?: string | null
  risk_basis?: string | null
  // DISPLAY-ONLY retro projection: today's rule would have entered this pre-fence refusal.
  // Never an entry — it carries no entry quality, walks no position, and fires no alert.
  retro_override?: boolean | null
  retro_ctx?: { group_id?: string | null; name?: string | null; name_zh?: string | null } | null
}

/** GC v2 structure-break warning side channel: {ts, kind:"arm"|"confirm"}. */
interface Warning {
  ts: string
  kind: "arm" | "confirm" | string
}

interface SliceIndicator {
  signals?: Signal[]
  early_dots?: string[]
  warnings?: Warning[]
}

interface BacktestMetrics {
  n_trades?: number | null
  win_rate?: number | null
  profit_factor?: number | null
  cagr?: number | null
}

interface BacktestResult {
  metrics?: BacktestMetrics
  n_trades?: number | null
}

interface Slice {
  indicator?: SliceIndicator
  backtest?: BacktestResult
  opportunities?: {
    schema?: string | null
    as_of?: string | null
    events?: OpportunityReceipt[] | null
  } | null
}

interface OpportunityReceipt {
  id?: string | null
  system?: string | null
  definition?: string | null
  authority?: string | null
  surfaced_at?: string | null
  entry_date?: string | null
  entry_basis?: string | null
  entry_price?: number | null
  rank?: number | null
  tier?: string | null
  state?: string | null
  latest_price?: number | null
  return_pct?: number | null
  excess_pct?: number | null
  sessions?: number | null
}

/* intel.analysis — narrow to consumed sub-shapes */
interface Decision {
  verb?: string | null; verb_zh?: string | null
  tone?: string | null
  headline?: string | null; headline_zh?: string | null
  gloss?: string | null; gloss_zh?: string | null
  band?: string | null; band_label?: string | null; band_label_zh?: string | null
  name_label?: string | null; name_label_zh?: string | null
  score?: number | null
  trust_tier?: string | null; trust_en?: string | null; trust_zh?: string | null
}
interface Conviction {
  score?: number | null
  band?: string | null; band_zh?: string | null
  drivers?: string[] | null
  cautions?: string[] | null; cautions_zh?: string[] | null
  size_bucket?: string | null; size_pct?: number | null; size_note?: string | null
  rank_pctile?: number | null; potential?: number | null
}
interface Factors {
  z?: number | null
  legs?: Record<string, number | null> | null
}
interface Analysis {
  decision?: Decision | null
  conviction?: Conviction | null
  factors?: Factors | null
}
interface Intel {
  analysis?: Analysis | null
  cards?: Record<string, any> | null   // live research-desk schema (ai_judgment · conviction · levels · analyst · smart_money)
  tape?: Record<string, any> | null    // ai_lean (dir) · regime · sector_pulse
  asof?: string | null                 // "YYYY-MM-DD" — date the research desk last ran for this name
}

export interface OracleDashProps {
  sym: string
  row?: ManifestRow | null
  slice?: Slice | null
  intel?: Intel | null
  bars?: unknown
  zh?: boolean
  onClose?: () => void
  /** Called by signal-row click; parent may also handle mm:chart-jump event. */
  onJump?: (ts: string) => void
  /** Opens the MegaPane full analysis view; passed from TerminalShell. */
  onOpenFull?: () => void
}

/* ── helpers ─────────────────────────────────────────────────────────── */

function fmt2(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—"
  return v.toFixed(2)
}

// size_pct arrives in percent form (e.g. 7.5 = 7.5%) on live data, but older/other
// emitters may send a 0..1 fraction. Treat <=1 as a fraction, >1 as already-percent
// so we never render "7500%". Returns a rounded whole-percent number.
function sizePctDisplay(v: number): number {
  return Math.round(v <= 1 ? v * 100 : v)
}

function fmtPctLocal(v: number | null | undefined, scale = false): string {
  if (v == null || !isFinite(v)) return "—"
  const pct = scale ? v * 100 : v
  return fmtPct(pct, { decimals: 1, alreadyPct: true })
}

/** EXACT match to ChartPanel renderSignals marker fills:
 *  BUY→--buy, SELL→--sell, REBUY→--rebuy (lime), CUT→--cut (orange). */
function signalColor(type: string): string {
  const t = (type || "").toUpperCase()
  if (t === "BOTTOM_WATCH") return "var(--signal)"
  if (t === "BUY") return "var(--buy)"
  if (t === "REBUY") return "var(--rebuy)"
  if (t === "CUT") return "var(--cut)"
  if (t === "SELL") return "var(--sell)"
  return "var(--signal)"
}

/** GC v2 tier → bilingual badge label. aplus="强烈 A+", quality="优质", base=none. */
function tierLabel(tier: string | null | undefined, zh: boolean): string {
  const t = (tier || "").toLowerCase()
  if (t === "aplus") return pick(zh, "A+", "A+级")
  if (t === "quality") return pick(zh, "Quality", "优质")
  return ""
}

/** GC v2 quality verdict → bilingual label + color. */
function qualityLabel(q: string | null | undefined, zh: boolean): string {
  const v = (q || "").toLowerCase()
  if (v === "take") return pick(zh, "Take", "采纳")
  // These keeper outcomes have always remained in the scored/backtested entry lane. Call
  // them what the system actually does with them: reduced-size starters, not refusals.
  if (v === "block") return pick(zh, "Starter — confirmation failed", "试仓 — 确认未通过")
  if (v === "pending") return pick(zh, "Starter — awaiting hold", "试仓 — 等待企稳")
  // HK-O1: the zh label used to read 结构破位 — literally "structure break" — the SAME words as
  // the structure-stop SELL and the ⛔ structure-break warning below. A 200d/regime veto is a
  // different machine entirely, so it takes the regime gate's own name (matching signalVerdict).
  if (v === "regime_blocked") return pick(zh, "Regime-blocked", "趋势闸拦截")
  // The washout-override ENTRY (era gc_v2_wo1) — a taken entry, not a keeper verdict. It
  // names the exception rather than the gate, because the gate is what it went past.
  if (v === "override_take") return pick(zh, "Washout override", "深度洗盘例外")
  // The KEEPER's waived entry (era gc_v2_wo2, Arm T). Its own label, because it is its own
  // rule with its own forward ledger — and because it names a DIFFERENT relaxation: the
  // 200-reclaim leg, not the regime veto. The next-bar hold still had to pass.
  if (v === "reclaim_override_take") return pick(zh, "Reclaim waived", "免收复200日线")
  return ""
}
function qualityColor(q: string | null | undefined): string {
  const v = (q || "").toLowerCase()
  if (v === "take") return "var(--buy)"
  if (v === "block") return "var(--signal)"
  if (v === "pending") return "var(--signal)"
  if (v === "regime_blocked") return "var(--muted)"
  // amber, matching the ⊘ class and the chart outline: the verdict above already carries
  // the ordinary entry green, so this chip's job is to make the exception FINDABLE, not to
  // grade it. One colour for one mechanism, in both of its states.
  if (v === "override_take") return "var(--signal)"
  if (v === "reclaim_override_take") return "var(--signal)"
  return "var(--muted)"
}

/** legs → readable factor labels (bilingual) */
const FACTOR_LABELS: Record<string, [string, string]> = {
  momentum: ["Momentum", "动量"],
  value: ["Value", "价值"],
  quality: ["Quality", "质量"],
  profitability: ["Profitability", "盈利能力"],
  revisions: ["Revisions", "评级调整"],
  investment: ["Investment", "投资"],
  payout: ["Payout", "分红"],
  low_vol: ["Low vol", "低波动"],
  low_beta: ["Low beta", "低贝塔"],
  accruals: ["Accruals", "应计"],
  short_interest: ["Short interest", "空头持仓"],
}
function factorLabel(key: string, zh: boolean): string {
  const l = FACTOR_LABELS[key]
  return l ? pick(zh, l[0], l[1]) : key.replace(/_/g, " ")
}

/* ── Icon constants — reused in .sd-ic container headers ────────────── */
const OracleStar = (
  <svg viewBox="0 0 24 24" aria-hidden style={{ width: 14, height: 14, fill: "var(--vc,var(--brand))", stroke: "none" }}>
    <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" />
  </svg>
)
const DeskGlyph = (
  <svg viewBox="0 0 24 24" aria-hidden style={{ width: 14, height: 14, fill: "none", stroke: "var(--vc,var(--brand))", strokeWidth: 2 }}>
    <path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6" />
  </svg>
)

/* ── BacktestCurve: lazy-fetch <SYM>.backtest.json and draw equity curve ── */
function BacktestCurve({ sym, zh }: { sym: string; zh: boolean }) {
  const [data, setData] = useState<{ labels: string[]; values: (number | null)[]; asOf?: string; start?: string; end?: string; note?: string; missingValidation: boolean } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(null)
    getJSON("/data/" + sym + ".backtest.json")
      .then((raw: any) => {
        if (cancelled || !raw || (raw.status && raw.status !== "ok")) return
        const dateString = (value: unknown): string | undefined => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined
        const source = raw.equity ?? raw.curve ?? []
        let eq: any[]
        if (Array.isArray(source)) {
          eq = source // Preserve the earlier row-oriented contract.
        } else {
          // backtest_result/v1 publishes paired date/value columns, not point objects.
          // Preserve supplied values and gaps; never reconstruct equity from trades.
          if (!Array.isArray(source.t) || !Array.isArray(source.v) || source.t.length !== source.v.length || !source.t.every((t: unknown) => dateString(t))) return
          eq = source.t.map((date: string, i: number) => ({ date, value: source.v[i] }))
        }
        if (eq.length === 0) return
        const labels: string[] = []
        const values: (number | null)[] = []
        eq.forEach((pt: any) => {
          if (typeof pt === "object" && pt !== null) {
            labels.push(pt.date ? fmtDate(pt.date, { short: true }) : String(labels.length))
            values.push(typeof pt.value === "number" && Number.isFinite(pt.value) ? pt.value : null)
          } else if (typeof pt === "number" && Number.isFinite(pt)) {
            labels.push(String(labels.length))
            values.push(pt)
          }
        })
        if (values.some((v) => v != null)) {
          setData({ labels, values, asOf: dateString(raw.as_of), start: dateString(raw.universe?.start), end: dateString(raw.universe?.end),
            note: typeof raw.honest_read === "string" ? raw.honest_read : undefined, missingValidation: raw.validation == null })
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sym])

  if (loading) {
    return (
      <div className="od-curve-loading">
        {pick(zh, "Loading equity curve…", "加载资金曲线…")}
      </div>
    )
  }
  if (!data) return <p className={styles.empty} role="status">{pick(zh, "Equity curve unavailable for this symbol.", "该标的的资金曲线暂不可用。")}</p>

  return (
    <div className="od-curve">
      <div className="od-sec-h">{pick(zh, "Equity Curve", "资金曲线")}</div>
      <p className={styles.date}>{data.asOf ? `${pick(zh, "Curve as of", "曲线截至")} ${signalHistoryDate(data.asOf, zh)}` : pick(zh, "Curve date not supplied", "未提供曲线日期")}
        {data.start && data.end && <><br />{pick(zh, "Backtest window", "回测区间")}: {signalHistoryDate(data.start, zh)} — {signalHistoryDate(data.end, zh)}</>}
      </p>
      {data.missingValidation && <p className={styles.meta}>{pick(zh, "Statistical validation not supplied", "未提供统计验证证据")}</p>}
      <LineSeries
        labels={data.labels}
        series={[{
          name: pick(zh, "Strategy equity", "策略权益"),
          values: data.values,
          color: "var(--brand)",
        }]}
        includeZero={false}
        refLine={data.values[0] ?? null}
        noLegend
        zh={zh}
        height={220}
      />
      {data.note && <details className={styles.method}><summary>{pick(zh, "Source methodology", "数据源方法说明")}</summary><p>{data.note}</p></details>}
    </div>
  )
}

/* ── ConvictionRing: small radial gauge for conviction.score (0-100) ── */
function ConvictionRing({ score, zh }: { score: number | null | undefined; zh: boolean }) {
  const s = score != null && isFinite(score) ? Math.max(0, Math.min(100, score)) : null
  const R = 22, C = 2 * Math.PI * R
  const off = s == null ? C : C * (1 - s / 100)
  const col = s == null ? "var(--muted)" : s >= 66 ? "var(--buy)" : s >= 40 ? "var(--signal)" : "var(--sell)"
  return (
    <div className="sig-ring" title={pick(zh, "Conviction", "信念度")}>
      <svg viewBox="0 0 56 56" aria-hidden>
        <circle cx="28" cy="28" r={R} fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle cx="28" cy="28" r={R} fill="none" stroke={col} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 28 28)" />
      </svg>
      <div className="sig-ring-v" style={{ color: col }}>{s != null ? Math.round(s) : "—"}</div>
    </div>
  )
}

/* ── FactorBar: one diverging factor leg (z-ish score, typ. -2..+2) ── */
function FactorBar({ label, value, zh }: { label: string; value: number | null | undefined; zh: boolean }) {
  const v = value != null && isFinite(value) ? value : null
  const CAP = 2
  const mag = v == null ? 0 : Math.max(-CAP, Math.min(CAP, v))
  const pct = (Math.abs(mag) / CAP) * 50 // half-width max
  const pos = v != null && v >= 0
  const col = v == null ? "var(--muted)" : pos ? "var(--up)" : "var(--down)"
  return (
    <div className="sig-fac-row">
      <span className="sig-fac-lbl">{label}</span>
      <div className="sig-fac-track">
        <span className="sig-fac-mid" />
        <span
          className="sig-fac-fill"
          style={{
            background: col,
            width: pct + "%",
            left: pos ? "50%" : (50 - pct) + "%",
          }}
        />
      </div>
      <span className="sig-fac-num" style={{ color: col }}>{v != null ? (v >= 0 ? "+" : "") + v.toFixed(2) : "—"}</span>
    </div>
  )
}

/* ── MarketRisk: compact regime chip (market_risk.json mirror of macro Risk Radar) ── */

interface MarketRiskDisplay {
  verdict?: string | null
  score?: number | null
  label_en?: string | null
  label_zh?: string | null
  color?: string | null
}
interface MarketRiskData {
  built?: string | null
  display?: MarketRiskDisplay | null
}

function MarketRiskChip({ zh }: { zh: boolean }) {
  const [data, setData] = useState<MarketRiskData | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/data/market_risk.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((raw: MarketRiskData | null) => {
        if (cancelled || !raw) return
        // graceful degradation: hide if data older than 48 h
        const built = raw?.built ? Date.parse(raw.built) : NaN
        if (!isNaN(built) && Date.now() - built > 48 * 3600 * 1000) return
        if (!raw?.display?.verdict) return
        setData(raw)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!data) return null
  const disp = data.display!
  const dotColor = disp.color === "green" ? "var(--up)" : disp.color === "red" ? "var(--down)" : "var(--warn)"
  const label = pick(zh, disp.label_en ?? disp.verdict ?? "—", disp.label_zh ?? disp.verdict ?? "—")
  const score = disp.score != null && isFinite(disp.score) ? Math.round(disp.score) : null

  return (
    <div className="sig-conflict" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-2)" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0, display: "inline-block" }} aria-hidden />
      <span style={{ fontWeight: 600, color: dotColor }}>{label}</span>
      {score != null && <span style={{ opacity: 0.7 }}>{score}/100</span>}
      <span style={{ marginLeft: "auto", opacity: 0.5, fontSize: "10px" }}>{pick(zh, "Market risk", "市场风险")}</span>
    </div>
  )
}

/* ── main component ───────────────────────────────────────────────────── */

export default function OracleDash({ sym, row, slice, intel, bars, zh = false, onClose, onJump, onOpenFull }: OracleDashProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const [activeTab, setActiveTab] = useState(0)
  const [visibleSignals, setVisibleSignals] = useState(25)
  const tabs = [pick(zh, "Overview", "概览"), pick(zh, "Research", "研究"), pick(zh, "Signals", "信号"), pick(zh, "Performance", "历史表现")]
  useEffect(() => {
    const dialog = dialogRef.current
    const opener = document.activeElement
    if (dialog && !dialog.open) dialog.showModal()
    titleRef.current?.focus()
    return () => {
      if (dialog?.open) dialog.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  useEffect(() => { setActiveTab(0); setVisibleSignals(25) }, [sym])
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0 }, [activeTab, sym])
  const selectTab = (index: number, focus = false) => {
    setActiveTab(index)
    if (focus) tabsRef.current[index]?.focus()
  }

  // Derived verdicts using shared helpers (trend powers the stance ladder on stale events)
  const trendState = Array.isArray(bars) && (bars as Bar[]).length >= 200 ? computeTrendState(bars as Bar[]) : null
  const ov = oracleVerdict(row?.verdict ?? null, slice, zh, Date.now(), trendState)
  const dv = deskVerdict(intel, zh)

  // derived stats: prefer slice.backtest.metrics over row for consistency
  const bt = slice?.backtest
  const metrics = bt?.metrics
  const wr = metrics?.win_rate ?? row?.wr ?? null
  const pf = metrics?.profit_factor ?? row?.pf ?? null
  const cagr = metrics?.cagr ?? row?.cagr ?? null
  const nTrades = metrics?.n_trades ?? bt?.n_trades ?? null

  // Research-desk read from the LIVE intel `cards` + `tape` schema (the old `analysis.decision`
  // schema is deprecated → only carries confluence/sniper now, hence the previously-empty panel).
  const cards = intel?.cards ?? null
  const tape = intel?.tape ?? null
  const aj = cards?.ai_judgment ?? null            // decision: verdict + gloss + size_pct
  const conv = cards?.conviction ?? null           // score + band + drivers + cautions
  const sectorPulse = tape?.sector_pulse ?? null   // theme + heat + reco (supporting read)

  const convScore = typeof conv?.score === "number" ? conv.score : null
  const convBand = typeof conv?.band === "string" ? conv.band : null
  const drivers = Array.isArray(conv?.drivers) ? (conv!.drivers as string[]) : []
  const cautions = Array.isArray(conv?.cautions) ? (conv!.cautions as string[]) : []

  // ── Live tech rating (D1/D2) ──
  const barsArr: Bar[] = Array.isArray(bars) ? (bars as Bar[]) : []
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const techRatings = useMemo(() => (barsArr.length >= 30 ? computeRatings(barsArr) : null), [bars])
  const techOverall = techRatings?.summary[2].score ?? null   // [-1, 1]
  const techVerdict = techRatings?.summary[2].verdict ?? null // Verdict string

  // ── D1: Freshness discount ──
  const staleDays = intelStaleDays(intel?.asof)
  const freshnessW = Math.min(0.5, Math.max(0, (staleDays - 2) / 10))
  // Blended score. HOUSE LAW: tech may only DE-ESCALATE — take min(convScore, blend) so tech
  // can only pull the score down, never up a bearish/low-conviction desk read into buy colors.
  const _blend = (convScore != null && techOverall != null && freshnessW > 0)
    ? Math.round((1 - freshnessW) * convScore + freshnessW * ((techOverall + 1) / 2) * 100)
    : convScore
  const displayedScore: number | null = (_blend == null || convScore == null)
    ? _blend
    : Math.min(convScore, _blend)

  // ── D2: Disagreement haircut ──
  // deskLean: derive from tape.ai_lean.dir (BULL/BEAR)
  const deskLeanDir = String(intel?.tape?.ai_lean?.dir || "").toUpperCase()
  const deskLean = deskLeanDir === "BULL" ? 1 : deskLeanDir === "BEAR" ? -1 : 0
  const d2Cap = deskLean === 1 && techOverall != null && techOverall <= -0.3
  const d2Improve = deskLean === -1 && techOverall != null && techOverall >= 0.3
  // Color-coherence gate: when desk is NOT bullish (deskLean<=0), cap at 65 so the ring never
  // enters buy-green (≥66) — convScore is conviction magnitude, not direction; blending with
  // directional tech can collapse a high-conviction WAIT toward green despite a non-buy read.
  const _afterD2 = (displayedScore != null && d2Cap) ? Math.min(55, displayedScore) : displayedScore
  const finalScore = (freshnessW > 0 && _afterD2 != null && deskLean <= 0)
    ? Math.min(65, _afterD2)
    : _afterD2

  // signals: most-recent first, ALL of them
  const sigs: Signal[] = [...(slice?.indicator?.signals ?? [])].reverse()
  const latestSig = sigs[0] ?? null   // freshest signal (already reversed → index 0)
  // Append-only Prophet/reversal-board admissions. Kept outside `indicator.signals` so a
  // candidate receipt can never repaint itself as an Oracle BUY or a Prophet trade plan.
  const opportunities: OpportunityReceipt[] = [...(slice?.opportunities?.events ?? [])]
    .sort((a, b) => String(b.surfaced_at ?? b.entry_date ?? "").localeCompare(String(a.surfaced_at ?? a.entry_date ?? "")))

  // GC v2 side channel: surface the freshest structure-break warning only when it POST-DATES the
  // latest signal (i.e. new information the last marker doesn't yet reflect). ts are "YYYY-MM-DD" → lexical compare is chronological.
  const warnings: Warning[] = slice?.indicator?.warnings ?? []
  const latestWarn: Warning | null = warnings.length ? warnings[warnings.length - 1] : null
  const freshWarn: Warning | null =
    latestWarn && (!latestSig || latestWarn.ts > (signalKnownTs(latestSig) ?? latestSig.ts)) ? latestWarn : null

  const handleJump = (ts: string) => {
    // Dispatch the standard CustomEvent that ChartPanel listens for (R14)
    window.dispatchEvent(new CustomEvent("mm:chart-jump", { detail: { sym, ts } }))
    onJump?.(ts)
    onClose?.()
  }

  const hasResearch = Boolean(aj?.verdict || convScore != null || drivers.length || cautions.length || sectorPulse?.theme_name || tape?.ai_lean?.dir)
  const researchDate = intel?.asof && Number.isFinite(Date.parse(intel.asof))
    ? `${pick(zh, "Research as of", "研究截至")} ${signalHistoryDate(intel.asof, zh)}${staleDays > 2 ? pick(zh, ` · ${staleDays} days old`, ` · ${staleDays}天前`) : ""}`
    : pick(zh, "Research date unavailable", "研究日期不可用")
  const researchContent = (<>
            {/* Research desk read — decision + conviction ring from the live cards schema.
                Deliberately terse: the verdict line carries the read; blend/staleness mechanics
                stay silent (they still shape the ring score) instead of rendering meta-copy. */}
            {(aj?.verdict || convScore != null) && (
              <div className="sig-card">
                <div className="sig-desk">
                  {/* D1: ring shows blended score when desk data is stale */}
                  <div className={styles.score}><ConvictionRing score={finalScore} zh={zh} /><span>{pick(zh, "Adjusted research score", "调整后研究评分")}</span></div>
                  <div className="sig-desk-body">
                    <div className="sig-desk-verb" style={{ color: dv.color }}>
                      {aj?.verdict || dv.label}
                      {convBand && <span className="sig-desk-band">{convBand}</span>}
                    </div>
                    {typeof aj?.size_pct === "number" && aj.size_pct > 0 && (
                      <div className="sig-desk-rank">{pick(zh, "Research size suggestion", "研究仓位建议")}: {sizePctDisplay(aj.size_pct)}%</div>
                    )}
                    {/* Technical rating line — reconciles desk read with live price action */}
                    {techVerdict != null && techOverall != null && (
                      <div className="sig-desk-tech">
                        <span className="sig-desk-tech-k">{pick(zh, "Technical rating", "技术评级")}</span>
                        <span className="sig-desk-tech-v" style={{ color: techOverall >= 0.1 ? "var(--up)" : techOverall <= -0.1 ? "var(--down)" : "var(--text-2)" }}>
                          {techVerdictLabel(techVerdict, zh)}
                          {" "}
                          <span className="sig-desk-tech-score">({techOverall >= 0 ? "+" : ""}{techOverall.toFixed(2)})</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                {/* D2: disagreement caution/context chips */}
                {d2Cap && (
                  <div className="sig-caution-chip">
                    {pick(zh, "Technical tape disagrees", "技术面不支持")}
                  </div>
                )}
                {d2Improve && (
                  <div className="sig-context-chip">
                    {pick(zh, "Technical tape improving", "技术面转强")}
                  </div>
                )}
              </div>
            )}

            {/* Drivers / Cautions — from cards.conviction */}
            {(drivers.length > 0 || cautions.length > 0) && (
              <div className="sig-card">
                <div className="sig-card-h">{pick(zh, "Drivers & Cautions", "驱动与警示")}</div>
                {/* v7: the universal tint tag (--c) replaces .sa-tag's hardcoded rgba
                    fills, which never flipped under html[data-updown="east"]. */}
                {drivers.length > 0 && (
                  <div className="sig-tags">
                    {drivers.slice(0, 6).map((d, i) => (
                      <span key={"d" + i} className="fin-tag" style={{ "--c": "var(--up)" } as React.CSSProperties}>{d}</span>
                    ))}
                  </div>
                )}
                {cautions.length > 0 && (
                  <div className="sig-tags">
                    {cautions.slice(0, 6).map((c, i) => (
                      <span key={"c" + i} className="fin-tag" style={{ "--c": "var(--warn)" } as React.CSSProperties}>{c}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Sector read — supporting context from tape.sector_pulse */}
            {sectorPulse?.theme_name && (
              <div className="sig-card">
                <div className="sig-card-h">
                  {pick(zh, "Sector", "板块")}
                  {sectorPulse.rank != null && sectorPulse.n_themes != null && (
                    <span className="sig-card-sub">#{sectorPulse.rank}/{sectorPulse.n_themes}</span>
                  )}
                </div>
                <div className="sig-desk-gloss">
                  {sectorPulse.theme_name}
                  {sectorPulse.label ? ` — ${sectorPulse.label}` : ""}
                  {sectorPulse.reco ? ` · ${pick(zh, "suggested", "建议")}: ${sectorPulse.reco}` : ""}
                </div>
              </div>
            )}

            {/* Open full analysis link */}
            {onOpenFull && (
              <button className="sd-full" onClick={() => { onClose?.(); onOpenFull?.() }}>
                {pick(zh, "Open full analysis", "打开完整分析")} ›
              </button>
            )}

    {!hasResearch && <p className={styles.empty}>{pick(zh, "Research unavailable", "研究暂不可用")}</p>}
    <details className={styles.method}><summary>{pick(zh, "How to read this assessment", "如何理解研究判断")}</summary>
      <p>{pick(zh, "Research context is not an Oracle signal or an instruction to trade. The existing research score can be reduced for age or disagreement with the technical tape; it is not a probability of profit.", "研究背景并非神谕信号或交易指令。现有研究评分会因数据时效或技术面分歧而下调；它不是盈利概率。")}</p>
      {convScore != null && <p>{pick(zh, "Source conviction", "原始信念评分")}: {convScore} / 100 · {pick(zh, "Adjusted", "调整后")}: {finalScore ?? "—"} / 100</p>}
    </details>
  </>)
  const oracleContent = (<>
            {/* Golden Oracle scorecard — the hero always carries its date; a stance renders
                smaller (descriptive posture) and a dim/undated event loses full saturation */}
            <div className="sig-card">
              <div className="od-hero">
                <div
                  className={"od-verdict" + (ov.stance ? " stance" : "") + (ov.dim && !ov.stance ? " dim" : "")}
                  style={{ color: ov.color }}
                >
                  {ov.label !== "—" ? ov.label : (row?.verdict ?? "—")}
                </div>
                {ov.sub && <div className="od-vsub">{ov.sub}</div>}
                {/* washout-override disclosure — a SECOND line on the same amber refusal card
                    (ratified 2026-08-10, 25% notch). Tier-1 says which group is washed out and
                    by how much; the numbers and the "still refused" clause live in the hover
                    the rail button already carries (ov.note). */}
                {ov.line2 && (
                  <div className="od-vline2" title={ov.note || undefined}>{ov.line2}</div>
                )}

              </div>
              {/* conviction/band/size intentionally NOT repeated here — they are the Research
                  Desk card's read (left/top); this card is the signal engine's scorecard */}
              {/* GC v2: latest signal's keeper quality + recipe tier (BUY|REBUY only).
                  HK-O1: a REFUSED entry is excluded — it has no tier and no score, and this
                  card is the entry scorecard. Its own disclosure line renders below instead. */}
              {latestSig && (latestSig.type === "BUY" || latestSig.type === "REBUY") && latestSig.quality && !isBlockedSignal(latestSig) && (
                <div className="sig-dims">
                  <div className="sig-dim">
                    <span className="sig-dim-k">{pick(zh, "Latest quality", "最新质量")}</span>
                    <span className="sig-dim-v" style={{ color: qualityColor(latestSig.quality) }}>
                      {qualityLabel(latestSig.quality, zh) || "—"}
                    </span>
                  </div>
                  {tierLabel(latestSig.tier, zh) && (
                    <div className="sig-dim">
                      <span className="sig-dim-k">{pick(zh, "Tier", "级别")}</span>
                      <span className="sig-dim-v" style={{ color: "var(--buy)" }}>{tierLabel(latestSig.tier, zh)}</span>
                    </div>
                  )}
                  {latestSig.score != null && isFinite(latestSig.score) && (
                    <div className="sig-dim">
                      <span className="sig-dim-k">{pick(zh, "Score", "评分")}</span>
                      <span className="sig-dim-v">{Math.round(latestSig.score)}<i>/100{latestSig.score_basis === "partial" ? "*" : ""}</i></span>
                    </div>
                  )}
                </div>
              )}
              {/* HK-O1: the newest marker is an entry the regime gate refused. It never enters the
                  scorecard above (no tier, no score, never traded), but it is a real dated fact and
                  is the one thing this panel must not bury — say it plainly instead. */}
              {latestSig && isBlockedSignal(latestSig) && (
                <div className="sig-conflict" style={{ color: "var(--muted)" }}>
                  {pick(zh, "⃠ Entry blocked by the regime gate — not an entry",
                    "⃠ 入场被趋势闸拦截 — 非入场信号")}
                  <span style={{ opacity: 0.7, marginLeft: 6 }}>{fmtDate(signalKnownTs(latestSig) ?? latestSig.ts)}</span>
                </div>
              )}
              {/* GC v2: fresh structure-break warning (only when it post-dates the latest signal) */}
              {freshWarn && (
                <div className="sig-conflict" style={{ color: "var(--warn)" }}>
                  {freshWarn.kind === "confirm"
                    ? pick(zh, "⛔ Structure break confirmed", "⛔ 结构破位（已确认）")
                    : pick(zh, "⚠ Structure-break warning (armed)", "⚠ 结构破位预警（预备）")}
                  <span style={{ opacity: 0.7, marginLeft: 6 }}>{fmtDate(freshWarn.ts)}</span>
                </div>
              )}
              {/* Market-level risk regime (macro Risk Radar mirror — additive, graceful-degrade) */}
              <MarketRiskChip zh={zh} />
            </div>


  </>)
  return (
    <dialog ref={dialogRef} className={styles.panel} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={(event) => { event.preventDefault(); onClose?.() }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose?.()
      }}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>{sym}</p><h2 ref={titleRef} tabIndex={-1} id={`${id}-title`}>{pick(zh, "Stock Intelligence", "个股情报")}</h2></div>
        <button type="button" className={styles.close} onClick={onClose} aria-label={pick(zh, "Close Stock Intelligence", "关闭个股情报")}>×</button>
      </header>
      <p className={styles.description} id={`${id}-description`}>{pick(zh, "Research, dated signals, and their historical track record.", "研究判断、有日期的信号与历史表现。")}</p>
      <div className={styles.tabs} role="tablist" aria-label={pick(zh, "Intelligence views", "情报视图")}>
        {tabs.map((label, index) => <button key={index} type="button" role="tab" id={`${id}-tab-${index}`} aria-controls={`${id}-panel`}
          aria-selected={activeTab === index} tabIndex={activeTab === index ? 0 : -1} ref={(el) => { tabsRef.current[index] = el }}
          onClick={() => selectTab(index)} onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % 4 : event.key === "ArrowLeft" ? (index + 3) % 4 : event.key === "Home" ? 0 : event.key === "End" ? 3 : null
            if (next != null) { event.preventDefault(); event.stopPropagation(); selectTab(next, true) }
          }}>{label}{index === 2 && sigs.length > 0 && <span className={styles.count}>{sigs.length}</span>}</button>)}
      </div>
      <div className={styles.body} ref={bodyRef} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${activeTab}`} tabIndex={0}>
        {activeTab === 0 && <>
          <div className={styles.overview}>
            <section className={styles.read}>
              <h3>{DeskGlyph}{pick(zh, "Research Desk", "研究台")}</h3>
              <p className={styles.date}>{researchDate}</p>
              <p className={styles.verdict} style={{ color: hasResearch ? dv.color : "var(--muted)" }}>{hasResearch ? dv.label : pick(zh, "Research unavailable", "研究暂不可用")}</p>
              {aj?.verdict && <p className={styles.headline}>{aj.verdict}</p> // plain-language-ok: ai_judgment.verdict is source-authored research prose, not a state enum; preserve the full original assessment.
              }
              {convBand && <p className={styles.meta}>{convBand}</p>}
              <button type="button" className={styles.link} onClick={() => selectTab(1, true)}>{pick(zh, "Explore research", "查看研究")} →</button>
            </section>
            <section className={styles.read}>
              <h3>{OracleStar}{pick(zh, "Golden Oracle", "黄金神谕")}</h3>
              <p className={styles.date}>{pick(zh, ov.stance ? "Model posture" : "Latest dated signal", ov.stance ? "模型状态" : "最新有日期的信号")}</p>
              {oracleContent}
              <button type="button" className={styles.link} onClick={() => selectTab(2, true)}>{pick(zh, "Explore signals", "查看信号")} →</button>
            </section>
          </div>
          <section className={styles.evidence}>
            <h3>{pick(zh, "Key drivers & cautions", "关键驱动与注意事项")}</h3>
            <div className={styles.evidenceGrid}>
              <div><h4>{pick(zh, "Supporting factors", "支持因素")}</h4>{drivers.length ? <ul>{drivers.map((d, i) => <li key={i}>{d}</li>)}</ul> : <p className={styles.meta}>{pick(zh, "No supporting factors supplied.", "暂无已提供的支持因素。")}</p>}</div>
              <div className={styles.cautions}><h4>{pick(zh, "Cautions", "注意事项")}</h4>{cautions.length ? <ul>{cautions.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className={styles.meta}>{pick(zh, "No cautions supplied; this does not establish low risk.", "未提供注意事项并不代表低风险。")}</p>}</div>
            </div>
          </section>
          <p className={styles.boundary}>{pick(zh, "These systems answer different questions. No combined score or trade recommendation is inferred.", "两个系统回答不同的问题；此处不推导合并评分或交易建议。")}</p>
        </>}
        {activeTab === 1 && <><p className={styles.date}>{researchDate}</p>{researchContent}</>}
        {activeTab === 2 && <>
          <p className={styles.boundary}>{pick(zh, "Dates show when a signal became known. Select a row to return to its chart bar. Candidate receipts remain separate from Oracle calls.", "日期表示信号何时变得可知。点击记录可返回相应图表K线。候选入选记录与神谕信号保持区分。")}</p>
            {opportunities.length > 0 && (
              <div className="od-sig-section" data-opportunity-receipts="1">
                <div className="od-sec-h">
                  {pick(zh, "Earlier system receipts", "更早的系统记录")}
                  <span className="od-sig-count">{opportunities.length}</span>
                </div>
                <div className="sd-siglist">
                  {opportunities.slice(0, 12).map((opp, i) => {
                    const ts = opp.surfaced_at ?? opp.entry_date ?? ""
                    const ret = typeof opp.return_pct === "number" && Number.isFinite(opp.return_pct)
                      ? `${opp.return_pct >= 0 ? "+" : ""}${opp.return_pct.toFixed(1)}%`
                      : null
                    const system = String(opp.system || "prophet").toLowerCase().includes("reversal")
                      ? pick(zh, "REVERSAL", "反转观察")
                      : "PROPHET"
                    const sourceLabel = opp.definition && opp.definition !== "legacy"
                      ? opp.definition
                      : String(opp.system || "").toLowerCase().includes("reversal")
                        ? pick(zh, "reversal watch", "反转观察")
                        : pick(zh, "Prophet board", "Prophet 榜单")
                    return (
                      <button
                        key={opp.id ?? `${ts}-${i}`}
                        className="sd-sigrow"
                        onClick={() => ts && handleJump(ts)}
                        title={pick(
                          zh,
                          `Candidate receipt from ${sourceLabel}; not a trade plan or Oracle call`,
                          `来自 ${sourceLabel} 的候选记录；并非交易计划或神谕信号`,
                        )}
                      >
                        <span className="sd-sig-badge" style={{ ["--sc" as any]: "#5b8cff" }}>{system}</span>
                        <span className="sd-sig-q">{pick(zh, "candidate · not plan", "候选 · 非计划")}</span>
                        <span className="sd-sig-date">{ts ? signalHistoryDate(ts, zh) : "—"}</span>
                        <span className="sd-sig-price">
                          {opp.entry_price != null ? opp.entry_price.toFixed(2) : "—"}
                          {opp.rank != null ? ` · #${opp.rank}` : ""}
                          {ret ? ` · ${ret}` : ""}
                        </span>
                      </button>
                    )
                  })}
                  <div className="sd-sig-legend">
                    {pick(
                      zh,
                      "These are dated candidate admissions from Prophet and reversal boards—not Golden Oracle calls or Prophet trade plans.",
                      "这些是 Prophet 与反转榜单的候选入选记录，并非黄金神谕信号或 Prophet 交易计划。",
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Signal history — compact date · price rows, scrollable (slim dark scrollbar) */}
            <div className="od-sig-section">
              <div className="od-sec-h">
                {pick(zh, "Signal history", "信号历史")}
                {sigs.length > 0 && <span className="od-sig-count">{sigs.length}</span>}
              </div>

              {sigs.length === 0 ? (
                <div className="fin-empty od-empty" role="status">
                  <span className="fin-empty-title">{pick(zh, "No signals", "暂无信号")}</span>
                  <span className="fin-empty-why">
                    {pick(
                      zh,
                      "Golden Oracle has not printed an entry or exit for this name in the loaded history.",
                      "在已加载的历史区间内，黄金神谕未对该标的发出过进出场信号。",
                    )}
                  </span>
                </div>
              ) : (
                <div className="sd-siglist">
                  {sigs.slice(0, visibleSignals).map((sig, i) => {
                    // HK-O1: `blocked` (not `type`) decides whether this row is an entry — a
                    // regime-vetoed setup still types BUY/REBUY for back-compat, and it must
                    // never wear the buy pill or count as one in the list.
                    const isBlocked = isBlockedSignal(sig)
                    // The RETRO PROJECTION: a pre-fence refusal today's rule would have
                    // entered. It reads as the entry it would have been — and says, in the
                    // row itself, that it was not one. `(retro)` is not decoration: without
                    // it this row is a claim the product never earned.
                    const isRetro = isRetroOverride(sig)
                    const isEntry = !isBlocked && (sig.type === "BUY" || sig.type === "REBUY")
                    const isReclaim = sig.type === "RECLAIM"
                    const isBottom = isBottomWatch(sig)
                    const isSweepReclaim = isStopSweepReclaim(sig)
                    const isStarter = isEntry && (sig.quality === "block" || sig.quality === "pending")
                    const isStop = isStructureStop({ type: sig.type, basis: sliceSignalBasis(sig) })
                    // badge text stays inside the 58px pill and matches the on-chart glyph, so the
                    // list and the chart read as one system; the mechanic rides the qualifier + hover.
                    const badgeText = isRetro ? sig.type
                      : isBlocked ? pick(zh, "BLOCKED", "已拦截")
                        : isStop ? pick(zh, "STOP", "止损")
                          : isBottom ? pick(zh, "EARLY", "底部观察")
                            : isSweepReclaim ? pick(zh, "RECLAIM", "流动性收复")
                              : isReclaim ? pick(zh, "RE-ENTRY", "再入场")
                                : isStarter ? pick(zh, "STARTER", "试仓") : sig.type
                    const qualifier = isRetro ? pick(zh, "(retro)", "（事后重标）")
                      : isBlocked ? pick(zh, "not an entry", "非入场信号")
                        : isStop ? pick(zh, "swing-low break", "跌破前低")
                          : isBottom ? pick(zh, "risk-defined · not confirmed", "风险限定 · 尚未确认")
                            : isSweepReclaim ? pick(zh, "failed breakdown reclaimed", "假突破后收复")
                              : isEntry ? qualityLabel(sig.quality, zh) : ""
                    const q = qualifier
                    const knownTs = signalKnownTs(sig) ?? sig.ts
                    const knownDate = signalHistoryDate(knownTs, zh)
                    const chartDate = signalHistoryDate(sig.ts, zh)
                    const dateTitle = knownTs !== sig.ts
                      ? pick(
                          zh,
                          `Confirmed ${knownDate} · 3D bar opened ${chartDate}`,
                          `确认于 ${knownDate} · 3日K线始于 ${chartDate}`,
                        )
                      : pick(zh, "Jump to chart", "跳转到图表")
                    return (
                      <button
                        key={i}
                        className="sd-sigrow"
                        onClick={() => handleJump(sig.ts)}
                        title={
                          isRetro
                            ? pick(zh,
                              "Re-marked under the current rule (2026-08-10) — the system refused this live",
                              "按当前规则事后重标（2026-08-10）— 当时系统并未入场")
                          : isBlocked
                            ? pick(zh,
                              `Entry refused by the regime gate — not an entry${sig.quality_reason ? ` (${sig.quality_reason})` : ""}`,
                              `入场被趋势闸拒绝 — 非入场信号${sig.quality_reason ? `（${sig.quality_reason}）` : ""}`)
                            : isStop
                              ? pick(zh,
                                `Structure stop — the daily close broke the prior swing low${sig.stop_level != null ? ` at ${sig.stop_level}` : ""}, not a momentum exit`,
                                `结构止损 — 日线收盘跌破前低${sig.stop_level != null ? ` ${sig.stop_level}` : ""}，非动量离场`)
                              : isBottom
                                ? pick(zh,
                                  `Bottom watch — risk-defined starter, not a confirmed buy${sig.stop_level != null ? `; stop reference ${sig.stop_level}` : ""}`,
                                  `底部观察 — 风险限定试仓，尚非确认买入${sig.stop_level != null ? `；止损参考 ${sig.stop_level}` : ""}`)
                              : isReclaim ? (sig.quality_reason || dateTitle) : dateTitle
                        }
                      >
                        {/* tinted (not solid) pills — the signal color rides --sc; RECLAIM keeps the
                            hollow treatment (glyph law — never the solid entry pill), and HK-O1 gives
                            a REFUSED entry the same hollow/muted treatment so it can never read green */}
                        {/* RETRO keeps the hollow treatment and the washout amber, never the
                            solid entry green: the row says what today's rule WOULD have done,
                            and a live-BUY pill would say the product did it. */}
                        <span
                          className={"sd-sig-badge" + (isReclaim || isBlocked || isRetro ? " hollow" : "")}
                          style={{ ["--sc" as any]: isRetro ? "var(--signal)" : isBlocked ? "var(--muted)" : isBottom || isStarter ? "var(--signal)" : isReclaim ? "var(--buy)" : signalColor(sig.type) }}
                        >
                          {badgeText}
                        </span>
                        {/* pre-promotion display-tier markers (scored:false) carry the unscored tag;
                            scored reclaim-lane events are normal position events and need none */}
                        {(isReclaim || isBottom) && sig.scored === false && <span className="sd-sig-q">{pick(zh, "unscored", "未计分")}</span>}
                        {q && <span className="sd-sig-q">{q}</span>}
                        <span className="sd-sig-date">{knownDate}</span>
                        <span className="sd-sig-price">{sig.price != null ? sig.price.toFixed(2) : "—"}</span>
                      </button>
                    )
                  })}
                  {/* ── THE RETRO LEGEND: the disclosure that needs no hover and no tap ──
                      A "(retro)" suffix is a label, and a label the reader cannot resolve is
                      not a disclosure. The sentence behind it used to live only in the row's
                      `title`, which is a desktop-hover affordance — invisible on touch, in a
                      screenshot, and to anyone skimming. So when the visible list contains a
                      re-marked fire, the card states the meaning in full, once, in place.
                      Rendered only when such a row is on screen, so it costs nothing on the
                      overwhelming majority of names that have none. */}
                  {sigs.some(isRetroOverride) && (
                    <div className="sd-sig-legend">{retroLegendCopy(zh)}</div>
                  )}
                </div>
              )}
            </div>


          {visibleSignals < sigs.length && <button type="button" className={styles.more} onClick={() => setVisibleSignals((n) => n + 25)}>{pick(zh, "Show more", "显示更多")} · {Math.min(visibleSignals, sigs.length)} / {sigs.length}</button>}
        </>}
        {activeTab === 3 && <section className={styles.performance}>
          <h3>{pick(zh, "Historical backtest", "历史回测")}</h3>
          <p className={styles.boundary}>{pick(zh, "Historical performance is not a forecast. Read the trade count alongside every percentage; these figures do not measure today's signal confidence.", "历史表现不代表预测。请结合交易样本数量阅读百分比；这些指标不代表当前信号的置信度。")}</p>
                <div className="od-stats">
                  <div className="od-stat">
                    <span className="od-stat-k">{pick(zh, "Win rate", "胜率")}</span>
                    <span className="od-stat-v">{fmtPctLocal(wr, true)}</span>
                  </div>
                  <div className="od-stat">
                    <span className="od-stat-k">{pick(zh, "Profit factor", "盈亏比")}</span>
                    <span className="od-stat-v">{fmt2(pf)}</span>
                  </div>
                  <div className="od-stat">
                    <span className="od-stat-k">{pick(zh, "CAGR", "年化收益")}</span>
                    <span className="od-stat-v">{fmtPctLocal(cagr, true)}</span>
                  </div>
                  <div className="od-stat">
                    <span className="od-stat-k">{pick(zh, "Trades", "交易次数")}</span>
                    <span className="od-stat-v">{nTrades ?? "—"}</span>
                  </div>
                </div>
          {nTrades != null && nTrades < 30 && <p className={styles.smallSample}>{pick(zh, "Small sample — interpret these results with caution.", "样本较少，请谨慎解读这些结果。")}</p>}
          <BacktestCurve key={sym} sym={sym} zh={zh} />
        </section>}
      </div>
      <footer className={styles.footer}><span>{sym} · {pick(zh, "Research Desk · Golden Oracle", "研究台 · 黄金神谕")}</span><span>{pick(zh, "Esc to close", "按 Esc 关闭")}</span></footer>
    </dialog>
  )
}
