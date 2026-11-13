"use client";

import { useLayoutEffect, useRef, useState } from "react";

export type AdaptiveToolbarMode = "full" | "overflow" | "compact";

export type AdaptiveToolbarSnapshot = {
  mode: AdaptiveToolbarMode;
  revision: number;
  fontGateComplete: boolean;
  measuredWidth: number;
};

type ToolbarMetrics = {
  full: number;
  overflow: number;
  compact: number;
};

type LastMeasurement = {
  width: number;
  mode: AdaptiveToolbarMode;
};

// FontFaceSet.ready is specified to always settle (resolve or reject), but a hung or broken
// implementation (a stuck worker, an injected polyfill that never fulfils) must not strand the
// toolbar permanently unsettled. Bound the wait with the same deterministic fallback the reject
// path already had.
const TOOLBAR_FONT_GATE_FALLBACK_MS = 4_000;

function cssPixels(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value || "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function outerWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  return element.getBoundingClientRect().width
    + cssPixels(style.marginLeft)
    + cssPixels(style.marginRight);
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

function markAdaptiveToolbarUnsettled(root: HTMLElement): void {
  delete root.dataset.toolbarSettled;
}

/**
 * Publish the browser-facing receipt only after React committed the exact mode returned by the
 * same measurement revision. The hook calls this from a second layout effect, never from the
 * closure that calculates and sets the next mode.
 */
export function publishAdaptiveToolbarSettled(
  root: HTMLElement,
  snapshot: AdaptiveToolbarSnapshot,
  currentRevision: number,
): boolean {
  if (
    snapshot.revision <= 0
    || !snapshot.fontGateComplete
    || currentRevision !== snapshot.revision
    || root.dataset.toolbarMode !== snapshot.mode
  ) {
    markAdaptiveToolbarUnsettled(root);
    return false;
  }

  root.dataset.toolbarRevision = String(snapshot.revision);
  root.dataset.toolbarSettled = "true";
  delete root.dataset.toolbarMeasuring;
  return true;
}

/**
 * Measures the toolbar's rendered labels instead of guessing from viewport breakpoints. That makes
 * the same priority rules work for English, Chinese, user-customised timeframe favourites, and a
 * resized detail rail. Hidden overflow items are exposed only during the synchronous pre-paint
 * measurement pass, then immediately returned to their selected mode.
 *
 * `data-toolbar-settled=true` is a revisioned COMMIT receipt, not a measurement receipt. It is
 * withheld while the FontFaceSet gate is pending, withdrawn before each authoritative font/resize
 * measurement, and published from a later layout effect only after the corresponding controls and
 * `data-toolbar-mode` have committed. The measurement-only CSS override never survives the
 * synchronous measurement closure, so an unsettled toolbar does not force every item visible.
 */
export function useAdaptiveToolbar(signature: string) {
  const ref = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<ToolbarMetrics | null>(null);
  const revisionRef = useRef(0);
  const [snapshot, setSnapshot] = useState<AdaptiveToolbarSnapshot>({
    mode: "full",
    revision: 0,
    fontGateComplete: false,
    measuredWidth: 0,
  });

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    let cancelled = false;
    let lastMeasurement: LastMeasurement | null = null;
    const fontsReady = document.fonts?.ready;
    let fontGateComplete = !(fontsReady && typeof fontsReady.then === "function");
    metricsRef.current = null;

    const readAvailableWidth = () => {
      const style = getComputedStyle(root);
      return root.clientWidth
        - cssPixels(style.paddingLeft)
        - cssPixels(style.paddingRight);
    };

    const commitMeasurement = (
      width: number,
      nextMode: AdaptiveToolbarMode,
      options: { force: boolean },
    ) => {
      if (cancelled) return;
      if (
        !options.force
        && lastMeasurement?.width === width
        && lastMeasurement.mode === nextMode
      ) return;

      markAdaptiveToolbarUnsettled(root);
      lastMeasurement = { width, mode: nextMode };
      const revision = ++revisionRef.current;
      setSnapshot({
        mode: nextMode,
        revision,
        fontGateComplete,
        measuredWidth: width,
      });
    };

    const measureAll = (force: boolean) => {
      if (cancelled) return;
      markAdaptiveToolbarUnsettled(root);
      root.dataset.toolbarMeasuring = "true";

      try {
        const tools = root.querySelector<HTMLElement>(":scope > .tools");
        const title = root.querySelector<HTMLElement>(":scope > .ct");
        const more = tools?.querySelector<HTMLElement>(":scope > [data-toolbar-more]");
        const allItems = tools
          ? Array.from(tools.querySelectorAll<HTMLElement>(":scope > [data-toolbar-item]"))
          : [];
        const coreItems = allItems.filter((element) => element.dataset.toolbarCore === "true");
        const timeframe = tools?.querySelector<HTMLElement>(":scope > [data-toolbar-timeframes]");

        if (!tools || !title || !more || !timeframe || !allItems.length) return;

        const toolsStyle = getComputedStyle(tools);
        const gap = cssPixels(toolsStyle.columnGap || toolsStyle.gap);
        const rootStyle = getComputedStyle(root);
        const rootGap = cssPixels(rootStyle.columnGap || rootStyle.gap);
        const full = outerWidth(title) + rootGap + sumWithGap(allItems, gap);
        const overflowItems = [
          timeframe,
          ...coreItems.filter((element) => element !== timeframe),
          more,
        ];
        const overflow = sumWithGap(overflowItems, gap);
        const compactTfButtons = Array.from(
          timeframe.querySelectorAll<HTMLElement>(".tfbtn.on,.tfbtn-edit"),
        );
        const compactTf = sumWithGap(compactTfButtons, 0);
        const compact = overflow - outerWidth(timeframe) + compactTf;
        const metrics = { full, overflow, compact };
        metricsRef.current = metrics;
        const width = readAvailableWidth();
        commitMeasurement(width, modeForWidth(width, metrics), { force });
      } finally {
        // This attribute changes product visibility through globals.css and is measurement-only.
        // It must be removed before paint even while the independent settled receipt stays absent.
        delete root.dataset.toolbarMeasuring;
      }
    };

    const measureResize = () => {
      if (cancelled) return;
      const metrics = metricsRef.current;
      if (!metrics) return;
      const width = readAvailableWidth();
      const nextMode = modeForWidth(width, metrics);
      // ResizeObserver may repeat a notification without an observable size change. Such a callback
      // is not a new authoritative measurement and must not flap the receipt or create a render loop.
      if (
        lastMeasurement?.width === width
        && lastMeasurement.mode === nextMode
      ) return;
      commitMeasurement(width, nextMode, { force: false });
    };

    measureAll(true);
    const observer = new ResizeObserver(measureResize);
    observer.observe(root);

    let fontGateFallbackTimer: ReturnType<typeof setTimeout> | null = null;
    if (fontsReady && typeof fontsReady.then === "function") {
      const completeFontGate = () => {
        if (cancelled || fontGateComplete) return;
        fontGateComplete = true;
        if (fontGateFallbackTimer !== null) {
          clearTimeout(fontGateFallbackTimer);
          fontGateFallbackTimer = null;
        }
        // Font metrics are authoritative even when they retain the same mode. A fresh revision
        // guarantees that React cannot elide the post-commit settled receipt.
        measureAll(true);
      };
      // Resolve, reject, AND a bounded timeout all converge on the same idempotent completion —
      // whichever settles the gate first wins, and the other two become no-ops.
      void fontsReady.then(completeFontGate, completeFontGate);
      fontGateFallbackTimer = setTimeout(completeFontGate, TOOLBAR_FONT_GATE_FALLBACK_MS);
    }

    return () => {
      cancelled = true;
      if (fontGateFallbackTimer !== null) clearTimeout(fontGateFallbackTimer);
      observer.disconnect();
      metricsRef.current = null;
      delete root.dataset.toolbarSettled;
      delete root.dataset.toolbarMeasuring;
    };
  }, [signature]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || snapshot.revision <= 0) return;

    root.dataset.toolbarRevision = String(snapshot.revision);
    publishAdaptiveToolbarSettled(root, snapshot, revisionRef.current);

    return () => {
      if (root.dataset.toolbarRevision === String(snapshot.revision)) {
        delete root.dataset.toolbarSettled;
      }
    };
  }, [snapshot]);

  return { ref, mode: snapshot.mode };
}
