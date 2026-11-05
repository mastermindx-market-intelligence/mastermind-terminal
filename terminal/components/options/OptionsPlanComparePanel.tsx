"use client";

import { useId, useRef, useState } from "react";
import { useChartWidth, niceTicks, padDomain, fmtTick } from "@/components/charts/svgChart";
import { comparePlanScenarios, type QualifiedPlanScenario } from "@/lib/optionsPlanScenarioCompare";
import styles from "./OptionsPlanPayoffPanel.module.css";

type Props = {
  lang: "en" | "zh";
  baseline: QualifiedPlanScenario | null;
  candidate: QualifiedPlanScenario | null;
  onPin: () => void;
  onClear: () => void;
  /** Original native account/selection lifetime; false is permanent for this mount. */
  isScopeCurrent?: () => boolean;
};

const money = (v: number, lang: "en" | "zh") => new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
}).format(v);

function Overlay({ data, lang }: {
  data: Extract<ReturnType<typeof comparePlanScenarios>, { ok: true }>;
  lang: "en" | "zh";
}) {
  const id = useId(), outer = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const width = Math.max(240, useChartWidth(outer)), height = 256;
  const left = width < 350 ? 52 : width < 500 ? 66 : 84, right = 20, top = 28, bottom = 42;
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  const visible = (() => {
    if (full) return data.spots.map((_, i) => i);
    const anchors = data.anchors.filter(v => Number.isFinite(v) && v >= data.spots[0]
      && v <= data.spots[data.spots.length - 1]);
    if (!anchors.length) return data.spots.map((_, i) => i);
    const low = Math.min(...anchors), high = Math.max(...anchors);
    const pad = Math.max((high - low) * 0.75, Math.max(Math.abs(low), Math.abs(high), 1) * 0.005);
    const start = Math.max(0, data.spots.findIndex(v => v >= low - pad) - 1);
    const rightEdge = data.spots.findIndex(v => v > high + pad);
    const end = rightEdge < 0 ? data.spots.length : Math.min(data.spots.length, rightEdge + 1);
    return data.spots.map((_, i) => i).slice(start, end);
  })();
  const spots = visible.map(i => data.spots[i]);
  const baseline = visible.map(i => data.baselinePnl[i]);
  const candidate = visible.map(i => data.candidatePnl[i]);
  const [x0, x1] = padDomain(spots[0], spots[spots.length - 1], { padFrac: 0 });
  const [y0, y1] = padDomain(Math.min(0, ...baseline, ...candidate),
    Math.max(0, ...baseline, ...candidate), { includeZero: true });
  const x = (v: number) => left + (v - x0) / Math.max(0.001, x1 - x0) * (width - left - right);
  const y = (v: number) => height - bottom - (v - y0) / Math.max(0.001, y1 - y0) * (height - top - bottom);
  const line = (values: readonly number[]) => spots.map((spot, i) => String(x(spot)) + "," + String(y(values[i]))).join(" ");
  const ticksY = niceTicks(y0, y1, 4), ticksX = niceTicks(x0, x1, 4);
  return <div ref={outer} className={styles.overlay} data-testid="plan-compare-overlay" data-chart-range={full ? "full" : "focus"}>
    <svg viewBox={"0 0 " + width + " " + height} width={width} height={height} role="img"
      aria-labelledby={id + "-title " + id + "-desc"}>
      <title id={id + "-title"}>{t("Two hypothetical expiry P/L curves on identical underlying prices", "相同假设标的价格下的两条到期损益曲线")}</title>
      <desc id={id + "-desc"}>{t("Baseline dashed; revised calculation solid. Lines connect actual samples; no repricing or interpolation is used to calculate P/L.", "基线为虚线，修订计算为实线。连接原始样本点，不重新定价或插值计算损益。")}</desc>
      {ticksY.values.map(v => <g key={v}><line className={styles.grid} x1={left} x2={width - right} y1={y(v)} y2={y(v)} />
        <text x={left - 8} y={y(v) + 4} textAnchor="end">{fmtTick(v, ticksY.step)}</text></g>)}
      {ticksX.values.map(v => <text key={v} x={x(v)} y={height - bottom + 20} textAnchor="middle">{fmtTick(v, ticksX.step)}</text>)}
      {y0 < 0 && y1 > 0 && <line className={styles.zero} x1={left} x2={width - right} y1={y(0)} y2={y(0)} />}
      <polyline className={styles.baselineLine} points={line(baseline)} fill="none" />
      <polyline className={styles.candidateLine} points={line(candidate)} fill="none" />
      <text x={(left + width - right) / 2} y={height - 4} textAnchor="middle">
        {t("Underlying at expiry (USD)", "到期标的价格（美元）")}
      </text>
    </svg>
    <button type="button" className={styles.actionSecondary} onClick={() => setFull(v => !v)} aria-pressed={full}
      data-testid="plan-compare-range">
      {full ? t("Focus strikes & breakevens", "聚焦行权价与盈亏平衡点") : t("Show full sampled range", "显示全部样本范围")}
    </button>
  </div>;
}

/** Explicit local-only comparison. No fetch, Save, watch or repricing happens
 * here. Baseline and candidate are trusted only after the original endpoint's
 * request-bound response validator has accepted both exact results. */
export function OptionsPlanComparePanel({ lang, baseline, candidate, onPin, onClear, isScopeCurrent }: Props) {
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  const heading = useRef<HTMLHeadingElement>(null);
  // Incumbent native lifetime is monotonic: once retired, it cannot be reused without a scopeKey remount.
  if (isScopeCurrent?.() === false) return null;
  const side = (value: "buy" | "sell" | null) => value === "buy" ? t("Buy", "买入") : value === "sell" ? t("Sell", "卖出") : "—";
  const comparison = baseline && candidate && baseline !== candidate ? comparePlanScenarios(baseline, candidate) : null;
  const refused = comparison && !comparison.ok;
  const reason = refused ? ({
    contract_changed: t("Exact contracts or original evidence changed. Start a new baseline.", "合约或原始证据已改变，请重新设定基线。"),
    reference_changed: t("Reference date or source changed. These curves cannot be overlaid.", "参考日期或来源已改变，无法叠加曲线。"),
    axis_changed: t("The calculation used different price samples. Comparison is withheld.", "计算价格样本不同，暂不比较。"),
    invalid_result: t("A calculation could not be verified. Comparison is withheld.", "计算结果无法核验，暂不比较。"),
  } as const)[comparison.reason] : null;
  return <section className={styles.comparePanel} aria-label={t("Research scenario comparison", "研究情景对比")} data-testid="plan-scenario-compare">
    <div className={styles.compareHead}>
      <div>
        <h3 ref={heading} tabIndex={-1}>{t("Compare assumptions", "对比假设")}</h3>
        <p>{t("Same contracts, same dated terms. Hypothetical research only.", "相同合约、相同日期条款。仅供假设研究。")}</p>
      </div>
      <div className={styles.compareActions}>
        {candidate && <button type="button" className={styles.actionPrimary} onClick={onPin} data-testid="plan-pin-baseline">
          {baseline ? t("Replace baseline", "替换基线") : t("Pin baseline", "固定基线")}
        </button>}
        {baseline && <button type="button" className={styles.actionSecondary} onClick={() => { onClear(); heading.current?.focus({ preventScroll: true }); }} data-testid="plan-clear-baseline">
          {t("Clear baseline", "清除基线")}
        </button>}
      </div>
    </div>
    {!baseline && <p className={styles.compareEmpty}>
      {t("Calculate your Plan, then pin a baseline to compare a changed assumption.", "先计算计划并固定基线，再修改假设进行对比。")}
    </p>}
    {baseline && (!candidate || baseline === candidate) && <p role="status" className={styles.compareEmpty} data-testid="plan-baseline-pending">
      {t("Baseline pinned in this tab. Edit an assumption and calculate again. Pinning sends no Save or watch.", "基线已暂存在本页面。修改假设并再次计算；固定基线不会保存或设置监控。")}
    </p>}
    {refused && <p role="status" className={styles.compareEmpty} data-testid="plan-compare-withheld">{reason}</p>}
    {comparison?.ok && <>
      <p className={styles.compareBasis} data-testid="plan-comparison-basis">
        {t("Shared dated terms", "共同参考条款")}: {comparison.root} · <bdi>{comparison.expiration}</bdi> ·
        <bdi> {comparison.referenceAsOf}</bdi> · {t("Captured", "采集")} <bdi>{comparison.referenceObservedAt}</bdi>
      </p>
      <details className={styles.scenarioDetails} data-testid="plan-comparison-clocks">
        <summary>{t("Calculation times", "计算时间")}</summary>
        <p className={styles.compareBasis}>{t("Baseline calculated at", "基线计算时间")}: <bdi>{comparison.baselineKnownBy}</bdi></p>
        <p className={styles.compareBasis}>{t("Revised calculated at", "修订计算时间")}: <bdi>{comparison.candidateKnownBy}</bdi></p>
      </details>
      <div className={styles.compareLegend}>
        <span><i className={styles.baselineSwatch}/>{t("Pinned baseline", "固定基线")}</span>
        <span><i className={styles.candidateSwatch}/>{t("Revised hypothesis", "修订假设")}</span>
      </div>
      <div className={styles.sampleSummary} data-testid="plan-comparison-sample">
        <p>{t("At sampled underlying", "假设标的样本价格")} <bdi>{money(comparison.sample.spot, lang)}</bdi></p>
        <dl>
          <div><dt>{t("Baseline P/L", "基线损益")}</dt><dd>{money(comparison.sample.baselinePnl, lang)}</dd></div>
          <div><dt>{t("Revised P/L", "修订损益")}</dt><dd>{money(comparison.sample.candidatePnl, lang)}</dd></div>
          <div><dt>{t("Scenario difference", "情景差额")}</dt><dd>{money(comparison.sample.deltaPnl, lang)}</dd></div>
        </dl>
      </div>
      <Overlay data={comparison} lang={lang} />
      <h4>{t("What changed", "假设变化")}</h4>
      {comparison.changes.some(x => x.changed) ? <div className={styles.comparisonTableWrap} tabIndex={0} role="region" aria-label={t("Assumption differences table", "假设差异表")}>
        <table className={styles.comparisonTable} data-testid="plan-assumption-diff">
          <caption>{t("Differences are user-authored assumptions, not market-price moves.", "差异来自用户假设，不代表市场价格变动。")}</caption>
          <thead><tr><th scope="col">{t("Contract", "合约")}</th><th scope="col">{t("Baseline", "基线")}</th><th scope="col">{t("Revised", "修订")}</th></tr></thead>
          <tbody>{comparison.changes.filter(x => x.changed).map(x => <tr key={x.identity.key}>
            <th scope="row"><bdi>{x.identity.root} · {x.identity.exp} · {x.identity.strike} · {x.identity.right === "C" ? t("Call", "看涨") : t("Put", "看跌")}</bdi></th>
            <td>{t("Side", "方向")}: {side(x.side.before)} · {t("Contracts", "张数")}: {x.quantity.before ?? "—"} · {t("Entry USD/unit", "入场美元/单位")}: {x.entry.before ?? "—"}</td>
            <td>{t("Side", "方向")}: {side(x.side.after)} · {t("Contracts", "张数")}: {x.quantity.after ?? "—"} · {t("Entry USD/unit", "入场美元/单位")}: {x.entry.after ?? "—"}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p>{t("No authored assumption changed. The calculations match the same scenario.", "用户假设未变化；两个计算对应相同情景。")}</p>}
      <details className={styles.scenarioDetails}>
        <summary>{t("All exact scenario prices and P/L", "查看全部精确情景价格与损益")}</summary>
        <div className={styles.comparisonTableWrap} tabIndex={0} role="region" aria-label={t("All exact scenario values", "全部精确情景数值")}>
          <table className={styles.comparisonTable} data-testid="plan-comparison-points">
            <caption>{t("Unrounded API values in USD. Difference is revised minus baseline, not an executable return.", "未四舍五入的API美元数值。差额为修订减基线，不代表可执行收益。")}</caption>
            <thead><tr><th scope="col">{t("Underlying", "标的价格")}</th><th scope="col">{t("Baseline P/L", "基线损益")}</th><th scope="col">{t("Revised P/L", "修订损益")}</th><th scope="col">{t("Difference", "差额")}</th></tr></thead>
            <tbody>{comparison.spots.map((spot, i) => <tr key={i}><th scope="row">{String(spot)}</th>
              <td>{String(comparison.baselinePnl[i])}</td><td>{String(comparison.candidatePnl[i])}</td>
              <td>{String(comparison.deltaPnl[i])}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
      <p className={styles.compareFootnote}>{t("No fees, early exercise, assignment, current quotes or trading execution. Pinning does not save or create a watch; existing saved research is unchanged.", "不包含费用、提前行权、指派、当前报价或交易执行。固定基线不会保存或设置监控，已有研究记录保持不变。")}</p>
    </>}
  </section>;
}
