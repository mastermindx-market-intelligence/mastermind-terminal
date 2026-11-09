"use client";
/**
 * RegimeOutlook — per-stock "regime-aware forward seasonal outlook"
 * rendered from the mastermind.seasonal_outlook/v1 JSON artifact.
 *
 * Fetches /data/<sym>.seasonal.json client-side. Returns null when the
 * artifact is absent (many symbols won't have it — no clutter).
 *
 * SPECULATIVE, DISPLAY-ONLY — validation verdict + disclaimer are kept
 * prominent, not buried.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as RPointerEvent,
} from "react";
import { fmtPct, pick } from "../../lib/finFormat";
import { FinTip, useFinTip } from "./FinCharts";
import { getJSON } from "../../lib/dataCache";
import { forwardSeasonalTooltipRows } from "../../lib/forwardSeasonalTooltip";
import { thinLabels, useChartWidth } from "../charts/svgChart";

/* ── types matching the JSON schema ─────────────────────────────────────── */
interface BucketView {
  dir: "bull" | "bear" | "neutral";
  mean: number | null;
  median: number | null;
  win_rate: number | null;
  n: number;
  lo: number | null;
  hi: number | null;
  confidence: "low" | "medium" | "high";
}
interface ForwardBucket {
  start: string;
  end: string;
  label: string;
  baseline: BucketView;
  regime: BucketView;
}
interface Interval {
  dir: "bull" | "bear";
  start: string;
  end: string;
  expected_move: number;
  typical_move?: number | null;
  win_rate: number | null;
  n: number;
  n_eff?: number;
  lo?: number | null;
  hi?: number | null;
  stability?: number | null;
  evidence_score?: number;
  confidence?: "low" | "medium" | "high";
  buckets: string[];
}
interface Analog {
  year: number;
  weight: number;
  cycle_pos: "midterm" | "post_election" | "pre_election" | "election";
  rate_dir: "hiking" | "cutting" | "holding" | "whipsaw";
  is_recession: boolean;
  whipsaw: boolean;
  flags: string[];
  provisional: boolean;
}
interface CurrentYear {
  year: number;
  cycle_pos: "midterm" | "post_election" | "pre_election" | "election";
  rate_dir: "hiking" | "cutting" | "holding" | "whipsaw";
  is_recession: boolean;
  whipsaw: boolean;
  flags: string[];
  anomaly_flags: string[];
  provisional: boolean;
}
interface Validation {
  loyo_years: number;
  n_predictions: number;
  regime_hit: number | null;
  baseline_hit: number | null;
  skill: number | null;
  skill_ci_lo?: number | null;
  skill_ci_hi?: number | null;
  n_blocks?: number;
  regime_better_years?: number;
  baseline_better_years?: number;
  tied_years?: number;
  verdict: "edge" | "no_edge" | "anti" | "untested";
}
interface History {
  first_year: number;
  last_date: string;
  complete_years: number;
  coverage: "deep" | "medium" | "thin";
}
interface SeasonalOutlook {
  schema: string;
  symbol: string;
  as_of: string;
  is_display_only: boolean;
  engine_version: string;
  regime_table_version: string;
  disclaimer: string;
  mode: "regime_weighted" | "baseline_fallback" | "insufficient" | "unavailable";
  default_view: "baseline" | "regime";
  n_eff: number;
  n_eff_note: string;
  relaxed_filters: string[];
  current_year: CurrentYear;
  history: History;
  validation: Validation;
  analogs: Analog[];
  forward_buckets: ForwardBucket[];
  intervals_baseline: Interval[];
  intervals_regime: Interval[];
  honest_read: string;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */
const P = (v: number | null | undefined) =>
  fmtPct(v, { alreadyPct: true, sign: true, decimals: 1 });
const HIT_DELTA = (v: number | null | undefined) =>
  fmtPct(v, { sign: true, decimals: 1 });
const WRp = (v: number | null | undefined) =>
  v == null ? "—" : `${Math.round(v * 100)}%`;

const dateMs = (s: string) => new Date(s + "T00:00:00Z").getTime();
/** Today as an ISO date, in the same YYYY-MM-DD space the artifact speaks. */
const todayIso = () => new Date().toISOString().slice(0, 10);
/** An artifact this old must say so — the panel used to draw as_of as "now". */
const STALE_MS = 14 * 86400000;

function cyclePosLabel(cp: string, zh: boolean): string {
  switch (cp) {
    case "midterm":
      return pick(zh, "Midterm", "中期选举年");
    case "post_election":
      return pick(zh, "Post-election", "选后年");
    case "pre_election":
      return pick(zh, "Pre-election", "选前年");
    case "election":
      return pick(zh, "Election", "选举年");
    default:
      return cp;
  }
}

function rateDirLabel(rd: string, zh: boolean): string {
  switch (rd) {
    case "hiking":
      return pick(zh, "Rates hiking", "加息周期");
    case "cutting":
      return pick(zh, "Rates cutting", "降息周期");
    case "holding":
      return pick(zh, "Rates holding", "利率不变");
    case "whipsaw":
      return pick(zh, "Rates whipsaw", "利率反复");
    default:
      return rd;
  }
}

/** Parse "2026-07-07" → a JS Date (UTC midnight). */
function parseDate(s: string): Date {
  return new Date(s + "T00:00:00Z");
}

/** Format a date to a short tick label: "Jul '26" / "Jan '27" (EN) or "7月" / "'27年1月" (zh). */
function tickLabel(d: Date, zh: boolean): string {
  const mi = d.getUTCMonth();
  const yy = String(d.getUTCFullYear()).slice(2);
  if (zh) return mi === 0 ? `'${yy}年1月` : `${mi + 1}月`;
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mi];
  return `${m} '${yy}`;
}

function shortDate(s: string, zh: boolean): string {
  const d = parseDate(s);
  if (zh) return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/* ── main export ─────────────────────────────────────────────────────────── */
export function RegimeOutlook({ sym, zh = false }: { sym: string; zh?: boolean }) {
  const [load, setLoad] = useState<{
    sym: string;
    data: SeasonalOutlook | null | "loading";
  }>({ sym, data: "loading" });

  useEffect(() => {
    let cancelled = false;
    getJSON(`/data/${sym}.seasonal.json`).then((d: SeasonalOutlook | null) => {
      if (!cancelled) setLoad({ sym, data: d ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [sym]);
  const data = load.sym === sym ? load.data : "loading";

  // Loading gets a skeleton of the panel's own height — the old combined null
  // popped the whole panel in after the fetch and shoved the page down.
  if (data === "loading") {
    return (
      <div className="fin-ro-panel fin-adv-panel">
        <div className="fin-skel" style={{ height: 88 }} />
      </div>
    );
  }
  if (data === null) return null;

  const d = data;

  // insufficient / unavailable → compact panel
  if (d.mode === "insufficient" || d.mode === "unavailable") {
    return (
      <div className="fin-ro-panel">
        <div className="fin-ro-head">
          <span className="fin-ro-title">{pick(zh, "Forward seasonal map", "前瞻季节图")}</span>
          <span className="fin-ro-pill">{pick(zh, "research", "研究")}</span>
        </div>
        <div className="fin-ro-emptyread">
          <strong>{pick(zh, "No reliable map yet", "暂无可靠季节图")}</strong>
          <span>
            {d.mode === "insufficient"
              ? pick(zh, "This symbol needs at least three complete calendar years.", "该标的至少需要三个完整日历年。")
              : pick(zh, "The price-history quality check failed, so the model suppressed the read.", "价格历史质量检查未通过，因此模型已隐藏读数。")}
          </span>
        </div>
        <div className="fin-ro-disclaimer">{pick(zh, "Historical research only · not a forecast or investment advice.", "仅供历史研究 · 不构成预测或投资建议。")}</div>
      </div>
    );
  }

  return <RegimeOutlookInner data={d} zh={zh} />;
}

/* ── full panel ──────────────────────────────────────────────────────────── */
function RegimeOutlookInner({ data: d, zh }: { data: SeasonalOutlook; zh: boolean }) {
  const [view, setView] = useState<"baseline" | "regime">(d.default_view);

  const intervals = view === "baseline" ? d.intervals_baseline : d.intervals_regime;
  const val = d.validation;
  const isStale = dateMs(todayIso()) - dateMs(d.as_of) > STALE_MS;
  const liveIntervals = intervals.filter((iv) => dateMs(iv.end) > dateMs(todayIso()));
  const bestSupport = liveIntervals.reduce(
    (best, iv) => Math.max(best, iv.evidence_score ?? 0),
    0,
  );
  const status =
    val.verdict === "edge"
      ? {
          tone: "up",
          label: pick(zh, "Regime lift validated", "制度加权已验证"),
          sentence: pick(
            zh,
            `The regime lens improved year-level tests and maps ${liveIntervals.length} upcoming seasonal window${liveIntervals.length === 1 ? "" : "s"}.`,
            `制度加权通过年度层级检验，并标出 ${liveIntervals.length} 个未来季节窗口。`,
          ),
        }
      : val.verdict === "anti"
        ? {
            tone: "down",
            label: pick(zh, "Regime lens rejected", "制度加权未通过"),
            sentence: pick(
              zh,
              `Regime matching weakened out-of-sample results, so the map defaults to the all-years seasonal baseline.`,
              "制度匹配削弱了样本外结果，因此地图默认采用所有年份的季节基准。",
            ),
          }
        : {
            tone: "neu",
            label: pick(zh, "Baseline only", "仅采用基准"),
            sentence: pick(
              zh,
              `Historical seasonality maps ${liveIntervals.length} upcoming window${liveIntervals.length === 1 ? "" : "s"}; regime matching did not add reliable out-of-sample lift.`,
              `历史季节性标出 ${liveIntervals.length} 个未来窗口；制度匹配未带来可靠的样本外提升。`,
            ),
          };

  return (
    <div className="fin-ro-panel fin-adv-panel">
      <div className="fin-ro-head">
        <span className="fin-ro-title">{pick(zh, "Forward seasonal map", "前瞻季节图")}</span>
        <span className="fin-ro-pill">{pick(zh, "research", "研究")}</span>
        {isStale && (
          <span className="fin-tag" style={{ "--c": "var(--warn)" } as CSSProperties}>
            {pick(zh, `stale · as-of ${d.as_of}`, `过期 · 截至 ${d.as_of}`)}
          </span>
        )}
      </div>

      <div className="fin-ro-summary">
        <div className="fin-ro-summary-copy">
          <span className={`fin-ro-state ${status.tone}`}>{status.label}</span>
          <p>{status.sentence}</p>
        </div>
        <div className="fin-ro-kpis">
          <div className="fin-ro-kpi">
            <span>{pick(zh, "Model read", "模型结论")}</span>
            <strong>{view === "baseline" ? pick(zh, "All years", "所有年份") : pick(zh, "Regime lens", "制度视角")}</strong>
          </div>
          <div className="fin-ro-kpi">
            <span>{pick(zh, "History", "历史样本")}</span>
            <strong className="num">{d.history.complete_years}y</strong>
          </div>
          <div className="fin-ro-kpi">
            <span>{pick(zh, "Best support", "最高支持度")}</span>
            <strong className="num">{bestSupport > 0 ? `${bestSupport}/100` : "—"}</strong>
          </div>
        </div>
      </div>

      <div className="fin-ro-controls">
        <div className="fin-toggle fin-ro-toggle">
          <button
            className={view === "baseline" ? "on" : ""}
            onClick={() => setView("baseline")}
          >
            {pick(zh, "Baseline", "基准")}
          </button>
          <button
            className={view === "regime" ? "on" : ""}
            onClick={() => setView("regime")}
            title={
              val.verdict === "edge"
                ? pick(zh, "Validated regime-weighted view", "已验证的制度加权视图")
                : pick(zh, "Research view; it did not beat the baseline", "研究视图；未优于基准")
            }
          >
            {pick(zh, "Regime lens", "制度视角")}
          </button>
        </div>
        <span>
          {view === "baseline"
            ? pick(zh, "Uses every complete year equally.", "对每个完整年份等权处理。")
            : pick(zh, "Weights years with similar cycle and rate conditions.", "加权处理周期与利率环境相似的年份。")}
        </span>
      </div>

      <TimelinePanel
        intervals={intervals}
        asOf={d.as_of}
        forwardBuckets={d.forward_buckets}
        view={view}
        zh={zh}
      />

      <WindowCards intervals={liveIntervals} zh={zh} />

      <details className="fin-ro-details">
        <summary>{pick(zh, "Evidence & analog years", "证据与类比年份")}</summary>
        <div className="fin-ro-details-body">
          <div className="fin-ro-regime-badge">
            {d.current_year.year}
            <span className="fin-ro-sep">·</span>
            {cyclePosLabel(d.current_year.cycle_pos, zh)}
            <span className="fin-ro-sep">·</span>
            {rateDirLabel(d.current_year.rate_dir, zh)}
            {d.current_year.is_recession && (
              <span className="fin-tag fin-ro-flag-rec" style={{ "--c": "var(--down)" } as CSSProperties}>
                {pick(zh, "Recession", "衰退")}
              </span>
            )}
            {d.current_year.provisional && (
              <span
                className="fin-tag fin-ro-provisional"
                style={{ "--c": "var(--warn)" } as CSSProperties}
                title={pick(
                  zh,
                  "Current-year regime is an as-of estimate while analog years carry full-year hindsight.",
                  "当前年度制度为截止估算，历史类比年具有全年后见之明。",
                )}
              >
                {pick(zh, "provisional", "暂定")}
              </span>
            )}
          </div>
          <ValidationStrip val={val} zh={zh} />
          <AnalogChips analogs={d.analogs} relaxedFilters={d.relaxed_filters} nEff={d.n_eff} zh={zh} />
          <div className="fin-asof">
            <span className="num">
              {pick(
                zh,
                `engine ${d.engine_version} · as-of ${d.as_of} · ${d.history.complete_years}y history · ${d.validation.loyo_years} year-level tests`,
                `引擎 ${d.engine_version} · 截至 ${d.as_of} · ${d.history.complete_years} 年历史 · ${d.validation.loyo_years} 次年度检验`,
              )}
            </span>
          </div>
        </div>
      </details>

      <div className="fin-ro-disclaimer">
        {pick(zh, "Historical pattern research only · not a forecast or investment advice.", "仅供历史规律研究 · 不构成预测或投资建议。")}
      </div>
    </div>
  );
}

function WindowCards({ intervals, zh }: { intervals: Interval[]; zh: boolean }) {
  if (intervals.length === 0) return null;
  const shown = intervals.slice(0, 4);
  return (
    <div className="fin-ro-windows">
      <div className="fin-ro-section-label">{pick(zh, "Window detail", "窗口详情")}</div>
      <div className="fin-ro-window-grid">
        {shown.map((iv) => {
          const score = iv.evidence_score;
          const move = iv.typical_move ?? iv.expected_move;
          const confidence = iv.confidence ?? "low";
          return (
            <article className={`fin-ro-window ${iv.dir}`} key={`${iv.start}-${iv.end}`}>
              <div className="fin-ro-window-head">
                <span>{shortDate(iv.start, zh)} → {shortDate(iv.end, zh)}</span>
                <span className={`fin-ro-confidence ${confidence}`}>
                  {confidence === "high"
                    ? pick(zh, "high support", "高支持")
                    : confidence === "medium"
                      ? pick(zh, "medium support", "中等支持")
                      : pick(zh, "low support", "低支持")}
                </span>
              </div>
              <div className="fin-ro-window-move">
                <strong>{P(move)}</strong>
                <span>{pick(zh, "typical move", "典型涨跌")}</span>
              </div>
              <div className="fin-ro-window-stats">
                <span><b>{WRp(iv.win_rate)}</b>{pick(zh, " positive", " 上涨")}</span>
                <span><b>{iv.n_eff != null ? iv.n_eff.toFixed(1) : iv.n}</b>{pick(zh, " effective years", " 有效年份")}</span>
                <span>
                  <b>{iv.lo != null && iv.hi != null ? `${P(iv.lo)} … ${P(iv.hi)}` : "—"}</b>
                  {pick(zh, " middle range", " 中间区间")}
                </span>
              </div>
              <div className="fin-ro-score">
                <span style={{ width: `${Math.max(0, Math.min(100, score ?? 0))}%` }} />
              </div>
              <div className="fin-ro-score-label">
                <span>{pick(zh, "Evidence", "证据")}</span>
                <b>{score != null ? `${score}/100` : "—"}</b>
                {iv.stability != null && (
                  <em>{pick(zh, `${Math.round(iv.stability * 100)}% sign-stable`, `${Math.round(iv.stability * 100)}% 方向稳定`)}</em>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ── timeline SVG ────────────────────────────────────────────────────────── */
interface TimelinePanelProps {
  intervals: Interval[];
  asOf: string;
  forwardBuckets: ForwardBucket[];
  view: "baseline" | "regime";
  zh: boolean;
}

function TimelinePanel({ intervals, asOf, forwardBuckets, view, zh }: TimelinePanelProps) {
  const { tip, show, hide } = useFinTip();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const vw = useChartWidth(boxRef, 680);
  const SVG_H = 88; // total SVG height
  const BAND_Y = 22; // top of the band area
  const BAND_H = 40; // height of each interval band
  const TICK_Y = BAND_Y + BAND_H + 10; // y for month labels
  const PAD_L = 18;
  const PAD_R = 8;
  const IW = vw - PAD_L - PAD_R;

  // Anchor on TODAY, not on the artifact's as_of. The artifact is regenerated by a
  // batch job, so as_of drifts; drawing it as "now" silently relabels weeks-old data.
  const today = todayIso();
  const tToday = dateMs(today);
  // Intervals that already ended are history, not outlook — skip them instead of
  // painting them behind the marker (and instead of rendering negative-x slivers).
  const live = intervals.filter((iv) => dateMs(iv.end) > tToday);

  if (live.length === 0) {
    return (
      <div className="fin-ro-timeline-wrap fin-empty">
        {intervals.length === 0
          ? pick(zh, "No intervals available", "暂无区间数据")
          : pick(zh, "Every mapped interval has already ended — this outlook is out of date.", "已绘制的区间均已结束——该展望数据已过期。")}
      </div>
    );
  }

  // Old artifacts may include weeks of already elapsed horizon. Start the plot
  // at the later of the artifact vintage and today so the useful future fills it.
  const domainStart = dateMs(asOf) > tToday ? asOf : today;
  const t0 = dateMs(domainStart);
  const lastEnd = live.reduce(
    (mx, iv) => Math.max(mx, dateMs(iv.end)),
    0
  );
  const tSpan = lastEnd - t0;
  if (tSpan <= 0) return null;

  const tx = (dateStr: string) => PAD_L + ((dateMs(dateStr) - t0) / tSpan) * IW;
  const nowX = Math.max(PAD_L, Math.min(PAD_L + IW, tx(today)));
  const nowLblRight = nowX > PAD_L + IW - 34;

  // Build month tick positions
  const tickDates: Date[] = [];
  {
    const start = parseDate(domainStart);
    // step to the first of the next month
    let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const endDate = new Date(lastEnd);
    while (cur <= endDate) {
      tickDates.push(new Date(cur));
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }
  }

  // Build bucket lookup by label for tooltips
  const bucketByLabel: Record<string, BucketView> = {};
  for (const fb of forwardBuckets) {
    const bv = view === "baseline" ? fb.baseline : fb.regime;
    bucketByLabel[fb.label] = bv;
  }
  const tickPoints = tickDates
    .map((d) => ({ d, x: tx(d.toISOString().slice(0, 10)) }))
    .filter((t) => t.x >= PAD_L && t.x <= vw - PAD_R);
  const labelledTicks = new Set(
    thinLabels(tickPoints, (t) => t.x, 74).map((t) => t.d.getTime()),
  );

  return (
    <div className="fin-ro-timeline-wrap" ref={boxRef}>
      <div className="fin-ro-timeline-label">
        {pick(zh, "Upcoming windows", "未来窗口")}
      </div>
      <div className="fin-ro-svg-box" style={{ height: SVG_H }}>
        <svg
          viewBox={`0 0 ${vw} ${SVG_H}`}
          width={vw}
          height={SVG_H}
          className="fin-svg fin-ro-svg"
          style={{ display: "block", width: "100%", height: SVG_H }}
        >
          {/* background baseline */}
          <line
            x1={PAD_L}
            x2={vw - PAD_R}
            y1={BAND_Y + BAND_H / 2}
            y2={BAND_Y + BAND_H / 2}
            className="fin-ro-axis-line"
          />

          {/* interval bands */}
          {live.map((iv, i) => {
            // an interval that began before today is drawn from today forward — only
            // the part you can still trade is claimed
            const x1 = Math.max(tx(iv.start), nowX);
            const x2 = tx(iv.end);
            const bw = Math.max(x2 - x1, 2);
            const isBull = iv.dir === "bull";

            // derive confidence from the bucket views for this interval
            const confScores = iv.buckets.map((bl) => {
              const bv = bucketByLabel[bl];
              if (!bv) return 0;
              return bv.confidence === "high" ? 3 : bv.confidence === "medium" ? 2 : 1;
            });
            const intervalConf =
              iv.confidence === "high" ? 3 : iv.confidence === "medium" ? 2 : iv.confidence === "low" ? 1 : null;
            const minConf = intervalConf ?? (confScores.length ? Math.min(...confScores) : 1);
            const opacity = minConf === 3 ? 0.75 : minConf === 2 ? 0.55 : 0.38;

            const pctTxt = P(iv.typical_move ?? iv.expected_move);
            const wrTxt = iv.win_rate != null ? `${Math.round(iv.win_rate * 100)}%` : "";

            return (
              <g key={i}>
                <rect
                  x={x1}
                  y={BAND_Y}
                  width={bw}
                  height={BAND_H}
                  fill={isBull ? "var(--up)" : "var(--down)"}
                  fillOpacity={opacity}
                  rx={3}
                  className="fin-ro-band"
                  data-bucket-count={iv.buckets.length}
                  onPointerMove={(e: RPointerEvent<SVGRectElement>) => {
                    show(
                      e,
                      `${iv.start} → ${iv.end}`,
                      forwardSeasonalTooltipRows(iv, zh),
                    );
                  }}
                  onPointerLeave={hide}
                />
                {/* label inside band if wide enough */}
                {bw > 42 && (
                  <text
                    x={x1 + bw / 2}
                    y={BAND_Y + BAND_H / 2 - 6}
                    textAnchor="middle"
                    className="fin-ro-band-pct"
                    fill={isBull ? "var(--up)" : "var(--down)"}
                  >
                    {pctTxt}
                  </text>
                )}
                {bw > 42 && wrTxt && (
                  <text
                    x={x1 + bw / 2}
                    y={BAND_Y + BAND_H / 2 + 9}
                    textAnchor="middle"
                    className="fin-ro-band-wr"
                  >
                    {wrTxt}
                  </text>
                )}
              </g>
            );
          })}

          {/* month ticks */}
          {tickDates.map((d, i) => {
            const xp = tx(d.toISOString().slice(0, 10));
            const isYear = d.getUTCMonth() === 0;
            const showLabel = labelledTicks.has(d.getTime());
            return (
              <g key={i} pointerEvents="none">
                <line
                  x1={xp}
                  x2={xp}
                  y1={BAND_Y}
                  y2={BAND_Y + BAND_H}
                  className={isYear ? "fin-ro-tick-year" : "fin-ro-tick"}
                />
                {showLabel && (
                  <text
                    x={xp}
                    y={TICK_Y}
                    textAnchor="middle"
                    className={isYear ? "fin-ro-tick-lbl-year" : "fin-ro-tick-lbl"}
                  >
                    {tickLabel(d, zh)}
                  </text>
                )}
              </g>
            );
          })}

          {/* "today" marker — the real one, clamped into view */}
          <line
            x1={nowX}
            x2={nowX}
            y1={BAND_Y - 4}
            y2={BAND_Y + BAND_H + 4}
            className="fin-ro-now"
          />
          <text
            x={nowLblRight ? nowX - 3 : nowX + 3}
            y={BAND_Y - 6}
            textAnchor={nowLblRight ? "end" : "start"}
            className="fin-ro-now-lbl"
          >
            {pick(zh, "today", "今天")}
          </text>
        </svg>
      </div>
      <FinTip tip={tip} />
    </div>
  );
}

/* ── validation strip ────────────────────────────────────────────────────── */
function ValidationStrip({ val, zh }: { val: Validation; zh: boolean }) {
  const verdictColor =
    val.verdict === "edge"
      ? "var(--up)"
      : val.verdict === "anti"
      ? "var(--down)"
      : "var(--muted)";

  const verdictTxt =
    val.verdict === "edge"
      ? pick(zh, "EDGE", "有优势")
      : val.verdict === "no_edge"
      ? pick(zh, "NO EDGE", "无优势")
      : val.verdict === "anti"
      ? pick(zh, "ANTI", "反向")
      : pick(zh, "UNTESTED", "未验证");

  const skillGloss =
    val.skill == null || val.verdict === "untested"
      ? pick(zh, "Insufficient out-of-sample history to assess skill.", "样本外历史不足，无法评估技能。")
      : val.verdict === "edge"
      ? pick(
          zh,
          "Regime-weighting beat the plain all-years seasonal out-of-sample.",
          "制度加权在样本外优于全年平均季节性。"
        )
      : val.verdict === "anti"
      ? pick(
          zh,
          "Regime-weighting underperformed the plain all-years seasonal out-of-sample.",
          "制度加权在样本外表现逊于全年平均季节性。"
        )
      : pick(
          zh,
          "Regime-weighting matched but did not beat the plain all-years seasonal out-of-sample.",
          "制度加权与全年平均季节性持平，但未超越。"
        );
  const better = val.regime_better_years;
  const worse = val.baseline_better_years;
  const ci =
    val.skill_ci_lo != null && val.skill_ci_hi != null
      ? `${HIT_DELTA(val.skill_ci_lo)} … ${HIT_DELTA(val.skill_ci_hi)}`
      : "—";

  return (
    <div className="fin-ro-val">
      <div className="fin-ro-val-head">
        <strong>{pick(zh, "Year-level validation", "年度层级验证")}</strong>
        <span className="fin-ro-verdict-chip" style={{ color: verdictColor, borderColor: verdictColor }}>
          {verdictTxt}
        </span>
      </div>
      <div className="fin-ro-val-grid">
        <span>
          <b>{better != null && worse != null ? `${better}–${worse}` : `${val.loyo_years}y`}</b>
          {pick(zh, " better–worse years", " 优于–劣于年份")}
        </span>
        <span>
          <b>{HIT_DELTA(val.skill)}</b>
          {pick(zh, " average lift", " 平均提升")}
        </span>
        <span>
          <b>{ci}</b>
          {pick(zh, " 90% range", " 90% 区间")}
        </span>
      </div>
      <span className="fin-ro-val-gloss">{skillGloss}</span>
    </div>
  );
}

/* ── analog chips ────────────────────────────────────────────────────────── */
function AnalogChips({
  analogs,
  relaxedFilters,
  nEff,
  zh,
}: {
  analogs: Analog[];
  relaxedFilters: string[];
  nEff: number;
  zh: boolean;
}) {
  if (analogs.length === 0) return null;

  const topAnalogs = analogs.slice().sort((a, b) => b.weight - a.weight).slice(0, 10);
  const maxW = topAnalogs[0]?.weight ?? 1;

  return (
    <div className="fin-ro-analogs">
      <div className="fin-ro-analogs-label">
        {pick(zh, `Regime-analog years (n_eff ${nEff.toFixed(1)})`, `制度类比年份 (n_eff ${nEff.toFixed(1)})`)}
      </div>
      <div className="fin-ro-analog-chips">
        {topAnalogs.map((a) => {
          const isWarning = a.is_recession || a.flags.length > 0 || a.whipsaw;
          const tipText = `${cyclePosLabel(a.cycle_pos, zh)} · ${rateDirLabel(a.rate_dir, zh)}${a.is_recession ? (zh ? " · 衰退" : " · Recession") : ""}${a.whipsaw ? (zh ? " · 利率反复" : " · Whipsaw") : ""}${a.provisional ? (zh ? " · 暂定" : " · provisional") : ""}`;
          return (
            <span key={a.year} className="fin-ro-analog-chip" title={tipText}>
              <span className="fin-ro-analog-year">{a.year}</span>
              <span
                className="fin-ro-analog-wbar"
                style={{ width: `${Math.round((a.weight / maxW) * 24)}px` } as CSSProperties}
              />
              {isWarning && <span className="fin-ro-analog-warn" title={pick(zh, "Recession / anomaly flag", "衰退/异常标志")}>●</span>}
            </span>
          );
        })}
      </div>
      {relaxedFilters.length > 0 && (
        <div className="fin-ro-relaxed">
          {pick(zh, "Analog floor relaxed: ", "类比门槛已放宽：")}
          {relaxedFilters.join(", ")}
          {pick(zh, " — confidence capped", " — 置信度上限")}
        </div>
      )}
    </div>
  );
}
