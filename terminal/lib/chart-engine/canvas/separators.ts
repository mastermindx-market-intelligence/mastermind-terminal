// Mastermind Chart Engine — pane separators (P03 parity with LWC's PaneSeparator).
//
// lightweight-charts draws a 1px separator row between adjacent panes and puts a 9px
// drag handle over it (4px into each neighbour) that resizes the two panes by moving
// stretch factor between them. The mm canvas keeps its panes contiguous, so the line
// overlays the lower pane's first pixel row instead of taking a row of its own; pane
// geometry, hit testing and every coordinate stay exactly as they were. The handle sits
// above the input overlay, so it forwards wheel input to it (a wheel over the band
// zooms, as it does on LWC) and the overlay sees an ordinary pointer leave.
//
// The resize arithmetic is LWC's (lightweight-charts.development.mjs PaneSeparator):
// a 30px minimum per pane, no resize when the pair is already at or under 2 × minimum,
// and the drag only starts after a 5px Manhattan move, measured from the press. LWC
// keeps its time axis in a row of its own; the mm last pane draws it inside its own
// box, so that pane's minimum carries the axis band on top of the 30px (`reservePx`).

export const SEPARATOR_MIN_PANE_PX = 30;
export const SEPARATOR_DRAG_THRESHOLD_PX = 5;
export const SEPARATOR_HANDLE_PX = 9;
export const SEPARATOR_HANDLE_OFFSET_PX = 4;

export type PaneSeparatorOptions = {
  enableResize: boolean;
  separatorColor: string;
  separatorHoverColor: string;
};

export const PANE_SEPARATOR_DEFAULTS: PaneSeparatorOptions = {
  enableResize: true,
  separatorColor: "#E0E3EB",
  separatorHoverColor: "rgba(178, 181, 189, 0.2)",
};

/** Resolve `layout.panes` from the stored option bag, falling back to LWC's defaults. */
export function paneSeparatorOptions(options: Record<string, unknown>): PaneSeparatorOptions {
  const layout = options.layout && typeof options.layout === "object" ? options.layout as Record<string, unknown> : {};
  const panes = layout.panes && typeof layout.panes === "object" ? layout.panes as Record<string, unknown> : {};
  return {
    enableResize: typeof panes.enableResize === "boolean" ? panes.enableResize : PANE_SEPARATOR_DEFAULTS.enableResize,
    separatorColor: typeof panes.separatorColor === "string" ? panes.separatorColor : PANE_SEPARATOR_DEFAULTS.separatorColor,
    separatorHoverColor: typeof panes.separatorHoverColor === "string"
      ? panes.separatorHoverColor
      : PANE_SEPARATOR_DEFAULTS.separatorHoverColor,
  };
}

export type SeparatorPane = { stretchFactor: number; height: number };

export type SeparatorResize = {
  startY: number;
  prevTopStretch: number;
  totalStretch: number;
  pixelStretchFactor: number;
  minPaneStretch: number;
  maxPaneStretch: number;
};

/**
 * LWC `_mouseDownEvent`: null when the pair is too small to resize. `bottomReservePx` is
 * height the lower pane holds beyond its plot (the mm time-axis band in the last pane).
 */
export function beginSeparatorResize(
  top: SeparatorPane,
  bottom: SeparatorPane,
  startY: number,
  bottomReservePx = 0,
): SeparatorResize | null {
  const totalStretch = top.stretchFactor + bottom.stretchFactor;
  const totalHeight = top.height + bottom.height;
  if (!(totalHeight > 0) || !(totalStretch > 0)) return null;
  const reserve = Math.max(0, bottomReservePx);
  // LWC's `totalStretch <= 2 × minPaneStretch`, compared in pixels so the boundary is exact.
  if (totalHeight <= SEPARATOR_MIN_PANE_PX * 2 + reserve) return null;
  const pixelStretchFactor = totalStretch / totalHeight;
  const minPaneStretch = SEPARATOR_MIN_PANE_PX * pixelStretchFactor;
  const minBottomStretch = (SEPARATOR_MIN_PANE_PX + reserve) * pixelStretchFactor;
  return {
    startY,
    prevTopStretch: top.stretchFactor,
    totalStretch,
    pixelStretchFactor,
    minPaneStretch,
    maxPaneStretch: totalStretch - minBottomStretch,
  };
}

/** LWC `_pressedMouseMoveEvent`: the two stretch factors for a pointer at `pageY`. */
export function separatorStretchesAt(resize: SeparatorResize, pageY: number): { top: number; bottom: number } {
  const delta = (pageY - resize.startY) * resize.pixelStretchFactor;
  const top = Math.min(Math.max(resize.prevTopStretch + delta, resize.minPaneStretch), resize.maxPaneStretch);
  return { top, bottom: resize.totalStretch - top };
}

export type SeparatorInputHost = {
  root: HTMLElement;
  panes(): readonly SeparatorPane[];
  options(): PaneSeparatorOptions;
  /** Height the pane at `index` keeps beyond its plot (the time-axis band in the last pane). */
  reservePx(index: number): number;
  /** Give the pane at `topIndex` and the one below it these stretch factors, then relayout. */
  resize(topIndex: number, top: number, bottom: number): void;
  wheel(ev: Event): void;
};

export type SeparatorInputBinding = { dispose(): void };

const HANDLE_SELECTOR = "[data-mm-separator]";

function handleOf(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  const el = target as Element | null;
  if (!el || typeof el.closest !== "function") return null;
  const handle = el.closest(HANDLE_SELECTOR) as HTMLElement | null;
  return handle && root.contains(handle) ? handle : null;
}

function showBackdrop(handle: HTMLElement, shown: boolean): void {
  const backdrop = handle.querySelector("[data-mm-separator-backdrop]") as HTMLElement | null;
  if (backdrop) backdrop.style.display = shown ? "block" : "none";
}

function within(handle: HTMLElement, ev: PointerEvent): boolean {
  const r = handle.getBoundingClientRect();
  return ev.clientX >= r.left && ev.clientX < r.right && ev.clientY >= r.top && ev.clientY < r.bottom;
}

/** Delegated listeners on the chart root: one binding serves every separator it ever holds. */
export function attachSeparatorInput(host: SeparatorInputHost): SeparatorInputBinding {
  const { root } = host;
  let drag: {
    pointerId: number;
    handle: HTMLElement;
    index: number;
    startX: number;
    startY: number;
    resize: SeparatorResize;
    moved: boolean;
  } | null = null;

  const paint = (handle: HTMLElement, hover: boolean): void => {
    handle.style.backgroundColor = hover ? host.options().separatorHoverColor : "";
  };

  const onOver = (ev: Event): void => {
    const handle = handleOf(ev.target, root);
    if (handle && host.options().enableResize) paint(handle, true);
  };
  const onOut = (ev: Event): void => {
    const handle = handleOf(ev.target, root);
    if (!handle || drag?.handle === handle) return;
    const into = (ev as PointerEvent).relatedTarget as Node | null;
    if (into && handle.contains(into)) return;
    paint(handle, false);
  };
  const onDown = (ev: Event): void => {
    const e = ev as PointerEvent;
    const handle = handleOf(e.target, root);
    if (!handle || drag || !host.options().enableResize) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const index = Number(handle.dataset.mmSeparator);
    const panes = host.panes();
    const top = panes[index];
    const bottom = panes[index + 1];
    if (!top || !bottom) return;
    const resize = beginSeparatorResize(top, bottom, e.pageY, host.reservePx(index + 1));
    if (!resize) return;
    drag = { pointerId: e.pointerId, handle, index, startX: e.pageX, startY: e.pageY, resize, moved: false };
    showBackdrop(handle, true);
    try { handle.setPointerCapture?.(e.pointerId); } catch { /* capture is best-effort */ }
  };
  const onMove = (ev: Event): void => {
    const e = ev as PointerEvent;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.abs(e.pageX - drag.startX) + Math.abs(e.pageY - drag.startY) < SEPARATOR_DRAG_THRESHOLD_PX) return;
      drag.moved = true;
    }
    const next = separatorStretchesAt(drag.resize, e.pageY);
    host.resize(drag.index, next.top, next.bottom);
  };
  const onEnd = (ev: Event): void => {
    const e = ev as PointerEvent;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { handle } = drag;
    drag = null;
    showBackdrop(handle, false);
    try { handle.releasePointerCapture?.(e.pointerId); } catch { /* already released */ }
    if (!within(handle, e)) paint(handle, false);
  };
  const onWheel = (ev: Event): void => {
    if (handleOf(ev.target, root)) host.wheel(ev);
  };

  const listeners: Array<[string, EventListener, AddEventListenerOptions | undefined]> = [
    ["pointerover", onOver, undefined],
    ["pointerout", onOut, undefined],
    ["pointerdown", onDown, undefined],
    ["pointermove", onMove, undefined],
    ["pointerup", onEnd, undefined],
    ["pointercancel", onEnd, undefined],
    ["wheel", onWheel, { passive: false }],
  ];
  for (const [type, listener, opts] of listeners) root.addEventListener(type, listener, opts);
  let disposed = false;
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const [type, listener, opts] of listeners) root.removeEventListener(type, listener, opts);
      if (drag) showBackdrop(drag.handle, false);
      drag = null;
    },
  };
}
