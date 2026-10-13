// Mastermind Chart Engine — Canvas2D DOM surface (P3 / R01).
//
// One <canvas> per pane plus a shared overlay canvas for the crosshair. Bitmap
// sizes are integer CSS-px × devicePixelRatio; the 2d context is transformed
// with setTransform(dpr,0,0,dpr,0,0) so painting stays in CSS pixels.
// ResizeObserver is used when available (constructor injectable for tests).

export type ResizeObserverCtor = new (cb: ResizeObserverCallback) => {
  observe(target: Element, options?: ResizeObserverOptions): void;
  unobserve(target: Element): void;
  disconnect(): void;
};

export type PaneSurface = {
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
};

export type ChartDom = {
  root: HTMLDivElement;
  panes: PaneSurface[];
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

export type CreateChartDomOpts = {
  dpr: number;
  width: number;
  height: number;
  paneCount: number;
  autoSize: boolean;
  resizeObserverCtor?: ResizeObserverCtor | null;
  onAutoSize?: (width: number, height: number) => void;
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

  const dom: ChartDom = { root, panes, overlay, observer, dpr: opts.dpr };
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
  for (let i = 0; i < dom.panes.length; i++) {
    const ph = paneHeights[i] ?? 0;
    const pane = dom.panes[i];
    pane.wrapper.style.width = `${w}px`;
    pane.wrapper.style.height = `${ph}px`;
    sizeCanvas(pane.canvas, w, ph, dom.dpr);
  }
  sizeCanvas(dom.overlay, w, h, dom.dpr);
}

export function destroyChartDom(dom: ChartDom): void {
  dom.observer?.disconnect();
  dom.observer = null;
  dom.root.remove();
  dom.panes.length = 0;
}

export function chartElement(dom: ChartDom): HTMLElement {
  return dom.root;
}

export function paneElement(dom: ChartDom, index: number): HTMLElement | null {
  return dom.panes[index]?.wrapper ?? null;
}

export function takeDomScreenshot(dom: ChartDom): HTMLCanvasElement {
  const shot = document.createElement("canvas");
  let bw = 1;
  let bh = 0;
  for (const pane of dom.panes) {
    bw = Math.max(bw, pane.canvas.width);
    bh += pane.canvas.height;
  }
  shot.width = bw;
  shot.height = Math.max(1, bh);
  const ctx = shot.getContext("2d");
  if (ctx) {
    let y = 0;
    for (const pane of dom.panes) {
      ctx.drawImage(pane.canvas, 0, y);
      y += pane.canvas.height;
    }
  }
  return shot;
}
