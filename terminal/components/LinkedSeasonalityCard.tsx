"use client";
import {useState} from "react";
import Link from "next/link";
import {useT} from "@/lib/i18n";
import {useWorkspaceContextConsumer} from "@/lib/useWorkspaceContextConsumer";
import type {ContextMode,WorkspaceContextSession} from "@/lib/workspaceContextSession";
import SeasonalityCard from "./SeasonalityCard";
import styles from "./LinkedSeasonalityCard.module.css";

/** One existing data-owner view consuming the mounted Chart Bus. Selecting a
 * mode changes this view only; it does not pin Brain or save a workspace. */
export default function LinkedSeasonalityCard({context,activeSymbol,onOpenCurrent}:{
 context:WorkspaceContextSession|null;activeSymbol:string;onOpenCurrent:()=>void;
}){
 const t=useT();
 const {snapshot,setMode}=useWorkspaceContextConsumer(context,"seasonality-card","active_security");
 const [refused,setRefused]=useState(false);
 const symbol=snapshot?.value.kind==="security"&&typeof snapshot.value.id==="string"?snapshot.value.id:null;
 const modes:Array<{mode:ContextMode;label:string}>=[
  {mode:"follow",label:t("contextFollow")},
  {mode:"pin",label:t("contextPin")},
  {mode:"local",label:t("contextUnlink")},
 ];
 const status=!snapshot||!symbol?t("contextUnavailable"):
  t(snapshot.mode==="follow"?"contextFollowing":snapshot.mode==="pin"?"contextPinned":"contextUnlinked")
   .replace("{symbol}",symbol).replace("{active}",activeSymbol);
 return <section className={styles.card} aria-label={t("contextSeasonality")}>
  <div className={styles.controls} role="group" aria-label={t("contextLinking")}>
   {modes.map(({mode,label})=><button key={mode} type="button" aria-pressed={snapshot?.mode===mode} disabled={!snapshot||!symbol}
    onClick={()=>setRefused(!setMode(mode))}>{label}</button>)}
  </div>
  <p className={styles.status} role="status">{refused?t("contextRefused"):status}</p>
  <p className={styles.status}>{t("contextSessionOnly")}</p>
  {symbol&&snapshot&&<SeasonalityCard key={`${snapshot.epoch}:${symbol}`} symbol={symbol}
   onOpenPane={symbol===activeSymbol?onOpenCurrent:undefined}/>}
  {symbol&&symbol!==activeSymbol&&<Link className={styles.open} href={`/analysis?symbol=${encodeURIComponent(symbol)}`}>
   {t("contextOpenResearch").replace("{symbol}",symbol)}
  </Link>}
 </section>;
}
