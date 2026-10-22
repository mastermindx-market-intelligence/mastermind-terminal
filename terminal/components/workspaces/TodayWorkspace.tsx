"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { localText, todayPayload, type TodayPayload } from "@/lib/shared-shell/readingPayloads";
import { readingJson, useReadingScope } from "@/lib/shared-shell/useReadingScope";
import styles from "./ReadingWorkspace.module.css";
import today from "./TodayWorkspace.module.css";
import TodayResearchAttention from "./TodayResearchAttention";
import TodayWatchAttention from "./TodayWatchAttention";

const COPY = {
 en: {
  title: "Today", intro: "A source-backed starting point for your research.", owner: "Macro Command · United States",
  loading: "Checking published source coverage…", unavailable: "The Macro Command reading is unavailable. This does not mean markets are quiet.",
  unavailableTitle: "Market reading unavailable", auth: "Your account changed or your session ended. Private readings have been cleared.",
  accountUnavailable: "The account service is unavailable. Private readings are hidden.",
  signIn: "Sign in", retry: "Try again", command: "Open Macro Command", overview: "Open market overview", coverage: "Source coverage",
  of: "of", sections: "sections have verified source coverage", published: "Source verification", ready: "Listed sources verified",
  partial: "Some sources are unavailable", missing: "No sources could be verified", asof: "Reading as of", manifest: "Publication manifest generated",
  noClock: "Source date unavailable", omitted: "Some source readings are omitted. Inspect each source's coverage before drawing a conclusion.",
  attentionLabel: "Needs your attention", attention: "Coverage to inspect", noAttention: "No source failures are reported. Check each source date and availability below.",
  effective: "Effective date", calculated: "Calculated as of", details: "All source coverage and dates",
  allSections: "Explore Macro Command sections", local: "Research", continue: "Pick up where you left off",
  localNote: "Your reading position is saved in this browser. Access is checked when you reopen.",
  noLocal: "Choose a report from the Research library to start reading.", resume: "Continue the selected revision",
  research: "Open Research", researchScreener: "Open research screener", clocks: "Publication evidence",
  clockNote: "Manifest generation and publication verification do not certify the freshness of every source. Each reading keeps its own clock.",
  hash: "Manifest SHA-256", monitor: "Open Monitor", curve: "View the curve", noSummary: "Open source reading",
  keepGoing: "Keep researching", keepGoingNote: "Open a workspace to inspect its published evidence while this reading recovers.",
  discover: "Discover companies", brief: "Your market", sourceReadings: "Source readings",
 },
 zh: {
  title: "今日", intro: "以来源证据为起点，开始研究。", owner: "宏观指挥台 · 美国",
  loading: "正在核验已发布来源覆盖…", unavailable: "宏观指挥台读数暂不可用。这并不代表市场平静。",
  unavailableTitle: "市场读数暂不可用", auth: "账户已更改或会话已结束。私人读数已清除。",
  accountUnavailable: "账户服务暂不可用。私人读数已隐藏。",
  signIn: "登录", retry: "重试", command: "打开宏观指挥台", overview: "打开市场概览", coverage: "来源覆盖",
  of: "/", sections: "个板块具有已核验来源覆盖", published: "来源核验", ready: "已核验所列来源",
  partial: "部分来源不可用", missing: "暂无通过核验的来源", asof: "读数截至", manifest: "发布清单生成于",
  noClock: "来源日期不可用", omitted: "部分来源读数未显示。请先查看各来源覆盖，再作判断。",
  attentionLabel: "关注事项", attention: "需要查看的覆盖", noAttention: "未报告来源失败。请检查下方各来源日期与可用状态。",
  effective: "生效日期", calculated: "计算截至", details: "全部来源覆盖与日期",
  allSections: "查看宏观指挥台板块", local: "研究", continue: "接续上次阅读",
  localNote: "阅读位置保存在此浏览器中。重新打开时会核验当前权限。",
  noLocal: "从研究资料库选择报告，开始阅读。", resume: "继续所选修订",
  research: "打开研究", researchScreener: "打开研究筛选器", clocks: "发布证据",
  clockNote: "清单生成与发布核验并不证明所有来源均为最新。每项读数保留各自时间。",
  hash: "清单 SHA-256", monitor: "打开监控", curve: "查看曲线", noSummary: "打开来源读数",
  keepGoing: "继续研究", keepGoingNote: "在读数恢复期间，可打开工作区查看已发布的来源证据。",
  discover: "发现公司", brief: "市场概览", sourceReadings: "来源读数",
 },
} as const;

const AVAILABILITY: Record<string, readonly [string, string]> = {
 CURRENT: ["Current source", "当前来源"], LATE_WITHIN_TOLERANCE: ["Late within tolerance", "延迟仍在容忍范围"],
 STALE_SOURCE: ["Source is behind", "来源滞后"], NOT_YET_RELEASED: ["Not yet released", "尚未发布"],
 SOURCE_FAILED: ["Source failed", "来源失败"], RIGHTS_BLOCKED: ["Source rights restricted", "来源权限受限"],
 NOT_COVERED: ["Not covered", "未覆盖"], HISTORICAL_AS_KNOWN: ["Historical as known", "当时已知的历史数据"],
 COMPUTATION_REFUSED: ["Computation unavailable", "计算不可用"], DISAGREEMENT: ["Sources disagree", "来源存在分歧"],
};

function Arrow() {
 return <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 10h12m-5-5 5 5-5 5" /></svg>;
}
function sourceHref(href: string) {
 return typeof href === "string" && /^\/macro_[a-z0-9_]+\.html$/.test(href) ? href : null;
}

function TodayWorkspaceSession({ ownerKey }: { ownerKey: string }) {
 const onboarding = useOnboarding();
 const { lang } = useLang();
 const c = COPY[lang];
 const { scope, ready, ended, unavailable: identityUnavailable, retryIdentity, invalidateIdentity } = useReadingScope(ownerKey);
 const [result, setResult] = useState<{ owner: string; data: TodayPayload } | null>(null);
 const [phase, setPhase] = useState<"loading" | "ready" | "auth" | "unavailable">("loading");
 const loadSequence = useRef(0);
 const invalidateRef = useRef(invalidateIdentity);
 useLayoutEffect(() => { invalidateRef.current = invalidateIdentity; }, [invalidateIdentity]);
 const endAttention = useCallback(() => invalidateRef.current(), []);

 async function load() {
  const ticket = ++loadSequence.current;
  setPhase("loading"); setResult(null);
  try {
   const { response, value } = await readingJson(scope, "/api/shared-shell/today");
   const data = todayPayload(value);
   if (ticket !== loadSequence.current) return;
   if (response.status === 401) { invalidateIdentity(); return; }
   if (!response.ok || !data) throw Error("unavailable");
   setResult({ owner: ownerKey, data }); setPhase("ready");
  } catch {
   if (!scope.current?.signal.aborted && ticket === loadSequence.current) setPhase("unavailable");
  }
 }
 useEffect(() => {
  if (!ready) { ++loadSequence.current; queueMicrotask(() => { setResult(null); }); return; }
  const controller = scope.current;
  queueMicrotask(() => { if (controller?.signal.aborted) return; void load(); });
  // Requests and visible results belong to the verified identity generation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [ready, ownerKey]);

 const data = ready && result?.owner === ownerKey ? result.data : null;
 const status = (state: string | null) => AVAILABILITY[state || ""]?.[lang === "zh" ? 1 : 0] ||
  (lang === "zh" ? "来源状态不可用" : "Source availability unavailable");
 const sourceStatus = (workspace: TodayPayload["workspaces"][number]) => workspace.failure
  ? (lang === "zh" ? "来源核验未完成" : "Source verification failed") : status(workspace.state);
 const needsAttention = data?.workspaces.filter(workspace => workspace.failure || !workspace.state ||
  !["CURRENT", "HISTORICAL_AS_KNOWN"].includes(workspace.state)) ?? [];
 const sectionHref = (id: string) => data?.sections.find(section => section.id === id)?.href ?? "/macro_monetary.html";
 const summary = data?.read.clauses.map(clause =>
  `${localText(clause.topic, lang)}${lang === "zh" ? "" : " "}${localText(clause.predicate, lang)}${localText(clause.punct, lang)}`
 ).join("") ?? "";

 return <main id="shared-shell-content" tabIndex={-1} className={`${styles.root} ${today.today}`}>
  <header className={`${styles.heading} ${today.pageHeading}`}>
   <div><h1>{c.title}</h1><p>{c.intro}</p></div>
   <Link className={today.overviewLink} href="/macro.html">{c.overview}<Arrow /></Link>
  </header>
  {ended || phase === "auth" ? <div role="status" className={styles.notice}>
   <p>{c.auth}</p><div className={styles.actions}><button onClick={() => onboarding.open("signin")}>{c.signIn}</button>
   <button onClick={retryIdentity}>{lang === "zh" ? "重新验证所选内容" : "Recheck selected context"}</button></div>
  </div> : identityUnavailable ? <div role="status" className={styles.notice}>
   <p>{c.accountUnavailable}</p>
   <button onClick={retryIdentity}>{c.retry}</button>
  </div> : !ready ? <div role="status" className={`${styles.loading} ${today.loading}`}>
   <span>{c.loading}</span><div className={styles.skeleton} /><div className={styles.skeleton} />
  </div> : <>
   {phase === "loading" ? <div role="status" className={styles.loading}>{c.loading}<div className={styles.skeleton} /></div> : !data ? <section role="status" className={`${styles.notice} ${today.unavailable}`}>
    <div className={styles.eyebrow}>{c.owner}</div><h2>{c.unavailableTitle}</h2><p>{c.unavailable}</p>
    <div className={styles.actions}><button onClick={() => void load()}>{c.retry}</button>
    <Link href="/macro_monetary.html">{c.command} →</Link></div>
   </section> : <section className={today.brief} aria-labelledby="today-command">
    <div className={today.briefHeader}><span className={styles.eyebrow}>{c.owner}</span>
     <span className={today.verification} title={c.published}>{data.state === "ready" ? c.ready : data.state === "partial" ? c.partial : c.missing}</span>
    </div>
    <h2 id="today-command" className={today.marketRead}>{summary || c.unavailable}</h2>
    {data.read.as_of && <p className={today.readingDate}>{c.asof}: <strong>{localText(data.read.as_of_display, lang) || data.read.as_of}</strong>
     <span>{localText(data.read.as_of_meaning, lang)}</span>
    </p>}
    <div className={`${styles.actions} ${today.briefActions}`}>
     <Link className={`${styles.action} ${styles.primary}`} href="/macro_monetary.html">{c.command}<Arrow /></Link>
     <span className={styles.coverage}>{data.coverage.available} {c.of} {data.coverage.total} {c.sections}</span>
    </div>
    {data.read.omitted && <p className={today.coverageNote}>{c.omitted}</p>}
   </section>}

   <TodayResearchAttention ownerKey={ownerKey} scope={scope} onUnauthenticated={endAttention}
    render={({ continuation, briefing }) => <div className={today.jobs}>
     <section className={today.watchJob} aria-label={c.attentionLabel}>
      <TodayWatchAttention ownerKey={ownerKey} scope={scope} onUnauthenticated={endAttention} />
     </section>
     <aside className={today.continuationJob}>{continuation}</aside>
     <div className={today.researchJob}>{briefing}</div>
     <section className={today.coverageJob} aria-labelledby="today-coverage">
      <h2 id="today-coverage">{c.attention}</h2>
     {!data ? <div className={today.nextSteps}><p className={styles.muted}>{c.keepGoingNote}</p>
      <Link href="/discover">{c.discover}<Arrow /></Link></div>
     : needsAttention.length === 0 ? <p className={styles.muted}>{c.noAttention}</p>
     : <ul className={today.attentionList}>{needsAttention.slice(0, 4).map(workspace => {
      const href = sourceHref(workspace.href);
      return <li className={today.attentionRow} key={workspace.workspace_id}>
       <div><h3>{href ? <Link href={href}>{localText(workspace.title, lang) || workspace.workspace_id}<Arrow /></Link> : localText(workspace.title, lang) || workspace.workspace_id}</h3>
        <span>{c.effective}: {workspace.effective_date || c.noClock}</span></div>
       <span className={today.sourceStatus}>{sourceStatus(workspace)}</span>
      </li>;
     })}</ul>}
     {data && <details><summary>{c.details}</summary><ul className={styles.list}>{data.workspaces.map(workspace =>
      <li className={styles.row} key={workspace.workspace_id}><h3>{localText(workspace.title, lang) || workspace.workspace_id}</h3>
       <p>{sourceStatus(workspace)}</p><small>{c.effective}: {workspace.effective_date || c.noClock}<br />{c.calculated}: {workspace.calculation_as_of || c.noClock}</small>
      </li>)}</ul></details>}
     {data && <details><summary>{c.allSections}</summary><ul className={styles.list}>{data.sections.map(section =>
      <li className={styles.row} key={section.id}><Link href={section.href}>{localText(section.label, lang)} →</Link></li>
     )}</ul></details>}
      {data && <details><summary>{c.sourceReadings}</summary>
    <div className={today.readings} aria-label={c.sourceReadings}>
     {data.strip.filter(chip => chip.id !== "coverage").map(chip =>
      <Link className={today.reading} key={chip.id} href={sectionHref(chip.section)}>
       <span className={today.readingLabel}>{localText(chip.label, lang)}<Arrow /></span>
       <strong>{chip.null ? chip.cause === "see_curve" ? c.curve : c.noSummary : localText(chip.value, lang)}</strong>
       <span className={today.readingClock}>{localText(chip.as_of_display, lang) || chip.as_of || c.noClock}</span>
       {chip.note && <span className={today.readingNote}>{localText(chip.note, lang)}</span>}
      </Link>
     )}
    </div>
      </details>}
     </section>
    </div>} />
   {data && <details className={today.evidence}><summary>{c.clocks}</summary><p>{c.clockNote}</p><dl>
    <div><dt>{c.manifest}</dt><dd>{data.source.manifest_generated_at || c.noClock}</dd></div>
    <div><dt>{c.hash}</dt><dd className={styles.source}>{data.source.manifest_sha256}</dd></div>
   </dl></details>}
  </>}
 </main>;
}

/** A subject switch destroys the reader lifetime, including A→B→A re-entry. */
export default function TodayWorkspace({ ownerKey }: { ownerKey: string }) {
 return <TodayWorkspaceSession key={ownerKey} ownerKey={ownerKey} />;
}
