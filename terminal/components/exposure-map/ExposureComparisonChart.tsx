"use client";
import dynamic from "next/dynamic";
import { memo, useLayoutEffect, useState } from "react";
import type { ChartEngine } from "@/lib/chart-engine/api";
import type { TerminalVisualReadyDetail } from "@/lib/terminalBoot";
import type { ExposureNode } from "@/lib/marketStructure";
import { createExposureMapPrimitive } from "@/lib/exposureMapPrimitive";
import styles from "./ExposureMap.module.css";

const ChartPanel = memo(dynamic(() => import("@/components/ChartPanel"), { ssr: false }));
const INDICATORS = new Set<string>();
/** A pane of the existing price host. The book is supplied by the board's owner. */
export default function ExposureComparisonChart({ root, timeframe, nodes, session }: {
  root: string; timeframe: string; nodes: ExposureNode[]; session: string | null;
}) {
  const [api, setApi] = useState<ChartEngine | null>(null);
  const [ready, setReady] = useState<TerminalVisualReadyDetail | null>(null);
  const current = ready?.state === "data" && ready.symbol === root && ready.timeframe === timeframe;
  useLayoutEffect(() => {
    if (!current || !api?.inventory().alive) return;
    const series = api.panes()[0]?.getSeries().find(item => item.kind === "candles");
    if (!series) return;
    const primitive = createExposureMapPrimitive({ nodes, selected: null, mode: "net", color: "#4d82ff", selectedColor: "#e8a33d" });
    series.attachPrimitive(primitive);
    const bars = series.data(), prices: number[] = [];
    const window = timeframe === "5m" ? 78 : 65;
    for (const bar of bars.slice(-window)) for (const field of ["low", "high"] as const) {
      const value = (bar as unknown as Record<string, unknown>)[field];
      if (typeof value === "number" && Number.isFinite(value)) prices.push(value);
    }
    prices.push(...nodes.filter(n => n.netMn != null && n.netMn !== 0).slice()
      .sort((a,b) => Math.abs(b.netMn!) - Math.abs(a.netMn!)).slice(0,6).map(n => n.strike));
    if (bars.length) api.timeScale().setVisibleLogicalRange({ from: Math.max(0,bars.length-window), to: bars.length+16 });
    if (prices.length) {
      const low = Math.min(...prices), high = Math.max(...prices), pad = Math.max((high-low)*.12,high*.0005);
      series.priceScale().setVisibleRange({from:Math.max(.001,low-pad),to:high+pad});
    }
    return () => { if (api.inventory().alive && api.panes()[0]?.getSeries().includes(series)) series.detachPrimitive(primitive); };
  },[api,current,ready,root,timeframe,nodes]);
  return <div className={styles.comparisonChart} data-testid="exposure-comparison-chart" data-chart-ready={current ? "true" : "false"} data-book-session={session ?? ""}>
    <ChartPanel symbol={root} timeframe={timeframe} indicators={INDICATORS} isActive={false} userTier="free" onChartApi={setApi} onVisualReady={setReady} />
  </div>;
}
