"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { localText, todayPayload, type TodayPayload } from "@/lib/shared-shell/readingPayloads";
import { readingFreshness, freshnessLabel } from "@/lib/shared-shell/readingFreshness";
import { useReadingClock } from "@/lib/shared-shell/useReadingClock";
import { readingJson, useReadingScope } from "@/lib/shared-shell/useReadingScope";
import { decodeCycleIntelligence, decodeProphetIntelligence, type CycleIntelligence, type ProphetIntelligence } from "@/lib/shared-shell/intelligencePayloads";
import IntelligenceNav from "./IntelligenceNav";
import s from "./Intelligence.module.css";
const COPY = {
 en: { title:"Market Intelligence", intro:"Start with the market backdrop, inspect sector cycles, then investigate a company or plan. Each reading keeps its own source and date.",
  macro:"Macro Dashboard", cycles:"Sector Cycles", prophet:"Prophet", macroSource:"Macro Command · United States", cycleSource:"Sector cycle model · United States", prophetSource:"Macro-originated plans",
  loading:"Loading source reading…", unavailable:"This reading is unavailable. It does not mean risk is low or there are no opportunities.", access:"Your current access does not include this reading. Other available readings remain usable.", missing:"This source has not published a reading.", retry:"Try again", date:"Source as of", unknown:"Date unavailable", stale:"This is a previously saved reading. Check its date before relying on it.",
  openMacro:"Open Macro Dashboard", openCycles:"Open Sector Cycles", openProphet:"Open opportunity workspace", openModelPlans:"Model plans & options", openSectors:"Explore sector intelligence", openCommand:"Open Macro Command",
  coverage:"source sections verified", partial:"Some source readings are omitted or unavailable. A partial view is not an all-clear.", noSummary:"The source did not publish a summary.",
  cycleNote:"Published cycle phases and positions, not a relative-strength rotation score. A position is not a probability or confidence rating.", position:"Position", model:"model", unavailableValue:"Unavailable", sectors:"sectors covered", noSectors:"The published source reports zero covered sectors.",
  preview:"A preview of published open plans in the source's order, not new recommendations.", openCount:"Open plans in published source", noPlans:"The published source reports no open plans.", priceDate:"Plan price basis", planDate:"Plan revision", published:"Publication date", mixed:"These readings come from different source dates.", delayed:"The source data is delayed.", sourceUnknown:"The underlying source date is unknown.",
  accountEnded:"Your account changed or your session ended. Private readings have been cleared.", identityUnavailable:"Account verification is unavailable. Private readings are hidden.", checking:"Verifying your account…", signIn:"Sign in", recheck:"Recheck account", researchOnly:"Research context only. The overview does not combine sources into a trading signal or authorize a trade.",
 },
 zh: { title:"市场情报", intro:"先了解宏观环境，再查看行业周期，继而研究公司或计划。每项读数均保留其来源与日期。",
  macro:"宏观仪表盘", cycles:"行业周期", prophet:"Prophet", macroSource:"宏观指挥台 · 美国", cycleSource:"行业周期模型 · 美国", prophetSource:"宏观引擎生成的计划",
  loading:"正在加载来源读数…", unavailable:"此读数暂不可用。这并不代表风险较低或没有机会。", access:"当前权限不包含此读数。其他可用读数仍可查看。", missing:"该来源尚未发布读数。", retry:"重试", date:"来源截至", unknown:"日期不可用", stale:"这是先前保存的读数。使用前请核对其日期。",
  openMacro:"打开宏观仪表盘", openCycles:"打开行业周期", openProphet:"打开机会工作台", openModelPlans:"模型计划与期权", openSectors:"探索行业情报", openCommand:"打开宏观指挥台",
  coverage:"个来源板块已核验", partial:"部分来源读数被省略或暂不可用。局部信息并不代表风险已解除。", noSummary:"来源未发布摘要。",
  cycleNote:"展示已发布的周期阶段与位置，并非相对强度轮动评分。周期位置不是概率或置信度。", position:"位置", model:"模型", unavailableValue:"不可用", sectors:"个行业已覆盖", noSectors:"已发布来源报告零个已覆盖行业。",
  preview:"按原始发布顺序展示未关闭计划；仅为有限预览，并非新的建议。", openCount:"来源报告的开放计划数", noPlans:"已发布来源报告当前无开放计划。", priceDate:"计划价格基准", planDate:"计划修订", published:"发布日期", mixed:"来源报告了混合数据日期。", delayed:"来源报告数据延迟。", sourceUnknown:"来源数据日期未知。",
  accountEnded:"账户已更改或会话已结束。私人读数已清除。", identityUnavailable:"账户核验暂不可用。私人读数已隐藏。", checking:"正在核验账户…", signIn:"登录", recheck:"重新核验账户", researchOnly:"仅作为研究背景。本总览不会将来源组合为交易信号，也不授权交易。",
 },
} as const;
const PHASE: Record<string, readonly [string,string]> = {
 Trough:["Trough","底部"], Recovery:["Recovery","复苏"], Expansion:["Expansion","扩张"], Peak:["Peak","顶部"], Downturn:["Downturn","下行"],
 pre_trigger:["Before trigger","尚未触发"], triggered_pre_t1:["Triggered · before target 1","已触发 · 未达第一目标"],
 delivering:["Delivering","兑现中"], overtime:["Window elapsed","窗口已过"], invalidated:["Invalidated","已失效"],
 watch:["Watch","观察"], ready:["Ready","就绪"], entered:["Entered","已进入"], resolved:["Resolved","已结案"],
};
type Kind = "macro" | "cycles" | "prophet";
type Payload = TodayPayload | CycleIntelligence | ProphetIntelligence;
type Read = { phase:"loading"|"ready"|"unavailable"|"access"|"missing"; data:Payload|null; generation:AbortController|null };
const SOURCES: Record<Kind,string> = { macro:"/api/shared-shell/today", cycles:"/api/sector-intelligence?source=history&view=intelligence", prophet:"/api/flow?f=prophet_idx&view=intelligence" };
const KINDS: Kind[] = ["macro","cycles","prophet"];
const initial = (): Record<Kind,Read> => Object.fromEntries(KINDS.map(k=>[k,{phase:"loading",data:null,generation:null}])) as Record<Kind,Read>;
export default function IntelligenceWorkspace({ ownerKey }: { ownerKey:string }) {
 return <IntelligenceSession key={ownerKey} ownerKey={ownerKey} />;
}
function IntelligenceSession({ownerKey}:{ownerKey:string}) {
 const {lang} = useLang(), c = COPY[lang];
 const {scope,ready,ended,unavailable,retryIdentity,invalidateIdentity} = useReadingScope(ownerKey);
 const [reads,setReads] = useState(initial);
 const sequence = useRef<Record<Kind,number>>({macro:0,cycles:0,prophet:0});
 const load = useCallback(async (kind:Kind) => {
  const generation = scope.current;
  if (!generation || generation.signal.aborted) return;
  const ticket = ++sequence.current[kind];
  setReads(old=>({...old,[kind]:{phase:"loading",data:null,generation}}));
  try {
   const {response,value} = await readingJson(scope,SOURCES[kind]);
   if (generation !== scope.current || generation.signal.aborted || ticket !== sequence.current[kind]) return;
   if (response.status === 401) { invalidateIdentity(); return; }
   const data = response.ok ? (kind === "macro" ? todayPayload(value) : kind === "cycles" ? decodeCycleIntelligence(value) : decodeProphetIntelligence(value)) : null;
   const phase = response.status === 403 ? "access" : response.status === 404 ? "missing" : data ? "ready" : "unavailable";
   setReads(old=>({...old,[kind]:{phase,data,generation}}));
  } catch {
   if (generation === scope.current && !generation.signal.aborted && ticket === sequence.current[kind])
    setReads(old=>({...old,[kind]:{phase:"unavailable",data:null,generation}}));
  }
 },[scope,invalidateIdentity]);
 useEffect(()=>{
  if (!ready) return;
  const controller = scope.current;
  queueMicrotask(()=>{if(controller === scope.current && !controller?.signal.aborted) KINDS.forEach(k=>void load(k));});
 },[ready,load,scope]);
 // Reuse the existing display clock; idle labels must age without refetching.
 const clockBucket = useCallback((at: Date) => {
  if (!ready) return "inactive";
  const macro = reads.macro.data as TodayPayload | null;
  const cycles = reads.cycles.data as CycleIntelligence | null;
  const prophet = reads.prophet.data as ProphetIntelligence | null;
  const dates = [macro?.read.as_of, ...(macro?.strip.filter(chip => chip.id !== "coverage").slice(0, 4).map(chip => chip.as_of) ?? []),
   cycles?.sourceAsOf, prophet?.sourceAsOf, ...(prophet?.plans.map(plan => plan.priceAsOf) ?? [])];
  return dates.map(date => {
   const age = readingFreshness(date, at);
   return `${age.kind}|${age.sessions}|${age.days}`;
  }).join(";");
 }, [ready, reads]);
 const now = useReadingClock(clockBucket);
 const clock = (asOf:string|null) => <span className={s.clock}>{c.date}: {asOf ?? c.unknown} · {freshnessLabel(readingFreshness(asOf,now),lang)}</span>;
 const phaseLabel = (phase:string|null) => phase && PHASE[phase] ? PHASE[phase][lang === "zh" ? 1 : 0] : c.unavailableValue;
 return <main id="shared-shell-content" tabIndex={-1} className={`main2 ${s.root}`} data-intelligence-overview="">
  <header className={s.header}><h1>{c.title}</h1><p>{c.intro}</p></header>
  <IntelligenceNav />
  {!ready ? <div role="status" className={s.notice}>
   <p>{ended ? c.accountEnded : unavailable ? c.identityUnavailable : c.checking}</p>
   {(ended || unavailable) && <div className={s.footer}>
    {ended && <Link className={s.action} href="/login?next=%2Fintelligence">{c.signIn}</Link>}
    <button className={s.action} onClick={retryIdentity}>{c.recheck}</button>
   </div>}
  </div> : <div className={s.grid}>
   {KINDS.map(kind=>{
    const read = reads[kind].generation === scope.current ? reads[kind] : initial()[kind];
    const title = c[kind], href = kind === "macro" ? "/macro.html" : kind === "cycles" ? "/sector_cycles.html" : "/us_stocks.html";
    return <section key={kind} className={s.card} aria-labelledby={`intel-${kind}`} aria-busy={read.phase === "loading"} data-intelligence-source={kind} data-read-state={read.phase}>
     <p className={s.eyebrow}>{kind === "macro" ? c.macroSource : kind === "cycles" ? c.cycleSource : c.prophetSource}</p><h2 id={`intel-${kind}`}>{title}</h2>
     {read.phase !== "ready" ? <p role="status" className={s.notice}>{c[read.phase]}</p> : kind === "macro" ? (()=>{
      const data = read.data as TodayPayload;
      return <>{clock(data.read.as_of)}
       <p className={s.summary}>{data.read.clauses.length ? data.read.clauses.map(p=>`${localText(p.topic,lang)}${lang === "en" ? " " : ""}${localText(p.predicate,lang)}${localText(p.punct,lang)}`).join("") : c.noSummary}</p>
       <p className={s.detail}>{data.coverage.available} / {data.coverage.total} {c.coverage}</p>
       {(data.state !== "ready" || data.read.omitted) && <p className={s.notice}>{c.partial}</p>}
       <ul>{data.strip.filter(p=>p.id !== "coverage").slice(0,4).map(chip=><li key={chip.id} className={s.metric}>
        <span>{localText(chip.label,lang)}</span><strong>{chip.null ? c.unavailableValue : localText(chip.value,lang)}</strong>{clock(chip.as_of)}
       </li>)}</ul>
       <Link className={s.action} href="/macro_monetary.html">{c.openCommand}</Link>
      </>;
     })() : kind === "cycles" ? (()=>{
      const data = read.data as CycleIntelligence;
      return <>{clock(data.sourceAsOf)}{data.stale && <p className={s.notice}>{c.stale}</p>}
       <p className={s.detail}>{data.coverage} {c.sectors} · {data.benchmark ?? c.unavailableValue}</p>
       {data.rows.length === 0 ? <p className={s.notice}>{c.noSectors}</p> : <ul>{data.rows.map(row=><li key={row.id}><Link className={s.cycleRow} href={`/sectors?sector=${encodeURIComponent(row.id)}&sectorWorkspace=rotation`}>
        <div><span>{lang === "zh" ? row.nameZh ?? row.name : row.name}</span><small>{row.ticker}</small></div>
        <div><strong>{phaseLabel(row.phase)}</strong><small>{c.position} {row.position === null ? "—" : `${row.position.toFixed(1)}/100`}</small></div>
       </Link></li>)}</ul>}
       <p className={s.detail}>{c.cycleNote}</p><Link className={s.action} href="/sectors">{c.openSectors}</Link>
      </>;
     })() : (()=>{
      const data = read.data as ProphetIntelligence;
      return <>{clock(data.sourceAsOf)}<span className={s.clock}>{c.published}: {data.publishedAt ?? c.unknown}</span>
       {(data.stale || data.sourceUnknown || data.sourceDelayed || data.mixedVintage) && <p className={s.notice}>{[data.stale && c.stale,data.sourceUnknown && c.sourceUnknown,data.sourceDelayed && c.delayed,data.mixedVintage && c.mixed].filter(Boolean).join(" ")}</p>}
       <p className={s.summary}>{c.openCount}: <strong>{data.openCount}</strong></p>
       {data.openCount === 0 ? <p className={s.notice}>{c.noPlans}</p> : <><p className={s.detail}>{c.preview}</p><ul>{data.plans.map(plan=><li key={plan.id}>
        <div className={s.planTitle}><Link href={`/analysis?symbol=${encodeURIComponent(plan.symbol)}`}>{plan.symbol} ↗</Link><span>{phaseLabel(plan.phase)}</span></div>
        <span className={s.clock}>{c.priceDate}: {plan.priceAsOf ?? c.unknown} · {freshnessLabel(readingFreshness(plan.priceAsOf,now),lang)}</span>
        <span className={s.clock}>{c.planDate}: {plan.planAsOf ?? c.unknown}</span>
       </li>)}</ul></>}
      </>;
     })()}
     <div className={s.footer}><Link className={s.action} href={href} prefetch={false}>{kind === "macro" ? c.openMacro : kind === "cycles" ? c.openCycles : c.openProphet} →</Link>
      {kind === "prophet" && <Link className={s.action} href="/prophet" prefetch={false}>{c.openModelPlans}</Link>}
      <button className={s.action} aria-label={`${c.retry}: ${title}`} aria-disabled={read.phase === "loading"} onClick={()=>{if(read.phase !== "loading") void load(kind);}}>{c.retry}</button>
     </div>
    </section>;
   })}
  </div>}
  <p className={s.detail}>{c.researchOnly}</p>
 </main>;
}
