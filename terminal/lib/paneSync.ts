// Cross-pane sync bus for the multi-pane chart grid.
// Panes register their chart + main series; when sync is on, the focused pane's
// crosshair and visible time-range are mirrored onto every other pane. Crosshair
// is broadcast by TIME (not price) — each peer looks up its OWN value at that time,
// so a $192 NVDA crosshair lands on BTC's candle at the same date, not at $192.
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";

// `onCrosshair` fires on a peer whenever THIS bus moves or clears its crosshair: setCrosshairPosition
// is a synthetic position and deliberately fires no crosshairMove event, so a pane that reacts to its
// own crosshair (such as its foreground price label) would never hear about a mirrored one.
type Peer = { chart: IChartApi; series: ISeriesApi<any>; valueAt: (t: Time) => number | null; tf: string; suppress?: number; onCrosshair?: (price: number | null, time: Time | null) => void };

const peers = new Map<number, Peer>();
let enabled = false;
let applying = false; // crosshair re-entrancy guard (range uses per-peer suppression below)

export function setPaneSync(on: boolean) {
  enabled = on;
  if (!on) peers.forEach((p) => { try { p.chart.clearCrosshairPosition(); p.onCrosshair?.(null, null); } catch {} });
}
export function paneSyncEnabled() { return enabled; }

/**
 * What a peer would mirror at `time` — the REGISTERED lookup itself, not a re-derivation of it.
 * Used by the live-bar coherence hook so a test asserts against the function sync actually calls.
 */
export function peerValueAt(id: number, time: Time): number | null {
  const p = peers.get(id);
  if (!p) return null;
  try { return p.valueAt(time); } catch { return null; }
}

export function registerPane(id: number, peer: Peer) {
  peers.set(id, peer);
  return () => { if (peers.get(id) === peer) peers.delete(id); };
}

// time === null means the pointer left the source chart → clear peers' crosshairs
export function broadcastCrosshair(fromId: number, time: Time | null) {
  if (!enabled || applying) return;
  const self = peers.get(fromId);
  applying = true;
  try {
    peers.forEach((p, id) => {
      if (id === fromId || (self && p.tf !== self.tf)) return;   // only mirror same-timeframe panes
      try {
        const v = time == null ? null : p.valueAt(time);
        if (time == null || v == null) { p.chart.clearCrosshairPosition(); p.onCrosshair?.(null, null); }
        else { p.chart.setCrosshairPosition(v, time, p.series); p.onCrosshair?.(v, time); }
      } catch { /* peer may be mid-teardown */ }
    });
  } finally { applying = false; }
}

// Range mirroring can't use the synchronous `applying` flag: LWC applies
// setVisibleLogicalRange on the NEXT animation frame and fires the change event
// there — after `applying` would already be reset — so peers would re-broadcast
// and (with differing bar counts → differing clamp) fight in a loop. Instead we
// arm a short per-peer suppression marker on the pane we drive, and that pane's
// own change handler swallows exactly one echo when it fires.
export function broadcastRange(fromId: number, range: { from: number; to: number } | null) {
  if (!enabled || !range) return;
  const self = peers.get(fromId);
  if (self && self.suppress && Date.now() - self.suppress < 250) { self.suppress = 0; return; }
  peers.forEach((p, id) => {
    if (id === fromId || (self && p.tf !== self.tf)) return;   // only mirror same-timeframe panes
    try {
      const cur = p.chart.timeScale().getVisibleLogicalRange();
      // only drive (and arm suppression) when the peer will actually move —
      // a no-op set fires no event, so arming there would leak the marker
      if (!cur || cur.from !== range.from || cur.to !== range.to) {
        p.suppress = Date.now();
        p.chart.timeScale().setVisibleLogicalRange(range);
      }
    } catch { /* teardown */ }
  });
}
