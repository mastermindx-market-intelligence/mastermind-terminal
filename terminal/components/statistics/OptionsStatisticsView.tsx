"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flowGet } from "@/lib/flowClientCache";
import { useLang } from "@/lib/i18n";
import { GEX_AUTOCOMPLETE_ROOTS } from "@/lib/optionsRoots";
import { trackSearch } from "@/lib/searchTrack";
import type { AggTrendPayload } from "@/lib/aggTrend";
import type { VolPayload } from "@/components/vol/volTypes";
import {
  absoluteSpotMoveStats,
  admitAggPayload,
  admitMovesPayload,
  admitVolPayload,
  finiteAggStats,
  histogram,
  percentileOf,
  sourceReceipts,
  type MovesPayload,
} from "@/lib/optionsStatistics";
import s from "./OptionsStatisticsView.module.css";

const DEFAULT_ROOT = "SPY";
const GREEKS = ["gamma", "delta", "vanna", "charm", "vega"] as const;

type Lang = "en" | "zh";

const COPY = {
  en: {
    input: "Statistics root",
    expectedEyebrow: "EXPECTED MOVE · PUBLISHED CALIBRATION",
    expectedTitle: "Expected move and historical containment",
    expectedSub: "Current nightly band beside the publisher's historical containment measurement.",
    expected: "Expected move",
    band: "Price band",
    spot: "Spot reference",
    multiplier: "Band multiplier",
    containment: "Contained historically",
    interval: "Published interval",
    sample: "Calibration sample",
    misses: "Misses shown",
    sessions: "sessions",
    calibrationNote: "Containment is a measurement about prior next-session ranges under the publisher's stated convention. It is not a win rate, probability forecast, trade signal, or target.",
    realizedEyebrow: "REALIZED SPOT MOVES · DESCRIPTIVE HISTORY",
    realizedTitle: "Where today's expected band sits in historical moves",
    realizedSub: "Absolute close-to-close spot moves from the separately dated aggregate-history series. This is not the publisher's intraday high/low containment statistic.",
    p50: "Median abs move",
    p90: "90th percentile",
    p95: "95th percentile",
    p99: "99th percentile",
    currentRank: "Expected-band percentile",
    currentRankSub: "vs close-to-close moves only",
    noDistribution: "Historical spot distribution unavailable for this root.",
    histAxis: "Absolute close-to-close move (%)",
    histCount: "Sessions",
    marker: "Current expected move",
    volEyebrow: "VOLATILITY · SOURCE-REPORTED",
    volTitle: "Volatility context",
    volSub: "Ranks and range are taken from the existing nightly volatility owner; the ATM tenor is not supplied here.",
    atmIv: "Headline ATM IV",
    rank252: "252-session IV rank",
    rankAll: "All-history IV rank",
    range52: "52-week IV range",
    rv20: "Trailing 20-return RV",
    ivRv: "Reported IV − RV20",
    greekEyebrow: "DEALER EXPOSURE · HISTORICAL DISTRIBUTION",
    greekTitle: "Where aggregate Greeks sat at their own source date",
    greekSub: "Publisher percentiles use the same dealer-sign convention through history. They are descriptive model context, not current trade direction.",
    percentile: "percentile",
    p05p95: "p05 / median / p95",
    greekUnavailable: "Aggregate Greek history unavailable.",
    sourceEyebrow: "SOURCE CLOCKS",
    sourceTitle: "Three existing owners, three independent dates",
    sourceSub: "Values are never restamped to make the sources look synchronized.",
    unavailable: "Unavailable",
    loading: "Loading statistics…",
    emptyTitle: "Statistics sources are unavailable for this root",
    emptyBody: "No synthetic replacement is shown. Try another covered root or return when the nightly sources publish.",
    regime: "Source regime",
    stickyRegime: "Positive gamma · range-dampening convention",
    slipperyRegime: "Negative gamma · trend-sensitive convention",
    unknownRegime: "Source regime unavailable",
    asof: "as of",
    movesReceipt: "{n} calibration sessions through {date}",
    volReceipt: "{n} supplied IV-history rows",
    aggReceipt: "{n} aggregate-history sessions",
    unitPrefix: "$bn dealer delta",
  },
  zh: {
    input: "统计标的",
    expectedEyebrow: "预期波动 · 已发布校准",
    expectedTitle: "预期波动与历史区间覆盖",
    expectedSub: "将当前夜间区间与发布方的历史覆盖测量并列展示。",
    expected: "预期波动",
    band: "价格区间",
    spot: "参考现价",
    multiplier: "区间倍数",
    containment: "历史区间覆盖",
    interval: "已发布区间",
    sample: "校准样本",
    misses: "未覆盖次数",
    sessions: "个交易日",
    calibrationNote: "区间覆盖只是发布方既定方法下，对过往下一交易日区间的测量。它不是胜率、概率预测、交易信号或目标价。",
    realizedEyebrow: "已实现现价波动 · 描述性历史",
    realizedTitle: "当前预期区间在历史波动中的位置",
    realizedSub: "使用独立日期的聚合历史序列计算绝对收盘到收盘波动；这不是发布方的日内高低区间覆盖统计。",
    p50: "绝对波动中位数",
    p90: "第90百分位",
    p95: "第95百分位",
    p99: "第99百分位",
    currentRank: "预期区间百分位",
    currentRankSub: "仅对比收盘到收盘波动",
    noDistribution: "该标的暂无历史现价分布。",
    histAxis: "绝对收盘波动（%）",
    histCount: "交易日",
    marker: "当前预期波动",
    volEyebrow: "波动率 · 来源报告",
    volTitle: "波动率背景",
    volSub: "排名与区间来自现有夜间波动率来源；此处未提供平值IV的期限。",
    atmIv: "报告平值IV",
    rank252: "252期IV排名",
    rankAll: "全历史IV排名",
    range52: "52周IV区间",
    rv20: "过去20个收益率RV",
    ivRv: "报告IV − RV20",
    greekEyebrow: "做市商敞口 · 历史分布",
    greekTitle: "聚合Greeks在其来源日期的历史位置",
    greekSub: "发布方百分位在历史上使用同一做市商符号假设。它只是描述性模型背景，不代表当前交易方向。",
    percentile: "百分位",
    p05p95: "p05 / 中位数 / p95",
    greekUnavailable: "暂无聚合Greek历史。",
    sourceEyebrow: "来源时钟",
    sourceTitle: "三个既有来源，三个独立日期",
    sourceSub: "不会重置时间戳来伪装来源同步。",
    unavailable: "不可用",
    loading: "正在加载统计…",
    emptyTitle: "该标的暂无统计来源",
    emptyBody: "不会使用合成值替代。请选择其他已覆盖标的，或等待夜间来源发布。",
    regime: "来源状态",
    stickyRegime: "正Gamma · 区间抑制惯例",
    slipperyRegime: "负Gamma · 趋势敏感惯例",
    unknownRegime: "来源状态不可用",
    asof: "截至",
    movesReceipt: "{n} 个校准交易日，截至 {date}",
    volReceipt: "{n} 条已提供IV历史记录",
    aggReceipt: "{n} 个聚合历史交易日",
    unitPrefix: "十亿美元做市商Delta",
  },
} as const;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const pct = (value: number | null | undefined, digits = 1) => finite(value) ? `${value.toFixed(digits)}%` : "—";
const pctFrac = (value: number | null | undefined, digits = 1) => finite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
const money = (value: number | null | undefined) => finite(value) ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—";
const num = (value: number | null | undefined, digits = 1) => finite(value) ? value.toFixed(digits) : "—";
const rank = (value: number | null | undefined) => finite(value) ? `${value.toFixed(1)}th` : "—";

export function OptionsStatisticsView() {
  const { lang } = useLang();
  const c = COPY[lang as Lang] ?? COPY.en;
  const [root, setRoot] = useState(DEFAULT_ROOT);
  const [input, setInput] = useState(DEFAULT_ROOT);
  const [moves, setMoves] = useState<MovesPayload | null>(null);
  const [vol, setVol] = useState<VolPayload | null>(null);
  const [agg, setAgg] = useState<AggTrendPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    void (async () => {
      const settled = await Promise.allSettled([
        flowGet(`moves:${root}`),
        flowGet(`vol:${root}`),
        flowGet(`agg:${root}`),
      ]);
      if (requestRef.current !== request) return;
      const rawMoves = settled[0].status === "fulfilled" ? settled[0].value : null;
      const rawVol = settled[1].status === "fulfilled" ? settled[1].value : null;
      const rawAgg = settled[2].status === "fulfilled" ? settled[2].value : null;
      setMoves(admitMovesPayload(rawMoves, root));
      setVol(admitVolPayload(rawVol, root));
      setAgg(admitAggPayload(rawAgg, root));
      setLoading(false);
    })();
  }, [root]);

  const commitRoot = useCallback(() => {
    const next = input.trim().toUpperCase();
    if (!next || next === root) return;
    trackSearch(next, "options-statistics", input.trim() || undefined);
    setLoading(true);
    setMoves(null);
    setVol(null);
    setAgg(null);
    setRoot(next);
  }, [input, root]);

  const distribution = useMemo(() => absoluteSpotMoveStats(agg?.series), [agg]);
  const bins = useMemo(() => histogram(distribution?.values ?? [], 12), [distribution]);
  const expectedPct = moves?.expected_move?.pct ?? null;
  const expectedRank = useMemo(
    () => distribution && finite(expectedPct) ? percentileOf(expectedPct, distribution.values) : null,
    [distribution, expectedPct],
  );
  const receipts = useMemo(() => sourceReceipts(moves, vol, agg), [moves, vol, agg]);
  const hasAny = moves != null || vol != null || agg != null;

  return (
    <div className={s.root} data-testid="options-statistics-view">
      <div className={s.toolbar}>
        <div className={s.inputWrap}>
          <span className={s.inputIcon} aria-hidden="true">⌕</span>
          <input
            className={s.rootInput}
            list="options-statistics-roots"
            value={input}
            onChange={(event) => setInput(event.target.value.toUpperCase())}
            onBlur={commitRoot}
            onKeyDown={(event) => { if (event.key === "Enter") commitRoot(); }}
            aria-label={c.input}
            maxLength={12}
            spellCheck={false}
          />
          <datalist id="options-statistics-roots">
            {GEX_AUTOCOMPLETE_ROOTS.map((symbol) => <option key={symbol} value={symbol} />)}
          </datalist>
        </div>
        <div className={s.sourceSummary}>
          {receipts.map((receipt) => (
            <span className={s.sourceChip} key={receipt.source}>
              <span className={`${s.sourceDot}${receipt.available ? "" : ` ${s.sourceDotMissing}`}`} aria-hidden="true" />
              {receipt.source.toUpperCase()} · {receipt.available ? `${c.asof} ${receipt.asof ?? "—"}` : c.unavailable}
            </span>
          ))}
        </div>
      </div>

      <div className={s.body}>
        {loading && !hasAny ? <div className={s.empty}>{c.loading}</div> : !hasAny ? (
          <div className={s.empty}><div><strong>{c.emptyTitle}</strong>{c.emptyBody}</div></div>
        ) : (
          <>
            <div className={s.heroGrid}>
              <ExpectedMoveCard moves={moves} lang={lang as Lang} />
              <RealizedMoveCard distribution={distribution} bins={bins} expectedPct={expectedPct} expectedRank={expectedRank} lang={lang as Lang} />
            </div>
            <section className={`${s.card} ${s.section}`}>
              <Header eyebrow={c.volEyebrow} title={c.volTitle} sub={c.volSub} />
              <div className={s.volGrid}>
                <Metric label={c.atmIv} value={pct(vol?.atm_iv, 1)} sub={vol?.asof ? `${c.asof} ${vol.asof.slice(0, 10)}` : undefined} />
                <Metric label={c.rank252} value={rank(vol?.iv_rank_252)} />
                <Metric label={c.rankAll} value={rank(vol?.iv_rank_all)} sub={vol?.coverage_days_all ? `${vol.coverage_days_all.toLocaleString()} ${c.sessions}` : undefined} />
                <Metric label={c.range52} value={`${pct(vol?.iv_52w_lo, 1)} – ${pct(vol?.iv_52w_hi, 1)}`} />
                <Metric label={c.rv20} value={pct(vol?.rv20, 1)} />
                <Metric label={c.ivRv} value={finite(vol?.vrp) ? `${vol.vrp! >= 0 ? "+" : ""}${vol.vrp!.toFixed(1)} pts` : "—"} />
              </div>
            </section>

            <section className={`${s.card} ${s.section}`}>
              <Header eyebrow={c.greekEyebrow} title={c.greekTitle} sub={c.greekSub} />
              {agg ? (
                <div className={s.greeksGrid}>
                  {GREEKS.map((greek) => <GreekCard key={greek} greek={greek} payload={agg} lang={lang as Lang} />)}
                </div>
              ) : <div className={s.chartEmpty}>{c.greekUnavailable}</div>}
            </section>

            <section className={`${s.card} ${s.section}`}>
              <Header eyebrow={c.sourceEyebrow} title={c.sourceTitle} sub={c.sourceSub} />
              <div className={s.receipts}>
                {receipts.map((receipt) => (
                  <div className={s.receipt} key={receipt.source}>
                    <div className={s.receiptTop}>
                      <span className={`${s.sourceDot}${receipt.available ? "" : ` ${s.sourceDotMissing}`}`} aria-hidden="true" />
                      <span className={s.receiptName}>{receipt.source}</span>
                      <span className={s.receiptDate}>{receipt.available ? receipt.asof ?? "—" : c.unavailable}</span>
                    </div>
                    <div className={s.receiptDetail}>{receiptDetail(receipt.source, moves, vol, agg, lang as Lang)}</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function receiptDetail(source: "moves" | "vol" | "agg", moves: MovesPayload | null, vol: VolPayload | null, agg: AggTrendPayload | null, lang: Lang): string {
  const c = COPY[lang];
  if (source === "moves") {
    if (!moves?.calibration) return c.unavailable;
    return c.movesReceipt.replace("{n}", moves.calibration.n_sessions.toLocaleString()).replace("{date}", moves.calibration.through);
  }
  if (source === "vol") {
    if (!vol?.history) return c.unavailable;
    return c.volReceipt.replace("{n}", vol.history.length.toLocaleString());
  }
  if (!agg?.n_days) return c.unavailable;
  return c.aggReceipt.replace("{n}", agg.n_days.toLocaleString());
}

function Header({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return <div className={s.cardHead}><div className={s.cardHeadCopy}><span className={s.eyebrow}>{eyebrow}</span><h2 className={s.cardTitle}>{title}</h2><p className={s.cardSub}>{sub}</p></div></div>;
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className={s.volCell}><span className={s.metricLabel}>{label}</span><span className={s.metricValue}>{value}</span>{sub && <span className={s.metricSub}>{sub}</span>}</div>;
}

function regimeLabel(value: string | null | undefined, lang: Lang): string {
  const c = COPY[lang];
  if (value === "sticky") return c.stickyRegime;
  if (value === "slippery") return c.slipperyRegime;
  return c.unknownRegime;
}

function ExpectedMoveCard({ moves, lang }: { moves: MovesPayload | null; lang: Lang }) {
  const c = COPY[lang];
  const expected = moves?.expected_move;
  const calibration = moves?.calibration;
  return (
    <section className={s.card}>
      <Header eyebrow={c.expectedEyebrow} title={c.expectedTitle} sub={c.expectedSub} />
      {expected && calibration ? (
        <>
          <div className={s.firstRead}>
            <div className={s.bigMetric}>
              <span className={s.bigLabel}>{c.expected}</span>
              <span className={s.bigValue}>±{pct(expected.pct, 2)}</span>
              <span className={s.band}>{c.band} · {money(expected.lo)} – {money(expected.hi)}</span>
              <span className={s.regime}>{c.spot} {money(moves?.spot_ref)} · {c.regime}: {regimeLabel(moves?.regime, lang)}</span>
            </div>
            <div className={s.calibration}>
              <Tile label={c.containment} value={pctFrac(calibration.contained_rate, 1)} sub={`${calibration.hits.toLocaleString()} / ${calibration.n_sessions.toLocaleString()} ${c.sessions}`} />
              <Tile label={c.interval} value={`${pctFrac(calibration.ci[0], 1)} – ${pctFrac(calibration.ci[1], 1)}`} sub={`${calibration.since} → ${calibration.through}`} />
              <Tile label={c.multiplier} value={`${num(calibration.band_mult, 2)}×`} sub={`${expected.horizon_days}d horizon`} />
              <Tile label={c.misses} value={calibration.misses.toLocaleString()} sub={`${calibration.n_sessions.toLocaleString()} ${c.sessions}`} />
            </div>
          </div>
          <p className={s.notice}>{c.calibrationNote}</p>
        </>
      ) : <div className={s.chartEmpty}>{c.unavailable}</div>}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className={s.metricTile}><span className={s.metricLabel}>{label}</span><span className={s.metricValue}>{value}</span>{sub && <span className={s.metricSub}>{sub}</span>}</div>;
}

function RealizedMoveCard({ distribution, bins, expectedPct, expectedRank, lang }: {
  distribution: ReturnType<typeof absoluteSpotMoveStats>;
  bins: ReturnType<typeof histogram>;
  expectedPct: number | null;
  expectedRank: number | null;
  lang: Lang;
}) {
  const c = COPY[lang];
  return (
    <section className={s.card}>
      <Header eyebrow={c.realizedEyebrow} title={c.realizedTitle} sub={c.realizedSub} />
      {distribution ? (
        <>
          <MoveHistogram bins={bins} expectedPct={expectedPct} lang={lang} />
          <div className={s.statsRow}>
            <Mini label={c.p50} value={pct(distribution.p50, 2)} />
            <Mini label={c.p90} value={pct(distribution.p90, 2)} />
            <Mini label={c.p95} value={pct(distribution.p95, 2)} />
            <Mini label={c.p99} value={pct(distribution.p99, 2)} />
            <Mini label={c.currentRank} value={finite(expectedRank) ? `${expectedRank.toFixed(1)}th` : "—"} sub={c.currentRankSub} />
          </div>
          <p className={s.notice}>{distribution.n.toLocaleString()} observations · {distribution.since ?? "—"} → {distribution.through ?? "—"}. {c.currentRankSub}.</p>
        </>
      ) : <div className={s.chartEmpty}>{c.noDistribution}</div>}
    </section>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className={s.mini}><div className={s.miniLabel}>{label}</div><div className={s.miniValue}>{value}</div>{sub && <div className={s.miniSub}>{sub}</div>}</div>;
}

function MoveHistogram({ bins, expectedPct, lang }: { bins: ReturnType<typeof histogram>; expectedPct: number | null; lang: Lang }) {
  const c = COPY[lang];
  if (!bins.length) return <div className={s.chartEmpty}>{c.noDistribution}</div>;
  const width = 720, height = 260, pad = { l: 48, r: 16, t: 22, b: 42 };
  const histMax = bins[bins.length - 1].hi;
  const xMax = Math.max(histMax, finite(expectedPct) ? expectedPct * 1.08 : 0, 0.1);
  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  const x = (value: number) => pad.l + (value / xMax) * (width - pad.l - pad.r);
  const y = (count: number) => pad.t + (1 - count / maxCount) * (height - pad.t - pad.b);
  const barGap = 2;
  const ticks = [0, .25, .5, .75, 1].map((fraction) => xMax * fraction);
  return (
    <div className={s.chartWrap}>
      <svg className={s.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${c.realizedTitle}. ${c.histAxis}`}>
        {ticks.map((tick) => <g key={tick}><line x1={x(tick)} x2={x(tick)} y1={pad.t} y2={height - pad.b} stroke="var(--grid)" opacity=".6" /><text x={x(tick)} y={height - 18} textAnchor="middle" fill="var(--muted)" fontSize="10">{tick.toFixed(tick < 1 ? 2 : 1)}%</text></g>)}
        {bins.map((bin, index) => {
          const left = x(bin.lo) + barGap / 2;
          const right = x(bin.hi) - barGap / 2;
          const top = y(bin.count);
          return <rect key={index} x={left} y={top} width={Math.max(1, right - left)} height={height - pad.b - top} rx="1" fill="var(--brand-2)" opacity=".68" />;
        })}
        {finite(expectedPct) && expectedPct >= 0 && expectedPct <= xMax && <g><line x1={x(expectedPct)} x2={x(expectedPct)} y1={pad.t} y2={height - pad.b} stroke="var(--warn)" strokeWidth="2" strokeDasharray="4 3" /><text x={Math.min(width - pad.r, x(expectedPct) + 5)} y={pad.t + 11} fill="var(--warn)" fontSize="10">{c.marker} {expectedPct.toFixed(2)}%</text></g>}
        <text x={(pad.l + width - pad.r) / 2} y={height - 3} textAnchor="middle" fill="var(--muted)" fontSize="10">{c.histAxis}</text>
      </svg>
    </div>
  );
}

function GreekCard({ greek, payload, lang }: { greek: typeof GREEKS[number]; payload: AggTrendPayload; lang: Lang }) {
  const c = COPY[lang];
  const stats = finiteAggStats(payload, greek);
  const label = greek.charAt(0).toUpperCase() + greek.slice(1);
  if (!stats) return <div className={s.greekCard}><div className={s.greekTop}><span className={s.greekName}>{label}</span><span className={s.greekPct}>—</span></div><div className={s.greekRange}>{c.unavailable}</div></div>;
  return (
    <div className={s.greekCard}>
      <div className={s.greekTop}><span className={s.greekName}>{label}</span><span className={s.greekPct}>{finite(stats.pctile) ? `${stats.pctile.toFixed(1)}th` : "—"}</span></div>
      <div className={s.greekRange}>{c.p05p95}<br />{num(stats.p05, 2)} / {num(stats.p50, 2)} / {num(stats.p95, 2)}<br />n={stats.n.toLocaleString()}<br />{c.unitPrefix} · {payload.units?.[greek] ?? "—"}</div>
    </div>
  );
}
