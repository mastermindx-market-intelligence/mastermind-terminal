"use client";

import React, { useEffect, useRef, useState } from "react";
import { OptionsPlanDraftEditor } from "./OptionsPlanDraftEditor";
import { preparePlanExpiryRequest, readPlanPayoff, type PlanPayoff } from "@/lib/optionsPlanPayoff";
import type { OptionsPlanDraft } from "@/lib/optionsPlanDraft";
import { useChartWidth, niceTicks, padDomain, thinLabels, fmtTick } from "@/components/charts/svgChart";
import styles from "./OptionsPlanPayoffPanel.module.css";

const money = (v: number, lang: "en" | "zh") => new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
function ExpiryCurve({ result, lang }: { result: PlanPayoff; lang: "en" | "zh" }) {
  const ref = useRef<HTMLDivElement>(null), width = useChartWidth(ref), height = 240;
  const xValues = result.curve.spots, yValues = result.curve.pnl;
  const [x0, x1] = padDomain(Math.min(...xValues), Math.max(...xValues), { padFrac: 0 });
  const [y0, y1] = padDomain(Math.min(...yValues), Math.max(...yValues), { includeZero: true });
  const left = width < 450 ? 64 : 82, right = 20, top = 16, bottom = 48;
  const x = (v: number) => left + (v - x0) / (x1 - x0) * (width - left - right);
  const y = (v: number) => height - bottom - (v - y0) / (y1 - y0) * (height - top - bottom);
  const xt = niceTicks(x0, x1, 5), yt = niceTicks(y0, y1, 4);
  const points = xValues.map((v, i) => `${x(v)},${y(yValues[i])}`).join(" ");
  return <div className={styles.chart} ref={ref}>
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={lang === "en" ? "Conditional expiry profit and loss over hypothetical underlying prices" : "假设标的价格下的条件到期损益"}>
      {yt.values.map(v => <g key={v}><line x1={left} x2={width - right} y1={y(v)} y2={y(v)} className={styles.grid} /><text x={left - 8} y={y(v) + 4} textAnchor="end">{fmtTick(v, yt.step)}</text></g>)}
      {thinLabels(xt.values, x, 66).map(v => <text key={v} x={x(v)} y={height - bottom + 20} textAnchor="middle">{fmtTick(v, xt.step)}</text>)}
      {y0 < 0 && y1 > 0 && <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} className={styles.zero} />}
      <polyline points={points} fill="none" className={styles.curve} />
      <text x={(left + width - right) / 2} y={height - 5} textAnchor="middle">{lang === "en" ? "Hypothetical underlying price at expiry (USD)" : "假设到期标的价格（美元）"}</text>
    </svg>
  </div>;
}

type Props = {
  draft: OptionsPlanDraft; lang: "en" | "zh";
  /** Non-secret account + retained-selection identity from the authenticated host. */
  scopeKey: string;
  onDraftChange: (draft: OptionsPlanDraft) => void; onClose: () => void;
};

/** A new account or retained selection gets a fresh editor/result controller.
 * onDraftChange returns the unchanged canonical payload to the existing Save
 * owner. This panel writes no local/cloud storage and invents no Save action. */
export function OptionsPlanPayoffPanel(props: Props) {
  return <PlanPayoffBody key={props.scopeKey} {...props} />;
}
function PlanPayoffBody({ draft, lang, onDraftChange, onClose }: Props) {
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  const [result, setResult] = useState<PlanPayoff | null>(null);
  const [status, setStatus] = useState("idle"), [reason, setReason] = useState("");
  const answer = useRef<HTMLHeadingElement>(null);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => () => { sequence.current++; controller.current?.abort(); }, []);
  useEffect(() => { if (result) answer.current?.focus(); }, [result]);
  const calculate = async (candidate: OptionsPlanDraft) => {
    controller.current?.abort(); const own = ++sequence.current;
    setResult(null); setReason(""); onDraftChange(candidate);
    const request = preparePlanExpiryRequest(candidate);
    if (!request.ok) { setStatus("incomplete"); setReason(request.reason); return; }
    setStatus("loading"); controller.current = new AbortController();
    try {
      const response = await fetch("/api/options/plan/expiry", { method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.value), signal: controller.current.signal });
      if (own !== sequence.current) return;
      if (!response.ok) { setStatus(response.status === 401 || response.status === 403 ? "access" : "unavailable"); return; }
      const parsed = readPlanPayoff(await response.json(), request.value);
      if (own !== sequence.current) return;
      if (!parsed) { setStatus("unavailable"); return; }
      setResult(parsed); setStatus("ready");
    } catch { if (own === sequence.current) setStatus("unavailable"); }
  };
  const bound = (v: number | "UNBOUNDED", loss: boolean) => v === "UNBOUNDED" ? t(loss ? "Unbounded loss" : "Unbounded gain", loss ? "亏损无上限" : "收益无上限") : money(v, lang);
  const incomplete = reason === "expiry" ? t("Use contracts with the same expiry for this curve.", "此曲线须使用相同到期日的合约。")
    : reason === "unsupported" ? t("Expiry terms are currently supported for ordinary SPY and QQQ contracts.", "当前到期条款支持标准SPY及QQQ合约。")
      : t("Enter a side, whole contract quantity and your USD entry assumption for every leg.", "请为每条腿填写方向、合约整数数量及美元入场价假设。");
  return <section className={styles.panel} data-testid="options-plan-payoff-panel" aria-label={t("Exact-contract Plan", "精确合约计划")}>
    <OptionsPlanDraftEditor draft={draft} lang={lang} onApply={candidate => { void calculate(candidate); }} onClose={onClose}
      onEdit={() => { sequence.current++; controller.current?.abort(); setResult(null); setStatus("idle"); }}
      applyLabel={t("Calculate expiry payoff", "计算到期损益")}
      contextDescription={t("Use your entry assumptions to explore a hold-to-expiry outcome. Current quotes are separate.", "用个人入场假设研究持有至到期的结果；当前报价另行核验。")} />
    <div className={styles.answer} aria-live="polite" aria-busy={status === "loading"}>
      <h2 ref={answer} tabIndex={-1}>{t("Expiry payoff", "到期损益")}</h2>
      {status === "idle" && <p>{t("Set your assumptions, then calculate a conditional expiry curve.", "填写假设后，可计算条件到期曲线。")}</p>}
      {status === "loading" && <p role="status">{t("Checking contract terms…", "正在核验合约条款……")}</p>}
      {status === "incomplete" && <p role="alert">{incomplete}</p>}
      {status === "access" && <p role="alert">{t("Sign in with Options access to check terms. Your draft stays here.", "请使用有期权访问权限的账户登录以核验条款，草稿仍保留在此处。")}</p>}
      {status === "unavailable" && <p role="alert">{t("Contract terms unavailable. Your draft is kept here; check the selected contracts before calculating again.", "合约条款暂不可用。草稿仍保留在此处；再次计算前请核对所选合约。")}</p>}
      {result && <>
        <p>{t("Dated conditional expiry outcome using your assumed entry.", "按带日期的条款及个人入场价假设计算的条件到期结果。")}</p>
        <dl className={styles.metrics}>
          <div><dt>{t("Worst expiry outcome", "最差到期结果")}</dt><dd>{bound(result.curve.max_loss, true)}</dd></div>
          <div><dt>{t("Best expiry outcome", "最佳到期结果")}</dt><dd>{bound(result.curve.max_gain, false)}</dd></div>
          <div><dt>{t("Breakeven underlying price", "标的盈亏平衡价")}</dt><dd>{result.curve.breakevens.length ? result.curve.breakevens.map(v => money(v, lang)).join(" / ") : t("No crossing", "无平衡点")}</dd></div>
        </dl>
        <p className={styles.limit}>{t("Hypothetical expiry prices; fees, early exercise and assignment are excluded. This is not a current valuation or fill.", "使用假设到期价格，未计费用、提前行权及指派；不代表当前估值或实际成交。")}</p>
        <ExpiryCurve result={result} lang={lang} />
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
