"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { useSettings } from "@/components/settings/SettingsProvider";
import { readingJson, useReadingScope } from "@/lib/shared-shell/useReadingScope";
import { parseCycleModel, type Band, type CycleModel } from "@/lib/flagshipCycle";
import { niceTicks, thinLabels, useChartWidth } from "@/components/charts/svgChart";
import styles from "./CycleIntelligence.module.css";
import namesZh from "./cycleNames.zh.json";

function PositionChart({ band, label }: { band: Band; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useChartWidth(ref, 300);
  const data = band.osc, start = data[0]?.x ?? 0, end = data.at(-1)?.x ?? 0;
  const valid = data.length > 1 && end > start;
  const x = (v: number) => 26 + (v-start) / (end-start) * (width-43);
  const y = (v: number) => 158 - Math.min(100,Math.max(0,v)) * 1.45;
  const years = valid ? Array.from({length:Math.max(0,Math.floor(end)-Math.ceil(start)+1)}, (_,i)=>Math.ceil(start)+i) : [];
  return <div ref={ref} className={styles.chart}>{valid && <svg role="img" aria-label={label} width={width} height={190} viewBox={`0 0 ${width} 190`}>
    <title>{label}</title>{niceTicks(0,100,3).values.map(v=><g key={v}><text x={0} y={y(v)+4}>{v}</text>
      <line x1={26} x2={width-12} y1={y(v)} y2={y(v)} /></g>)}
    <path d={data.map((p,i)=>(i ? "L" : "M")+x(p.x).toFixed(2)+" "+y(p.v).toFixed(2)).join(" ")} />
    {thinLabels(years,x,58).map(v=><text key={v} x={x(v)} y={181} textAnchor="middle">{v}</text>)}
  </svg>}</div>;
}
type View = {phase:"ready"; model:CycleModel} | {phase:"loading"|"restricted"|"unavailable"};

export function CycleReading({ model }: { model: CycleModel }) {
  const { lang } = useLang(), zh = lang === "zh";
  const t = (en:string,cn:string) => zh ? cn : en;
  const params = useSearchParams();
  const card = model.cards.find(c=>c.id===params.get("cycle")) ?? model.cards.find(c=>c.id==="gold") ?? model.cards[0];
  const band = card.bands.find(b=>b.name===params.get("band")) ?? card.bands[0];
  const reverse = [...band.turns].reverse();
  const turn = reverse.find(v=>v.date===params.get("turn")) ?? reverse[0];
  const name = (c:typeof card) => zh ? (namesZh as Record<string,string>)[c.id] ?? c.name : c.name;
  const bandName = (b:Band) => b.tier === "frame" ? t("Historical timeline","历史时间线") : t("Measured cycle","实测周期");
  const kind = (v:string) => v === "peak" ? t("Peak","高点") : t("Trough","低点");
  function navigate(c:string,b?:string,date?:string) {
    const url = new URL(window.location.href);
    url.searchParams.set("cycle",c);
    if (b) url.searchParams.set("band",b); else url.searchParams.delete("band");
    if (date) url.searchParams.set("turn",date); else url.searchParams.delete("turn");
    window.history.pushState(null,"",url);
  }
  const period = (date:string) => band.monthly ? date.slice(0,7) : date;
  return <>
    <div className={styles.controls}><label>{t("Cycle","周期")} <select value={card.id} onChange={e=>navigate(e.target.value)}>
      {model.cards.map(c=><option key={c.id} value={c.id}>{name(c)}</option>)}</select></label>
      {card.bands.length>1 && <label>{t("View","视图")} <select value={band.name} onChange={e=>navigate(card.id,e.target.value)}>
        {card.bands.map(b=><option key={b.name} value={b.name}>{bandName(b)} · {b.name}</option>)}</select></label>}</div>
    <section className={styles.hero}><small>{name(card)} · {bandName(band)}</small>
      <h2>{turn ? [turn.tentative===true ? t("Provisional","暂定") : turn.tentative===false ? t("Confirmed","已确认") : "",kind(turn.kind)].filter(Boolean).join(" ") : t("Turn history unavailable","暂无转折记录")}</h2>
      <p>{turn ? period(turn.date) : "—"}{turn?.note ? " · "+turn.note : ""}</p>
      {band.stale && <p>{t("This band has a delayed source reading.","此频段的来源读数已延迟。")}</p>}</section>
    <div className={styles.panels}>
      <section className={styles.card}><h2>{band.tier==="measured" ? t("Cycle position","周期位置") : t("Historical turns","历史转折")}</h2>
        {band.tier==="measured" && (band.osc.length>1 ? <><PositionChart band={band} label={t("Cycle oscillator, 0 to 100","周期振荡指标，0 至 100")}/>
          <small>{t("Oscillator · 0–100","振荡指标 · 0–100")} · {band.asof ? period(band.asof) : t("Date unavailable","日期未知")}</small></> : <p>{t("No measured curve is available.","暂无实测曲线。")}</p>)}
        {turn && <label className={styles.field}>{t("Inspect a turn","查看转折")} <select value={turn.date} onChange={e=>navigate(card.id,band.name,e.target.value)}>
          {reverse.map((v,i)=><option key={v.date+i} value={v.date}>{period(v.date)} · {kind(v.kind)}{v.tentative===true ? t(" · Provisional"," · 暂定") : ""}</option>)}
        </select></label>}</section>
      <section className={styles.card}><h2>{band.tier==="frame" ? t("Timeline evidence","历史证据") : t("Estimated next window","预计下个时间区间")}</h2>
        {band.projection ? <><strong>{band.projection.low} – {band.projection.high}</strong><p>{kind(band.projection.kind)} · {t("Median","中位时间")} {band.projection.mid}</p>
          {band.projection.overdue && <p>{t("The historical timing window is overdue.","已超过历史时间区间。")}</p>}</> :
          <p>{band.tier==="frame" ? t("This historical timeline records selected turning points.","此时间线记录筛选出的历史转折点。") : t("An estimate is unavailable for this band.","此频段暂无估计区间。")}</p>}
        <details><summary>{t("Source and timing","来源与时间")}</summary>
          {band.source && <p>{t("Series","序列")} · {band.source}</p>}
          {band.asof && <p>{t("Band observation","频段观测")} · {period(band.asof)}</p>}
          <p>{t("Newest measured series","最新实测序列")} · {model.latest ?? "—"}</p><p>{t("Research notes","研究笔记")} · {model.notes ?? "—"}</p>
        </details></section></div></>;
}

export default function CycleIntelligence({owner,explorer}:{owner:string;explorer:string}) {
  const {lang}=useLang(), t=(en:string,cn:string)=>lang==="zh"?cn:en;
  const onboarding=useOnboarding(), settings=useSettings();
  const {scope,ready,ended,unavailable,invalidateIdentity}=useReadingScope(owner);
  const [view,setView]=useState<View>({phase:"loading"});
  useEffect(()=>{
    if (!ready) return;
    let current=true;
    void readingJson(scope,"/api/sector-intelligence?source=flagship_cycles").then(({response,value})=>{
      if (!current) return;
      if (response.status===401) {invalidateIdentity();return;}
      const model=response.ok && value && typeof value==="object" && "data" in value ? parseCycleModel(value.data) : null;
      setView(model ? {phase:"ready",model} : {phase:response.status===403?"restricted":"unavailable"});
    }).catch(()=>{if(current)setView({phase:"unavailable"});});
    return ()=>{current=false;};
  },[ready,scope,invalidateIdentity]);
  const guest=!owner||ended;
  return <main id="shared-shell-content" tabIndex={-1} className={`main2 ${styles.viewport}`}><div className={styles.page}>
    <header><small>{t("Research / Capital & regimes","研究 / 资本与市场环境")}</small><h1>{t("Cycle Intelligence","周期研究")}</h1></header>
    {ready && view.phase==="ready" ? <CycleReading model={view.model}/> : <section className={styles.hero}>
      <h2>{t("Market cycles and historical turns","市场周期与历史转折")}</h2>
      {guest ? <><p>{t("Sign in to inspect measured cycles and their turning points.","登录后查看实测周期与转折点。")}</p>
        <button onClick={()=>onboarding.open("signin")}>{t("Sign in","登录")}</button></> :
        view.phase==="restricted" ? <button onClick={()=>settings.open("billing")}>{t("View research access","查看研究权限")}</button> :
        unavailable||view.phase==="unavailable" ? <><p>{t("The cycle source is unavailable.","周期来源暂不可用。")}</p><button onClick={()=>window.location.reload()}>{t("Try again","重试")}</button></> :
        <p role="status">{t("Loading cycle readings…","正在加载周期读数…")}</p>}</section>}
    <a className={styles.link} href={explorer}>{t("Open full cycle explorer","打开完整周期研究")} ↗</a>
  </div></main>;
}
