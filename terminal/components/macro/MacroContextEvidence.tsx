import { macroLocal, macroNumber, macroRecord, macroRows, macroText, type MacroRecord } from "@/lib/shared-shell/macroDashboard";
import s from "./MacroDashboard.module.css";
const value = (v: unknown) => macroText(v) ?? (macroNumber(v) === null ? "—" : String(v));
const strings = (v: unknown) => Array.isArray(v) ? v.filter((item): item is string => typeof item === "string") : [];

export function MacroSentimentEvidence({ source, lang }: { source: MacroRecord; lang: "en" | "zh" }) {
 const zh = lang === "zh", rows = macroRows(source.legs_included), excluded = macroRows(source.legs_excluded_young);
 return <><p className={s.caption}>{zh ? "标准化位置越高，越偏贪婪。部分原始输入经过反向处理；这不是原始数值的概率。" : "Higher normalized positions mean more greed. Some raw inputs are inverted; these positions are not probabilities of the named quantity."}</p>
 {rows.length ? rows.map((row, i) => <details className={s.signalEvidence} key={i}><summary><span>{macroLocal(row, lang, "name") ?? "—"}</span><small>{macroNumber(row.pct) ?? "—"} / 100 · {zh ? "恐惧 → 贪婪" : "fear → greed"}</small></summary>
  <dl className={s.metricGrid}><div><dt>{zh ? "原始读数" : "Raw reading"}</dt><dd>{value(row.value)} {macroText(row.unit)}</dd></div><div><dt>{zh ? "观测日期" : "Observed"}</dt><dd>{value(row.last_date)}</dd></div><div><dt>{zh ? "样本数" : "Observations"}</dt><dd>{value(row.obs_count)}</dd></div><div><dt>{zh ? "来源状态" : "Source freshness"}</dt><dd>{value(row.freshness)}</dd></div><div><dt>{zh ? "来源方向规则" : "Source orientation"}</dt><dd>{value(row.orientation)}</dd></div></dl>
 </details>) : <p className={s.empty}>{zh ? "暂无合格输入。" : "No qualifying inputs published."}</p>}
 {excluded.length > 0 && <section className={s.detailSection}><h3>{zh ? "未纳入的输入" : "Inputs excluded from the composite"}</h3>{excluded.map((row, i) => <div className={s.evidenceRow} key={i}><strong>{macroLocal(row, lang, "name") ?? macroText(row.key)}</strong><p>{macroText(row.reason ?? row.null_reason) ?? (zh ? "历史样本不足" : "Insufficient history")}</p><small>{value(row.last_date)} · {zh ? "样本数" : "observations"}: {value(row.obs_count)}</small></div>)}</section>}
 </>;
}

export function MacroRatesEvidence({ source, lang }: { source: MacroRecord; lang: "en" | "zh" }) {
 const zh = lang === "zh";
 return <><section className={s.detailSection}><h3>{zh ? "压力来源" : "Sources of rate pressure"}</h3>{macroRows(macroRecord(source.expectations_pressure).legs).map((row, i) => <div className={s.evidenceRow} key={i}><strong>{macroText(row.key)?.replaceAll("_", " ")}</strong><p>{macroLocal(row, lang, "detail") ?? macroText(row.null_reason) ?? "—"}</p><small>{row.active === true ? (zh ? "来源已激活" : "Source active") : row.active === false ? (zh ? "来源未激活" : "Source inactive") : (zh ? "输入不可用" : "Input unavailable")}</small></div>)}</section>
  <section className={s.detailSection}><h3>{zh ? "比较依据" : "Comparison evidence"}</h3>{macroRows(source.qualified_comparisons).length ? macroRows(source.qualified_comparisons).map((row, i) => {
   const qualified = ["directly_comparable", "comparable_after_transformation"].includes(String(row.status)) && row.reference_only !== true;
   return <details className={s.signalEvidence} key={i}><summary><span>{macroText(row.component ?? row.comparison_id)?.replaceAll("_", " ") ?? (zh ? "来源比较" : "Source comparison")}</span><small>{qualified ? (zh ? "具备可比基础" : "Comparable basis") : (zh ? "不予比较" : "Withheld")}</small></summary>
    <p>{macroText(row.reason) ?? (qualified ? (zh ? "采用来源发布的比较规则。" : "Uses the source’s published comparison rules.") : (zh ? "来源未确认可比基础。" : "The source has not established a comparable basis."))}</p>
    <dl className={s.metricGrid}><div><dt>{zh ? "左侧来源" : "Left source"}</dt><dd>{value(row.left_ref)} · {value(row.left_cutoff)}</dd></div><div><dt>{zh ? "右侧来源" : "Right source"}</dt><dd>{value(row.right_ref)} · {value(row.right_cutoff)}</dd></div>{qualified && <div><dt>{zh ? "来源发布的差值" : "Published difference"}</dt><dd>{value(row.difference)} {value(row.unit)}</dd></div>}<div><dt>{zh ? "规则" : "Rule"}</dt><dd>{value(row.rule_id)} · {value(row.rule_version)}</dd></div></dl>
    {[...strings(row.assumptions), ...strings(row.limitations)].length > 0 && <ul className={s.briefList}>{[...strings(row.assumptions), ...strings(row.limitations)].map((line, j) => <li key={j}>{line}</li>)}</ul>}
   </details>;
  }) : <p className={s.empty}>{zh ? "未发布可比性证据。" : "No comparison evidence published."}</p>}</section>
 </>;
}
