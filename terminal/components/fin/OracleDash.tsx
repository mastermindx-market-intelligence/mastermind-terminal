"use client"
/**
 * Intelligence Workspace — a source-preserving view of existing research,
 * Oracle signals, market risk and historical evidence, docked beside the watchlist.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { pick, fmtPct, fmtDate } from "../../lib/finFormat"
import { LineSeries } from "./FinCharts"
import { useWorkspaceSource, type WorkspaceSource } from "../../lib/useWorkspaceSource"
import { workspaceCurve, workspaceSourceClock, workspaceSecurityContext } from "../../lib/intelligenceWorkspaceView"
import { IntelligenceWorkspaceShell, type WorkspaceTab } from "./IntelligenceWorkspaceShell"
import styles from "./IntelligenceWorkspace.module.css"
import { oracleVerdict, deskVerdict, signalKnownTs, isBlockedSignal, isBottomWatch, isRetroOverride, isStopSweepReclaim, isStructureStop, retroLegendCopy, sliceSignalBasis } from "../../lib/signalVerdict"
import { computeTrendState } from "../../lib/trend"
import { normalizeMarketRisk, riskEnvelopeCopy, type MarketRiskRead } from "../../lib/marketRisk"
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
  security_state?: unknown
  security_state_read?: unknown
  analysis?: Analysis | null
  cards?: Record<string, any> | null   // live research-desk schema (ai_judgment · conviction · levels · analyst · smart_money)
  tape?: Record<string, any> | null    // ai_lean (dir) · regime · sector_pulse
  asof?: string | null                 // "YYYY-MM-DD" — date the research desk last ran for this name
}

export interface OracleDashProps {
  sym: string
  open?: boolean
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
  const read = useWorkspaceSource<unknown>(sym, "backtest", true)
  const data = useMemo(() => workspaceCurve(read.data), [read.data])
  if (read.status !== "ready") return <SourceState read={read} label={pick(zh, "Historical performance", "历史表现")} zh={zh} />
  if (!data) return <p className={styles.empty} role="status">{pick(zh, "No equity curve is available for this symbol.", "该标的暂无可用的资金曲线。")}</p>
  return <div className="od-curve" data-testid="workspace-equity-curve">
    <div className="od-sec-h">{pick(zh, "Strategy equity", "策略权益")}</div>
    <p className={styles.date}>{data.asOf ? `${pick(zh, "As of", "截至")} ${signalHistoryDate(data.asOf, zh)}` : pick(zh, "Curve date not supplied", "未提供曲线日期")}
      {data.start && data.end && <><br />{pick(zh, "Backtest window", "回测区间")}: {signalHistoryDate(data.start, zh)} — {signalHistoryDate(data.end, zh)}</>}
    </p>
    {read.refresh !== "settled" && <SourceState read={read} label={pick(zh, "Historical performance", "历史表现")} zh={zh} />}
    <LineSeries labels={data.dates.map(value => /^\d{4}-/.test(value) ? fmtDate(value, { short: true }) : value)}
      series={[{ name: pick(zh, "Strategy equity", "策略权益"), values: data.values, color: "var(--brand-2)" }]}
      includeZero={false} refLine={data.values[0] ?? null} noLegend zh={zh} height={200} />
    {!data.validationSupplied && <p className={styles.meta}>{pick(zh, "Statistical validation not supplied by this source.", "该数据源未提供统计验证信息。")}</p>}
    {data.note && <details className={styles.method}><summary>{pick(zh, "Source methodology", "数据源方法说明")}</summary><p>{data.note}</p></details>}
  </div>
}

function SourceState({ read, label, zh }: { read: WorkspaceSource<unknown> & { retry: () => void }; label: string; zh: boolean }) {
  const message = read.status === "loading" ? pick(zh, `Loading ${label.toLowerCase()}…`, `正在加载${label}…`)
    : read.status === "absent" ? pick(zh, `${label} is not published for this symbol.`, `该标的尚未发布${label}。`)
    : read.status === "unavailable" ? pick(zh, `${label} could not be loaded.`, `暂时无法加载${label}。`)
    : read.refresh === "failed" ? pick(zh, `Showing saved ${label.toLowerCase()}. The latest refresh failed.`, `正在显示已保存的${label}，最新刷新失败。`)
    : read.refresh === "checking" ? pick(zh, `Checking for updated ${label.toLowerCase()}…`, `正在检查${label}更新…`) : null
  if (!message) return null
  return <div className={styles.status} role="status" data-source-state={read.status}>
    {message}{(read.status === "unavailable" || read.status === "absent" || read.refresh === "failed") && <button className={styles.textButton} onClick={read.retry}>{pick(zh, "Retry", "重试")}</button>}
  </div>
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

export function MarketRiskChip({ zh }: { zh: boolean }) {
  const [data, setData] = useState<MarketRiskRead | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false, pending = false
    const controller = new AbortController()
    const refresh = async () => {
      if (pending || cancelled) return
      pending = true
      try {
        const response = await fetch("/data/market_risk.json", { cache: "no-store", signal: controller.signal })
        const raw: unknown = response.ok ? await response.json() : null
        if (!cancelled) { setData(normalizeMarketRisk(raw)); setLoaded(true) }
      } catch {
        if (!cancelled) { setData(null); setLoaded(true) }
      } finally { pending = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 60_000)
    const onFocus = () => { if (document.visibilityState === "visible") void refresh() }
    window.addEventListener("focus", onFocus)
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", onFocus) }
  }, [])

  if (!loaded) return null
  const available = data !== null && !data.stale
  const disp = available ? data : null
  const dotColor = !disp ? "var(--text-2)" : disp.color === "green" ? "var(--up)" : disp.color === "red" ? "var(--down)" : "var(--warn)"
  const label = disp ? pick(zh, disp.label_en ?? disp.verdict, disp.label_zh ?? disp.verdict) : pick(zh, "Market risk unavailable", "市场风险不可用")
  const score = disp?.score != null ? Math.round(disp.score) : null
  const context = riskEnvelopeCopy(disp?.risk_envelope ?? null, zh)

  return (
    <details className="sig-conflict" data-testid="market-risk-chip" style={{ display: "block", color: "var(--text-2)" }}>
      <summary style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, minHeight: 32, cursor: "pointer" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0, display: "inline-block" }} aria-hidden />
        <span style={{ fontWeight: 600, color: dotColor }}>{label}</span>
        {score != null && <span style={{ opacity: 0.7 }}>{score}/100</span>}
        <span style={{ marginLeft: "auto", opacity: 0.65, fontSize: "10px" }}>{context.scope ?? pick(zh, "Market risk", "市场风险")} ▾</span>
        <span data-testid="market-risk-attention" aria-live="polite" aria-atomic="true"
          style={{ flexBasis: disp && context.attention.length > 0 ? "100%" : undefined, display: "flex", flexWrap: "wrap", gap: "4px 12px", color: "var(--warn)", fontSize: "11px", fontWeight: 600, paddingBottom: disp && context.attention.length > 0 ? 4 : 0 }}>
          {disp && context.attention.map(message => <span key={message}>{message}</span>)}
        </span>
      </summary>
      <div style={{ paddingTop: 8, fontSize: "11px", lineHeight: 1.5, overflowWrap: "anywhere" }} data-testid="market-risk-details">
        {data?.asof && <p>{pick(zh, "Observation session: ", "观测日期：")}{data.asof}</p>}
        {disp && <p>{pick(zh, disp.headline_en ?? "", disp.headline_zh ?? disp.headline_en ?? "")}</p>}
        {disp?.display_pending && <p>{pick(zh, "The numerical score is live; the risk label is held while the new state is confirmed.", "数值评分来自实时观测；风险标签在新状态确认期间保持不变。")}</p>}
        <p>{context.caption}</p>
        {context.details.map((detail, index) => <p key={`${index}:${detail}`}>{detail}</p>)}
        {data?.stale && <p>{pick(zh, "This source is stale or could not be qualified.", "该来源已过期或无法核实。")}</p>}
      </div>
    </details>
  )
}

/* ── main component ───────────────────────────────────────────────────── */

export default function OracleDash({ sym, row, bars, zh = false, open = true, onClose, onJump, onOpenFull }: OracleDashProps) {
  const [tab, setTab] = useState<WorkspaceTab>("summary")
  const [filter, setFilter] = useState<"all" | "entries" | "exits" | "refused" | "receipts">("all")
  const [visibleCount, setVisibleCount] = useState(30)
  const sliceRead = useWorkspaceSource<Slice>(sym, "slice", open)
  const intelRead = useWorkspaceSource<Intel>(sym, "intel", open)
  const slice = sliceRead.data
  const intel = intelRead.data
  useEffect(() => { setVisibleCount(30) }, [sym, filter])
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


  const sourceClock = workspaceSourceClock(intel?.asof)
  const companyContext = workspaceSecurityContext(intel, sym)
  const researchDate = sourceClock.kind === "dated"
    ? `${pick(zh, "Research as of", "研究截至")} ${signalHistoryDate(sourceClock.date, zh)}${sourceClock.ageDays > 2 ? ` · ${pick(zh, `${sourceClock.ageDays} days old`, `${sourceClock.ageDays}天前`)}` : ""}`
    : pick(zh, "Research date not supplied", "未提供研究日期")
  const filteredSignals = sigs.filter(sig => filter === "all" ? true
    : filter === "receipts" ? false
    : filter === "refused" ? isBlockedSignal(sig) || isRetroOverride(sig)
    : filter === "entries" ? !isBlockedSignal(sig) && !isRetroOverride(sig) && ["BUY", "REBUY", "RECLAIM", "BOTTOM_WATCH"].includes(sig.type)
    : ["SELL", "CUT"].includes(sig.type))
  const visibleSignals = filteredSignals.slice(0, visibleCount)
  const handleJump = (ts: string) => {
    window.dispatchEvent(new CustomEvent("mm:chart-jump", { detail: { sym, ts } }))
    onJump?.(ts)
    // Desktop context stays open when inspecting a chart event. On mobile return
    // to the chart so the requested point can actually be seen.
    if (window.innerWidth <= 860) onClose?.()
  }
  const metricsView = <div className={styles.metricGrid}>
    {[{ label: pick(zh, "Win rate", "胜率"), value: fmtPctLocal(wr, true) },
      { label: pick(zh, "Profit factor", "盈亏比"), value: fmt2(pf) },
      { label: pick(zh, "CAGR", "年化收益"), value: fmtPctLocal(cagr, true) },
      { label: pick(zh, "Trades", "交易次数"), value: nTrades ?? "—" }].map(metric =>
      <div className={styles.metric} key={metric.label}><span className={styles.metricValue}>{metric.value}</span><span className={styles.metricLabel}>{metric.label}</span></div>)}
  </div>
  const oracleView = <section className="sd-go" data-testid="workspace-oracle">
    <SourceState read={sliceRead} label={pick(zh, "Oracle signals", "神谕信号")} zh={zh} />
    {sliceRead.status === "ready" && <>
      <div className={styles.hero}>
        <div className={styles.heroTop}><span className={styles.eyebrow}>{pick(zh, "Current read", "当前解读")}</span><span className={styles.sourcePill}>{pick(zh, "Oracle", "神谕")}</span></div>
        <h3 className={`${styles.heroTitle} od-verdict${ov.stance ? " stance" : ""}${ov.dim && !ov.stance ? " dim" : ""}`} style={{ color: ov.color }}>{ov.label !== "—" ? ov.label : "—"}</h3>
        {ov.sub && <p className={`${styles.heroSub} od-vsub`}>{ov.sub}</p>}
        {ov.line2 && <p className={styles.heroNote} title={ov.note || undefined}>{ov.line2}</p>}
        {ov.note && <details className={styles.method}><summary>{pick(zh, "What this means", "如何理解")}</summary><p>{ov.note}</p></details>}
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


      </div>
      <section className={styles.section}>
        <h3 className={styles.sectionHeading}>{pick(zh, "Historical evidence", "历史证据")}<span>{pick(zh, "Backtest", "回测")}</span></h3>
        {metricsView}
        <p className={styles.meta}>{pick(zh, "Historical strategy results; they describe the loaded sample, not a forecast.", "历史策略表现反映已加载样本，并非未来预测。")}</p>
        {tab === "summary" ? <button className={styles.textButton} onClick={() => setTab("oracle")}>{pick(zh, "Explore performance & signals", "查看表现与信号")} →</button> : <BacktestCurve sym={sym} zh={zh} />}
      </section>
    </>}
  </section>
  const researchView = <section className={`sd-rd ${styles.section}`} data-testid="workspace-research">
    <h3 className={styles.sectionHeading}>{pick(zh, "Research perspective", "研究观点")}<span>{pick(zh, "Supporting context", "辅助信息")}</span></h3>
    <SourceState read={intelRead} label={pick(zh, "Research", "研究")} zh={zh} />
    {intelRead.status === "ready" && <>
      {(aj?.verdict || convScore != null) ? <>
        <div className={styles.researchRead}>
          <ConvictionRing score={finalScore} zh={zh} />
          <div><h3 style={{ color: dv.color }}>{(zh ? aj?.verdict_zh : null) || aj?.verdict || dv.label}</h3>
            <p>{(zh ? aj?.gloss_zh : null) || aj?.gloss || convBand || dv.sub}</p>
          </div>
        </div>
        <div className={styles.sourceDate}>{researchDate}</div>
        {d2Cap && <div className="sig-caution-chip">{pick(zh, "Technical tape disagrees", "技术面不支持")}</div>}
        {d2Improve && <div className="sig-context-chip">{pick(zh, "Technical tape improving", "技术面转强")}</div>}
        {sourceClock.kind === "unknown" && <p className={styles.meta}>{pick(zh, "Freshness cannot be verified from this research source.", "无法验证该研究信息的新鲜度。")}</p>}
        <ul className={styles.evidenceList}>{drivers.slice(0, tab === "summary" ? 2 : drivers.length).map((item, i) => <li key={i}>{item}</li>)}</ul>
        {tab === "summary" && cautions.length > 0 && <>
          <ul className={`${styles.evidenceList} ${styles.cautions}`}><li>{cautions[0]}</li></ul>
          <button className={styles.textButton} onClick={() => setTab("research")}>{pick(zh, `${cautions.length} research caution${cautions.length === 1 ? "" : "s"}`, `${cautions.length}项研究注意事项`)} →</button>
        </>}
        {tab === "research" && <>
          {cautions.length > 0 && <><h4 className={styles.sectionHeading} style={{ marginTop: 20 }}>{pick(zh, "Cautions", "注意事项")}</h4><ul className={`${styles.evidenceList} ${styles.cautions}`}>{cautions.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
          {techVerdict != null && techOverall != null && <div className={styles.callout}><strong>{pick(zh, "Technical rating", "技术评级")}</strong><br />{techVerdictLabel(techVerdict, zh)} · {techOverall >= 0 ? "+" : ""}{techOverall.toFixed(2)}</div>}
          <details className={styles.method}><summary>{pick(zh, "About this research read", "关于研究解读")}</summary><p>{pick(zh, "Research conviction and the Oracle signal describe different sources. Older research may be reduced by current technical disagreement; technicals never increase the original conviction. This workspace does not infer your holdings or calculate a personal allocation.", "研究信念度与神谕信号来自不同数据源。较旧研究的信念度可能因技术面分歧而降低，但技术面不会提高原始信念度。工作区不会推断您的持仓或计算个人配置。")}</p></details>
        </>}
      </> : <p className={styles.empty}>{pick(zh, "No research judgment is included in the published source.", "已发布的数据源中未包含研究判断。")}</p>}
      {sectorPulse?.theme_name && tab === "research" && <div className={styles.callout}><strong>{pick(zh, "Sector context", "板块信息")}</strong><br />{sectorPulse.theme_name}{sectorPulse.label ? ` · ${sectorPulse.label}` : ""}
        {sectorPulse.rank != null && sectorPulse.n_themes != null && <p className={styles.meta}>#{sectorPulse.rank} / {sectorPulse.n_themes}</p>}
      </div>}
    </>}
    <div className={styles.actionRow}>
      {tab === "summary" && <button className={styles.textButton} onClick={() => setTab("research")}>{pick(zh, "Read research", "阅读研究")} →</button>}
      {tab === "research" && onOpenFull && <button className={styles.textButton} onClick={onOpenFull}>{pick(zh, "Open full company analysis", "打开完整公司分析")} ↗</button>}
    </div>
  </section>
  const companyView = <section className={styles.section} data-testid="workspace-company-context">
    <h3 className={styles.sectionHeading}>{pick(zh, "Company state", "公司状态")}<span>{pick(zh, "Evidence context", "证据背景")}</span></h3>
    {companyContext.disposition === "accepted" ? <>
      {companyContext.degradation && companyContext.degradation !== "NONE" && <div className={styles.callout}>
        {pick(zh, "Source coverage", "数据覆盖")}: {companyContext.coverage?.replaceAll("_", " ").toLowerCase() || "—"}
        {companyContext.degradation !== companyContext.coverage && ` · ${companyContext.degradation.toLowerCase()}`}
      </div>}
      {companyContext.state && <p className={styles.heroSub}>{pick(zh, companyContext.state.en, companyContext.state.zh)}</p>}
      {companyContext.change && <div className={styles.callout}><strong>{pick(zh, "What changed", "发生了什么变化")}</strong><br />{pick(zh, companyContext.change.en, companyContext.change.zh)}</div>}
      {companyContext.unresolved && <div className={styles.callout}><strong>{pick(zh, "Unresolved evidence", "待确认的证据")}</strong><br />{pick(zh, companyContext.unresolved.en, companyContext.unresolved.zh)}
        {(companyContext.unresolved.leg || companyContext.unresolved.code) && <p className={styles.meta}>{[companyContext.unresolved.leg, companyContext.unresolved.code].filter(Boolean).join(" · ")}</p>}
      </div>}
      {companyContext.catalysts.map((catalyst, index) => <div key={index} className={styles.callout}><strong>{pick(zh, "Estimated catalyst window", "预估催化窗口")}</strong><br />
        {signalHistoryDate(catalyst.start, zh)} — {signalHistoryDate(catalyst.end, zh)}<p className={styles.meta}>{catalyst.basis}</p></div>)}
      <div className={styles.sourceDate}>{companyContext.marketAt ? `${pick(zh, "Market data through", "市场数据截至")} ${signalHistoryDate(companyContext.marketAt, zh)}` : pick(zh, "Market observation date unavailable", "市场观察日期不可用")}</div>
      <details className={styles.method}><summary>{pick(zh, "Evidence & availability", "证据与可用性")}</summary>
        <p>{pick(zh, "Company context is descriptive. It does not authorize a new entry or determine what to do with an existing position.", "公司背景信息仅作描述，不构成新入场许可，也不决定已有持仓的操作。")}</p>
        <p>{pick(zh, "Entry-source evidence", "入场数据证据")}: {companyContext.entrySourceAvailable ? pick(zh, "provided", "已提供") : pick(zh, "unavailable", "不可用")}</p>
        <p>Prophet: {companyContext.prophetCoverage?.replaceAll("_", " ").toLowerCase() || pick(zh, "unavailable", "不可用")}</p>
        {companyContext.generatedAt && <p>{pick(zh, "Compiled", "编制于")}: {signalHistoryDate(companyContext.generatedAt, zh)}</p>}
        {companyContext.contentSha256 && <p className={styles.receipt}>{pick(zh, "Source receipt", "来源凭据")}: {companyContext.contentSha256}</p>}
      </details>
    </> : <p className={styles.empty}>{companyContext.disposition === "not_published"
      ? pick(zh, "Company-state evidence is not published for this symbol yet.", "该标的尚未发布公司状态证据。")
      : companyContext.disposition === "identity_blocked"
        ? pick(zh, "Company-state identity could not be verified. This evidence is unavailable.", "公司状态身份无法核实，此证据不可用。")
        : pick(zh, "Company-state evidence is temporarily unavailable.", "公司状态证据暂时不可用。")}</p>}
  </section>
  const activityView = <section className="sd-go" data-testid="workspace-activity">
    <h3 className={styles.sectionHeading}>{pick(zh, "Signal activity", "信号动态")}<span>{sigs.length} {pick(zh, "events", "条记录")}</span></h3>
    <p className={styles.meta}>{pick(zh, "Select an event to locate it on the chart. Dates reflect when signals became observable.", "选择一条记录即可定位图表。日期反映信号首次可见的时间。")}</p>
    <div className={styles.filters} aria-label={pick(zh, "Filter activity", "筛选动态")}>
      {([ ["all", "All", "全部"], ["entries", "Entries", "入场"], ["exits", "Exits", "离场"], ["refused", "Refused / retro", "拦截 / 事后"], ["receipts", "Candidates", "候选"] ] as const).map(([id, en, cn]) =>
        <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{pick(zh, en, cn)}</button>)}
    </div>
    <SourceState read={sliceRead} label={pick(zh, "Signal history", "信号历史")} zh={zh} />
    {sliceRead.status === "ready" && <>
      <div className="sd-siglist">
                  {visibleSignals.map((sig, i) => {
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

      </div>
      {sigs.some(isRetroOverride) && <div className="sd-sig-legend">{retroLegendCopy(zh)}</div>}
      {filter !== "receipts" && filteredSignals.length === 0 && <p className={styles.empty}>{pick(zh, "No signal events match this view in the loaded history.", "已加载历史中没有符合此筛选的信号。")}</p>}
      {filteredSignals.length > visibleCount && <button className={styles.loadMore} onClick={() => setVisibleCount(count => count + 30)}>{pick(zh, `Show more · ${filteredSignals.length - visibleCount} remaining`, `显示更多 · 剩余${filteredSignals.length - visibleCount}条`)}</button>}
            {opportunities.length > 0 && (filter === "all" || filter === "receipts") && (
              <div className="od-sig-section" data-opportunity-receipts="1">
                <div className="od-sec-h">
                  {pick(zh, "Earlier system receipts", "更早的系统记录")}
                  <span className="od-sig-count">{opportunities.length}</span>
                </div>
                <div className="sd-siglist">
                  {opportunities.slice(0, visibleCount).map((opp, i) => {
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


      {filter === "receipts" && opportunities.length === 0 && <p className={styles.empty}>{pick(zh, "No candidate receipts are included in this source.", "该数据源中暂无候选记录。")}</p>}
      {(filter === "all" || filter === "receipts") && opportunities.length > visibleCount && <button className={styles.loadMore} onClick={() => setVisibleCount(count => count + 30)}>{pick(zh, "Show more candidate receipts", "显示更多候选记录")}</button>}
    </>}
  </section>
  return <IntelligenceWorkspaceShell open={open} symbol={sym} zh={zh} tab={tab} onTabChange={setTab} onClose={() => onClose?.()}
    status={intelRead.status === "ready" ? researchDate : pick(zh, "Sources are dated individually", "各数据源单独标注日期")}>
    {(tab === "summary" || tab === "oracle") && oracleView}
    {(tab === "summary" || tab === "oracle") && <section className={styles.section}><h3 className={styles.sectionHeading}>{pick(zh, "Market risk", "市场风险")}</h3><MarketRiskChip zh={zh} /></section>}
    {(tab === "summary" || tab === "research") && researchView}
    {tab === "research" && intelRead.status === "ready" && companyView}
    {tab === "summary" && <section className={styles.section}><h3 className={styles.sectionHeading}>{pick(zh, "Activity", "动态")}<span>{sigs.length} {pick(zh, "events", "条记录")}</span></h3>
      {latestSig ? <button className={styles.textButton} onClick={() => setTab("activity")}>{pick(zh, "Review latest signals & receipts", "查看最新信号与记录")} →</button> : <p className={styles.empty}>{pick(zh, "No signal history is loaded yet.", "暂未加载信号历史。")}</p>}
    </section>}
    {tab === "oracle" && <button className={styles.textButton} onClick={() => setTab("activity")}>{pick(zh, "View complete signal history", "查看完整信号历史")} →</button>}
    {tab === "activity" && activityView}
  </IntelligenceWorkspaceShell>
}
