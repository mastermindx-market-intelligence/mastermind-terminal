"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createEngine, type MarkerSpec } from "@/lib/chart-engine";
import { useLang } from "@/lib/i18n";
import type { Bar6 } from "@/lib/intradayShared";
import type { StudyReport, StudyTrade } from "@/lib/rsPivotStudy";

/** Consumer of the shared renderer, never a second chart or trading engine. */
export default function RSPivotChart({ bars, report, trade }: { bars: Bar6[]; report: StudyReport; trade: StudyTrade | null }) {
  const host = useRef<HTMLDivElement>(null);
  const { lang } = useLang(); const zh = lang === "zh";
  const frame = useMemo(() => {
    const end = trade ? bars.findIndex(b => b[0] === trade.exitBarAt) : bars.length - 1;
    const entry = trade ? bars.findIndex(b => b[0] === trade.entryAt) : end;
    return bars.slice(Math.max(0, entry - 45), Math.min(bars.length, end + 8));
  }, [bars, trade]);
  // Replay is observation-based: candle and annotations enter only at its completed close.
  const [cursor, setCursor] = useState(frame.length - 1);
  const shownCursor = Math.min(cursor, frame.length - 1);
  useEffect(() => {
    if (!host.current || !frame.length) return;
    const el = host.current, shown = frame.slice(0, shownCursor + 1), cutoff = shown.at(-1)![0] + 1800;
    const engine = createEngine(el, { height: 430, width: el.clientWidth, timeScale: { timeVisible: true, secondsVisible: false }, layout: { attributionLogo: false } });
    const candles = engine.addSeries("candles", { upColor: "#37b99a", downColor: "#e46c7b", wickUpColor: "#37b99a", wickDownColor: "#e46c7b", borderVisible: false });
    candles.setData(shown.map(b => ({ time: b[0], open: b[1], high: b[2], low: b[3], close: b[4] })));
    const short = engine.addSeries("line", { color: "#6a9fea", lineWidth: 2, title: zh ? "短期超额%" : "Short excess %" }, 1);
    const long = engine.addSeries("line", { color: "#ce9be9", lineWidth: 2, title: zh ? "长期超额%" : "Long excess %" }, 1);
    const path = report.rsPath.filter(p => p.time >= shown[0][0] && p.time <= shown.at(-1)![0]);
    short.setData(path.map(p => ({time:p.time,value:p.shortExcessPct})));
    long.setData(path.map(p => ({time:p.time,value:p.longExcessPct})));
    engine.panes()[1]?.setHeight(115);
    const marks: MarkerSpec[] = [];
    if (trade) {
      if (trade.confirmedAt != null && trade.confirmedAt <= cutoff) {
        const confirmBar = trade.confirmedAt - 1800;
        if (confirmBar >= shown[0][0]) marks.push({time:confirmBar,position:"belowBar",shape:"circle",color:"#ce9be9",text:zh?"收盘确认":"Confirmed at close"});
        const p = bars.find(b => b[0] === trade.pivotAt);
        if (p) candles.createPriceLine({price:p[3],color:"#ce9be9",lineStyle:2,title:zh?"已确认枢轴":"Confirmed pivot"});
      }
      if (trade.signalAt <= cutoff && trade.signalBarAt >= shown[0][0]) marks.push({time:trade.signalBarAt,position:"belowBar",shape:"circle",color:"#e3b869",text:zh?"收盘收复":"Reclaim at close"});
      if (trade.entryAt < cutoff && trade.entryAt >= shown[0][0]) {
        marks.push({time:trade.entryAt,position:"belowBar",shape:"arrowUp",color:"#37b99a",text:zh?"模拟开盘入场":"Hypothetical open entry"});
        for (const [price,color,title] of [[trade.entry,"#6a9fea",zh?"入场":"Entry"],[trade.stop,"#e46c7b",zh?"止损":"Stop"],[trade.target,"#37b99a",zh?"2R目标":"2R target"]] as const) candles.createPriceLine({price,color,title,lineStyle:2});
      }
      if (trade.exitAt <= cutoff && trade.exitBarAt >= shown[0][0] && trade.exitBarAt <= shown.at(-1)![0]) marks.push({time:trade.exitBarAt,position:"aboveBar",shape:"arrowDown",color:"#e46c7b",text:zh?"模拟离场":"Hypothetical exit"});
    } else if (report.lastCompleted?.pivotPrice != null && report.lastCompleted.confirmedAt! <= cutoff) {
      candles.createPriceLine({price:report.lastCompleted.pivotPrice,color:"#ce9be9",title:zh?"历史已确认枢轴":"Historical confirmed pivot",lineStyle:2});
    }
    candles.setMarkers(marks.sort((a,b) => Number(a.time)-Number(b.time)));
    engine.timeScale().fitContent();
    const theme = () => { const css = getComputedStyle(el); engine.applyOptions({layout:{background:{type:"solid",color:css.getPropertyValue("--panel").trim()||"#111821"},textColor:css.getPropertyValue("--muted").trim()||"#9aa6b2"},grid:{vertLines:{color:css.getPropertyValue("--line").trim()||"#263342"},horzLines:{color:css.getPropertyValue("--line").trim()||"#263342"}}}); };
    theme(); const observer = new MutationObserver(theme); observer.observe(document.documentElement,{attributes:true});
    const resize = new ResizeObserver(() => engine.resize(el.clientWidth,430)); resize.observe(el);
    return () => { observer.disconnect(); resize.disconnect(); engine.destroy(); };
  }, [bars, frame, shownCursor, report, trade, zh]);
  return <section style={{minWidth:0}}>
    <div ref={host} data-testid="rs-pivot-chart" role="img" aria-label={zh?"30分钟历史K线、模拟交易与超额收益路径":"Historical 30m candles, hypothetical trade and excess return paths"} style={{height:430,width:"100%"}} />
    <label style={{display:"grid",gap:6,fontSize:12,color:"var(--muted)",marginTop:12}}>
      {zh?"逐根重放（收盘观察，美东显示时钟）":"Replay completed candles (close observations, ET display clock)"}
      <input aria-label={zh?"逐根重放":"Replay candle"} type="range" min="0" max={Math.max(0,frame.length-1)} value={Math.max(0,shownCursor)} onChange={e=>setCursor(Number(e.target.value))} style={{width:"100%",minHeight:32}} />
      {frame[shownCursor] ? new Date((frame[shownCursor][0]+1800)*1000).toISOString().slice(0,16).replace("T"," ") : "—"}
    </label>
    <p style={{fontSize:12,color:"var(--muted)"}}>{zh?"标记绘于所属K线；确认与收复仅在该根收盘可知。蓝色/紫色为短期/长期相对基准的超额收益代理。":"Markers attach to their candle; confirmation and reclaim become known at its close. Blue/purple: short/long benchmark excess return proxies."}</p>
  </section>;
}
