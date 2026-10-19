"use client";

import { sectorPaperText } from "@/lib/sectorPaperCopy";

import { useId, useMemo, useRef } from "react";
import { fmtTick, niceTicks, padDomain, thinLabels, useChartWidth } from "@/components/charts/svgChart";
import { formatValue } from "@/lib/sectorIntelligence";
import type { PaperLeadershipSeries, PaperReturnSeries } from "@/lib/sectorPaper";
import styles from "./PaperSectorWorkspace.module.css";

type Lang="en"|"zh";
type Point={session:string;first:number|null;second:number|null};
const dateLabel=(session:string,lang:Lang)=>new Intl.DateTimeFormat(lang==="zh"?"zh-CN":"en-US",
  {month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(session+"T00:00:00Z"));
type ChartProps={points:Point[];start:string;end:string;firstLabel:string;secondLabel:string;description:string;title:string;basis:string;note:string;lang:Lang};

/** Both qualified measurement views use the same measured-pixel SVG primitive. Values enter in percent. */
function PaperSectorLineChart({points,start,end,firstLabel,secondLabel,description,title,basis,note,lang}:ChartProps) {
  const id=useId(),container=useRef<HTMLDivElement>(null),width=useChartWidth(container,880);
  const height=width<500?230:250;
  const margin={top:18,right:width<500?14:28,bottom:36,left:46};
  const geometry=useMemo(()=>{
    const values=points.flatMap(point=>[point.first,point.second]).filter((value):value is number=>value!==null&&Number.isFinite(value));
    const min=Math.min(...values),max=Math.max(...values);
    const [lo,hi]=padDomain(min,max,{padFrac:.13,includeZero:min<0&&max>0});
    const from=Date.parse(start),to=Date.parse(end);
    const x=(session:string)=>margin.left+(Date.parse(session)-from)/(to-from)*(width-margin.left-margin.right);
    const y=(value:number)=>margin.top+(hi-value)/(hi-lo)*(height-margin.top-margin.bottom);
    const ticks=niceTicks(lo,hi,4),dates=thinLabels(points,point=>x(point.session),width<500?76:120);
    const segments=(key:"first"|"second")=>{
      const paths:string[]=[];let path="";
      for(const point of points){const value=point[key];
        if(value===null){if(path)paths.push(path);path="";}
        else path+=`${path?" L":"M"}${x(point.session).toFixed(2)},${y(value).toFixed(2)}`;
      }
      if(path)paths.push(path);return paths;
    };
    const markers=(key:"first"|"second")=>points.filter((point,index)=>point[key]!==null &&
      (index===points.length-1 || ((index===0||points[index-1][key]===null)&&(index===points.length-1||points[index+1][key]===null))));
    return {x,y,ticks,dates,first:segments("first"),second:segments("second"),firstMarkers:markers("first"),secondMarkers:markers("second")};
  },[points,start,end,width,height,margin.left,margin.right,margin.top,margin.bottom]);
  return <div ref={container} className={styles.chart}>
    <div className={styles.chartLegend}><span><i aria-hidden="true"/>{firstLabel} <strong>{formatValue(points[points.length-1].first,2,"%",true)}</strong></span><span className={styles.benchmark}><i aria-hidden="true"/>{secondLabel} <strong>{formatValue(points[points.length-1].second,2,"%",true)}</strong></span><span>{basis}</span></div>
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>{title}</title><desc id={`${id}-description`}>{description}</desc>
      {geometry.ticks.values.map(value=><g key={value}><line x1={margin.left} x2={width-margin.right} y1={geometry.y(value)} y2={geometry.y(value)} stroke="var(--paper-line)" strokeOpacity=".55"/>
        <text x={margin.left-9} y={geometry.y(value)+3} textAnchor="end" fill="var(--paper-muted)" fontSize="10">{fmtTick(value,geometry.ticks.step)}%</text></g>)}
      {geometry.dates.map(point=><text key={point.session} x={geometry.x(point.session)} y={height-9} textAnchor={point.session===start?"start":point.session===end?"end":"middle"}
        fill="var(--paper-muted)" fontSize="10">{dateLabel(point.session,lang)}</text>)}
      {geometry.second.map((path,index)=><path data-series="second" key={index} d={path} fill="none" stroke="var(--paper-muted)" strokeWidth="1.6" strokeDasharray="4 5"/>)}
      {geometry.first.map((path,index)=><path data-series="first" key={index} d={path} fill="none" stroke="var(--paper-link)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>)}
      {geometry.secondMarkers.map(point=><circle key={point.session} cx={geometry.x(point.session)} cy={geometry.y(point.second!)} r="2.6" fill="var(--paper-muted)"/>)}
      {geometry.firstMarkers.map(point=><circle key={point.session} cx={geometry.x(point.session)} cy={geometry.y(point.first!)} r="3.4" fill="var(--paper-link)"/>)}
    </svg>
    <p className={styles.chartNote}>{dateLabel(start,lang)} – {dateLabel(end,lang)} · {note}</p>
    <details className={styles.chartTable}><summary>{sectorPaperText(lang, "siPaperViewAccessibleValueTable")}</summary>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">{sectorPaperText(lang, "siPaperSession")}</th><th scope="col">{firstLabel}</th><th scope="col">{secondLabel}</th></tr></thead>
        <tbody>{points.map(point=><tr key={point.session}><th scope="row">{point.session}</th><td>{formatValue(point.first,2,"%",true)}</td><td>{formatValue(point.second,2,"%",true)}</td></tr>)}</tbody></table></div>
    </details>
  </div>;
}

/** Absolute total returns require their own producer contract and common starting session. */
export default function PaperSectorReturnChart({series,groupName,lang}:{series:PaperReturnSeries;groupName:string;lang:Lang}) {
  const points=useMemo(()=>series.points.map(point=>({session:point.session,first:point.groupReturn===null?null:point.groupReturn*100,second:point.benchmarkReturn===null?null:point.benchmarkReturn*100})),[series]);
  return <PaperSectorLineChart points={points} start={series.startSession} end={series.endSession} firstLabel={groupName} secondLabel={series.benchmark} lang={lang}
    title={sectorPaperText(lang, "siPaperTotalReturnAnd", groupName, series.benchmark)}
    description={sectorPaperText(lang, "siPaperBothSeriesUseTheSameStartingSessionMissingValues")}
    basis={series.currency+" · "+(sectorPaperText(lang, "siPaperTotalReturnSameStart"))}
    note={sectorPaperText(lang, "siPaperEachSeriesIsCumulativeTotalReturnTheseAreNot")}/>;
}

/** Current owner reconstruction is descriptive history, never an as-known signal or absolute return. */
export function PaperSectorLeadershipChart({series,groupName,lang}:{series:PaperLeadershipSeries;groupName:string;lang:Lang}) {
  const points=useMemo(()=>series.points.map(point=>({session:point.session,first:point.short,second:point.long})),[series]);
  return <PaperSectorLineChart points={points} start={series.startSession} end={series.endSession}
    firstLabel={sectorPaperText(lang, "siPaper21SessionRelativeWealth")} secondLabel={sectorPaperText(lang, "siPaper63SessionRelativeWealth")} lang={lang}
    title={sectorPaperText(lang, "siPaperRelativeLeadershipHistoryVersus", groupName, series.benchmark)}
    description={sectorPaperText(lang, "siPaperOwnerReconstructed21And63SessionRelativeWealthChanges")}
    basis={series.benchmark+" · "+(sectorPaperText(lang, "siPaperTotalReturnBasis"))}
    note={(sectorPaperText(lang, "siPaperOwnerReconstructedDescriptiveHistoryNotAnAsKnownSignal"))+series.sourceAsOf+(series.stale?(sectorPaperText(lang, "siPaperSourceDelayed")):"")}/>;
}
