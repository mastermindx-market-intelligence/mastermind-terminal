// Magnet hover-tag candidate scan for ChartPanel's onTagCrosshair.
//
// Picking the closest series row under the magnet crosshair needs to read
// `paneIndex` off each candidate in `p.seriesData`. Today that map is keyed
// by raw `ISeriesApi` objects (the lwc adapter's wrapMouse is a pass-through
// of lightweight-charts' MouseEventParams — see lib/chart-engine/lwc/index.ts
// `wrapMouse`); the future keyed-by-engine-handles adapter will hand us
// owned SeriesHandle objects instead. This module is the one place that
// handles both shapes so the call site stays engine-agnostic.
//
// Local structural types only — the module deliberately imports nothing from
// "lightweight-charts" or lib/chart-engine. The ChartPanel call site reads
// `options()`, `priceToCoordinate`, `paneIndex` / `getPane().paneIndex()` off
// whatever the adapter handed it; what we test for is the SHAPE, not the
// identity, of the renderer. see lib/__tests__/crosshairMagnet.test.ts.

export type MagnetCandidateLike = {
  options?: () => unknown;
  priceToCoordinate?: (v: number) => unknown;
  paneIndex?: () => number | null | undefined;
  getPane?: () => { paneIndex?: () => number | null | undefined } | null | undefined;
};

export type MagnetDatumLike = { close?: unknown; value?: unknown } | null | undefined;

/**
 * Resolves the pane a magnet candidate belongs to.
 *
 * - Owned `SeriesHandle` exposes `paneIndex()` directly — call it and trust
 *   the value (non-finite gets nulled out, throws get caught and nulled).
 * - Raw lightweight-charts `ISeriesApi` has no `paneIndex()`; the pane lives
 *   on `getPane().paneIndex()` (see node_modules/lightweight-charts/dist/
 *   typings.d.ts ISeriesApi#getPane and IPaneApi#paneIndex).
 *
 * Any non-finite / missing value, OR a throwing call, returns null. The scan
 * treats a null result as "not in our pane" and skips the candidate.
 */
export function candidatePaneIndex(candidate: unknown): number | null {
  if (candidate === null || candidate === undefined) return null;

  // Owned SeriesHandle path: typeof check first because lwc series DO have a
  // `getPane()` getter (no-op-looking object), and we want paneIndex() to
  // win when the engine re-keys the map.
  try {
    if (typeof (candidate as MagnetCandidateLike).paneIndex === "function") {
      const v = (candidate as MagnetCandidateLike).paneIndex!();
      if (typeof v === "number" && Number.isFinite(v)) return v;
      return null;
    }
  } catch {
    // fall through to the getPane path
  }

  // Raw lwc path: candidate.getPane()?.paneIndex().
  try {
    const pane = (candidate as MagnetCandidateLike).getPane?.();
    const v = pane?.paneIndex?.();
    if (typeof v === "number" && Number.isFinite(v)) return v;
    return null;
  } catch {
    return null;
  }
}

/**
 * Picks the y-coordinate the magnet crosshair should snap to, given the
 * event's `seriesData` map, the current pointer y, and the active pane
 * index. Returns null when nothing snaps — the caller leaves the raw pointer
 * alone in that case.
 *
 * Per candidate, INSIDE ITS OWN try/catch (a throwing candidate is skipped,
 * the scan continues — no single bad series blanks the hover tag), in order:
 *
 *   1. skip if options()?.visible === false
 *   2. skip if candidatePaneIndex(candidate) !== paneIndex
 *   3. skip if options()?.priceScaleId is truthy and neither "left" nor
 *      "right" (explicit overlay scale id like "volume")
 *   4. value = finite datum.close, else finite datum.value, else skip
 *   5. y = candidate.priceToCoordinate(value), skip if null/non-finite
 *   6. keep the smallest Math.abs(y - pointerY) with strict `<` — the FIRST
 *      of equal distances wins, matching LWC's magnet scan order.
 */
export function nearestMagnetY(
  seriesData: unknown,
  pointerY: number,
  paneIndex: number,
): number | null {
  if (!(seriesData instanceof Map)) return null;
  if (!Number.isFinite(pointerY)) return null;
  if (!Number.isFinite(paneIndex)) return null;

  let bestY: number | null = null;
  let bestDistance = Infinity;

  for (const [candidate, datum] of seriesData) {
    try {
      const c = candidate as MagnetCandidateLike;
      const optsRaw = typeof c.options === "function" ? c.options() : undefined;
      const opts = (optsRaw && typeof optsRaw === "object") ? optsRaw as Record<string, unknown> : null;

      if (opts?.visible === false) continue;
      if (candidatePaneIndex(candidate) !== paneIndex) continue;

      const scaleId = opts?.priceScaleId;
      if (scaleId && scaleId !== "left" && scaleId !== "right") continue; // overlay scale id

      const d = datum as MagnetDatumLike;
      const closeVal = d?.close;
      const valueVal = d?.value;
      let value: number | null = null;
      if (typeof closeVal === "number" && Number.isFinite(closeVal)) value = closeVal;
      else if (typeof valueVal === "number" && Number.isFinite(valueVal)) value = valueVal;
      if (value === null) continue;

      if (typeof c.priceToCoordinate !== "function") continue;
      const yRaw = c.priceToCoordinate(value);
      const y = typeof yRaw === "number" ? yRaw : null;
      if (y === null || !Number.isFinite(y)) continue;

      const distance = Math.abs(y - pointerY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestY = y;
      }
    } catch {
      // a throwing candidate is skipped, the scan continues (MIG-FIX R1)
      continue;
    }
  }

  return bestY;
}
