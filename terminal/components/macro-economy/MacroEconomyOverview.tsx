"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { localText, type TodayPayload } from "@/lib/shared-shell/readingPayloads";
import { ECONOMIC_WORKSPACES, type EconomicWorkspaceId } from "@/lib/shared-shell/macroEconomyPayload";
import s from "./MacroEconomy.module.css";

const COPY = {
  en: { explore: "Explore", headline: "Economy at a glance.", partialAssessment: "Some readings are unavailable. Each section below shows its status.", todayCoverage: "sections have today's data", macro: "Macro", today: "Today", economy: "Economy", eyebrow: "The economic picture", title: "Understand what is moving the economy.", support: "Explore the forces behind the market, from the first reading to the underlying evidence.", daily: "Start with the market", dailyTitle: "Your daily risk view", dailyBody: "Market score, key changes and the next catalysts.", open: "Open Today", drivers: "The main drivers", more: "Explore all workspaces", unavailable: "Reading unavailable", deepen: "Go deeper", dates: "Each reading keeps its own observation date.", coverage: "sections have a published reading", source: "Publication details", missing: "The economic overview could not be verified.", withheld: "No combined economic assessment has been published.", refresh: "Refresh", loading: "Loading the economic picture…", access: "Your current access does not include this reading." },
  zh: { explore: "探索", headline: "一眼看懂经济环境。", partialAssessment: "部分读数暂不可用。下方各板块标明了各自的状态。", todayCoverage: "个板块有今日数据", macro: "宏观", today: "今日", economy: "经济", eyebrow: "经济全景", title: "理解推动经济变化的力量。", support: "从初步解读到基础证据，探索市场背后的经济力量。", daily: "从市场开始", dailyTitle: "每日风险视图", dailyBody: "市场评分、关键变化和下一催化因素。", open: "打开今日视图", drivers: "主要驱动因素", more: "探索所有工作区", unavailable: "读数不可用", deepen: "深入探索", dates: "每项读数保留自己的观察日期。", coverage: "个板块已有发布读数", source: "发布详情", missing: "无法核验经济总览。", withheld: "尚未发布综合经济解读。", refresh: "刷新", loading: "正在加载经济全景…", access: "当前权限不包含此读数。" },
} as const;
const LEAD_SECTIONS = ["money", "inflation", "growth", "jobs", "credit", "policy"];

export default function MacroEconomyOverview({ lang, data, phase, dashboardHref, overviewHref, workspaceHref, onRefresh, accountNotice }: {
  lang: "en" | "zh"; data: TodayPayload | null; phase: "loading" | "ready" | "unavailable" | "access";
  dashboardHref: string; overviewHref: string; workspaceHref: (id: EconomicWorkspaceId) => string; onRefresh: () => void; accountNotice?: ReactNode;
}) {
  const c = COPY[lang], ids = Object.keys(ECONOMIC_WORKSPACES) as EconomicWorkspaceId[];
  const qualified = phase === "ready" && !accountNotice ? data : null;
  const clause = (value: TodayPayload["read"]["clauses"][number]) => `${localText(value.topic, lang)} ${localText(value.predicate, lang)}${localText(value.punct, lang)}`;
  const assessment = qualified?.read.clauses.map(clause).join(lang === "zh" ? "" : " ");
  const coverage = qualified?.strip.find(item => item.id === "coverage");
  return <div className={s.root} data-macro-economy="" data-read-state={phase}>
    <nav className={s.productNav} aria-label={c.macro}><div className={s.productLinks}><strong className={s.productTitle}>{c.macro}</strong><Link href={dashboardHref} prefetch={false}>{c.today}</Link><Link href={overviewHref} aria-current="page" prefetch={false}>{c.economy}</Link></div><button type="button" className={s.button} onClick={onRefresh} disabled={phase === "loading"}>{c.refresh}</button></nav>
    <section className={s.hero}><div className={s.heroMain}><p className={s.eyebrow}>{c.eyebrow}</p><h1>{c.headline}</h1><p className={assessment ? s.economicAssessment : s.heroSummary} data-economic-assessment="">{assessment || c.support}</p>{qualified?.read.omitted && <p className={s.caption}>{c.partialAssessment}</p>}{qualified?.read.as_of && <div className={s.caption} data-economic-date=""><time dateTime={qualified.read.as_of}>{localText(qualified.read.as_of_display, lang) || qualified.read.as_of}</time>{qualified.read.as_of_meaning && <p>{localText(qualified.read.as_of_meaning, lang)}</p>}</div>}</div><aside className={s.dailyLink}><p className={s.eyebrow}>{c.daily}</p><strong>{c.dailyTitle}</strong><p className={s.muted}>{c.dailyBody}</p><Link href={dashboardHref} prefetch={false}>{c.open} →</Link></aside></section>
    {!qualified ? accountNotice || <section className={s.limit} role="status" aria-busy={phase === "loading"}>{phase === "loading" ? c.loading : phase === "access" ? c.access : c.missing}</section> : <>
      <section aria-labelledby="economic-driver-title"><div className={s.sectionHeading}><h2 id="economic-driver-title">{c.drivers}</h2><a href="#economic-workspaces" className={s.textButton}>{c.more} ↓</a></div><ul className={s.driverGrid}>{LEAD_SECTIONS.map(section => {
        const chip = qualified.strip.find(item => item.section === section), id = ids.find(id => ECONOMIC_WORKSPACES[id].section === section);
        if (!id) return null;
        return <li className={s.driverEntry} key={section}><Link href={workspaceHref(id)} prefetch={false}><div><div className={s.driverLabel}><span>{chip ? localText(chip.label, lang) : ECONOMIC_WORKSPACES[id][lang]}</span>{chip?.as_of && <time dateTime={chip.as_of}>{localText(chip.as_of_display, lang) || chip.as_of}</time>}</div><strong className={chip?.tone === "warn" ? s.toneWarn : chip?.tone === "bad" ? s.toneBad : chip?.tone === "ok" ? s.toneGood : undefined}>{chip && !chip.null ? localText(chip.value, lang) : chip?.cause === "see_curve" ? `${c.explore}${lang === "zh" ? "" : " "}${lang === "zh" ? ECONOMIC_WORKSPACES[id][lang] : ECONOMIC_WORKSPACES[id].en.toLowerCase()}` : c.unavailable}</strong>{chip?.note && <p className={s.caption}>{localText(chip.note, lang)}</p>}{chip?.meaning && <p className={s.caption}>{localText(chip.meaning, lang)}</p>}</div><span aria-hidden="true" className={s.driverArrow}>→</span></Link></li>;
      })}</ul><p className={s.caption} style={{ marginTop: 16 }}>{c.dates}</p></section>
      <section id="economic-workspaces" className={s.explore} aria-labelledby="economic-workspaces-title"><h2 id="economic-workspaces-title">{c.deepen}</h2><div className={s.exploreLinks}>{ids.map(id => <Link href={workspaceHref(id)} key={id} prefetch={false}>{ECONOMIC_WORKSPACES[id][lang]} →</Link>)}</div></section>
      <footer className={s.overviewReceipt}><p data-economic-coverage="">{coverage?.note ? localText(coverage.note, lang) : `${qualified.coverage.available} / ${qualified.coverage.total} ${c.todayCoverage}`}</p>{coverage?.meaning && <p className={s.caption}>{localText(coverage.meaning, lang)}</p>}<details className={s.receipt}><summary>{c.source}</summary><p><code>{qualified.source.manifest_sha256}</code></p>{qualified.source.manifest_generated_at && <p>{qualified.source.manifest_generated_at}</p>}</details></footer>
    </>}
  </div>;
}
