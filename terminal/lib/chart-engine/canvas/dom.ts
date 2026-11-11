// Mastermind Chart Engine — Canvas2D DOM surface (P3 / R01).
//
// One <canvas> per pane plus a shared overlay canvas for the crosshair. Bitmap
// sizes are integer CSS-px × devicePixelRatio; the 2d context is transformed
// with setTransform(dpr,0,0,dpr,0,0) so painting stays in CSS pixels.
// ResizeObserver is used when available (constructor injectable for tests).
// Screenshots go through snapshot.ts composeSnapshot — the one compositor (F-06).
// Between adjacent panes sits a separator (separators.ts): a 1px line over the lower
// pane's first row inside a 9px drag handle. Separators are inserted before the overlay,
// which stays the root's last child.

import { composeSnapshot, layersFromPanes } from "./snapshot";
import {
  PANE_SEPARATOR_DEFAULTS,
  SEPARATOR_HANDLE_OFFSET_PX,
  SEPARATOR_HANDLE_PX,
  type PaneSeparatorOptions,
} from "./separators";

export type ResizeObserverCtor = new (cb: ResizeObserverCallback) => {
  observe(target: Element, options?: ResizeObserverOptions): void;
  unobserve(target: Element): void;
  disconnect(): void;
};

export type PaneSurface = {
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
};

/** `handle` is the root child; `line` and the drag `backdrop` live inside it, so a host
 *  that toggles the root's children (ChartPanel's maximize) never reveals the backdrop. */
export type SeparatorSurface = {
  handle: HTMLDivElement;
  line: HTMLDivElement;
  backdrop: HTMLDivElement;
};

export type ChartDom = {
  root: HTMLDivElement;
  panes: PaneSurface[];
  /** separators[i] sits between panes[i] and panes[i + 1]. */
  separators: SeparatorSurface[];
  separatorStyle: PaneSeparatorOptions;
  overlay: HTMLCanvasElement;
  observer: { disconnect(): void } | null;
  dpr: number;
};

export function sizeCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): void {
  const w = Math.max(0, cssWidth);
  const h = Math.max(0, cssHeight);
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function makePane(index: number, dpr: number): PaneSurface {
  const wrapper = document.createElement("div");
  wrapper.dataset.mmPane = String(index);
  wrapper.style.position = "relative";
  wrapper.style.flex = "0 0 auto";
  wrapper.style.overflow = "hidden";
  const canvas = document.createElement("canvas");
  canvas.dataset.mmPaneCanvas = String(index);
  canvas.style.display = "block";
  sizeCanvas(canvas, 0, 0, dpr);
  wrapper.appendChild(canvas);
  return { wrapper, canvas };
}

function makeSeparator(index: number): SeparatorSurface {
  const handle = document.createElement("div");
  handle.dataset.mmSeparator = String(index);
  handle.style.position = "absolute";
  handle.style.left = "0";
  handle.style.width = "100%";
  handle.style.height = `${SEPARATOR_HANDLE_PX}px`;
  handle.style.zIndex = "50";
  // As on LWC: a vertical touch drag resizes, a horizontal one still scrolls the page.
  handle.style.touchAction = "pan-x";
  const line = document.createElement("div");
  line.dataset.mmSeparatorLine = String(index);
  line.style.position = "absolute";
  line.style.left = "0";
  line.style.top = `${SEPARATOR_HANDLE_OFFSET_PX}px`;
  line.style.width = "100%";
  line.style.height = "1px";
  line.style.pointerEvents = "none";
  // Shown for the length of a drag so the row-resize cursor holds wherever the pointer goes.
  const backdrop = document.createElement("div");
  backdrop.dataset.mmSeparatorBackdrop = String(index);
  backdrop.style.position = "fixed";
  backdrop.style.display = "none";
  backdrop.style.zIndex = "49";
  backdrop.style.top = "0";
  backdrop.style.left = "0";
  backdrop.style.width = "100%";
  backdrop.style.height = "100%";
  backdrop.style.cursor = "row-resize";
  handle.appendChild(line);
  handle.appendChild(backdrop);
  return { handle, line, backdrop };
}

function styleSeparator(sep: SeparatorSurface, style: PaneSeparatorOptions): void {
  sep.line.style.backgroundColor = style.separatorColor;
  sep.handle.style.pointerEvents = style.enableResize ? "auto" : "none";
  sep.handle.style.cursor = style.enableResize ? "row-resize" : "";
  if (!style.enableResize) {
    sep.handle.style.backgroundColor = "";
    sep.backdrop.style.display = "none";
  }
}

/** Apply `layout.panes` to every separator; later separators pick the same style up. */
export function styleSeparators(dom: ChartDom, style: PaneSeparatorOptions): void {
  dom.separatorStyle = style;
  for (const sep of dom.separators) styleSeparator(sep, style);
}

export type CreateChartDomOpts = {
  dpr: number;
  width: number;
  height: number;
  paneCount: number;
  autoSize: boolean;
  resizeObserverCtor?: ResizeObserverCtor | null;
  onAutoSize?: (width: number, height: number) => void;
  separators?: PaneSeparatorOptions;
};

export function createChartDom(container: HTMLElement, opts: CreateChartDomOpts): ChartDom {
  const root = document.createElement("div");
  root.dataset.mmChart = "mm";
  root.style.position = "relative";
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.overflow = "hidden";
  root.style.width = `${Math.max(0, opts.width)}px`;
  root.style.height = `${Math.max(0, opts.height)}px`;

  const panes: PaneSurface[] = [];
  const count = Math.max(1, opts.paneCount);
  for (let i = 0; i < count; i++) {
    const pane = makePane(i, opts.dpr);
    panes.push(pane);
    root.appendChild(pane.wrapper);
  }
  const separatorStyle = opts.separators ?? PANE_SEPARATOR_DEFAULTS;
  const separators: SeparatorSurface[] = [];
  for (let i = 0; i < count - 1; i++) {
    const sep = makeSeparator(i);
    styleSeparator(sep, separatorStyle);
    separators.push(sep);
    root.appendChild(sep.handle);
  }

  const overlay = document.createElement("canvas");
  overlay.dataset.mmOverlay = "1";
  overlay.style.position = "absolute";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.pointerEvents = "auto";
  overlay.style.zIndex = "2";
  sizeCanvas(overlay, opts.width, opts.height, opts.dpr);
  root.appendChild(overlay);

  container.appendChild(root);

  let observer: { disconnect(): void } | null = null;
  const Ctor = opts.resizeObserverCtor === undefined
    ? (typeof ResizeObserver !== "undefined" ? ResizeObserver : null)
    : opts.resizeObserverCtor;
  if (opts.autoSize && Ctor && opts.onAutoSize) {
    const ro = new Ctor((entries) => {
      const entry = entries[entries.length - 1];
      const box = entry?.contentRect;
      if (!box) return;
      opts.onAutoSize?.(box.width, box.height);
    });
    ro.observe(container);
    observer = ro;
  }

  const dom: ChartDom = { root, panes, separators, separatorStyle, overlay, observer, dpr: opts.dpr };
  layoutChartDom(dom, opts.width, opts.height, panes.map(() => opts.height / count));
  return dom;
}

export function syncPaneCount(dom: ChartDom, paneCount: number): void {
  const n = Math.max(1, paneCount);
  while (dom.panes.length < n) {
    const pane = makePane(dom.panes.length, dom.dpr);
    dom.root.insertBefore(pane.wrapper, dom.overlay);
    dom.panes.push(pane);
  }
  while (dom.panes.length > n) {
    const extra = dom.panes.pop();
    extra?.wrapper.remove();
  }
  dom.panes.forEach((p, i) => {
    p.wrapper.dataset.mmPane = String(i);
    p.canvas.dataset.mmPaneCanvas = String(i);
  });
  while (dom.separators.length < n - 1) {
    const sep = makeSeparator(dom.separators.length);
    styleSeparator(sep, dom.separatorStyle);
    dom.root.insertBefore(sep.handle, dom.overlay);
    dom.separators.push(sep);
  }
  while (dom.separators.length > n - 1) {
    dom.separators.pop()?.handle.remove();
  }
}

export function layoutChartDom(
  dom: ChartDom,
  width: number,
  totalHeight: number,
  paneHeights: number[],
): void {
  const w = Math.max(0, width);
  const h = Math.max(0, totalHeight);
  dom.root.style.width = `${w}px`;
  dom.root.style.height = `${h}px`;
  let boundary = 0;
  for (let i = 0; i < dom.panes.length; i++) {
    const ph = paneHeights[i] ?? 0;
    const pane = dom.panes[i];
    pane.wrapper.style.width = `${w}px`;
    pane.wrapper.style.height = `${ph}px`;
    sizeCanvas(pane.canvas, w, ph, dom.dpr);
    boundary += ph;
    const sep = dom.separators[i];
    if (sep) sep.handle.style.top = `${boundary - SEPARATOR_HANDLE_OFFSET_PX}px`;
  }
  sizeCanvas(dom.overlay, w, h, dom.dpr);
}

export function destroyChartDom(dom: ChartDom): void {
  dom.observer?.disconnect();
  dom.observer = null;
  dom.root.remove();
  dom.panes.length = 0;
  dom.separators.length = 0;
}

export function chartElement(dom: ChartDom): HTMLElement {
  return dom.root;
}

export function paneElement(dom: ChartDom, index: number): HTMLElement | null {
  return dom.panes[index]?.wrapper ?? null;
}

function cssDim(canvas: HTMLCanvasElement, dpr: number, which: "width" | "height"): number {
  const raw = which === "width" ? canvas.style.width : canvas.style.height;
  const parsed = raw ? parseFloat(raw) : Number.NaN;
  if (Number.isFinite(parsed)) return parsed;
  const bitmap = which === "width" ? canvas.width : canvas.height;
  return dpr > 0 ? bitmap / dpr : bitmap;
}

/** Composite pane bitmaps (and the overlay only when `includeOverlay` is true). */
export function takeDomScreenshot(dom: ChartDom, includeOverlay = false): HTMLCanvasElement {
  const dpr = dom.dpr > 0 ? dom.dpr : 1;
  let top = 0;
  const panes = dom.panes.map((p) => {
    const height = cssDim(p.canvas, dpr, "height");
    const layer = { canvas: p.canvas, top, height };
    top += height;
    return layer;
  });
  const width = cssDim(dom.panes[0]?.canvas ?? dom.overlay, dpr, "width");
  const overlays = includeOverlay ? [{ canvas: dom.overlay }] : [];
  const out = composeSnapshot(
    layersFromPanes(panes, overlays, width),
    { widthPx: Math.max(0, width), heightPx: Math.max(0, top), dpr },
  );
  // The separator lines are DOM, not canvas: draw them in, as LWC draws its separator rows,
  // at the pane boundaries (the lower pane's first row, where they sit on screen).
  if (panes.length > 1) {
    const ctx = out.getContext("2d");
    if (ctx) {
      ctx.fillStyle = dom.separatorStyle.separatorColor;
      const rowPx = Math.max(1, Math.round(dpr));
      for (let i = 1; i < panes.length; i++) ctx.fillRect(0, Math.round(panes[i].top * dpr), out.width, rowPx);
    }
  }
  return out;
}
