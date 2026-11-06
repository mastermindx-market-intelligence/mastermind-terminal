"use client";
import { useCallback, useLayoutEffect, useState } from "react";
import { chartRailLayout, clampRailWidth, MAX_RAIL_WIDTH, type ChartPlotGeometry } from "@/lib/chartRailLayout";

/** Measures occupied space without changing chart identity, selection or width preferences. */
export function useChartRailLayout(requestedWidth: number, eligible: boolean, activePane: number, paneCount: number) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [insets, setInsets] = useState<Record<number, number>>({});
  const [budget, setBudget] = useState<{ availableWidth: number; columns: number; gap: number } | null>(null);
  const onPlotGeometry = useCallback((pane: number, geometry: ChartPlotGeometry | null) => {
    if (!geometry) {
      setInsets((old) => { if (!(pane in old)) return old; const next = { ...old }; delete next[pane]; return next; });
      return;
    }
    if (!(geometry.paneWidth > 0) || !(geometry.plotWidth > 0) || geometry.plotWidth > geometry.paneWidth) return;
    // Measure chrome/axes separately from the engine's alternating even-size loss.
    // Using paneWidth - plotWidth here makes a one-pixel boundary oscillate.
    if (!Number.isFinite(geometry.plotInset) || geometry.plotInset < 0) return;
    const inset = Math.ceil(geometry.plotInset);
    setInsets((old) => old[pane] === inset ? old : { ...old, [pane]: inset });
  }, []);

  useLayoutEffect(() => {
    if (!root || !eligible) return;
    const workspace = root.querySelector<HTMLElement>(".workspace");
    const grid = workspace?.querySelector<HTMLElement>(".pane-grid");
    const rail = root.querySelector<HTMLElement>(":scope > .rail");
    if (!workspace || !grid || !rail) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const style = getComputedStyle(grid);
      const tracks = style.gridTemplateColumns.split(/\s+/).filter(Boolean);
      const railWidth = root.dataset.railLayout === "below" ? 0 : rail.getBoundingClientRect().width;
      // Reconstruct the rail-free plot grid budget. This already excludes actual
      // navigation, drawing tools, borders and scrollbar occupancy, and stays
      // stable when the same rail moves below the chart.
      const next = {
        availableWidth: grid.getBoundingClientRect().width + railWidth,
        columns: Math.max(1, tracks.length),
        gap: parseFloat(style.columnGap) || 0,
      };
      setBudget((old) => old && Math.abs(old.availableWidth - next.availableWidth) < .1
        && old.columns === next.columns && old.gap === next.gap ? old : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    [root, workspace, grid, rail].forEach((node) => observer.observe(node));
    schedule();
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [root, eligible, activePane, paneCount]);

  const inset = insets[activePane];
  const layout = eligible && budget && inset !== undefined
    ? chartRailLayout({ ...budget, plotInset: inset }, requestedWidth)
    : { placement: "rail" as const, width: clampRailWidth(requestedWidth), maximum: MAX_RAIL_WIDTH };
  return { rootRef: setRoot, ...layout, onPlotGeometry };
}
