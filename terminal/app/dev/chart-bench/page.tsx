"use client";
// Dev harness for the chart-engine performance budget (P4). Full-viewport, no chrome.
// Served at /dev/chart-bench?engine=mm|lwc. Not under the authed /terminal layout.

import { useEffect, useRef } from "react";
import { notFound } from "next/navigation";
import { engineQueryFromUrl } from "@/lib/chart-engine/select";
import { mountBench } from "@/lib/chart-engine/bench/mount";

export default function ChartBenchPage() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_CHART_BENCH !== "1") notFound();
  return <ChartBenchMount />;
}

function ChartBenchMount() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const impl = engineQueryFromUrl(window.location.search) ?? "mm";
    const handle = mountBench(el, impl);
    return () => {
      handle.destroy();
    };
  }, []);
  return (
    <div
      ref={ref}
      style={{
        width: "100vw",
        height: "100vh",
        margin: 0,
        background: "#0b0b0c",
        overflow: "hidden",
      }}
    />
  );
}
