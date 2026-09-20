// IndicatorCanvas renderer — draws a SuiteRenderBundle's Prim[] into the chart's indicator SVG
// overlay. APPEND-ONLY: the caller clears the layer each frame (ChartPanel renderIndOverlays
// pattern); renderPrims builds everything in one DocumentFragment and appends once.
//
// Coordinate rules (for module authors):
//   • x = CoordMapper.xi(barIndex) — valid off-screen; XRef "right" = m.W. y = m.y(price).
//   • Culling: a prim whose entire x-extent falls outside [-40, m.W+40] px is skipped, as is any
//     prim with minPxPerBar > m.barW. Any null/NaN coordinate skips that prim (or that point,
//     for multi-point kinds — clouds/gradlines break the run and resume after the gap).
//     "columns" culls in INDEX space instead: its items are contract-sorted by i, so a binary
//     search narrows a full-history histogram to the visible slice [i0-2, i1+2] before any
//     coordinate work — a 20k-item series costs only what is on screen per frame.
//   • Clamping: zone/bgshade rect x-edges are clamped to [-40, m.W+40]; line endpoints are
//     clamped to the same window with y linearly interpolated so the slope is preserved.
//   • Z-order: stable sort by (z ?? 0); "bgshade" is always forced behind everything else.
//   • Alpha clamps: zone fill ≤0.18, bgshade ≤0.10. NaN/Infinity numbers never render.
//   • Colors pass through verbatim (CSS var() tokens); alpha is applied via *-opacity
//     attributes, never by baking rgba() literals.
// Tooltips: elements carrying tooltipId are marked `data-ic-tip` and stay NON-hit-testable — the
// layer's own pointer-events:none really does cover everything. Hover/tap is resolved in JS from
// delegated listeners on the chart wrapper, which drive one shared ".ic-tip" HTML div inside it.
// lib/markerTooltip.ts documents at length why this is a JS hit test and not `pointer-events:auto`.

import type {
  ZonePrim, LinePrim, PolyPrim, CloudPrim, GradLinePrim, LabelPrim, MarkerPrim,
  ProfilePrim, BgShadePrim, ColumnsPrim, XRef, CoordMapper, SuiteRenderBundle, TooltipDef,
} from "./types";
import {
  gestureStamp, hitTestMarkers, isTapSample, MARKER_HOVER_SLACK, MARKER_TAP_SLACK,
} from "../markerTooltip";
import {
  planSquareMarkerBatch, sameSquareMarkerBatchStyle, type SquareMarkerBatchPlan,
} from "./squareMarkerBatch";

const NS = "http://www.w3.org/2000/svg";
const CULL_PAD = 40;

// -------------------------------------------------------------------------------- tiny helpers

function mk(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

function fin(v: number | null | undefined): v is number {
  return typeof v === "number" && isFinite(v);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Width estimate without getBBox: ~0.62em per char (perf bar forbids layout reads). */
function estTextW(text: string, fs: number): number {
  return text.length * fs * 0.62;
}

/** Mostly digits/symbols → numeral font (tabular), else UI font. */
function fontFor(text: string): string {
  let numish = 0;
  for (let i = 0; i < text.length; i++) {
    if ("0123456789.,%+-−–:/$ ▲▼✓×".indexOf(text[i]) >= 0) numish++;
  }
  return numish >= text.length / 2 ? "var(--font-num)" : "var(--font-ui)";
}

function isCapsTag(text: string): boolean {
  return /[A-Z]/.test(text) && !/[a-z]/.test(text);
}

// ------------------------------------------------------------------------------ tooltip plumbing

/** Per-wrapper tooltip defs, refreshed by every renderPrims call. */
const TIP_DEFS = new WeakMap<HTMLElement, Map<string, TooltipDef>>();

/** One hit-testable prim, measured in VIEWPORT (client) coordinates — the space pointer events
 *  already report in, so the hit test never has to reason about the overlay's SVG user space
 *  versus the wrapper's border box. Same choice, for the same reason, as ChartPanel's sig hits. */
type HitEntry = { el: Element; tid: string; x: number; y: number; w: number; h: number };

/** Hit boxes for the prims currently painted in a wrapper. `null` (or absent) = stale: renderPrims
 *  drops it on every frame and the next pointer event rebuilds it. Rebuilding is LAZY because
 *  renderPrims runs on every pan/zoom frame while a hover is a far rarer event — measuring here
 *  would put a layout read on the render path, which the perf bar forbids. */
const HIT_BOXES = new WeakMap<HTMLElement, HitEntry[] | null>();

/** Wrappers whose delegated pointer listeners are already installed. */
const HIT_WIRED = new WeakSet<HTMLElement>();

/**
 * Create (once) the shared tooltip div inside the chart wrapper, and install (once) the delegated
 * pointer listeners that drive it. Idempotent. The wrapper must be a positioned element (chart
 * wrappers are position:relative).
 */
export function ensureTooltipHost(wrap: HTMLElement): void {
  if (!wrap.querySelector(":scope > .ic-tip")) {
    const tip = document.createElement("div");
    tip.className = "ic-tip";
    tip.style.cssText =
      "position:absolute;left:0;top:0;display:none;z-index:6;pointer-events:none;max-width:260px;" +
      "background:var(--pop-bg,rgba(24,26,32,.96));border:1px solid var(--line-3);" +
      "border-radius:var(--r-md);padding:6px 9px;font:11px/1.45 var(--font-ui);color:var(--text);" +
      "white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.45)";
    wrap.appendChild(tip);
  }
  wireTooltipHitTest(wrap);
}

/** The clip window a prim actually renders inside, in CLIENT coordinates, or null when the prim is
 *  unclipped (or the clip cannot be read, in which case the caller must not narrow anything).
 *
 *  Pane suites — and the price pane itself — render into `<g clip-path="url(#…)">`, and the clip is
 *  not decoration: ChartPanel sizes it to the live pane band precisely so off-scale prims (a TP/SL
 *  label pushed past the band, say) are HIDDEN. A hidden prim still reports a full
 *  getBoundingClientRect, so without this it would ghost-hit — the reader would get a tooltip from
 *  a chart element they cannot see. `url(#id)` resolves against the whole document, which is why
 *  ChartPanel mints document-unique clip ids; the containment check keeps a same-id clip in another
 *  chart's overlay from being applied to this one. */
function clipWindowOf(el: Element): { x: number; y: number; w: number; h: number } | null {
  const g = el.closest("g[clip-path]");
  if (!g) return null;
  const ref = /^url\(\s*["']?#([^"'()\s]+)["']?\s*\)$/.exec((g.getAttribute("clip-path") || "").trim());
  const svg = el.closest("svg");
  if (!ref || !svg) return null;
  const cp = svg.ownerDocument?.getElementById(ref[1]);
  if (!cp || !svg.contains(cp) || cp.tagName.toLowerCase() !== "clippath") return null;
  // Only userSpaceOnUse is convertible by a plain origin shift; anything else is left un-narrowed.
  const units = cp.getAttribute("clipPathUnits");
  if (units && units !== "userSpaceOnUse") return null;
  const r = cp.querySelector("rect");
  if (!r) return null;
  const rx = parseFloat(r.getAttribute("x") || "0"), ry = parseFloat(r.getAttribute("y") || "0");
  const rw = parseFloat(r.getAttribute("width") || ""), rh = parseFloat(r.getAttribute("height") || "");
  if (!fin(rx) || !fin(ry) || !fin(rw) || !fin(rh)) return null;
  let sr: DOMRect;
  // The overlay <svg> is inset:0 with no viewBox, so one SVG user unit is one CSS px and the whole
  // conversion is the svg's own client origin.
  try { sr = svg.getBoundingClientRect(); } catch { return null; }
  return { x: sr.x + rx, y: sr.y + ry, w: rw, h: rh };
}

/** Measure every prim currently carrying a tooltip. Live query, so a prim kind added later is
 *  hoverable for free and cannot be forgotten. */
function buildHitEntries(wrap: HTMLElement): HitEntry[] {
  const out: HitEntry[] = [];
  for (const el of wrap.querySelectorAll("svg [data-ic-tip]")) {
    const tid = el.getAttribute("data-ic-tip");
    if (!tid) continue;
    let b: DOMRect;
    try { b = el.getBoundingClientRect(); } catch { continue; }
    if (!(b.width > 0) || !(b.height > 0)) continue;
    let x = b.x, y = b.y, w = b.width, h = b.height;
    const clip = clipWindowOf(el);
    if (clip) {
      const x1 = Math.max(x, clip.x), y1 = Math.max(y, clip.y);
      const x2 = Math.min(x + w, clip.x + clip.w), y2 = Math.min(y + h, clip.y + clip.h);
      if (!(x2 > x1) || !(y2 > y1)) continue;   // clipped fully out of sight — never a ghost hit
      x = x1; y = y1; w = x2 - x1; h = y2 - y1;
    }
    out.push({ el, tid, x, y, w, h });
  }
  return out;
}

/**
 * Install the delegated hover/tap listeners for one chart wrapper. Once per wrapper, ever.
 *
 * WHY DELEGATION AND NOT `pointer-events:auto` ON THE PRIMS — the full argument lives in
 * lib/markerTooltip.ts and is structural, not a matter of tuning: lightweight-charts owns pan,
 * crosshair, wheel-zoom and pinch on ITS OWN canvas, which lives inside the chart container. The
 * overlay layers are appended to the container's PARENT, so the canvas is a SIBLING SUBTREE, not an
 * ancestor. An event landing on a hit-testable prim bubbles to `wrap` and stops — it never reaches
 * the canvas and there is no propagation path that would take it there. A hit-testable prim
 * therefore does not merely "risk" swallowing a drag, it DELETES the chart's gesture surface over
 * its own footprint: a pan that starts on it does not pan, a wheel over it does not zoom, and the
 * crosshair drops out as the cursor crosses it. That is what these prims shipped with until now.
 *
 * So the layer stays entirely `pointer-events:none` and NOT ONE PIXEL of the chart's hit-test
 * geometry moves. Every listener here is read-only — no preventDefault, no stopPropagation, no
 * capture — and registered on `wrap`, which already receives the canvas's bubbled pointer events
 * (ChartPanel's pane-hover, double-tap and signal-marker handlers have all relied on that for as
 * long as they have existed).
 */
function wireTooltipHitTest(wrap: HTMLElement): void {
  if (HIT_WIRED.has(wrap)) return;
  HIT_WIRED.add(wrap);

  /** A tapped tooltip stays put until the next pointerdown; a hovered one follows the cursor. */
  let pinned = false;
  /** Suppresses the tooltip for the whole of a press-drag, so it can never chase a pan. `ts` is
   *  the event's own time — see markerTooltip.gestureStamp for why the handler clock cannot
   *  classify this gesture on a busy thread. */
  let down: { x: number; y: number; t: number; ts: number | null; id: number } | null = null;
  /** Touch emits a synthetic mouse-ish move right after a tap; it must not un-pin the tap. */
  let lastTouchTs = 0;
  /** What the shared node is currently showing. Keyed on the def OBJECT as well as the id: bundles
   *  are memoized per (suite, symbol, tf, bars, params, tier), so identity is stable across pan
   *  frames — steady-state hover never rebuilds a node, and a recompute still refreshes the rows. */
  let shownTid: string | null = null;
  let shownDef: TooltipDef | null = null;

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const tipOf = () => wrap.querySelector(":scope > .ic-tip") as HTMLElement | null;

  // First-show placement stays synchronous so a newly opened tooltip never flashes at the wrapper
  // origin. Once visible, high-Hz pointer streams only need the latest sample that can actually
  // reach the display: defer cursor-follow geometry to one requestAnimationFrame per paint.
  let positionFrame: number | null = null;
  let pendingPosition: { tip: HTMLElement; clientX: number; clientY: number } | null = null;
  const flushPosition = () => {
    positionFrame = null;
    const next = pendingPosition;
    pendingPosition = null;
    if (!next || next.tip.style.display !== "block" || !next.tip.isConnected || !wrap.isConnected) return;
    placeTip(next.tip, wrap, next);
  };
  const cancelPosition = () => {
    pendingPosition = null;
    if (positionFrame == null) return;
    if (typeof cancelAnimationFrame === "function") {
      try { cancelAnimationFrame(positionFrame); } catch {}
    }
    positionFrame = null;
  };
  const schedulePosition = (tip: HTMLElement, clientX: number, clientY: number) => {
    pendingPosition = { tip, clientX, clientY };
    if (positionFrame != null) return;
    if (typeof requestAnimationFrame !== "function") {
      flushPosition();
      return;
    }
    positionFrame = requestAnimationFrame(flushPosition);
  };

  const hide = () => {
    pinned = false;
    cancelPosition();
    const tip = tipOf();
    if (tip && tip.style.display !== "none") tip.style.display = "none";
  };

  const hitAt = (clientX: number, clientY: number, slack: number): HitEntry | null => {
    let entries = HIT_BOXES.get(wrap) ?? null;
    // The layer can also be emptied with no renderPrims call behind it (every suite toggled off),
    // which leaves a cache of boxes whose elements are gone. A detached first element proves it.
    if (entries && entries.length && !entries[0].el.isConnected) entries = null;
    if (!entries) { entries = buildHitEntries(wrap); HIT_BOXES.set(wrap, entries); }
    return entries.length ? hitTestMarkers(entries, clientX, clientY, slack) : null;
  };

  const show = (hit: HitEntry, def: TooltipDef, clientX: number, clientY: number) => {
    const tip = tipOf(); if (!tip) return;
    // Only rewrite the node when the tooltip actually changed — this runs on every pointermove
    // while the cursor sits on a prim, and re-filling 60×/s rebuilds a subtree for nothing.
    if (shownTid !== hit.tid || shownDef !== def) {
      fillTip(tip, def);
      tip.dataset.icTipFor = hit.tid;
      shownTid = hit.tid; shownDef = def;
    }
    const alreadyVisible = tip.style.display === "block";
    if (!alreadyVisible) {
      cancelPosition();
      tip.style.display = "block";
      placeTip(tip, wrap, { clientX, clientY });
      return;
    }
    schedulePosition(tip, clientX, clientY);
  };

  const defOf = (tid: string): TooltipDef | null => TIP_DEFS.get(wrap)?.get(tid) ?? null;

  const onMove = (e: PointerEvent) => {
    // A PointerEvent always carries a pointerType in a browser; an absent one means a plain
    // MouseEvent (jsdom) and reads as a mouse. Touch takes the tap path below.
    if (e.pointerType && e.pointerType !== "mouse") return;
    // Synthetic post-touch move. Gated on a touch having HAPPENED: `performance.now()` is measured
    // from the page's time origin, so a bare `now() - 0 < 700` would also suppress every hover in
    // the first 700ms of the page's life.
    if (lastTouchTs > 0 && now() - lastTouchTs < 700) return;
    if (pinned) return;                           // a tapped tooltip is not chased by the cursor
    if (down) {
      if (e.buttons !== 0) { hide(); return; }    // mid press-drag → never chase a pan
      // A press whose release landed outside the window never reaches our `pointerup`, and a stuck
      // flag would suppress hover for the rest of the session. A move with no button held is proof
      // the gesture ended, so the flag heals itself instead of needing window listeners.
      down = null;
    }
    const hit = hitAt(e.clientX, e.clientY, MARKER_HOVER_SLACK);
    const def = hit ? defOf(hit.tid) : null;
    if (hit && def) show(hit, def, e.clientX, e.clientY);
    else hide();
  };

  const onDown = (e: PointerEvent) => {
    // Unconditional: a press anywhere dismisses an open tooltip BEFORE the gesture it starts.
    // This is also what makes the pinned (tapped) tooltip dismissable by a tap elsewhere.
    hide();
    down = { x: e.clientX, y: e.clientY, t: now(), ts: gestureStamp(e), id: e.pointerId };
  };

  const onUp = (e: PointerEvent) => {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId) return;
    if (e.pointerType === "mouse") return;        // a mouse click is not a tooltip gesture
    lastTouchTs = now();
    // TOUCH: a tap on a prim must not dead-end. Same thresholds as ChartPanel's double-tap
    // detector, so one gesture can never be a tap here and a drag for the chart. Timed on the
    // EVENTS, not on when this handler ran: a thread held for 300ms+ between down and up (a phone
    // mid-repaint, a saturated runner) made a fingertip flick read as a long press and the tooltip
    // dead-ended. markerTooltip.gestureStamp carries the measurements.
    if (!isTapSample(d, { x: e.clientX, y: e.clientY, t: now(), ts: gestureStamp(e) })) return;
    // Hit-tested at the DOWN point — where the finger actually landed — and with the larger touch
    // slack, because these prims are a few px across and a fingertip has no hover to correct with.
    const hit = hitAt(d.x, d.y, MARKER_TAP_SLACK);
    const def = hit ? defOf(hit.tid) : null;
    if (!hit || !def) return;
    show(hit, def, d.x, d.y);
    pinned = true;    // stays until the next pointerdown; there is no hover to dismiss it
  };

  const onCancel = () => { down = null; hide(); };

  const onLeave = (e: PointerEvent) => {
    // Touch fires pointerleave immediately after pointerup, which would kill the pin the tap just
    // set. Only a real cursor leaving the chart dismisses a tooltip.
    if (e.pointerType && e.pointerType !== "mouse") return;
    hide();
  };

  // `passive` is the contract in code: nothing here may ever call preventDefault. No capture phase
  // and no removal — the listeners live exactly as long as the wrapper element does.
  const opts = { passive: true } as const;
  wrap.addEventListener("pointermove", onMove, opts);
  wrap.addEventListener("pointerdown", onDown, opts);
  wrap.addEventListener("pointerup", onUp, opts);
  wrap.addEventListener("pointercancel", onCancel, opts);
  wrap.addEventListener("pointerleave", onLeave, opts);
}

function fillTip(tip: HTMLElement, def: TooltipDef): void {
  while (tip.firstChild) tip.removeChild(tip.firstChild);
  const title = document.createElement("div");
  title.style.cssText = "font-weight:700;display:flex;align-items:center;gap:6px;margin-bottom:3px";
  if (def.accent) {
    const sw = document.createElement("span");
    sw.style.cssText = `width:8px;height:8px;border-radius:2px;flex:none;background:${def.accent}`;
    title.appendChild(sw);
  }
  title.appendChild(document.createTextNode(def.title));
  tip.appendChild(title);
  for (const r of def.rows) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;gap:14px;font-size:10.5px";
    const k = document.createElement("span");
    k.style.color = "var(--muted)";
    k.textContent = r.k;
    const v = document.createElement("span");
    v.style.cssText =
      `font-family:var(--font-num);font-variant-numeric:tabular-nums;color:${r.color || "var(--text)"}`;
    v.textContent = r.v;
    row.appendChild(k); row.appendChild(v);
    tip.appendChild(row);
  }
}

/** `ev` is only ever read for its cursor position, so the tap path can hand over the DOWN point as
 *  a plain object rather than the (already-consumed) pointerup event. */
function placeTip(tip: HTMLElement, wrap: HTMLElement, ev: { clientX: number; clientY: number }): void {
  const wr = wrap.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = ev.clientX - wr.left + 12, y = ev.clientY - wr.top + 14;
  if (x + tw > wr.width - 4) x = ev.clientX - wr.left - tw - 12;
  if (y + th > wr.height - 4) y = ev.clientY - wr.top - th - 10;
  tip.style.left = `${clamp(x, 4, Math.max(4, wr.width - tw - 4))}px`;
  tip.style.top = `${clamp(y, 4, Math.max(4, wr.height - th - 4))}px`;
}

/**
 * Mark an SVG element as carrying a tooltip. ATTRIBUTE ONLY — no listeners and, deliberately, no
 * `pointer-events`: the prim stays non-hit-testable so the layer's `pointer-events:none` really
 * does cover everything, and the chart keeps every gesture over the prim's footprint (see
 * wireTooltipHitTest above, and lib/markerTooltip.ts for the structural argument).
 *
 * `data-ic-tip` is the hit query's only input: the delegated listeners on the wrapper measure every
 * element carrying it and resolve the id against the defs map the last renderPrims call stored for
 * that wrapper. renderPrims calls this itself for every prim carrying a tooltipId — modules never
 * need to.
 */
export function bindTooltip(el: Element, tooltipId: string): void {
  (el as SVGElement).setAttribute("data-ic-tip", tooltipId);
}

// ---------------------------------------------------------------------------------- coordinates

function xOf(m: CoordMapper, i: XRef): number | null {
  if (i === "right") return m.W;
  const x = m.xi(i);
  return fin(x) ? x : null;
}

/** Entirely outside the padded viewport window → cull. */
function xVisible(m: CoordMapper, xa: number, xb: number): boolean {
  const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
  return hi >= -CULL_PAD && lo <= m.W + CULL_PAD;
}

// ------------------------------------------------------------------------------- prim renderers

function drawZone(f: DocumentFragment, z: ZonePrim, m: CoordMapper): Element | null {
  const xa = xOf(m, z.i1), xb = xOf(m, z.i2);
  const ya = m.y(z.p1), yb = m.y(z.p2);
  if (!fin(xa) || !fin(xb) || !fin(ya) || !fin(yb)) return null;
  if (!xVisible(m, xa, xb)) return null;
  const x1 = clamp(Math.min(xa, xb), -CULL_PAD, m.W + CULL_PAD);
  const x2 = clamp(Math.max(xa, xb), -CULL_PAD, m.W + CULL_PAD);
  const y1 = Math.min(ya, yb), y2 = Math.max(ya, yb);
  const w = x2 - x1, h = y2 - y1;
  if (!(w > 0) || !(h >= 0)) return null;
  const g = mk("g", {});
  const rect = mk("rect", {
    x: x1, y: y1, width: w, height: Math.max(h, 0.5),
    fill: z.fill, "fill-opacity": clamp(z.fillAlpha ?? 0.10, 0, 0.18),
  });
  if (z.radius) rect.setAttribute("rx", String(z.radius));
  if (z.stroke && !z.edges) {
    rect.setAttribute("stroke", z.stroke);
    rect.setAttribute("stroke-width", String(z.strokeW ?? 1));
    if (z.dash) rect.setAttribute("stroke-dasharray", z.dash);
  }
  g.appendChild(rect);
  if (z.stroke && z.edges) {
    const seg: Record<string, [number, number, number, number]> = {
      top: [x1, y1, x2, y1], bottom: [x1, y2, x2, y2],
      left: [x1, y1, x1, y2], right: [x2, y1, x2, y2],
    };
    for (const e of z.edges) {
      const s = seg[e]; if (!s) continue;
      const ln = mk("line", {
        x1: s[0], y1: s[1], x2: s[2], y2: s[3],
        stroke: z.stroke, "stroke-width": z.strokeW ?? 1, "vector-effect": "non-scaling-stroke",
      });
      if (z.dash) ln.setAttribute("stroke-dasharray", z.dash);
      g.appendChild(ln);
    }
  }
  if (z.midline) {
    const ym = m.y((z.p1 + z.p2) / 2);
    if (fin(ym)) {
      g.appendChild(mk("line", {
        x1, y1: ym, x2, y2: ym,
        stroke: z.midline.color, "stroke-width": 1,
        "stroke-dasharray": z.midline.dash ?? "4 3", "vector-effect": "non-scaling-stroke",
      }));
    }
  }
  f.appendChild(g);
  return g;
}

function drawLine(f: DocumentFragment, l: LinePrim, m: CoordMapper): Element | null {
  const xa = xOf(m, l.a.i), xb = xOf(m, l.b.i);
  const ya = m.y(l.a.p), yb = m.y(l.b.p);
  if (!fin(xa) || !fin(xb) || !fin(ya) || !fin(yb)) return null;
  if (!xVisible(m, xa, xb)) return null;
  // Clamp x to the padded window, interpolating y so the slope survives the clamp.
  let X1 = xa, Y1 = ya, X2 = xb, Y2 = yb;
  const lo = -CULL_PAD, hi = m.W + CULL_PAD;
  if (X1 !== X2) {
    const slope = (Y2 - Y1) / (X2 - X1);
    const cl = (x: number, y: number, cx: number): [number, number] => [cx, y + (cx - x) * slope];
    if (X1 < lo) [X1, Y1] = cl(X1, Y1, lo); else if (X1 > hi) [X1, Y1] = cl(X1, Y1, hi);
    if (X2 < lo) [X2, Y2] = cl(X2, Y2, lo); else if (X2 > hi) [X2, Y2] = cl(X2, Y2, hi);
  }
  const ln = mk("line", {
    x1: X1, y1: Y1, x2: X2, y2: Y2,
    stroke: l.color, "stroke-width": l.w ?? 1, "vector-effect": "non-scaling-stroke",
  });
  if (l.dash) ln.setAttribute("stroke-dasharray", l.dash);
  if (l.alpha != null) ln.setAttribute("opacity", String(clamp(l.alpha, 0, 1)));
  f.appendChild(ln);
  return ln;
}

function drawPoly(f: DocumentFragment, p: PolyPrim, m: CoordMapper): Element | null {
  if (p.pts.length < 2) return null;
  let d = "", pen = false, minX = Infinity, maxX = -Infinity;
  for (const pt of p.pts) {
    const x = m.xi(pt.i), y = m.y(pt.p);
    if (!fin(x) || !fin(y)) { pen = false; continue; } // gap: break the path, resume after
    d += (pen ? "L" : "M") + `${x} ${y}`;
    pen = true;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
  }
  if (!d || !xVisible(m, minX, maxX)) return null;
  const path = mk("path", {
    d, fill: "none", stroke: p.color, "stroke-width": p.w ?? 1,
    "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke",
  });
  if (p.dash) path.setAttribute("stroke-dasharray", p.dash);
  if (p.alpha != null) path.setAttribute("opacity", String(clamp(p.alpha, 0, 1)));
  f.appendChild(path);
  return path;
}

function drawCloud(f: DocumentFragment, c: CloudPrim, m: CoordMapper): Element | null {
  const n = Math.min(c.upper.length, c.lower.length);
  if (n < 2) return null;
  const alpha = clamp(c.fillAlpha ?? 0.12, 0, 0.5);
  const fallback = (c.segColors && c.segColors[0]) || "var(--brand-2)";
  const g = mk("g", {});
  // Precompute px points; null coords break color runs.
  const px: Array<[number, number, number] | null> = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = m.xi(c.upper[i].i), yu = m.y(c.upper[i].p), yl = m.y(c.lower[i].p);
    px[i] = fin(x) && fin(yu) && fin(yl) ? [x, yu, yl] : null;
  }
  // Merge consecutive same-color segments into one polygon (node economy).
  let s = 0;
  while (s < n - 1) {
    if (!px[s]) { s++; continue; }
    const color = (c.segColors && c.segColors[s]) || fallback;
    let e = s + 1;
    while (
      e < n - 1 && px[e] &&
      ((c.segColors && c.segColors[e]) || fallback) === color
    ) e++;
    if (!px[e]) { s = e + 1; continue; } // run must end on a valid point
    const seg = px.slice(s, e + 1) as Array<[number, number, number]>;
    if (xVisible(m, seg[0][0], seg[seg.length - 1][0])) {
      let pts = "";
      for (let i = 0; i < seg.length; i++) pts += `${seg[i][0]},${seg[i][1]} `;
      for (let i = seg.length - 1; i >= 0; i--) pts += `${seg[i][0]},${seg[i][2]} `;
      g.appendChild(mk("polygon", { points: pts.trimEnd(), fill: color, "fill-opacity": alpha, stroke: "none" }));
    }
    s = e;
  }
  if (!g.firstChild) return null;
  f.appendChild(g);
  return g;
}

function drawGradLine(f: DocumentFragment, gl: GradLinePrim, m: CoordMapper): Element | null {
  const n = gl.pts.length;
  if (n < 2) return null;
  const fallback = gl.colors[0] || "var(--brand-2)";
  const g = mk("g", {});
  const px: Array<[number, number] | null> = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = m.xi(gl.pts[i].i), y = m.y(gl.pts[i].p);
    px[i] = fin(x) && fin(y) ? [x, y] : null;
  }
  // Merge consecutive same-color segments into single <path>s.
  let s = 0;
  while (s < n - 1) {
    if (!px[s]) { s++; continue; }
    const color = gl.colors[s] || fallback;
    let e = s + 1;
    while (e < n - 1 && px[e] && (gl.colors[e] || fallback) === color) e++;
    if (!px[e]) { s = e + 1; continue; }
    const first = px[s] as [number, number], last = px[e] as [number, number];
    if (xVisible(m, first[0], last[0])) {
      let d = `M${first[0]} ${first[1]}`;
      for (let i = s + 1; i <= e; i++) { const p = px[i] as [number, number]; d += `L${p[0]} ${p[1]}`; }
      const glAttrs: Record<string, string | number> = {
        d, fill: "none", stroke: color, "stroke-width": gl.w ?? 1.5,
        "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke",
      };
      if (gl.dash) glAttrs["stroke-dasharray"] = gl.dash;
      if (gl.alpha != null && gl.alpha < 1) glAttrs["stroke-opacity"] = Math.max(0, gl.alpha);
      g.appendChild(mk("path", glAttrs));
    }
    s = e;
  }
  if (!g.firstChild) return null;
  f.appendChild(g);
  return g;
}

function drawLabel(f: DocumentFragment, lb: LabelPrim, m: CoordMapper): Element | null {
  const x = xOf(m, lb.i), y = m.y(lb.p);
  if (!fin(x) || !fin(y) || !lb.text) return null;
  if (!xVisible(m, x, x)) return null;
  const fs = clamp(lb.fs ?? 10, 8, 20);
  const tw = estTextW(lb.text, fs);
  const padX = lb.style === "chip" ? 3 : lb.style === "bare" ? 0 : 6;
  const padY = lb.style === "chip" ? 3 : lb.style === "bare" ? 0 : 3;
  const bw = tw + padX * 2, bh = fs + padY * 2;
  const gap = 6;
  // Box center from placement, then user offsets.
  let cx = x, cy = y;
  switch (lb.place) {
    case "above": cy = y - gap - bh / 2; break;
    case "below": cy = y + gap + bh / 2; break;
    case "left": cx = x - gap - bw / 2; break;
    case "right": cx = x + gap + bw / 2; break;
    case "center": break;
  }
  cx += lb.dxPx ?? 0; cy += lb.dyPx ?? 0;
  const g = mk("g", {});
  if (lb.style !== "bare") {
    const bx = cx - bw / 2, by = cy - bh / 2;
    if (lb.style === "pill") {
      const bg = mk("rect", { x: bx, y: by, width: bw, height: bh, rx: bh / 2, fill: lb.bg ?? lb.color });
      if (!lb.bg) bg.setAttribute("fill-opacity", "0.14");
      g.appendChild(bg);
      if (lb.pointer && (lb.place === "above" || lb.place === "below")) {
        const dir = lb.place === "above" ? 1 : -1; // triangle points back at (i,p)
        const yEdge = cy + (bh / 2) * dir;
        g.appendChild(mk("path", {
          d: `M${cx - 4} ${yEdge}L${cx + 4} ${yEdge}L${cx} ${yEdge + 4 * dir}Z`,
          fill: lb.bg ?? lb.color, ...(lb.bg ? {} : { "fill-opacity": 0.14 }),
        }));
      }
    } else { // tag / chip — fin-tag formula in SVG
      if (lb.style === "chip") {
        g.appendChild(mk("rect", { x: bx, y: by, width: bw, height: bh, rx: 4, fill: "var(--panel-2)" }));
      }
      g.appendChild(mk("rect", {
        x: bx, y: by, width: bw, height: bh, rx: 4,
        fill: lb.color, "fill-opacity": 0.12,
        stroke: lb.color, "stroke-opacity": 0.30, "stroke-width": 1,
      }));
    }
  }
  const txt = mk("text", {
    x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central",
    fill: lb.color, "font-size": fs, "font-weight": lb.bold ? 700 : 600,
    "font-family": fontFor(lb.text),
  }) as SVGTextElement;
  txt.style.fontVariantNumeric = "tabular-nums";
  if (isCapsTag(lb.text) && (lb.style === "tag" || lb.style === "chip")) {
    txt.setAttribute("letter-spacing", ".04em");
  }
  txt.textContent = lb.text;
  g.appendChild(txt);
  f.appendChild(g);
  return g;
}

function drawMarker(f: DocumentFragment, mk_: MarkerPrim, m: CoordMapper): Element | null {
  const x = m.xi(mk_.i), y = m.y(mk_.p);
  if (!fin(x) || !fin(y)) return null;
  if (!xVisible(m, x, x)) return null;
  let s = mk_.size ?? 5;
  if (m.barW < 4) s = Math.min(s, 3); // autoscale down when zoomed way out
  const fill = mk_.fill;
  const alpha = mk_.alpha != null ? clamp(mk_.alpha, 0, 1) : null;
  let el: SVGElement;
  switch (mk_.shape) {
    case "diamond":
      el = mk("path", { d: `M${x} ${y - s}L${x + s} ${y}L${x} ${y + s}L${x - s} ${y}Z`, fill });
      break;
    case "tri-up":
      el = mk("path", { d: `M${x} ${y - s}L${x + s} ${y + s}L${x - s} ${y + s}Z`, fill });
      break;
    case "tri-down":
      el = mk("path", { d: `M${x} ${y + s}L${x + s} ${y - s}L${x - s} ${y - s}Z`, fill });
      break;
    case "circle":
      el = mk("circle", { cx: x, cy: y, r: s, fill });
      break;
    case "square":
      el = mk("rect", { x: x - s, y: y - s, width: s * 2, height: s * 2, fill });
      break;
    case "x":
      el = mk("path", {
        d: `M${x - s} ${y - s}L${x + s} ${y + s}M${x + s} ${y - s}L${x - s} ${y + s}`,
        fill: "none", stroke: fill, "stroke-width": 1.5, "stroke-linecap": "round",
      });
      break;
    case "arrow-up":
      el = mk("path", {
        d: `M${x} ${y - s}L${x - s} ${y}M${x} ${y - s}L${x + s} ${y}M${x} ${y - s}L${x} ${y + s}`,
        fill: "none", stroke: fill, "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round",
      });
      break;
    case "arrow-down":
      el = mk("path", {
        d: `M${x} ${y + s}L${x - s} ${y}M${x} ${y + s}L${x + s} ${y}M${x} ${y + s}L${x} ${y - s}`,
        fill: "none", stroke: fill, "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round",
      });
      break;
    case "triple-lines": { // three 8px-wide lines stacked 3px apart (oscillator buy/sell)
      el = mk("path", {
        d: `M${x - 4} ${y - 3}H${x + 4}M${x - 4} ${y}H${x + 4}M${x - 4} ${y + 3}H${x + 4}`,
        fill: "none", stroke: fill, "stroke-width": 1.5, "stroke-linecap": "round",
      });
      break;
    }
    default:
      return null;
  }
  if (mk_.stroke && mk_.shape !== "x" && mk_.shape !== "arrow-up" && mk_.shape !== "arrow-down" && mk_.shape !== "triple-lines") {
    el.setAttribute("stroke", mk_.stroke);
    el.setAttribute("stroke-width", "1");
  }
  if (alpha != null) el.setAttribute("opacity", String(alpha));
  f.appendChild(el);
  return el;
}

function drawSquareMarkerBatch(f: DocumentFragment, plan: SquareMarkerBatchPlan): void {
  for (const d of plan.paths) {
    const path = mk("path", { d, fill: plan.fill });
    if (plan.stroke) {
      path.setAttribute("stroke", plan.stroke);
      path.setAttribute("stroke-width", "1");
    }
    if (plan.alpha != null) path.setAttribute("opacity", String(plan.alpha));
    f.appendChild(path);
  }
}

function drawProfile(f: DocumentFragment, pr: ProfilePrim, m: CoordMapper): Element | null {
  const maxPx = pr.maxPx ?? 120;
  let anchorX: number, dir: 1 | -1, capPx = maxPx;
  if (pr.side === "right") {
    anchorX = m.W; dir = -1;
  } else {
    if (!pr.box) return null;
    const bx1 = xOf(m, pr.box.i1), bx2 = xOf(m, pr.box.i2);
    if (!fin(bx1) || !fin(bx2)) return null;
    if (!xVisible(m, bx1, bx2)) return null;
    anchorX = Math.min(bx1, bx2); dir = 1;
    capPx = Math.min(maxPx, Math.abs(bx2 - bx1)); // bars capped to box width
  }
  const g = mk("g", {});
  for (const bin of pr.bins) {
    if (!fin(bin.p1) || !fin(bin.p2) || !fin(bin.frac)) continue;
    const y1 = m.y(bin.p1), y2 = m.y(bin.p2);
    if (!fin(y1) || !fin(y2)) continue;
    const yT = Math.min(y1, y2), hRaw = Math.abs(y2 - y1);
    const h = hRaw > 2 ? hRaw - 1 : hRaw; // 1px gap between bins when there's room
    if (h <= 0) continue;
    const len = clamp(bin.frac, 0, 1) * capPx;
    if (len < 0.5) continue;
    const bx = dir === -1 ? anchorX - len : anchorX;
    g.appendChild(mk("rect", {
      x: bx, y: yT, width: len, height: h,
      fill: bin.color, "fill-opacity": bin.alpha != null ? clamp(bin.alpha, 0, 1) : 0.55,
    }));
    if (bin.overlayFrac != null && bin.overlayColor) {
      const oLen = clamp(bin.overlayFrac, 0, 1) * capPx;
      if (oLen >= 0.5) {
        const ox = dir === -1 ? anchorX - oLen : anchorX;
        g.appendChild(mk("rect", {
          x: ox, y: yT, width: oLen, height: h,
          fill: bin.overlayColor, "fill-opacity": 0.75,
        }));
      }
    }
    if (bin.label && h >= 8) {
      const tipX = dir === -1 ? anchorX - len - 3 : anchorX + len + 3;
      const txt = mk("text", {
        x: tipX, y: yT + h / 2,
        "text-anchor": dir === -1 ? "end" : "start", "dominant-baseline": "central",
        fill: "var(--muted)", "font-size": 8.5, "font-family": "var(--font-num)",
      }) as SVGTextElement;
      txt.style.fontVariantNumeric = "tabular-nums";
      txt.textContent = bin.label;
      g.appendChild(txt);
    }
  }
  if (!g.firstChild) return null;
  f.appendChild(g);
  return g;
}

function drawBgShade(f: DocumentFragment, b: BgShadePrim, m: CoordMapper): Element | null {
  const xa = xOf(m, b.i1), xb = xOf(m, b.i2);
  if (!fin(xa) || !fin(xb)) return null;
  if (!xVisible(m, xa, xb)) return null;
  const x1 = clamp(Math.min(xa, xb), -CULL_PAD, m.W + CULL_PAD);
  const x2 = clamp(Math.max(xa, xb), -CULL_PAD, m.W + CULL_PAD);
  if (x2 - x1 <= 0) return null;
  const rect = mk("rect", {
    x: x1, y: 0, width: x2 - x1, height: m.H,
    fill: b.color, "fill-opacity": clamp(b.alpha, 0, 0.10),
  });
  f.appendChild(rect);
  return rect;
}

/** First index whose `.i` is >= target. Items are contract-guaranteed sorted by i ascending. */
function lowerBoundByI(items: Array<{ i: number }>, target: number): number {
  let lo = 0, hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].i < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Oscillator histogram: one vertical rect per item, from `base` (default 0) to `v`, in whatever
 * y-space the mapper carries (pane suites map their own min..max range). Bars are centered on
 * xi(i) and are `clamp(widthFrac, 0.1, 1) × barW` wide.
 *
 * Cost is proportional to the VISIBLE slice, not to items.length: the items are sorted by i, so
 * two binary searches bracket [i0-2, i1+2] and everything outside is never touched. Full-history
 * histograms (20k+ bars) therefore stay a per-frame no-op off-screen.
 */
function drawColumns(f: DocumentFragment, cp: ColumnsPrim, m: CoordMapper): Element | null {
  const items = cp.items;
  if (!items || items.length === 0) return null;
  // Index-space cull (inclusive [lo, hi] → exclusive end at hi+1; bar indices are integers).
  const lo = fin(m.i0) ? Math.floor(m.i0) - 2 : -Infinity;
  const hi = fin(m.i1) ? Math.ceil(m.i1) + 2 : Infinity;
  const s = lowerBoundByI(items, lo);
  const e = lowerBoundByI(items, hi + 1);
  if (e <= s) return null;

  const base = fin(cp.base) ? cp.base : 0;
  const yBase = m.y(base);
  if (!fin(yBase)) return null;
  const barW = fin(m.barW) ? m.barW : 1;
  // Sub-pixel bars smear into an unreadable haze when zoomed all the way out — floor at 1px.
  const w = Math.max(1, clamp(cp.widthFrac ?? 0.6, 0.1, 1) * barW);
  const half = w / 2;

  // A histogram can carry hundreds of visible bars. One DOM <rect> per bar makes pan/zoom
  // spend most of its frame budget allocating and attaching nodes that all share a tiny style set.
  // SVG compound paths preserve the exact same rectangular geometry while collapsing every
  // (fill, opacity) style into one node. Group order follows first appearance; bars do not overlap
  // horizontally (widthFrac <= 1), so grouping cannot change visible z-order.
  const groups: Array<{ color: string; alpha: number | null; parts: string[] }> = [];
  const groupByStyle = new Map<string, Map<number | null, number>>();
  for (let k = s; k < e; k++) {
    const it = items[k];
    if (!it || !fin(it.v)) continue;
    const x = m.xi(it.i), yv = m.y(it.v);
    if (!fin(x) || !fin(yv)) continue;
    const y = Math.min(yv, yBase);
    const h = Math.max(Math.abs(yv - yBase), 0.5); // flat bars still print a hairline
    const alpha = it.alpha != null ? clamp(it.alpha, 0, 1) : null;
    let byAlpha = groupByStyle.get(it.color);
    if (!byAlpha) {
      byAlpha = new Map<number | null, number>();
      groupByStyle.set(it.color, byAlpha);
    }
    let gi = byAlpha.get(alpha);
    if (gi == null) {
      gi = groups.length;
      byAlpha.set(alpha, gi);
      groups.push({ color: it.color, alpha, parts: [] });
    }
    const x1 = x - half, x2 = x + half, y2 = y + h;
    groups[gi].parts.push(`M${x1} ${y}H${x2}V${y2}H${x1}Z`);
  }

  if (!groups.length) return null;
  const g = mk("g", {});
  for (const group of groups) {
    if (!group.parts.length) continue;
    const path = mk("path", { d: group.parts.join(""), fill: group.color });
    if (group.alpha != null) path.setAttribute("fill-opacity", String(group.alpha));
    g.appendChild(path);
  }
  if (!g.firstChild) return null;
  f.appendChild(g);
  return g;
}

// ------------------------------------------------------------------------------------ entry point

/**
 * Draw every prim in the bundle into svgEl. APPEND-ONLY — the caller clears the layer each frame.
 * Builds a DocumentFragment and appends once. Prims are stable-sorted by (z ?? 0) with bgshade
 * forced behind everything. Prims with tooltipId are marked `data-ic-tip` and stay
 * pointer-events-transparent; the delegated wrapper hit test (wireTooltipHitTest) is what raises
 * the shared ".ic-tip" host inside the chart wrapper (the parent of the owning <svg>).
 *
 * The target may be the overlay <svg> itself (overlay suites) or a <g> inside it (pane suites pass
 * a clip-wrapped group so their sub-pane content cannot bleed past the pane). Children are appended
 * generically either way.
 */
export function renderPrims(
  svgEl: SVGSVGElement | SVGGElement, bundle: SuiteRenderBundle, m: CoordMapper,
): void {
  // closest("svg") returns the element itself when it IS the <svg>, so this is identical to
  // svgEl.parentElement for overlay callers and resolves the wrapper for a <g> target.
  const wrap = svgEl.closest("svg")?.parentElement ?? null;
  // The hit cache is MEASURED geometry and this frame is about to move it. Dropped before the
  // empty-bundle early-out, so a frame that draws nothing still cannot leave last frame's boxes
  // hoverable. This is the renderer's whole share of the hit test — one WeakMap write, no layout.
  if (wrap) HIT_BOXES.set(wrap, null);

  const prims = bundle.prims;
  if (!prims.length) return;
  if (wrap) {
    {
    // MERGE per wrapper: several suites render into the same chart wrap each frame; replacing the
    // map would leave only the last suite's tooltips resolvable (review W2-2). Ids are suite-scoped,
    // so collisions cannot occur; stale ids from disabled suites are inert.
    const existing = TIP_DEFS.get(wrap);
    if (!existing) TIP_DEFS.set(wrap, new Map(bundle.tooltips));
    else for (const [tid, tdef] of bundle.tooltips) existing.set(tid, tdef);
  }
    if (bundle.tooltips.size) ensureTooltipHost(wrap);
  }

  // Stable z-sort; bgshade always behind (Array.prototype.sort is spec-stable).
  const sorted = prims.slice().sort((a, b) => {
    const ba = a.kind === "bgshade" ? 0 : 1, bb = b.kind === "bgshade" ? 0 : 1;
    if (ba !== bb) return ba - bb;
    return (a.z ?? 0) - (b.z ?? 0);
  });

  const frag = document.createDocumentFragment();
  for (let index = 0; index < sorted.length; index++) {
    const p = sorted[index];
    if (p.minPxPerBar != null && m.barW < p.minPxPerBar) continue; // density gate

    // Phase ribbons and similar regimes can contain hundreds of same-style squares. Preserve every
    // tooltip-bearing node and every intervening primitive, but collapse each contiguous safe run
    // to the planner's minimum non-overlapping path layers. A null plan is an explicit instruction
    // to retain ordinary one-marker/one-node rendering.
    if (p.kind === "marker" && p.shape === "square" && !p.tooltipId) {
      let end = index + 1;
      while (end < sorted.length) {
        const next = sorted[end];
        if (
          next.kind !== "marker" || next.shape !== "square" || next.tooltipId ||
          !sameSquareMarkerBatchStyle(p, next, m.barW)
        ) break;
        end++;
      }
      if (end - index >= 2) {
        const plan = planSquareMarkerBatch(sorted.slice(index, end) as MarkerPrim[], m);
        if (plan) {
          drawSquareMarkerBatch(frag, plan);
          index = end - 1;
          continue;
        }
      }
    }

    let el: Element | null = null;
    switch (p.kind) {
      case "bgshade": el = drawBgShade(frag, p, m); break;
      case "zone": el = drawZone(frag, p, m); break;
      case "cloud": el = drawCloud(frag, p, m); break;
      case "line": el = drawLine(frag, p, m); break;
      case "poly": el = drawPoly(frag, p, m); break;
      case "gradline": el = drawGradLine(frag, p, m); break;
      case "profile": el = drawProfile(frag, p, m); break;
      case "columns": el = drawColumns(frag, p, m); break;
      case "marker": el = drawMarker(frag, p, m); break;
      case "label": el = drawLabel(frag, p, m); break;
    }
    if (el) {
      const tid = (p as { tooltipId?: string }).tooltipId;
      if (tid && bundle.tooltips.has(tid)) bindTooltip(el, tid);
    }
  }
  svgEl.appendChild(frag);
}
