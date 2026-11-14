"use client";
import { useState } from "react";
import { macroLocal, macroNumber, macroRecord, macroRows, macroText, type MacroRecord } from "@/lib/shared-shell/macroDashboard";
import { pick } from "./macroCopy";
import s from "./MacroDashboard.module.css";

const percent = (value: unknown) => { const n = macroNumber(value); return n !== null && n >= 0 && n <= 1 ? `${Math.round(n * 100)}%` : "—"; };
export default function MacroRiskEvidence({ radar, lang }: { radar: MacroRecord; lang: "en" | "zh" }) {
 const [horizon, setHorizon] = useState<5 | 10 | 21>(21);
 const evidence = macroRecord(radar.dd_evidence), history = macroRecord(macroRecord(evidence.horizons)[`h${horizon}`]);
 const probability = macroNumber(radar[`dd${horizon}`]), baseline = macroRecord(radar.dd_base)[`h${horizon}`];
 // History qualifies only the exact owner-issued estimate to which it is bound.
 const matched = history.matched === true && probability !== null && probability >= 0 && probability <= 1 && macroNumber(history.displayed_probability) === probability;
 const interval = Array.isArray(history.observed_rate_ci90) ? history.observed_rate_ci90 : [];
 const target = macroNumber(macroRecord(evidence.target).threshold_pct);
 const authority = macroRecord(radar.authority);
 return <>
  <section className={s.detailSection} aria-labelledby="macro-risk-odds-title">
   <div className={s.sectionHead}><div><p className={s.eyebrow}>{pick(lang, "HISTORICAL CONDITIONAL ESTIMATE", "历史条件估计")}</p><h3 id="macro-risk-odds-title">{target !== null ? `SPY · ≥${Math.abs(target)}% ${pick(lang, "pullback", "回撤")}` : pick(lang, "Drawdown odds & evidence", "回撤概率与样本")}</h3></div>
    <div className={s.segmented} aria-label={pick(lang, "Probability horizon", "概率期限")}>{([5, 10, 21] as const).map(day => <button key={day} aria-pressed={horizon === day} onClick={() => setHorizon(day)}>{day}{pick(lang, "d", "日")}</button>)}</div></div>
   <div className={s.detailHero} aria-live="polite"><strong>{matched ? percent(probability) : "—"}</strong><span>{matched ? (history.thin === true ? (pick(lang, "Thin historical sample", "样本偏少")) : (pick(lang, "Source-matched history", "已绑定历史证据"))) : (pick(lang, "Matching estimate evidence unavailable", "暂无与该估计匹配的历史证据"))}</span></div>
   <p className={s.caption}>{pick(lang, "The signal index and drawdown odds have different scales. Historical conditional estimates are uncertain and confer no trading or sizing authority.", "风险信号指数与回撤概率使用不同刻度。历史条件估计不代表未来保证，亦不授予交易或仓位权限。")}</p>
   {matched && <dl className={s.metricGrid}>
    <div><dt>{pick(lang, "Baseline frequency", "基准发生率")}</dt><dd>{percent(baseline)}</dd></div>
    <div><dt>{pick(lang, "Observations", "样本数")}</dt><dd>{macroNumber(history.n) ?? "—"}</dd></div>
    <div><dt>{pick(lang, "Observed events", "事件数")}</dt><dd>{macroNumber(history.events) ?? "—"}</dd></div>
    <div><dt>{pick(lang, "Observed frequency", "实际发生率")}</dt><dd>{percent(history.observed_rate)}</dd></div>
    <div><dt>{pick(lang, "90% interval", "90%区间")}</dt><dd>{interval.length === 2 ? `${percent(interval[0])} – ${percent(interval[1])}` : "—"}</dd></div>
    <div><dt>{pick(lang, "Evidence window", "样本窗口")}</dt><dd>{macroText(history.from) ?? macroText(macroRecord(evidence.window).from) ?? "—"} → {macroText(history.through) ?? macroText(macroRecord(evidence.window).through) ?? "—"}</dd></div>
   </dl>}
   {Array.isArray(evidence.limitations) && <ul className={s.briefList}>{evidence.limitations.filter((v): v is string => typeof v === "string").map((v, i) => <li key={i}>{v}</li>)}</ul>}
  </section>
  <section className={s.detailSection}><h3>{pick(lang, "Evidence behind the signals", "风险信号依据")}</h3>
   {macroRows(radar.scares).map((scare, i) => <details className={s.signalEvidence} key={i}><summary><span>{macroLocal(scare, lang, "label") ?? macroText(scare.scare) ?? "—"}</span><small>{["AVAILABLE", "PARTIAL"].includes(String(scare.reading_state)) ? `${macroNumber(scare.n_legs_resolved) ?? "—"} / ${macroNumber(scare.n_legs_registered) ?? "—"} ${pick(lang, "inputs", "输入")}` : pick(lang, "Unavailable", "不可用")}</small></summary>
    <p className={s.caption}>{pick(lang, "Weight coverage", "权重覆盖")}: {percent(scare.weight_coverage)}{scare.partial_composition === true ? (pick(lang, " · Partial evidence", " · 部分证据")) : ""}</p>
    {macroRows(scare.firing_legs).length ? macroRows(scare.firing_legs).map((leg, j) => <div className={s.riskRow} key={j}><div><strong>{macroText(leg.leg)?.replaceAll("_", " ") ?? "—"}</strong><small>{leg.confirmed === true ? (pick(lang, "Source confirmed", "来源已确认")) : (pick(lang, "Not confirmed", "尚未确认"))}{leg.era_robust === false ? (pick(lang, " · Limited era stability", " · 跨时期稳定性不足")) : ""}</small></div><span>{percent(leg.pctile)}<small>{pick(lang, "historical percentile", "历史百分位")}</small></span></div>) : <p className={s.empty}>{pick(lang, "No firing inputs published.", "未发布触发输入。")}</p>}
   </details>)}
  </section>
  <section className={s.detailSection}><h3>{pick(lang, "Model authority & limits", "模型权限与限制")}</h3><p>{macroLocal(authority, lang, "note") ?? macroText(authority.reason) ?? (pick(lang, "This panel provides research context.", "此面板仅用于研究背景。"))}</p><p className={s.caption}>{pick(lang, "This interface displays the source model’s readings. It creates no trades, risk gates or position rules.", "此界面展示来源模型的读数，不会新建交易、风控限制或仓位规则。")}</p></section>
 </>;
}
