/** SIGNAL-MARKER TOOLTIP GEOMETRY — hit-testing and placement, kept pure.
 *
 *  ── WHY THIS EXISTS AS A JS HIT TEST AND NOT `pointer-events` ──────────────────────────────
 *
 *  Every `<title>` in the signal layer had never rendered for anyone. The layer is built
 *  `pointer-events:none` (ChartPanel's `sigSvg`), so no descendant is hit-testable and the
 *  browser never surfaces a native SVG tooltip. Five shipped tooltip copies — the blocked ⊘
 *  "not an entry" line, the washout-override candidate line, the two waived-entry lines, and
 *  the retro re-mark line — were written, reviewed, tested for CONTENT, and displayed to nobody.
 *
 *  The obvious repair is to set `pointer-events:auto` on each marker group and let the native
 *  tooltip come back. THAT REPAIR IS A REGRESSION, and the reason is structural rather than a
 *  matter of tuning: lightweight-charts owns pan, crosshair, wheel-zoom and pinch on ITS OWN
 *  canvas, which lives inside the chart container element. The overlay layers are appended to
 *  the container's PARENT (`wrap = el.parentElement`), so the canvas is a SIBLING SUBTREE, not
 *  an ancestor. An event that lands on a hit-testable marker bubbles to `wrap` and stops — it
 *  never reaches the canvas, and there is no propagation path that would take it there. A
 *  hit-testable marker therefore does not merely "risk" swallowing a drag; it removes the
 *  chart's entire gesture surface over its own footprint. A pan that starts on a marker does
 *  not pan, a wheel over a marker does not zoom, and the crosshair drops out while the cursor
 *  crosses it because the canvas stops receiving moves.
 *
 *  (The broken pattern used to ship one layer down as well: `indicator-canvas/render.bindTooltip`
 *  set `pointer-events:auto` on premium-suite prims inside the equally `pointer-events:none`
 *  indicator layer, so those prims carried the same gesture hole — every premium prim with a
 *  tooltip deleted pan, wheel-zoom and crosshair over its own footprint. That was out of scope for
 *  the marker repair and was reported rather than fixed; it is the reason this file did not follow
 *  that precedent. The indicator layer has since been converted to this same delegated hit test —
 *  `render.wireTooltipHitTest`, driven by `data-ic-tip` and the two helpers below — so the two
 *  overlay layers now resolve their tooltips the same way, from the same wrapper's events.)
 *
 *  So the layer stays `pointer-events:none` and NOTHING about the chart's hit-testing changes —
 *  drag, crosshair, wheel and pinch are byte-identical because not one pixel of the app's
 *  hit-test geometry moved. The tooltip is driven instead from listeners on `wrap`, which
 *  already receives the canvas's bubbled pointer events (the pane-hover and double-tap handlers
 *  have relied on exactly that for as long as they have existed). This module owns the two pure
 *  pieces of that path so they can be tested without a browser.
 *
 *  The COPY is never re-authored here. Callers read each marker's own `<title>` text and hand it
 *  over verbatim, so the tooltip and the SVG title cannot drift apart: there is exactly one
 *  string per marker class and it is the one already in the DOM. */

/** One hoverable marker. Coordinates are whatever space the caller measures in — the hit test
 *  is space-agnostic on purpose, and ChartPanel measures in viewport (client) coordinates so it
 *  never has to reason about the overlay's user space versus the wrapper's border box. */
export type MarkerHit = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The marker's `<title>` text, verbatim. The tooltip's entire content. */
  title: string;
  /** Bar date — every title is emitted as `${m.t} · …`, so the prefix identifies the marker. */
  t: string;
};

/** Mouse forgiveness, px. Markers are 11–20px tall; a couple of pixels of slack makes the ring
 *  and the pill's pointer tip hoverable without reaching into a neighbour. */
export const MARKER_HOVER_SLACK = 3;

/** Touch forgiveness, px. A ⊘ ring is ~11px across, far under any usable touch target, so the
 *  tap box is grown to roughly 32–40px. Deliberately larger than the hover slack: a fingertip
 *  has no hover state to correct an aim with. */
export const MARKER_TAP_SLACK = 10;

/** The marker under (px, py), or null.
 *
 *  Overlapping markers resolve by CENTRE DISTANCE rather than paint order. Two fires on adjacent
 *  bars can have overlapping slack boxes, and "whichever was appended last" would make the
 *  tooltip depend on emitter ordering — the nearest centre is what the reader is pointing at.
 *
 *  Generic over the box type, not fixed to `MarkerHit`: the indicator layer's boxes carry an
 *  element and a tooltip id where a signal marker carries its title, and only the RECTANGLE is
 *  hit-test input. Callers passing `MarkerHit[]` still get `MarkerHit | null` back — this is a
 *  type widening with no runtime change at all. */
export function hitTestMarkers<T extends { x: number; y: number; w: number; h: number }>(
  boxes: readonly T[],
  px: number,
  py: number,
  slack = 0,
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const b of boxes) {
    if (px < b.x - slack || px > b.x + b.w + slack) continue;
    if (py < b.y - slack || py > b.y + b.h + slack) continue;
    const dx = px - (b.x + b.w / 2);
    const dy = py - (b.y + b.h / 2);
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

/** Where to put the tooltip box, in coordinates relative to the chart wrapper.
 *
 *  Mirrors `indicator-canvas/render.placeTip`'s behaviour so the two floating surfaces on this
 *  chart move the same way: offset below-right of the anchor, flipped to the other side when it
 *  would overflow, then clamped inside the wrapper so a marker at the very edge of the pane
 *  still shows its whole tooltip instead of a sliver. */
export function placeMarkerTip(
  anchor: { x: number; y: number },
  tip: { w: number; h: number },
  wrap: { w: number; h: number },
  opts: { pad?: number; offX?: number; offY?: number } = {},
): { left: number; top: number } {
  const pad = opts.pad ?? 4;
  const offX = opts.offX ?? 12;
  const offY = opts.offY ?? 14;
  let x = anchor.x + offX;
  let y = anchor.y + offY;
  if (x + tip.w > wrap.w - pad) x = anchor.x - tip.w - offX;
  if (y + tip.h > wrap.h - pad) y = anchor.y - tip.h - (offY - 4);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  return {
    left: clamp(x, pad, Math.max(pad, wrap.w - tip.w - pad)),
    top: clamp(y, pad, Math.max(pad, wrap.h - tip.h - pad)),
  };
}

/** Did this pointer gesture stay still and short enough to read as a TAP rather than a pan?
 *  Same thresholds as ChartPanel's existing double-tap detector, so one gesture cannot be a tap
 *  for the tooltip and a drag for the chart.
 *
 *  `t` is a gesture time, NOT a handler time — see `gestureStamp` / `isTapSample` below for why
 *  that distinction is the whole difference between a tap that works on a busy phone and one that
 *  dead-ends. Callers must not pass `performance.now()` when the event can date itself. */
export function isTapGesture(
  down: { x: number; y: number; t: number },
  up: { x: number; y: number; t: number },
): boolean {
  if (up.t - down.t > 300) return false;
  return Math.hypot(up.x - down.x, up.y - down.y) <= 12;
}

/** When the gesture ACTUALLY happened, or null when the event cannot date itself.
 *
 *  ── WHY NOT `performance.now()` ─────────────────────────────────────────────────────────────
 *
 *  `performance.now()` read inside a handler is the moment THE MAIN THREAD GOT ROUND TO the
 *  event, not the moment the finger moved. The two agree only on an idle thread. They come apart
 *  exactly where this layer matters most — a phone mid-repaint, a chart re-laying its panes, a
 *  saturated CI runner — because the browser queues input behind whatever the thread is already
 *  doing and delivers it late, in a burst.
 *
 *  Measured on this chart (e2e, both touch viewports, both overlay layers): a zero-travel tap
 *  whose two events are stamped 0-1ms apart is delivered with `performance.now()` deltas of
 *  120 / 250 / 400 / 700ms as the thread is held for that long between down and up. At 400ms the
 *  300ms bound above rejects it and the tooltip never opens — for a gesture that was physically
 *  a flick of a fingertip. `timeStamp` carries the platform time the event was GENERATED, so it
 *  reads ~0ms across all of them and the same tap classifies the same way whether the thread was
 *  free or not.
 *
 *  Only ever consumed as a DELTA between two events of one gesture, so the epoch and the unit do
 *  not have to match `performance.now()` — they only have to match each other, which two events
 *  from one pointer always do. `0` reads as "no platform time" (some synthetic events) and is
 *  refused, because a pair of zeroes would make every press, however long, look instantaneous. */
export function gestureStamp(e: { timeStamp?: unknown }): number | null {
  const ts = e.timeStamp;
  return typeof ts === "number" && isFinite(ts) && ts > 0 ? ts : null;
}

/** One end of a pointer gesture: where it was, when its handler ran (`t`), and when the event
 *  itself says it happened (`ts`, from `gestureStamp`, null when the event cannot date itself). */
export type TapSample = { x: number; y: number; t: number; ts: number | null };

/** `isTapGesture` over a gesture that carries both clocks — the form every delegated tooltip
 *  layer on this chart uses, so they cannot drift apart in how they read one gesture.
 *
 *  Prefers the events' own stamps and falls back to the handler clock only when the pair is
 *  unusable (either end undateable, or the two not in order — a mismatched pair whose delta would
 *  be meaningless). The THRESHOLDS are not duplicated here: this resolves a clock and hands the
 *  result to `isTapGesture`, which stays the one definition of what a tap is. */
export function isTapSample(down: TapSample, up: TapSample): boolean {
  const paired = down.ts != null && up.ts != null && up.ts >= down.ts;
  return isTapGesture(
    { x: down.x, y: down.y, t: paired ? down.ts as number : down.t },
    { x: up.x, y: up.y, t: paired ? up.ts as number : up.t },
  );
}

/** The same marker, found again after a RELAYOUT — or null when it is genuinely gone.
 *
 *  ── WHY A PINNED TOOLTIP IS RE-ANCHORED RATHER THAN DISMISSED ───────────────────────────────
 *
 *  A pane resize invalidates a tooltip's ANCHOR, not the reader's intent. The hover tooltip can
 *  be dropped on a resize and never be missed, because the very next pointermove re-opens it
 *  under the cursor that is still there. A TAPPED tooltip has no cursor behind it: dropping it
 *  is final, and the reader who deliberately opened it watches it vanish for no reason they can
 *  see. That asymmetry is the whole defect — it is invisible on desktop and terminal on touch.
 *
 *  The chart keeps sizing well after hydration (panes lay out, the price axis takes its final
 *  width), so on a loaded machine a pane resize lands AFTER a tap that has already opened its
 *  tooltip. The marker has not gone anywhere; it has MOVED. Matching it by identity and
 *  re-placing the tooltip on its new box keeps the anti-litter guarantee — a tooltip is never
 *  left pointing at empty chart — without destroying a deliberate tap.
 *
 *  Identity is the marker's `title`, the same key `sigTipShow` writes the node on: it is the one
 *  string per marker class already in the DOM, and two markers on one bar carry different titles.
 *  A marker whose title is no longer painted really is gone (the series changed, the study was
 *  turned off), and THAT is the case the caller dismisses on. */
export function reanchorMarker<T extends { title: string }>(
  fresh: readonly T[],
  anchor: { title: string } | null,
): T | null {
  if (!anchor) return null;
  for (const m of fresh) if (m.title === anchor.title) return m;
  return null;
}
