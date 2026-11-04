"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { OptionsPlanDraftEditor } from "./OptionsPlanDraftEditor";
import { preparePlanExpiryRequest, readPlanPayoff, planPayoffView, type PlanPayoff, type PlanReferenceCoverage } from "@/lib/optionsPlanPayoff";
import { capturePlanExpiryObservation, comparePlanEntryAssumptions, type PlanExpiryObservation } from "@/lib/optionsPlanRobustness";
import type { OptionsPlanDraft } from "@/lib/optionsPlanDraft";
import { useChartWidth, niceTicks, padDomain, thinLabels, fmtTick } from "@/components/charts/svgChart";
import styles from "./OptionsPlanPayoffPanel.module.css";

const money = (v: number, lang: "en" | "zh") => new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
function ExpiryCurve({ result, lang, strikes }: { result: PlanPayoff; lang: "en" | "zh"; strikes: number[] }) {
  const ref = useRef<HTMLDivElement>(null), width = useChartWidth(ref), height = 270, id = useId();
  const [full, setFull] = useState(false);
  const view = planPayoffView(result.curve, strikes, full), xValues = view.spots, yValues = view.pnl;
  const [x0, x1] = padDomain(Math.min(...xValues), Math.max(...xValues), { padFrac: 0 });
  const [y0, y1] = padDomain(Math.min(...yValues), Math.max(...yValues), { includeZero: true });
  const left = width < 450 ? 64 : 82, right = 20, top = 42, bottom = 48;
  const x = (v: number) => left + (v - x0) / (x1 - x0) * (width - left - right);
  const y = (v: number) => height - bottom - (v - y0) / (y1 - y0) * (height - top - bottom);
  const xt = niceTicks(x0, x1, 5), yt = niceTicks(y0, y1, 4);
  const points = xValues.map((v, i) => `${x(v)},${y(yValues[i])}`).join(" ");
  const zero = Math.min(height - bottom, Math.max(top, y(0)));
  const area = `${x(xValues[0])},${zero} ${points} ${x(xValues[xValues.length - 1])},${zero}`;
  const breakevens = result.curve.breakevens.filter(v => x0 <= v && v <= x1);
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  return <div className={styles.chart} ref={ref} data-testid="plan-expiry-chart" data-view-low={x0} data-view-high={x1}>
    <div className={styles.legend}>
      <span><i className={styles.lossKey} />{t("Loss below $0", "零以下为亏损")}</span>
      <span><i className={styles.profitKey} />{t("Profit above $0", "零以上为盈利")}</span>
    </div>
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>{t("Conditional expiry profit and loss in USD", "美元条件到期损益")}</title>
      <desc id={`${id}-description`}>{t("Hypothetical underlying prices", "假设标的价格")}: {x0}–{x1}. {t("Marked breakeven", "标记的盈亏平衡点")}: {breakevens.join(" / ") || t("outside this view or no crossing", "当前视图之外或无平衡点")}.</desc>
      <defs>
        <clipPath id={`${id}-profit`}><rect x={left} y={top} width={width - left - right} height={Math.max(0, zero - top)} /></clipPath>
        <clipPath id={`${id}-loss`}><rect x={left} y={zero} width={width - left - right} height={Math.max(0, height - bottom - zero)} /></clipPath>
      </defs>
      <text x={left} y={16}>{t("Profit / loss (USD)", "损益（美元）")}</text>
      {yt.values.map(v => <g key={v}><line x1={left} x2={width - right} y1={y(v)} y2={y(v)} className={styles.grid} /><text x={left - 8} y={y(v) + 4} textAnchor="end">{fmtTick(v, yt.step)}</text></g>)}
      {thinLabels(xt.values, x, 66).map(v => <text key={v} x={x(v)} y={height - bottom + 20} textAnchor="middle">{fmtTick(v, xt.step)}</text>)}
      <polygon points={area} className={styles.profitArea} clipPath={`url(#${id}-profit)`} />
      <polygon points={area} className={styles.lossArea} clipPath={`url(#${id}-loss)`} />
      {y0 < 0 && y1 > 0 && <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} className={styles.zero} />}
      <polyline points={points} fill="none" className={styles.profitCurve} clipPath={`url(#${id}-profit)`} />
      <polyline points={points} fill="none" className={styles.lossCurve} clipPath={`url(#${id}-loss)`} />
      {thinLabels(breakevens, x, 110).map(v => <g key={v} data-testid="plan-breakeven-marker">
        <line x1={x(v)} x2={x(v)} y1={top} y2={height - bottom} className={styles.breakeven} />
        <circle cx={x(v)} cy={y(0)} r={4} className={styles.breakevenDot} />
        <text x={Math.min(width - right - 52, Math.max(left + 52, x(v)))} y={top - 10} textAnchor="middle">{t("Breakeven", "盈亏平衡")}: {money(v, lang)}</text>
      </g>)}
      <text x={(left + width - right) / 2} y={height - 5} textAnchor="middle">{t("Hypothetical underlying price at expiry (USD)", "假设到期标的价格（美元）")}</text>
    </svg>
    <button type="button" className="chip" onClick={() => setFull(v => !v)} aria-pressed={full}>
      {full ? t("Focus strikes and breakevens", "聚焦行权价与盈亏平衡点") : t("Show full hypothetical range", "显示完整假设范围")}
    </button>
  </div>;
}

type Props = {
  draft: OptionsPlanDraft; lang: "en" | "zh";
  /** Non-secret account + retained-selection identity from the authenticated host. */
  scopeKey: string;
  onDraftChange: (draft: OptionsPlanDraft) => void;
  /** Current editor inputs, independent of the last applied calculation. */
  onDraftInputChange?: (draft: OptionsPlanDraft | null) => void;
  onClose: () => void;
};

/** A new account or retained selection gets a fresh editor/result controller.
 * onDraftChange returns the unchanged canonical payload to the existing Save
 * owner. This panel writes no local/cloud storage and invents no Save action. */
export function OptionsPlanPayoffPanel(props: Props) {
  return <PlanPayoffBody key={props.scopeKey} {...props} />;
}
function PlanPayoffBody({ draft, lang, onDraftChange, onDraftInputChange, onClose }: Props) {
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  const [result, setResult] = useState<PlanPayoff | null>(null);
  const [observation, setObservation] = useState<PlanExpiryObservation | null>(null);
  const [baseline, setBaseline] = useState<PlanExpiryObservation | null>(null);
  const comparison = baseline && observation ? comparePlanEntryAssumptions(baseline, observation) : null;
  const [coverage, setCoverage] = useState<PlanReferenceCoverage | null>(null);
  const [status, setStatus] = useState("idle"), [reason, setReason] = useState("");
  const answer = useRef<HTMLHeadingElement>(null);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => () => { sequence.current++; controller.current?.abort(); }, []);
  useEffect(() => { if (result) answer.current?.focus(); }, [result]);
  const calculate = async (candidate: OptionsPlanDraft) => {
    controller.current?.abort(); const own = ++sequence.current;
    setResult(null); setObservation(null); setCoverage(null); setReason(""); onDraftChange(candidate);
    const request = preparePlanExpiryRequest(candidate);
    if (!request.ok) { setBaseline(null); setStatus("incomplete"); setReason(request.reason); return; }
    setStatus("loading"); controller.current = new AbortController();
    try {
      const response = await fetch("/api/options/plan/expiry", { method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.value), signal: controller.current.signal });
      if (own !== sequence.current) return;
      if (!response.ok) {
        // Only the fixed proxy emits this small allowlisted summary. Revalidate
        // its shape before rendering; never render arbitrary upstream text.
        const body = await response.json().catch(() => null);
        if (own !== sequence.current) return;
        const c = body?.coverage;
        if (c && (c.root === "SPY" || c.root === "QQQ") && Number.isInteger(c.contract_count) && c.contract_count >= 1 && c.contract_count <= 100
          && Array.isArray(c.expirations) && c.expirations.length > 0 && c.expirations.length <= 100
          && c.expirations.every((v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))
          && typeof c.as_of === "string" && typeof c.captured_at === "string") setCoverage(c);
        setBaseline(null);
        setStatus(response.status === 401 || response.status === 403 ? "access" : "unavailable"); return;
      }
      const raw = await response.json();
      const parsed = readPlanPayoff(raw, request.value);
      if (own !== sequence.current) return;
      if (!parsed) { setBaseline(null); setStatus("unavailable"); return; }
      const captured = capturePlanExpiryObservation(request.value.draft, raw);
      if (!captured) { setBaseline(null); setStatus("unavailable"); return; }
      setObservation(captured);
      setResult(parsed); setCoverage({ root: parsed.source_boundary.reference_root, contract_count: parsed.source_boundary.reference_contract_count,
        expirations: parsed.source_boundary.reference_expirations, as_of: parsed.source_boundary.reference_as_of, captured_at: parsed.source_boundary.reference_observed_at }); setStatus("ready");
    } catch { if (own === sequence.current) { setBaseline(null); setStatus("unavailable"); } }
  };
  const bound = (v: number | "UNBOUNDED", loss: boolean) => v === "UNBOUNDED" ? t(loss ? "Unbounded loss" : "Unbounded gain", loss ? "亏损无上限" : "收益无上限") : money(v, lang);
  const incomplete = reason === "expiry" ? t("Use contracts with the same expiry for this curve.", "此曲线须使用相同到期日的合约。")
    : reason === "unsupported" ? t("Expiry terms are currently supported for ordinary SPY and QQQ contracts.", "当前到期条款支持标准SPY及QQQ合约。")
      : t("Enter a side, whole contract quantity and your USD entry assumption for every leg.", "请为每条腿填写方向、合约整数数量及美元入场价假设。");
  return <section className={styles.panel} data-testid="options-plan-payoff-panel" aria-label={t("Exact-contract Plan", "精确合约计划")}>
    <OptionsPlanDraftEditor layout="planning" draft={draft} lang={lang} onApply={candidate => { void calculate(candidate); }} onClose={onClose}
      onEdit={candidate => { onDraftInputChange?.(candidate); sequence.current++; controller.current?.abort(); setResult(null); setObservation(null); setCoverage(null); setStatus("idle"); }}
      applyLabel={t("Calculate expiry payoff", "计算到期损益")}
      contextDescription={t("Use your entry assumptions for a conditional expiry outcome. Current executable quotes are unavailable.", "用个人入场假设研究条件到期结果；当前可成交报价不可用。")} />
    <div className={styles.answer} aria-live="polite" aria-busy={status === "loading"}>
      <h2 ref={answer} tabIndex={-1}>{t("Expiry payoff", "到期损益")}</h2>
      {status === "idle" && <p>{t("Set your assumptions, then calculate a conditional expiry curve.", "填写假设后，可计算条件到期曲线。")}</p>}
      {status === "loading" && <p role="status">{t("Checking contract terms…", "正在核验合约条款……")}</p>}
      {status === "incomplete" && <p role="alert">{incomplete}</p>}
      {status === "access" && <p role="alert">{t("Sign in with Options access to check terms. Your draft stays here.", "请使用有期权访问权限的账户登录以核验条款，草稿仍保留在此处。")}</p>}
      {status === "unavailable" && <p role="alert">{t("Contract terms unavailable. Your draft is kept here; check the selected contracts before calculating again.", "合约条款暂不可用。草稿仍保留在此处；再次计算前请核对所选合约。")}</p>}
      {baseline && <button type="button" className="chip" onClick={() => setBaseline(null)}>{t("Clear baseline", "清除基准")}</button>}
      {baseline && !observation && <p>{t("Entry baseline kept for this Plan. Calculate again to compare the same contracts and dated terms.", "已保留本计划的入场基准。再次计算可对比相同合约及带日期条款。")}</p>}
      {comparison?.state === "unavailable" && <p role="status">{t("The contracts, source terms or price grid changed. Keep a new baseline to compare entries.", "合约、来源条款或价格网格已变化，请重新设置基准后对比入场假设。")}</p>}
      {comparison?.state === "ready" && <details><summary>{t("Compare entry assumptions", "对比入场假设")}</summary>
        <p className={styles.limit}>{t("Expiry only; fees, early exercise and assignment are excluded. No pre-expiry valuation is admitted.", "仅限到期结果；不含费用、提前行权及指派。不提供到期前估值。")}</p>
        {[comparison.baseline, comparison.current].map((item, index) => <div key={index}>
          <h3>{index === 0 ? t("Entry baseline", "入场基准") : t("Current entry", "当前入场假设")}</h3>
          <dl className={styles.metrics}>
            <div><dt>{t("Entry cost", "入场成本")}</dt><dd>{money(item.result.curve.cost, lang)}</dd></div>
            <div><dt>{t("Worst expiry outcome", "最差到期结果")}</dt><dd>{bound(item.result.curve.max_loss, true)}</dd></div>
            <div><dt>{t("Best expiry outcome", "最佳到期结果")}</dt><dd>{bound(item.result.curve.max_gain, false)}</dd></div>
            <div><dt>{t("Breakeven underlying price", "标的盈亏平衡价")}</dt><dd>{item.result.curve.breakevens.length ? item.result.curve.breakevens.map(v => money(v, lang)).join(" / ") : t("No crossing", "无平衡点")}</dd></div>
          </dl>
          {item.request.draft.legs.map((leg, n) => <p key={n}>{leg.snapshot.identity.root} · {leg.snapshot.identity.exp} · {leg.snapshot.identity.strike} {leg.snapshot.identity.right} · {leg.assumptions.side === "buy" ? t("Buy", "买入") : t("Sell", "卖出")} × {leg.assumptions.quantity} · {t("Your premium assumption", "个人权利金假设")}: {money(leg.assumptions.entry!.premium_per_unit, lang)}</p>)}
          <p>{t("Calculated at", "计算时间")}: <bdi>{item.result.known_by}</bdi></p>
        </div>)}
        <details><summary>{t("Exact reference binding", "精确参考绑定")}</summary>
          <p>{baseline!.result.source_boundary.reference_as_of} · {baseline!.result.source_boundary.reference_observed_at}</p>
          <p>{t("Reference digest", "参考摘要")}: <bdi>{baseline!.result.source_boundary.reference_sha256}</bdi></p>
          <p>{t("Installed observation digest", "已安装观测摘要")}: <bdi>{baseline!.result.source_boundary.installed_observation_sha256}</bdi></p>
        </details>
      </details>}
      {coverage && <><p className={styles.referenceBasis} data-testid="plan-reference-coverage">
        {t("Dated reference coverage", "带日期的参考范围")}: {coverage.contract_count} {coverage.root} {t("contracts", "份合约")} · {t("Expiry", "到期日")}: {coverage.expirations.join(" / ")}.
        {" "}{t("This is a dated selection, not a current chain. Choose a matching dated contract; other selections need matching terms.", "这是带日期的合约范围，并非当前完整期权链。请选择匹配的带日期合约；其他选择需要相应条款。")}
      </p><p className={styles.referenceBasis} data-testid="plan-reference-basis">{t("Dated terms as of", "带日期的条款")}: <bdi>{coverage.as_of}</bdi> · {t("Captured", "采集时间")}: <bdi>{coverage.captured_at}</bdi></p></>}
      {result && <>
        {observation && <button type="button" className="chip" onClick={() => setBaseline(observation)}>{t("Keep as entry baseline", "设为入场基准")}</button>}
        <p>{t("Dated conditional expiry outcome using your assumed entry.", "按带日期的条款及个人入场价假设计算的条件到期结果。")}</p>
        <dl className={styles.metrics}>
          <div><dt>{t("Worst expiry outcome", "最差到期结果")}</dt><dd>{bound(result.curve.max_loss, true)}</dd></div>
          <div><dt>{t("Best expiry outcome", "最佳到期结果")}</dt><dd>{bound(result.curve.max_gain, false)}</dd></div>
          <div><dt>{t("Breakeven underlying price", "标的盈亏平衡价")}</dt><dd>{result.curve.breakevens.length ? result.curve.breakevens.map(v => money(v, lang)).join(" / ") : t("No crossing", "无平衡点")}</dd></div>
        </dl>
        <p className={styles.limit}>{t("Hypothetical expiry prices; fees, early exercise and assignment are excluded. This is not a current valuation or fill.", "使用假设到期价格，未计费用、提前行权及指派；不代表当前估值或实际成交。")}</p>
        <ExpiryCurve result={result} lang={lang} strikes={draft.legs.map(l => l.snapshot.identity.strike)} />
        <details><summary>{t("Terms and calculation basis", "条款与计算依据")}</summary>
          <p>{t("Contract expiry", "合约到期日")}: <bdi>{result.contract_expirations[0]}</bdi></p>
          <p>{t("Reference terms as of", "参考条款日期")}: <bdi>{result.source_boundary.reference_as_of}</bdi> · {t("Captured", "采集时间")}: <bdi>{result.source_boundary.reference_observed_at}</bdi></p>
          <p>{t("Calculated at", "计算时间")}: <bdi>{result.known_by}</bdi></p>
          <p>{t("Reference terms were checked separately from your dated discovery snapshot. First historical availability and current executable quotes are not established.", "参考条款与带日期的发现快照分别核验；尚未确认历史首次可知时间及当前可执行报价。")}</p>
        </details>
      </>}
    </div>
  </section>;
}
