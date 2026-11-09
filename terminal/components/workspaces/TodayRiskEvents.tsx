"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { pickLang } from "@/lib/portfolioBrief";
import { freshnessLabel, readingFreshness } from "@/lib/shared-shell/readingFreshness";
import type { TodayBriefContext } from "@/lib/shared-shell/todayBriefContext";
import today from "./TodayWorkspace.module.css";

/** Pure presentation: the Today comparison holder owns this authenticated response.
 * No fetch, quota use, extra identity lifetime, inferred risk score or schedule engine. */
export default function TodayRiskEvents({ value, now }: { value: TodayBriefContext; now: Date }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const age = readingFreshness(value.asof, now);
  const rows = value.earnings ?? [];
  const renderEvent = (event: typeof rows[number]) => <li key={`${event.ticker}|${event.date}`}>
    <Link href={`/analysis?symbol=${encodeURIComponent(event.ticker)}`} aria-label={zh ? `分析 ${event.ticker}` : `Analyze ${event.ticker}`}>{event.ticker}</Link>
    <time dateTime={event.date}>{event.date}</time>
    <span>{zh ? "财报" : "Earnings"}</span>
  </li>;
  return <section className={today.contextJob} aria-labelledby="today-risk-events" data-today-brief-context>
    <div className={today.jobHeader}>
      <h2 id="today-risk-events">{zh ? "风险与财报" : "Risk & earnings"}</h2>
      <Link href="/portfolio">{zh ? "完整简报" : "Full brief"}<span aria-hidden="true">→</span></Link>
    </div>
    <p className={today.contextClock}>
      {value.population && <span>{zh ? value.population.label_zh : value.population.label_en} · </span>}
      {zh ? "读数截至 " : "Reading as of "}<time dateTime={value.asof}>{value.asof}</time>
      <span className={today.readingAge} data-kind={value.stale ? "stale" : age.kind}> · {value.stale ? zh ? "来源标记为滞后" : "Source marked behind" : freshnessLabel(age, lang)}</span>
    </p>
    {value.regime.length > 0 && <div className={today.contextRegime}>
      <p>{pickLang(value.regime[0], lang)}</p>
      {value.regime.length > 1 && <details><summary>{zh ? "更多风险背景" : "More risk context"}</summary>
        {value.regime.slice(1).map((line, index) => <p key={index}>{pickLang(line, lang)}</p>)}
      </details>}
    </div>}
    <div className={today.contextEvents}>
      <h3>{zh ? "来源记录的财报日期" : "Recorded earnings dates"}</h3>
      {rows.length > 0 ? <>
        <ul>{rows.slice(0, 3).map(renderEvent)}</ul>
        {rows.length > 3 && <details><summary>{zh ? `另外 ${rows.length - 3} 个日期` : `${rows.length - 3} more dates`}</summary>
          <ul>{rows.slice(3).map(renderEvent)}</ul>
        </details>}
      </> : <p>{zh ? "此读数未提供可用的财报日期。" : "No usable earnings dates were supplied in this reading."}</p>}
      <p className={today.helper}>{zh ? "日期来自该期简报；请在公司页面核对最新安排。" : "Dates belong to this brief. Check the company for the latest schedule."}</p>
    </div>
  </section>;
}
