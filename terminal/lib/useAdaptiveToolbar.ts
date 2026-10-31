"use client";

import { useLayoutEffect, useRef, useState } from "react";

export type AdaptiveToolbarMode = "full" | "overflow" | "compact";

type ToolbarMetrics = {
  full: number;
  overflow: number;
  compact: number;
};

function outerWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return element.getBoundingClientRect().width
    + Number.parseFloat(style.marginLeft || "0")
    + Number.parseFloat(style.marginRight || "0");
}

function sumWithGap(elements: HTMLElement[], gap: number): number {
  return elements.reduce((total, element) => total + outerWidth(element), 0)
    + Math.max(0, elements.length - 1) * gap;
}

function modeForWidth(width: number, metrics: ToolbarMetrics): AdaptiveToolbarMode {
  if (width >= metrics.full + 2) return "full";
  if (width >= metrics.overflow + 2) return "overflow";
  return "compact";
}

/**
 * Measures the toolbar's rendered labels instead of guessing from viewport breakpoints. That makes
 * the same priority rules work for English, Chinese, user-customised timeframe favourites, and a
 * resized detail rail. Hidden overflow items are exposed only during the synchronous measurement
 * pass, before paint, then returned to their selected mode.
 */
export function useAdaptiveToolbar(signature: string) {
  const ref = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<ToolbarMetrics | null>(null);
  const [mode, setMode] = useState<AdaptiveToolbarMode>("full");

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const readAvailableWidth = () => {
      const style = getComputedStyle(root);
      return root.clientWidth
        - Number.parseFloat(style.paddingLeft || "0")
        - Number.parseFloat(style.paddingRight || "0");
    };

    const measure = () => {
      // Phone chrome hides this toolbar. Zero boxes are not reusable label metrics.
      if (!root.getClientRects().length || root.clientWidth <= 0) {
        metricsRef.current = null;
        return;
      }
      root.dataset.toolbarMeasuring = "true";
      const tools = root.querySelector<HTMLElement>(":scope > .tools");
      const title = root.querySelector<HTMLElement>(":scope > .ct");
      const more = tools?.querySelector<HTMLElement>(":scope > [data-toolbar-more]");
      const allItems = tools
        ? Array.from(tools.querySelectorAll<HTMLElement>(":scope > [data-toolbar-item]"))
        : [];
      const coreItems = allItems.filter((element) => element.dataset.toolbarCore === "true");
      const timeframe = tools?.querySelector<HTMLElement>(":scope > [data-toolbar-timeframes]");
      const toolsStyle = tools ? getComputedStyle(tools) : null;
      const gap = Number.parseFloat(toolsStyle?.columnGap || toolsStyle?.gap || "0");
      const rootGap = Number.parseFloat(getComputedStyle(root).columnGap || getComputedStyle(root).gap || "0");

      if (!tools || !title || !more || !timeframe || !allItems.length) {
        delete root.dataset.toolbarMeasuring;
        return;
      }

      const full = outerWidth(title) + rootGap + sumWithGap(allItems, gap);
      const overflowItems = [timeframe, ...coreItems.filter((element) => element !== timeframe), more];
      const overflow = sumWithGap(overflowItems, gap);
      const compactTfButtons = Array.from(
        timeframe.querySelectorAll<HTMLElement>(".tfbtn.on,.tfbtn-edit"),
      );
      const compactTf = sumWithGap(compactTfButtons, 0);
      const compact = overflow - outerWidth(timeframe) + compactTf;
      const metrics = { full, overflow, compact };
      metricsRef.current = metrics;
      delete root.dataset.toolbarMeasuring;
      setMode(modeForWidth(readAvailableWidth(), metrics));
    };

    measure();
    const observer = new ResizeObserver(() => {
      if (!root.getClientRects().length || root.clientWidth <= 0) {
        metricsRef.current = null;
        return;
      }
      const metrics = metricsRef.current;
      if (metrics) setMode(modeForWidth(readAvailableWidth(), metrics));
      else measure();
    });
    observer.observe(root);

    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [signature]);

  return { ref, mode };
}
