"use client";

import { localText } from "@/lib/shared-shell/readingPayloads";
import type { EconomicMetric } from "@/lib/shared-shell/macroEconomyPayload";
import s from "./MacroEconomy.module.css";

const COPY = {
  en: { title: "How quickly prices are changing", all: "All consumer prices", core: "Without food & energy", year: "Over the past year", month: "Over the past month", missing: "Unavailable", period: "Period unavailable", unavailable: "Current inflation rates are unavailable. Historical price levels are shown separately below.", evidence: "View source" },
  zh: { title: "价格变化有多快", all: "整体消费价格", core: "不含食品与能源", year: "与一年前相比", month: "与上月相比", missing: "不可用", period: "参考期不可用", unavailable: "当前通胀率暂不可用。下方另行展示历史价格水平。", evidence: "查看来源" },
} as const;
const MEASURES = [
  ["headline_cpi_yoy_pct", "all", "year"],
  ["core_cpi_yoy_pct", "core", "year"],
  ["headline_cpi_mom_pct", "all", "month"],
  ["core_cpi_mom_pct", "core", "month"],
] as const;

/** Display existing owner rates. Index histories never fill a missing rate. */
export default function MacroInflationReadout({ metrics, lang, onEvidence }: {
  metrics: EconomicMetric[]; lang: "en" | "zh"; onEvidence: (id: string) => void;
}) {
  const c = COPY[lang];
  const readings = MEASURES.map(([id, label, period]) => ({ id, label, period, metric: metrics.find(row => row.metric_id === id) }));
  return <section className={s.inflationReadout} aria-labelledby="inflation-rates-title" data-inflation-rates="">
    <h2 id="inflation-rates-title">{c.title}</h2>
    {!readings.some(row => row.metric?.value) && <p className={s.caption}>{c.unavailable}</p>}
    <div className={s.inflationGrid}>{readings.map(({ id, label, period, metric }) => {
      // The known owner unit is percent; the surrounding period label carries
      // the YoY/MoM distinction. Any different published unit stays explicit.
      const unit = metric?.unit?.en === "Pct yoy" || metric?.unit?.en === "Pct mom" ? "%" : localText(metric?.unit, lang);
      return <button type="button" className={s.inflationMetric} key={id} data-inflation-rate={id}
        disabled={!metric} onClick={() => onEvidence(`metric:${id}`)}>
        <span className={s.caption}>{c[period]}</span><span>{c[label]}</span>
        <strong>{metric?.value ? localText(metric.value, lang) : "—"}{metric?.value && <small>{unit}</small>}</strong>
        <span className={s.caption}>{metric?.reference_period ?? c.period}</span>
        <span className={s.caption}>{localText(metric?.value ? metric.freshness : metric?.absence?.label, lang) || c.missing}</span>
        {metric && <span className={s.inflationEvidence}>{c.evidence} ↗</span>}
      </button>;
    })}</div>
  </section>;
}
