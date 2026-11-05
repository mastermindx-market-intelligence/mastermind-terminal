// Cross-pane sync bus for the multi-pane chart grid.
// Panes register their chart + main series; when sync is on, the focused pane's
// crosshair and visible time-range are mirrored onto every other pane. BOTH travel by
// TIME, never by bar number — each peer resolves its OWN chart at that calendar instant,
// so a $192 NVDA crosshair lands on BTC's candle at the same date, not at $192, and a
// window over June 2024 lands on June 2024 rather than on whatever bar happens to sit at
// the same array position. See lib/timeWindow.ts for why logical indexes cannot be shared.
//
// Link groups (E09) ride on THIS bus, not beside it: `setPaneLinks` narrows who mirrors whom —
// same group, the dimension shared by that group, and (as always) the same timeframe — while the
// registration, the calendar conversion and the echo bookkeeping stay the single ones below.
// `setPaneSync` remains the legacy all-or-nothing switch (every registered pane in one group).
import type { ChartEngine, EngineTime, SeriesHandle } from "@/lib/chart-engine/api";
import {
  clampLogicalRange, sameLogicalRange, sampleStep, timeToMs, toLogicalRange, toTimeWindow,
  type AxisClock, type LogicalRange, type TimeWindow,
} from "./timeWindow";

// `onCrosshair` fires on a peer whenever THIS bus moves or clears its crosshair: setCrosshairPosition
// is a synthetic position and deliberately fires no crosshairMove event, so a pane that reacts to its
// own crosshair (such as its foreground price label) would never hear about a mirrored one.
export type PaneRegistration = {
  chart: ChartEngine;
  series: SeriesHandle;
  valueAt: (t: EngineTime) => number | null;
  tf: string;
  /** Current accepted bars' owner, for symbol-scoped focus only; null while data is unready. */
  focusOwner?: () => { symbol: string; tf: string } | null;
  onCrosshair?: (price: number | null, time: EngineTime | null) => void;
};

type Peer = PaneRegistration & {
  /** operation token armed when THIS bus drove the pane; its next range event is our own echo */
  echoOf?: number;
  /** the range we last asked this pane for — second echo signal, and the re-issue guard */
  lastTarget?: LogicalRange;
  /** memoised index↔time clock, rebuilt only when the pane's bar set moves */
  clock?: { sig: string; clock: AxisClock };
};

const NEAREST_LEFT = "nearest-left" as const;
const NEAREST_RIGHT = "nearest-right" as const;

/**
 * One pane's membership in a link group. `crosshair` and `window` are the two dimensions a group
 * may share, chosen independently. Nothing else — symbol, timeframe, studies, the active security
 * context (#821) — is a synchronised dimension of this bus, so no plan can move them.
 */
export type PaneLink = { group: string; crosshair: boolean; window: boolean };
type LinkDimension = "crosshair" | "window";

/** Legacy plan (`setPaneSync`): every registered pane is one group sharing both dimensions. */
const LEGACY_LINK: PaneLink = Object.freeze({ group: "*", crosshair: true, window: true });

const peers = new Map<number, Peer>();
const registryListeners = new Set<() => void>();
let registrySnapshot = "";
type VisibleWindowListener = (window: TimeWindow | null) => void;
const visibleWindowListeners = new Map<number, Set<VisibleWindowListener>>();
let enabled = false;
let applying = false; // crosshair re-entrancy guard (range uses the operation token below)
let crosshairFrame: number | null = null;
// The queued sample remembers WHICH registration produced it and under WHICH plan. A pane id is a
// grid slot and is reused (a grid shrink then regrow, a symbol switch re-registering); without the
// identity check a sample queued by a retired registration would be delivered as if the slot's new
// owner had produced it, and a sample queued before a regroup would reach the previous group.
let pendingCrosshair: { fromId: number; source: Peer; epoch: number; time: EngineTime | null } | null = null;
let opSeq = 0;        // monotonic range-operation token
/** `null` = legacy plan; otherwise the explicit per-pane membership set by `setPaneLinks`. */
let plan: Map<number, PaneLink> | null = null;
let planSig = "legacy";
let planEpoch = 0;    // bumped on every effective plan change; stale queued crosshairs are dropped

function linkOf(id: number): PaneLink | null {
  if (!plan) return LEGACY_LINK;
  return plan.get(id) ?? null;
}

/** Both panes in the same group, and that group shares `dim`. */
function linked(a: PaneLink | null, b: PaneLink | null, dim: LinkDimension): boolean {
  return !!a && !!b && a.group === b.group && a[dim] && b[dim];
}

function notifyRegistry() {
  registrySnapshot = [...peers.keys()].sort((x, y) => x - y).join(",");
  for (const fn of [...registryListeners]) { try { fn(); } catch { /* observers never break sync */ } }
}

function cancelPendingCrosshair() {
  pendingCrosshair = null;
  if (crosshairFrame == null) return;
  if (typeof cancelAnimationFrame === "function") {
    try { cancelAnimationFrame(crosshairFrame); } catch {}
  }
  crosshairFrame = null;
}

function applyCrosshair(fromId: number, self: Peer, time: EngineTime | null) {
  if (!enabled || applying) return;
  if (peers.get(fromId) !== self) return;   // retired registration: never act as the slot's new owner
  const selfLink = linkOf(fromId);
  if (!selfLink?.crosshair) return;
  applying = true;
  try {
    peers.forEach((p, id) => {
      if (id === fromId || p.tf !== self.tf || !linked(selfLink, linkOf(id), "crosshair")) return;
      try {
        const v = time == null ? null : p.valueAt(time);
        if (time == null || v == null) { p.chart.clearCrosshairPosition(); p.onCrosshair?.(null, null); }
        else { p.chart.setCrosshairPosition(v, time, p.series); p.onCrosshair?.(v, time); }
      } catch {}
    });
  } finally { applying = false; }
}

function flushCrosshairFrame() {
  crosshairFrame = null;
  const next = pendingCrosshair;
  pendingCrosshair = null;
  if (next && next.epoch === planEpoch) applyCrosshair(next.fromId, next.source, next.time);
}

function clearMirroredCrosshairs() {
  peers.forEach((p) => { try { p.chart.clearCrosshairPosition(); p.onCrosshair?.(null, null); } catch {} });
}

/** Legacy all-or-nothing switch: every registered same-timeframe pane mirrors both dimensions. */
export function setPaneSync(on: boolean) {
  if (plan !== null || enabled !== on) planEpoch++;
  plan = null;
  planSig = "legacy";
  enabled = on;
  if (!on) {
    cancelPendingCrosshair();
    peers.forEach((p) => {
      // Drop the echo bookkeeping too: a `lastTarget` left over from the previous session would
      // suppress the first mirror after sync is switched back on.
      p.echoOf = undefined;
      p.lastTarget = undefined;
      try { p.chart.clearCrosshairPosition(); p.onCrosshair?.(null, null); } catch {}
    });
  }
}
export function paneSyncEnabled() { return enabled; }

/**
 * Replace the link plan: pane id → its group and the dimensions that group shares. A pane absent
 * from `links` (or sharing nothing) is independent. Idempotent: re-sending the same plan changes
 * nothing, so a caller can push it on every render-relevant change.
 *
 * An effective change drops any queued crosshair and clears every mirrored crosshair, because a
 * crosshair the bus placed under the previous plan has no owner under the new one. The echo
 * bookkeeping (`echoOf` / `lastTarget`) is deliberately KEPT: a write already issued is still in
 * flight, and its echo must be absorbed rather than re-broadcast to the pane's new group.
 */
export function setPaneLinks(links: Readonly<Record<number, PaneLink>>) {
  const next = new Map<number, PaneLink>();
  for (const [key, link] of Object.entries(links)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 0 || !link || typeof link.group !== "string" || !link.group) continue;
    const crosshair = link.crosshair === true;
    const shareWindow = link.window === true;
    if (!crosshair && !shareWindow) continue;
    next.set(id, { group: link.group, crosshair, window: shareWindow });
  }
  const sig = [...next.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, l]) => `${id}:${l.group}:${l.crosshair ? 1 : 0}${l.window ? 1 : 0}`)
    .join("|");
  if (plan !== null && sig === planSig) return;
  plan = next;
  planSig = sig;
  planEpoch++;
  enabled = next.size > 0;
  cancelPendingCrosshair();
  clearMirroredCrosshairs();
  installProbe();
}

/** The link this bus currently applies to `id` (`null` = independent). */
export function paneLinkOf(id: number): PaneLink | null {
  if (!enabled) return null;
  const link = linkOf(id);
  return link ? { ...link } : null;
}

/** Registered pane ids as a stable "0,1,3" key — a `useSyncExternalStore` snapshot. */
export function registeredPaneIds(): string { return registrySnapshot; }

/** Observe registrations/retirements so a UI can say "waiting for chart data" truthfully. */
export function subscribePaneRegistry(fn: () => void): () => void {
  registryListeners.add(fn);
  return () => { registryListeners.delete(fn); };
}

/**
 * What a peer would mirror at `time` — the REGISTERED lookup itself, not a re-derivation of it.
 * Used by the live-bar coherence hook so a test asserts against the function sync actually calls.
 */
export function peerValueAt(id: number, time: EngineTime): number | null {
  const p = peers.get(id);
  if (!p) return null;
  try { return p.valueAt(time); } catch { return null; }
}

function visibleWindowFor(peer: Peer, range?: LogicalRange | null): TimeWindow | null {
  try {
    const logical = range ?? peer.chart.timeScale().getVisibleLogicalRange();
    if (!logical) return null;
    const clock = clockFor(peer);
    return clock ? toTimeWindow(clock, logical) : null;
  } catch {
    return null;
  }
}

function reportVisibleWindow(id: number, peer: Peer, range?: LogicalRange | null) {
  const listeners = visibleWindowListeners.get(id);
  if (!listeners?.size) return;
  const window = visibleWindowFor(peer, range);
  for (const fn of [...listeners]) {
    try { fn(window); } catch { /* observation never breaks chart sync */ }
  }
}

/** Observe one already-owned pane's exact calendar window without a second chart/range bus. */
export function subscribePaneVisibleWindow(id: number, fn: VisibleWindowListener): () => void {
  let listeners = visibleWindowListeners.get(id);
  if (!listeners) {
    listeners = new Set();
    visibleWindowListeners.set(id, listeners);
  }
  listeners.add(fn);
  const peer = peers.get(id);
  if (peer) reportVisibleWindow(id, peer);
  return () => {
    const current = visibleWindowListeners.get(id);
    current?.delete(fn);
    if (current && current.size === 0) visibleWindowListeners.delete(id);
  };
}


/** Set one registered pane to an exact calendar window using the SAME time-domain owner as sync.
 * Partial overlap is representable with honest whitespace. A no-overlap window would be clamped by
 * Lightweight Charts; reject that case instead of ACKing a different viewport than was requested.
 */
export function setPaneVisibleWindow(id: number, window: TimeWindow): boolean {
  const peer = peers.get(id);
  if (!peer || !Number.isFinite(window.from) || !Number.isFinite(window.to) || window.to <= window.from)
    return false;
  try {
    const clock = clockFor(peer);
    if (!clock) return false;
    const wanted = toLogicalRange(clock, window);
    if (!wanted) return false;
    const representable = clampLogicalRange(clock, wanted);
    if (!representable || !sameLogicalRange(wanted, representable)) return false;
    const current = peer.chart.timeScale().getVisibleLogicalRange();
    if (sameLogicalRange(wanted, current)) {
      reportVisibleWindow(id, peer, current);
      return true;
    }
    // Do not arm an echo token: this is a genuine source-pane move. If pane sync is ON,
    // its normal range event may lawfully mirror the same calendar window to peers.
    peer.lastTarget = undefined;
    peer.echoOf = undefined;
    peer.chart.timeScale().setVisibleLogicalRange(wanted);
    return true;
  } catch {
    return false;
  }
}

export function registerPane(id: number, registration: PaneRegistration) {
  const peer: Peer = { ...registration };
  peers.set(id, peer);
  // Effect 2 registers only after the pane owns bars + series, so an existing active-pane
  // subscriber receives viewport truth immediately instead of waiting for a pan/zoom.
  reportVisibleWindow(id, peer);
  // Registration is also the moment a remounted pane has restored its own view — a focus request
  // waiting for this pane lands here, AFTER that restore, so the restore cannot overwrite it.
  if (pendingFocus && pendingFocus.id === id) tryFocus(pendingFocus, peer);
  else reassertFocus(id);
  installProbe();
  notifyRegistry();
  return () => {
    if (peers.get(id) === peer) {
      peers.delete(id);
      if (pendingCrosshair?.source === peer) cancelPendingCrosshair();
      const listeners = visibleWindowListeners.get(id);
      if (listeners) for (const fn of [...listeners]) { try { fn(null); } catch {} }
      notifyRegistry();
    }
  };
}

// time === null means the pointer left the source chart → clear peers' crosshairs.
// Input devices can emit many moves inside one display frame. Only the latest sample can become
// visible, so peer crosshair + foreground-label work is bounded to one flush per paint.
export function broadcastCrosshair(fromId: number, time: EngineTime | null) {
  if (!enabled || applying) return;
  const source = peers.get(fromId);
  if (!source || !linkOf(fromId)?.crosshair) return;
  pendingCrosshair = { fromId, source, epoch: planEpoch, time };
  if (crosshairFrame != null) return;
  if (typeof requestAnimationFrame !== "function") {
    flushCrosshairFrame();
    return;
  }
  crosshairFrame = requestAnimationFrame(flushCrosshairFrame);
}

/**
 * Mirror the source pane's VIEW onto every same-timeframe peer in its window-sharing group.
 *
 * `range` is the source's live logical range, which is meaningful only inside the source's own
 * bar array. It is immediately converted to a calendar window through the source's axis, and each
 * peer converts that window back through its own — so peers show the same DATES, not the same
 * array positions. `lib/timeWindow.ts` owns the arithmetic and the no-overlap edge policy.
 *
 * ── Echo suppression (single-owner law) ─────────────────────────────────────────────────────
 * Lightweight Charts applies `setVisibleLogicalRange` on the NEXT animation frame and fires the
 * change event there, so a mirrored write comes back as an inbound event on the pane we drove. A
 * wall-clock suppression window used to cover that gap, which made correctness a race: a frame
 * slower than the window (a heavy rebuild, a backgrounded tab) turned an echo into a genuine
 * broadcast and the panes fought. The gate is now an explicit operation token plus the range we
 * asked for — neither expires, so no amount of scheduler delay can reopen it.
 *
 * The bus also refuses to re-issue a target it has already asked a pane for. Together with
 * clamping the target ourselves (rather than letting the library rewrite it silently), that is
 * what makes the no-overlap case terminate instead of re-driving a pinned pane every frame.
 */
export function broadcastRange(fromId: number, range: LogicalRange | null) {
  if (!range) return;
  const self = peers.get(fromId);
  if (!self) return;

  // Viewport observation is independent of cross-pane synchronization: the Brain needs
  // the pane the user is actually viewing even when sync is OFF. Mirrored echoes are
  // also real visible states, so report before the echo-suppression gate.
  const clock = clockFor(self);
  const win = clock ? toTimeWindow(clock, range) : null;
  reportVisibleWindow(fromId, self, range);

  if (!clock || !win) return;
  // Echo bookkeeping runs whether or not this pane is linked right now: a write issued under the
  // previous link plan still bounces back after a regroup, and it must be absorbed here — never
  // mistaken for a genuine move and re-broadcast to the pane's new group.
  if (self.echoOf != null || sameLogicalRange(range, self.lastTarget ?? null)) {
    self.echoOf = undefined;          // our own write bouncing back — absorb it, never re-broadcast
    return;
  }
  self.lastTarget = undefined;        // a genuine move: this pane owns its viewport again

  if (!enabled) return;
  const selfLink = linkOf(fromId);
  if (!selfLink?.window) return;
  const op = ++opSeq;
  peers.forEach((p, id) => {
    if (id === fromId || p.tf !== self.tf) return;   // only mirror same-timeframe panes
    if (!linked(selfLink, linkOf(id), "window")) return;   // only members of the source's group
    try {
      const peerClock = clockFor(p);
      if (!peerClock) return;
      const wanted = toLogicalRange(peerClock, win);
      if (!wanted) return;
      const target = clampLogicalRange(peerClock, wanted);
      if (!target) return;
      // Already asked for exactly this and the pane has not moved on its own since — whatever the
      // library settled on stands. Re-issuing here is the runaway-pan case.
      if (sameLogicalRange(target, p.lastTarget ?? null)) return;
      // A no-op set fires no event, so arming the echo token there would leak it onto the pane's
      // next genuine move.
      if (sameLogicalRange(target, p.chart.timeScale().getVisibleLogicalRange())) { p.lastTarget = target; return; }
      p.lastTarget = target;
      p.echoOf = op;
      p.chart.timeScale().setVisibleLogicalRange(target);
    } catch { /* teardown */ }
  });
}

// ── Focus: put one exact bar in front of the user ────────────────────────────────────────────
//
// A caller outside the chart (the Data Inspector) asks for an exact bar TIME on one pane. The pane
// owner resolves it on its own axis: `timeToIndex(time, false)` — exact match only, never the
// nearest bar — so a time the pane does not plot is reported as missing and the view is left where
// it was. Nothing is substituted. The request may be made while the pane is unmounted (the table
// view replaces the chart body); it then waits for the pane's next registration, which runs after
// the pane has restored its own saved view, so the focus is the last write.

export type PaneFocusStatus = "exact" | "missing" | "expired" | "replaced" | "unavailable";
export type PaneFocusResult = { status: PaneFocusStatus; index?: number };

type FocusRequest = {
  id: number;
  symbol?: string;
  tf: string;
  time: EngineTime;
  resolve: (result: PaneFocusResult) => void;
  done: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
};

const FOCUS_TIMEOUT_MS = 20_000;
/** a pane can register before its full bar set has hydrated; a miss is only final after this */
const FOCUS_MISSING_GRACE_MS = 1_200;
/** window in which a pane's own late view restore must not displace a focus that already landed */
const FOCUS_HOLD_MS = 4_000;
const FOCUS_REASSERT_MS = 400;
const DEFAULT_FOCUS_SPAN = 80;

let pendingFocus: FocusRequest | null = null;
let heldFocus: { id: number; symbol?: string; tf: string; time: EngineTime; until: number } | null = null;
let lastFocus: { id: number; symbol?: string; tf: string; time: EngineTime; status: PaneFocusStatus; index: number | null; at: number } | null = null;

function settleFocus(request: FocusRequest, result: PaneFocusResult) {
  if (request.done) return;
  request.done = true;
  if (request.timer) clearTimeout(request.timer);
  if (request.graceTimer) clearTimeout(request.graceTimer);
  if (pendingFocus === request) pendingFocus = null;
  lastFocus = { id: request.id, symbol: request.symbol, tf: request.tf, time: request.time, status: result.status, index: result.index ?? null, at: Date.now() };
  request.resolve(result);
}

/**
 * A pane id is a reusable grid slot. Focus belongs to the selected row's symbol, unlike the
 * intentional cross-symbol calendar sync above. Read ownership at lookup time: a registration
 * can survive while its chart refs change. Missing ownership never relaxes a scoped request.
 */
function focusOwnerState(peer: Peer, scope: { symbol?: string; tf: string }): "match" | "unknown" | "different" {
  if (scope.symbol === undefined) return "match"; // legacy unscoped navigation
  let owner: { symbol: string; tf: string } | null = null;
  try { owner = peer.focusOwner?.() ?? null; } catch { return "unknown"; }
  if (!owner?.symbol || !owner.tf) return "unknown";
  if (owner.symbol !== scope.symbol) return "different";
  return owner.tf === scope.tf ? "match" : "unknown";
}

/** Exact index + plotted value of `time` on this pane, or null when the pane does not plot it. */
function exactBar(peer: Peer, time: EngineTime): { index: number; value: number } | null {
  const index = peer.chart.timeScale().timeToIndex(time, false) as number | null;
  if (index == null || !Number.isFinite(index)) return null;
  let value: number | null = null;
  try { value = peer.valueAt(time); } catch { value = null; }
  return value == null || !Number.isFinite(value) ? null : { index, value };
}

function placeFocus(peer: Peer, index: number, value: number, time: EngineTime) {
  const ts = peer.chart.timeScale();
  const current = ts.getVisibleLogicalRange();
  const width = current ? current.to - current.from : NaN;
  const span = Number.isFinite(width) && width >= 2 ? width : DEFAULT_FOCUS_SPAN;
  const wanted: LogicalRange = { from: index - span / 2, to: index + span / 2 };
  const clock = clockFor(peer);
  const target = (clock && clampLogicalRange(clock, wanted)) || wanted;
  if (!sameLogicalRange(target, current)) ts.setVisibleLogicalRange(target);
  peer.chart.setCrosshairPosition(value, time, peer.series);
  peer.onCrosshair?.(value, time);
}

function tryFocus(request: FocusRequest, peer: Peer, final = false) {
  if (request.done) return;
  let owner = focusOwnerState(peer, request);
  if (owner === "different") { settleFocus(request, { status: "replaced" }); return; }
  if (peer.tf !== request.tf) return;   // the same symbol is still on another timeframe
  let hit: { index: number; value: number } | null = null;
  if (owner === "match") {
    try { hit = exactBar(peer, request.time); } catch { settleFocus(request, { status: "unavailable" }); return; }
    // The value lookup may read mutable chart refs. Recheck before any range/crosshair write.
    owner = focusOwnerState(peer, request);
    if (owner === "different") { settleFocus(request, { status: "replaced" }); return; }
    if (owner !== "match") hit = null;
  }
  if (!hit) {
    if (final) { settleFocus(request, { status: owner === "unknown" ? "unavailable" : "missing" }); return; }
    // Re-read the current owner and exact bar after hydration, never a replacement symbol's bar.
    if (!request.graceTimer) request.graceTimer = setTimeout(() => {
      const current = peers.get(request.id);
      if (current) tryFocus(request, current, true);
      else settleFocus(request, { status: "missing" });
    }, FOCUS_MISSING_GRACE_MS);
    return;
  }
  try { placeFocus(peer, hit.index, hit.value, request.time); } catch { settleFocus(request, { status: "unavailable" }); return; }
  heldFocus = { id: request.id, symbol: request.symbol, tf: request.tf, time: request.time, until: Date.now() + FOCUS_HOLD_MS };
  settleFocus(request, { status: "exact", index: hit.index });
  const id = request.id;
  setTimeout(() => reassertFocus(id), FOCUS_REASSERT_MS);
}

/** Put a landed focus back only if the pane's own view restore has since moved the bar out of view. */
function reassertFocus(id: number) {
  const held = heldFocus;
  if (!held || held.id !== id) return;
  if (Date.now() > held.until) { heldFocus = null; return; }
  const peer = peers.get(id);
  if (!peer) return; // a legitimate same-symbol remount may still be pending
  if (focusOwnerState(peer, held) !== "match") { heldFocus = null; return; }
  if (peer.tf !== held.tf) return;
  try {
    const hit = exactBar(peer, held.time);
    if (focusOwnerState(peer, held) !== "match") { heldFocus = null; return; }
    if (!hit) return;                       // the bar set moved on; never re-point at a neighbour
    const r = peer.chart.timeScale().getVisibleLogicalRange();
    if (r && hit.index >= r.from && hit.index <= r.to) return;
    placeFocus(peer, hit.index, hit.value, held.time);
  } catch { /* teardown */ }
}

/**
 * Ask pane `id` to show the bar at exactly `time` (in that pane's own time key) on timeframe `tf`.
 * A supplied `symbol` binds the request to that owner, including hydration and later remounts.
 * Resolves once: `exact` (view centred on it, crosshair on it), `missing` (the pane plots no bar at
 * that time; the view did not move), `expired` (the pane never registered on that timeframe),
 * `replaced` (a newer request or symbol superseded this one) or `unavailable` (the chart could not
 * prove the requested owner or refused the write).
 */
export function requestPaneFocus(id: number, req: { symbol?: string; tf: string; time: string | number; timeoutMs?: number }): Promise<PaneFocusResult> {
  if (pendingFocus) settleFocus(pendingFocus, { status: "replaced" });
  heldFocus = null;
  return new Promise<PaneFocusResult>((resolve) => {
    // The bar's own time key as the pane plotted it: epoch seconds intraday, "YYYY-MM-DD" daily.
    const request: FocusRequest = { id, symbol: req.symbol, tf: req.tf, time: req.time as EngineTime, resolve, done: false, timer: null, graceTimer: null };
    pendingFocus = request;
    request.timer = setTimeout(() => settleFocus(request, { status: "expired" }), req.timeoutMs ?? FOCUS_TIMEOUT_MS);
    const peer = peers.get(id);
    if (peer) tryFocus(request, peer);
  });
}

/**
 * Index↔time clock for one pane, read from the chart it registered.
 *
 * The pane's own price series is the authority for where its data starts and ends: Lightweight
 * Charts indexes series bars by TIME-SCALE index, and the axis can carry points the price series
 * does not (an Ichimoku cloud is displaced into the future). Bounding the clock by the price
 * series keeps the clamp at or inside the library's own limit, which is what lets a mirrored
 * write settle instead of being rewritten and re-issued.
 */
function clockFor(p: Peer): AxisClock | null {
  try {
    const ts = p.chart.timeScale();
    const series = p.series;
    const firstBar = series.dataByIndex(Number.MIN_SAFE_INTEGER, NEAREST_RIGHT) as { time?: unknown } | null;
    const lastBar = series.dataByIndex(Number.MAX_SAFE_INTEGER, NEAREST_LEFT) as { time?: unknown } | null;
    if (!firstBar || !lastBar) return null;
    const first = ts.timeToIndex(firstBar.time as EngineTime, false);
    const last = ts.timeToIndex(lastBar.time as EngineTime, false);
    const msFirst = timeToMs(firstBar.time);
    const msLast = timeToMs(lastBar.time);
    if (first == null || last == null || !(last > first)) return null;
    if (!Number.isFinite(msFirst) || !Number.isFinite(msLast) || !(msLast > msFirst)) return null;
    // Endpoints move on every setData and on an appended live bar; nothing else can change the
    // interior, so this signature is a sufficient cache key for the sampled step.
    const sig = `${first}|${last}|${msFirst}|${msLast}`;
    if (p.clock?.sig === sig) return p.clock.clock;
    const msAt = (i: number): number => {
      try {
        const bar = series.dataByIndex(i) as { time?: unknown } | null;
        return bar ? timeToMs(bar.time) : NaN;
      } catch { return NaN; }
    };
    const step = sampleStep(msAt, first, last);
    if (!Number.isFinite(step) || step <= 0) return null;
    const clock: AxisClock = { first, last, msAt, step };
    p.clock = { sig, clock };
    return clock;
  } catch { return null; }
}

/**
 * Dev-only introspection, so a browser test can assert the CALENDAR window each pane shows rather
 * than infer it from pixels. `visible` is the library's own answer (clamped to that symbol's data);
 * `window` is the full window including whitespace, which is what the panes are supposed to agree on.
 */
function installProbe() {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
  (window as unknown as { __mmPaneSync?: unknown }).__mmPaneSync = () => ({
    enabled,
    plan: plan ? "groups" : "legacy",
    epoch: planEpoch,
    panes: [...peers.entries()].map(([id, p]) => {
      let logical: LogicalRange | null = null;
      let visible: unknown = null;
      let win: { from: number; to: number } | null = null;
      try { logical = p.chart.timeScale().getVisibleLogicalRange(); } catch {}
      try { visible = p.chart.timeScale().getVisibleRange(); } catch {}
      try { const c = clockFor(p); if (c && logical) win = toTimeWindow(c, logical); } catch {}
      const link = enabled ? linkOf(id) : null;
      return { id, tf: p.tf, logical, visible, window: win, pendingEcho: p.echoOf ?? null, link: link ? { ...link } : null };
    }),
    focus: lastFocus,
    pendingFocus: pendingFocus ? { id: pendingFocus.id, symbol: pendingFocus.symbol, tf: pendingFocus.tf, time: pendingFocus.time } : null,
  });
}
