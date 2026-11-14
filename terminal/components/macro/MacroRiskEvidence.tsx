"use client";
import { useState } from "react";
import { macroLocal, macroNumber, macroRecord, macroRows, macroText, type MacroRecord } from "@/lib/shared-shell/macroDashboard";
import s from "./MacroDashboard.module.css";

const percent = (value: unknown) => { const n = macroNumber(value); return n !== null && n >= 0 && n <= 1 ? `${Math.round(n * 100)}%` : "—"; };
export default function MacroRiskEvidence({ radar, lang }: { radar: MacroRecord; lang: "en" | "zh" }) {
 const [horizon, setHorizon] = useState<5 | 10 | 21>(21), zh = lang === "zh";
 const evidence = macroRecord(radar.dd_evidence), history = macroRecord(macroRecord(evidence.horizons)[`h${horizon}`]);
 const probability = macroNumber(radar[`dd${horizon}`]), baseline = macroRecord(radar.dd_base)[`h${horizon}`];
 // History qualifies only the exact owner-issued estimate to which it is bound.
 const matched = history.matched === true && probability !== null && probability >= 0 && probability <= 1 && macroNumber(history.displayed_probability) === probability;
 const interval = Array.isArray(history.observed_rate_ci90) ? history.observed_rate_ci90 : [];
 const target = macroNumber(macroRecord(evidence.target).threshold_pct);
 const authority = macroRecord(radar.authority);
 return <>
  <section className={s.detailSection} aria-labelledby="macro-risk-odds-title">
   <div className={s.sectionHead}><div><p className={s.eyebrow}>{zh ? "历史条件估计" : "HISTORICAL CONDITIONAL ESTIMATE"}</p><h3 id="macro-risk-odds-title">{target !== null ? `SPY · ≥${Math.abs(target)}% ${zh ? "回撤" : "pullback"}` : zh ? "回撤概率与样本" : "Drawdown odds & evidence"}</h3></div>
    <div className={s.segmented} aria-label={zh ? "概率期限" : "Probability horizon"}>{([5, 10, 21] as const).map(day => <button key={day} aria-pressed={horizon === day} onClick={() => setHorizon(day)}>{day}{zh ? "日" : "d"}</button>)}</div></div>
   <div className={s.detailHero} aria-live="polite"><strong>{matched ? percent(probability) : "—"}</strong><span>{matched ? (history.thin === true ? (zh ? "样本偏少" : "Thin historical sample") : (zh ? "已绑定历史证据" : "Source-matched history")) : (zh ? "暂无与该估计匹配的历史证据" : "Matching estimate evidence unavailable")}</span></div>
   <p className={s.caption}>{zh ? "风险信号指数与回撤概率使用不同刻度。历史条件估计不代表未来保证，亦不授予交易或仓位权限。" : "The signal index and drawdown odds have different scales. Historical conditional estimates are uncertain and confer no trading or sizing authority."}</p>
   {matched && <dl className={s.metricGrid}>
    <div><dt>{zh ? "基准发生率" : "Baseline frequency"}</dt><dd>{percent(baseline)}</dd></div>
    <div><dt>{zh ? "样本数" : "Observations"}</dt><dd>{macroNumber(history.n) ?? "—"}</dd></div>
    <div><dt>{zh ? "事件数" : "Observed events"}</dt><dd>{macroNumber(history.events) ?? "—"}</dd></div>
    <div><dt>{zh ? "实际发生率" : "Observed frequency"}</dt><dd>{percent(history.observed_rate)}</dd></div>
    <div><dt>{zh ? "90%区间" : "90% interval"}</dt><dd>{interval.length === 2 ? `${percent(interval[0])} – ${percent(interval[1])}` : "—"}</dd></div>
    <div><dt>{zh ? "样本窗口" : "Evidence window"}</dt><dd>{macroText(history.from) ?? macroText(macroRecord(evidence.window).from) ?? "—"} → {macroText(history.through) ?? macroText(macroRecord(evidence.window).through) ?? "—"}</dd></div>
   </dl>}
   {Array.isArray(evidence.limitations) && <ul className={s.briefList}>{evidence.limitations.filter((v): v is string => typeof v === "string").map((v, i) => <li key={i}>{v}</li>)}</ul>}
  </section>
  <section className={s.detailSection}><h3>{zh ? "风险信号依据" : "Evidence behind the signals"}</h3>
   {macroRows(radar.scares).map((scare, i) => <details className={s.signalEvidence} key={i}><summary><span>{macroLocal(scare, lang, "label") ?? macroText(scare.scare) ?? "—"}</span><small>{["AVAILABLE", "PARTIAL"].includes(String(scare.reading_state)) ? `${macroNumber(scare.n_legs_resolved) ?? "—"} / ${macroNumber(scare.n_legs_registered) ?? "—"} ${zh ? "输入" : "inputs"}` : zh ? "不可用" : "Unavailable"}</small></summary>
    <p className={s.caption}>{zh ? "权重覆盖" : "Weight coverage"}: {percent(scare.weight_coverage)}{scare.partial_composition === true ? (zh ? " · 部分证据" : " · Partial evidence") : ""}</p>
    {macroRows(scare.firing_legs).length ? macroRows(scare.firing_legs).map((leg, j) => <div className={s.riskRow} key={j}><div><strong>{macroText(leg.leg)?.replaceAll("_", " ") ?? "—"}</strong><small>{leg.confirmed === true ? (zh ? "来源已确认" : "Source confirmed") : (zh ? "尚未确认" : "Not confirmed")}{leg.era_robust === false ? (zh ? " · 跨时期稳定性不足" : " · Limited era stability") : ""}</small></div><span>{percent(leg.pctile)}<small>{zh ? "历史百分位" : "historical percentile"}</small></span></div>) : <p className={s.empty}>{zh ? "未发布触发输入。" : "No firing inputs published."}</p>}
   </details>)}
  </section>
  <section className={s.detailSection}><h3>{zh ? "模型权限与限制" : "Model authority & limits"}</h3><p>{macroLocal(authority, lang, "note") ?? macroText(authority.reason) ?? (zh ? "此面板仅用于研究背景。" : "This panel provides research context.")}</p><p className={s.caption}>{zh ? "此界面展示来源模型的读数，不会新建交易、风控限制或仓位规则。" : "This interface displays the source model’s readings. It creates no trades, risk gates or position rules."}</p></section>
 </>;
}
