"use client";

import Link from "next/link";
import { useState } from "react";
import { armingNote, buildWatchCondition, watchesFor, watchState, type OwnerAlertRow, type WatchBuild, type WatchKind, type WatchLink, type WatchState } from "@/lib/investigationWatch";
import styles from "./InvestigationWorkspace.module.css";

export type WatchLoadState = "loading" | "ready" | "unauthenticated" | "unavailable";
type Props = {
 link: WatchLink; symbol: string; rows: OwnerAlertRow[] | null; current?: { value: number; asOf: string } | null;
 lang: "en" | "zh"; disabled: boolean; loadState: WatchLoadState;
 onArm(build: Extract<WatchBuild, { ok: true }>): Promise<void>; onRearm(alertId: string): Promise<void>; onRetry?(): void;
};
const C={
 en:{strip:"WATCH",armed:"ARMED · WAITING",fired:"FIRED",disarmed:"now disarmed",notArmed:"NOT ARMED",condition:"Condition",observed:"Observed",current:"Current",currentNotLoaded:"current quote not loaded here",above:"above the threshold",below:"below the threshold",within:"within the threshold",cadenceLine:"fires once · re-arm manually",
  metric:"Metric",metricValue:"last price · latest hub quote (EOD fallback named in the receipt)",scope:"Scope",threshold:"Threshold",source:"Source",sourceValue:"alerts engine",cadence:"Cadence",cadenceValue:"evaluated every 5 minutes",behaviour:"Behaviour",behaviourValue:"fires once and disarms · re-arm manually · no cooldown",missing:"Missing input",missingValue:"no price available · never a fire · an unseen crossing is never inferred",correction:"Correction",correctionValue:"a correction is a new fire event, never an edit",
  kinds:"Watch kinds",offered:"Offered here",notOffered:"Not offered",kindTouch:"price touch",kindProximity:"price proximity · wall levels only",kindExposure:"exposure change",kindRotation:"rotation transition",kindEvent:"event time",noEvaluator:"no evaluator in the alerts owner",engFollow:"no evaluator in the alerts owner · follow-on L-W3C-ENG",
  form:"Arm a watch",aboveOp:"above",belowOp:"below",priceThreshold:"price threshold",proximityThreshold:"proximity band (% of the wall level)",wallCall:"call wall",wallPut:"put wall",arm:"Arm watch",rearm:"Re-arm watch",notAnOrder:"A watch is not an order and implies no profitable signal.",
  signIn:"Sign in to arm a watch",unavailable:"The alerts owner could not be read · what is shown is the saved investigation only · retry",retry:"Retry",plan:"This watch kind is not included in your plan",armFailed:"The watch could not be armed just now. Nothing was changed; try again.",unknownShape:"a saved condition in the alerts owner's own words"},
 zh:{strip:"监测",armed:"已布防 · 等待中",fired:"已触发",disarmed:"现已解除",notArmed:"未布防",condition:"条件",observed:"观测值",current:"当前报价",currentNotLoaded:"此处未加载当前报价",above:"高于阈值",below:"低于阈值",within:"在阈值以内",cadenceLine:"触发一次 · 手动重新布防",
  metric:"指标",metricValue:"最新价 · 最新中枢报价（EOD 回退在回执中注明）",scope:"范围",threshold:"阈值",source:"来源",sourceValue:"提醒引擎",cadence:"频率",cadenceValue:"每 5 分钟评估一次",behaviour:"行为",behaviourValue:"触发一次并解除 · 手动重新布防 · 无冷却",missing:"输入缺失",missingValue:"无报价时不触发 · 绝不在观测间隙推断穿越",correction:"修正",correctionValue:"修正是新的触发事件，绝不改动旧事件",
  kinds:"监测类型",offered:"此处提供",notOffered:"不提供",kindTouch:"价格触达",kindProximity:"价格接近 · 仅墙位水平",kindExposure:"敞口变化",kindRotation:"轮动切换",kindEvent:"事件时间",noEvaluator:"提醒系统无评估器",engFollow:"提醒系统无评估器 · 后续 L-W3C-ENG",
  form:"创建监测",aboveOp:"高于",belowOp:"低于",priceThreshold:"价格阈值",proximityThreshold:"接近带宽（占墙位水平的百分比）",wallCall:"看涨墙",wallPut:"看跌墙",arm:"布防监测",rearm:"重新布防",notAnOrder:"监测不是订单，也不暗示任何盈利信号。",
  signIn:"登录后即可布防监测",unavailable:"提醒系统暂不可读 · 此处仅显示已保存的研究 · 重试",retry:"重试",plan:"此监测类型不包含在你的方案中",armFailed:"暂时无法布防监测。未做任何更改，请重试。",unknownShape:"以提醒系统自身措辞保存的条件"},
} as const;
const plain=(c:(typeof C)["en"|"zh"],state:WatchState):string=>{
 if(state.state==="armed")return c.armed;
 if(state.state==="fired")return `${c.fired} · ${state.at?`${state.at.slice(11,19)}Z`:"—"}${state.disarmed?` · ${c.disarmed}`:""}`;
 return c.notArmed;
};
const conditionWords=(c:(typeof C)["en"|"zh"],condition:Record<string,unknown>|undefined):string=>{
 if(!condition)return c.unknownShape;
 if(condition.type==="price"&&typeof condition.value==="number"&&(condition.op==="above"||condition.op==="below"))
  return c===C.zh?`最新价${condition.op==="above"?"高于":"低于"} ${condition.value.toFixed(2)}`:`last price ${condition.op} ${condition.value.toFixed(2)}`;
 if(condition.type==="opt_wall_touch"&&typeof condition.within_pct==="number")
  return c===C.zh?`进入 ${String(condition.root??"")} ${condition.wall==="put"?"看跌":"看涨"}墙 ${condition.within_pct}% 以内（EOD）`:`within ${condition.within_pct}% of the ${String(condition.root??"")} ${condition.wall==="put"?"put":"call"} wall (EOD)`;
 return c.unknownShape;
};

export default function InvestigationWatchPanel({link,symbol,rows,current,lang,disabled,loadState,onArm,onRearm,onRetry}:Props) {
 const c=C[lang];
 const [kind,setKind]=useState<WatchKind>("price_touch");
 const [op,setOp]=useState<"above"|"below">("above");
 const [threshold,setThreshold]=useState("");
 const [wall,setWall]=useState<"call"|"put">("call");
 const [note,setNote]=useState<string|null>(null);
 const linked=rows?watchesFor(rows,link.investigation_id):[];
 const fired=linked.find(row=>watchState(row).state==="fired");
 const thresholdNumber=Number(threshold);
 const currentWord=(condition:Record<string,unknown>|undefined):string=>{
  if(!current)return c.currentNotLoaded;
  if(condition?.type==="price"&&(condition.op==="above"||condition.op==="below")&&typeof condition.value==="number")
   return `${current.value.toFixed(2)} · ${condition.op==="above"?(current.value>condition.value?c.above:c.within):(current.value<condition.value?c.below:c.within)}`;
  return current.value.toFixed(2);
 };
 const warn=kind==="price_touch"&&Number.isFinite(thresholdNumber)&&thresholdNumber>0?armingNote(thresholdNumber,op,current??null,lang):"";
 async function arm() {
  const value=Number(threshold);
  const built=buildWatchCondition(link,symbol,kind,kind==="price_touch"?{op,value}:{band_pct:value,wall});
  if(!built.ok){setNote(built.plain[lang]);return;}
  setNote(null);
  try{await onArm(built);}catch(error){setNote(error instanceof Error&&error.message==="plan"?c.plan:c.armFailed);}
 }
 return <section className={styles.watchPanel} data-testid="investigation-watch">
  <p className={styles.eyebrow}>{c.strip}</p>
  {loadState==="loading"&&<div aria-busy="true" data-testid="investigation-watch-loading"><span className={styles.skeletonLine}/><span className={`${styles.skeletonLine} ${styles.skeletonShort}`}/></div>}
  {loadState==="unauthenticated"&&<p role="status"><Link href="/login">{c.signIn}</Link></p>}
  {loadState==="unavailable"&&<p role="status">{c.unavailable}{onRetry&&<button disabled={disabled} onClick={onRetry}>{c.retry}</button>}</p>}
  {loadState==="ready"&&<>
   {linked.length===0&&<p className={styles.watchChip} data-testid="investigation-watch-state">{c.notArmed}</p>}
   {linked.map(row=>{const state=watchState(row);
    return <div key={row.id} className={styles.watchRow} data-testid="investigation-watch-row">
     <p className={styles.watchChip} data-testid="investigation-watch-state" data-watch-fired={state.state==="fired"||undefined}>{plain(c,state)}</p>
     <dl className={styles.strip}><div><dt>{c.condition}</dt><dd>{conditionWords(c,row.condition)}</dd></div>{state.state==="fired"&&state.value!==null&&<div><dt>{c.observed}</dt><dd>{state.value.toFixed(2)}</dd></div>}<div><dt>{c.current}</dt><dd>{currentWord(row.condition)}</dd></div></dl>
     <p><small>{c.cadenceLine}</small></p>
    </div>;})}
   <h3>{c.metric}</h3>
   <dl className={styles.strip}>
    <div><dt>{c.metric}</dt><dd>{c.metricValue}</dd></div>
    <div><dt>{c.scope}</dt><dd>{symbol}</dd></div>
    <div><dt>{c.source}</dt><dd>{c.sourceValue}</dd></div>
    <div><dt>{c.cadence}</dt><dd>{c.cadenceValue}</dd></div>
    <div><dt>{c.behaviour}</dt><dd>{c.behaviourValue}</dd></div>
    <div><dt>{c.missing}</dt><dd>{c.missingValue}</dd></div>
    <div><dt>{c.correction}</dt><dd>{c.correctionValue}</dd></div>
   </dl>
   <details open className={styles.landing}>
    <summary>{c.kinds}</summary>
    <ul className={styles.kinds} data-testid="investigation-watch-kinds">
     <li><strong>{c.offered}</strong>
      <ul><li>{c.kindTouch}</li><li>{c.kindProximity}</li></ul></li>
     <li><strong>{c.notOffered}</strong>
      <ul><li>{c.kindExposure} — {c.engFollow}</li><li>{c.kindRotation} — {c.noEvaluator}</li><li>{c.kindEvent} — {c.noEvaluator}</li></ul></li>
    </ul>
   </details>
   <h3>{c.form}</h3>
   <div className={styles.pair}>
    <label>{c.kinds}<select data-testid="investigation-watch-kind" value={kind} onChange={e=>setKind(e.target.value as WatchKind)}><option value="price_touch">{c.kindTouch}</option><option value="price_proximity">{c.kindProximity}</option></select></label>
    {kind==="price_touch"?<label>{c.condition}<select data-testid="investigation-watch-op" value={op} onChange={e=>setOp(e.target.value as "above"|"below")}><option value="above">{c.aboveOp}</option><option value="below">{c.belowOp}</option></select></label>
     :<label>{c.source}<select data-testid="investigation-watch-wall" value={wall} onChange={e=>setWall(e.target.value as "call"|"put")}><option value="call">{c.wallCall}</option><option value="put">{c.wallPut}</option></select></label>}
    <label>{kind==="price_touch"?c.priceThreshold:c.proximityThreshold}<input data-testid="investigation-watch-threshold" type="number" step="any" min="0" value={threshold} onChange={e=>setThreshold(e.target.value)}/></label>
   </div>
   {note&&<p role="alert">{note}</p>}
   {warn&&<p role="status">{warn}</p>}
   <div className={styles.actions}>
    <button data-testid="investigation-watch-arm" disabled={disabled||!threshold} onClick={()=>void arm()}>{c.arm}</button>
    {fired&&<button data-testid="investigation-watch-rearm" disabled={disabled} onClick={()=>void onRearm(fired.id).catch(()=>setNote(c.armFailed))}>{c.rearm}</button>}
   </div>
   <p><small>{c.notAnOrder}</small></p>
  </>}
 </section>;
}
