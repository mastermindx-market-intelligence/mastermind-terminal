/**
 * surfaceContract.ts — pure contract + transform helpers for the surface snapshot store
 * and the session-flow rebase math. Kept DOM-free so lib/__tests__/surfaceContract.test.ts
 * can assert the index↔files contract and the off-open rebase without a chart.
 *
 * Snapshot store (materialized to R2 / served via /api/flow):
 *   surface_idx:{ROOT}   → SurfaceIndex  { date, stamps:["HHMM",…], latest, cadenceSec }
 *   surface:{ROOT}:{HHMM}→ SurfaceFrame  { spot, price_levels[], time_steps[],
 *                                          grids:{ netprem:[[…]] }, asof, cadence }
 *
 * The UI must never pretend a cadence it doesn't have: producer cadence metadata is a
 * target, while SurfacePane measures the plotted `time_steps` and labels that observed
 * spacing (see `observedSurfaceCadenceSec`).
 */

import type { HeatData, HeatCell } from "@/lib/heatSeries";
import type { Time } from "lightweight-charts";

// ─── Snapshot store types ───────────────────────────────────────────────────

export interface SurfaceIndex {
  date: string; // YYYY-MM-DD (session date, ET)
  stamps: string[]; // ascending "HHMM"
  latest: string | null; // newest stamp === stamps.at(-1)
  cadenceSec: number; // real cadence of the underlying artifacts (honesty)
  source?: string;
}

export interface SurfaceFrame {
  spot: number | null;
  price_levels: number[]; // strike levels, ascending
  time_steps: string[]; // "HH:MM" columns realized so far this session
  grids: { [metric: string]: number[][] }; // grids[metric][levelIdx][timeIdx]
  asof: string; // ISO stamp of this frame
  cadence: string; // human cadence label e.g. "10-min" (honesty)
  metrics?: string[]; // which metric grids are present
  session_date?: string; // YYYY-MM-DD (ET) — anchors the intraday time axis
  root?: string;
}

/**
 * The sessions index for multi-day replay — `surface_dates:{ROOT}` → R2
 * live_flow/surface/{ROOT}/dates.json. Written by the macro poller alongside the dated
 * copies of the index and frames; the legacy today-paths are unchanged and stay the LIVE
 * read. Dates are NEWEST FIRST (the opposite of `SurfaceIndex.stamps`, which ascend) and
 * are trimmed to `retain`, so the list never promises a session R2 has already pruned.
 */
export interface SurfaceDates {
  root: string;
  dates: string[]; // "YYYY-MM-DD", NEWEST FIRST
  latest: string | null; // === dates[0] (null when empty)
  count?: number;
  retain?: number;
  cadenceSec: number;
  cadence?: string;
  asof?: string;
  source?: string;
}

// ─── Contract validators ────────────────────────────────────────────────────

const SESSION_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for an exact YYYY-MM-DD session-date string (the dated-prefix shape). */
export function isSessionDate(s: unknown): s is string {
  return typeof s === "string" && SESSION_DATE_RE.test(s);
}

/**
 * Validator for the sessions index — the TS twin of the macro materializer's
 * `is_surface_dates()` (scripts/build_flow_surface.py), checking the same three things:
 * every entry is a session date, the list is sorted newest-first, and `latest` is dates[0]
 * (null when empty). A payload that fails any of them is not trusted as a session list, so
 * the picker stays hidden and the Terminal keeps its today-only behaviour.
 */
export function isSurfaceDates(x: unknown): x is SurfaceDates {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const dates = o.dates;
  if (!Array.isArray(dates) || !dates.every(isSessionDate)) return false;
  // Newest first — compare against a descending copy (ISO dates sort lexicographically).
  const desc = [...dates].sort().reverse();
  if (dates.some((d, i) => d !== desc[i])) return false;
  if (dates.length > 0 ? o.latest !== dates[0] : o.latest !== null) return false;
  return typeof o.cadenceSec === "number" && typeof o.root === "string";
}


export function isSurfaceIndex(x: unknown): x is SurfaceIndex {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.date === "string" &&
    Array.isArray(o.stamps) &&
    o.stamps.every((s) => typeof s === "string") &&
    (o.latest === null || typeof o.latest === "string") &&
    typeof o.cadenceSec === "number"
  );
}

/** Validate one selected replay index without coercing malformed frame clocks. */
export function isSurfaceIndexForContext(
  value: unknown, root: string, sessionDate: string | null,
): value is SurfaceIndex {
  if (!isSurfaceIndex(value) || !isSessionDate(value.date)) return false;
  const suppliedRoot = (value as SurfaceIndex & { root?: unknown }).root;
  if (suppliedRoot !== undefined &&
      (typeof suppliedRoot !== "string" || suppliedRoot.trim().toUpperCase() !== root)) return false;
  if (sessionDate != null && value.date !== sessionDate) return false;
  if (!Number.isFinite(value.cadenceSec) || value.cadenceSec <= 0) return false;
  return value.latest === (value.stamps.at(-1) ?? null) && value.stamps.every((stamp, i) =>
    /^(?:[01]\d|2[0-3])[0-5]\d$/.test(stamp) && (i === 0 || stamp > value.stamps[i - 1]));
}

export function isSurfaceFrame(x: unknown): x is SurfaceFrame {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    Array.isArray(o.price_levels) &&
    Array.isArray(o.time_steps) &&
    !!o.grids &&
    typeof o.grids === "object" &&
    typeof o.asof === "string" &&
    typeof o.cadence === "string"
  );
}

/**
 * Bind a fetched frame to the exact replay request that selected it. The file path
 * carries HHMM identity, so a same-session stale/misrouted response must not be
 * relabelled with the requested cursor time merely because root/date still match.
 */
export function isSurfaceFrameForContext(
  value: unknown, root: string, sessionDate: string | null, stamp: string,
): value is SurfaceFrame {
  if (!isSurfaceFrame(value) || !isSessionDate(sessionDate) || value.session_date !== sessionDate) return false;
  const suppliedRoot = value.root;
  if (suppliedRoot !== undefined &&
      (typeof suppliedRoot !== "string" || suppliedRoot.trim().toUpperCase() !== root)) return false;
  if (!/^(?:[01]\d|2[0-3])[0-5]\d$/.test(stamp) || value.time_steps.length === 0) return false;
  if (!value.time_steps.every((step, i) =>
    typeof step === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(step) &&
    (i === 0 || step > value.time_steps[i - 1]))) return false;
  const expected = `${stamp.slice(0, 2)}:${stamp.slice(2, 4)}`;
  return value.time_steps.at(-1) === expected;
}

/**
 * Validate that an index and a set of available stamp files agree.
 * Returns { ok, missing, extra } — `missing` = stamps promised by the index but with no
 * file; `extra` = files present that the index doesn't list. `latest` must equal the last
 * stamp. Used in tests and can gate a materializer self-check.
 */
export function checkIndexFilesContract(
  index: SurfaceIndex,
  availableStamps: string[],
): { ok: boolean; missing: string[]; extra: string[]; latestOk: boolean } {
  const idxSet = new Set(index.stamps);
  const availSet = new Set(availableStamps);
  const missing = index.stamps.filter((s) => !availSet.has(s));
  const extra = availableStamps.filter((s) => !idxSet.has(s));
  const latestOk =
    index.stamps.length === 0
      ? index.latest === null
      : index.latest === index.stamps[index.stamps.length - 1];
  return { ok: missing.length === 0 && extra.length === 0 && latestOk, missing, extra, latestOk };
}

// ─── Grid → heat bars ───────────────────────────────────────────────────────

/**
 * Median step between successive price levels (the cell half-height source).
 * Falls back to 1 for degenerate inputs.
 */
export function levelStep(priceLevels: number[]): number {
  if (priceLevels.length < 2) return 1;
  const diffs: number[] = [];
  for (let i = 1; i < priceLevels.length; i++) {
    const d = priceLevels[i] - priceLevels[i - 1];
    if (d > 0) diffs.push(d);
  }
  if (diffs.length === 0) return 1;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

/** max(|min|,|max|) across a metric grid — the shader's day-max normalizer. */
export function gridMaxAbs(grid: number[][]): number {
  let m = 0;
  for (const row of grid) {
    for (const v of row) {
      const a = Math.abs(v);
      if (Number.isFinite(a) && a > m) m = a;
    }
  }
  return m;
}

/**
 * Percentile-range variant of `gridMaxAbs` (masterplan R1.4, "kill the bland") — the
 * shader's day-max normalizer clamps to the Pth percentile of |cell| (default 95th)
 * instead of the single largest cell, mirroring MatrixHeatCard's validated `pctile()`
 * (components/msc/MatrixHeatCard.tsx). ONE outlier strike-minute cannot wash out the rest
 * of the field.
 *
 * heatShade already computes `o = min(1, |amount| / maxAbs)` — passing this function's
 * result as `maxAbs` is the entire fix: every cell beyond the Pth percentile saturates to
 * full intensity for free, with no change to heatShade's curve/palette (out of scope; the
 * MSC sibling program's R1.2 owns contour lines / configurable intensity curves).
 *
 * Zero cells are excluded from the distribution (a mostly-empty column must not pull the
 * percentile index toward the outlier). A grid with 0 or 1 distinct nonzero magnitudes
 * degrades to that value (or 0, gridMaxAbs's own answer for an all-zero grid) —
 * percentile is a no-op until there is a distribution worth compressing.
 */
export function gridPercentileAbs(grid: number[][], p = 95): number {
  const mags: number[] = [];
  for (const row of grid) {
    for (const v of row) {
      const a = Math.abs(v);
      if (Number.isFinite(a) && a > 0) mags.push(a);
    }
  }
  if (!mags.length) return 0;
  mags.sort((a, b) => a - b);
  const idx = Math.min(mags.length - 1, Math.max(0, Math.ceil((p / 100) * mags.length) - 1));
  return mags[idx];
}

/**
 * Median observed interval between surface columns, in seconds.
 *
 * The snapshot producer carries a configured target cadence, but a full poll cycle can
 * take much longer. The plotted columns are the authority for what the user actually
 * received. Returning null for fewer than two valid points avoids inventing precision
 * before a cadence can be observed.
 */
export function observedSurfaceCadenceSec(timeSteps: string[]): number | null {
  const minutes: number[] = [];
  for (const step of timeSteps) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(step);
    if (!match) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) continue;
    minutes.push(hour * 60 + minute);
  }
  if (minutes.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < minutes.length; i++) {
    const gap = minutes[i] - minutes[i - 1];
    if (gap > 0) gaps.push(gap * 60);
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
}

/**
 * Per-level price bands: the [low, high) each strike row owns on the price axis.
 *
 * Each level extends half-way to each neighbour, so the bands are CONTIGUOUS and
 * NON-OVERLAPPING — `bands[i].high === bands[i+1].low` exactly. Edge levels extend by
 * half their single neighbouring gap. A single-level ladder falls back to `levelStep`.
 *
 * This is what makes a non-uniform ladder paint solid (B3). The renderer
 * (lib/heatSeries) builds its pixel grid from the UNION of every cell boundary in a bar;
 * contiguous non-overlapping bands make that union exactly `levels + 1` entries, i.e.
 * one grid row per level with no row left unowned. The previous construction gave every
 * cell the same half-height (the MEDIAN gap), which on a non-uniform ladder both
 * overlapped neighbours and left surplus union rows that nothing ever wrote —
 * transparent stripes across the field.
 *
 * On a uniform ladder this is arithmetically identical to level ± step/2, so the
 * geometry of every existing (uniform) surface is unchanged.
 */
export function levelBands(priceLevels: number[]): { low: number; high: number }[] {
  const n = priceLevels.length;
  if (n === 0) return [];
  if (n === 1) {
    const h = levelStep(priceLevels) / 2;
    return [{ low: priceLevels[0] - h, high: priceLevels[0] + h }];
  }
  const bands: { low: number; high: number }[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const low =
      i === 0
        ? priceLevels[0] - (priceLevels[1] - priceLevels[0]) / 2
        : (priceLevels[i - 1] + priceLevels[i]) / 2;
    const high =
      i === n - 1
        ? priceLevels[n - 1] + (priceLevels[n - 1] - priceLevels[n - 2]) / 2
        : (priceLevels[i] + priceLevels[i + 1]) / 2;
    bands[i] = { low, high };
  }
  return bands;
}

/** A time-anchoring converter: "HH:MM" on a session date → LWC UNIX time (seconds). */
export type TimeAnchor = (hhmm: string) => Time;

/**
 * Build the heat-series bar array from a frame's metric grid.
 * grid[levelIdx][timeIdx] → one bar per time step, each carrying a cell per level.
 * Bars past the frame's realized `time_steps` are simply absent (honest — no forward fill).
 */
export function buildHeatBars(
  frame: SurfaceFrame,
  metric: string,
  anchor: TimeAnchor,
): HeatData[] {
  const grid = frame.grids[metric];
  if (!grid || !frame.price_levels.length || !frame.time_steps.length) return [];
  // Contiguous half-way bands (see levelBands) — non-uniform ladders tile solid (B3).
  const bands = levelBands(frame.price_levels);
  const bars: HeatData[] = [];
  for (let ti = 0; ti < frame.time_steps.length; ti++) {
    const cells: HeatCell[] = bands.map((b, li) => ({
      low: b.low,
      high: b.high,
      amount: grid[li]?.[ti] ?? 0,
    }));
    bars.push({ time: anchor(frame.time_steps[ti]), cells });
  }
  return bars;
}

/**
 * Filter a frame's price_levels (and each metric grid's rows) to spot ± q.
 * Mirrors quanted's range slider: it narrows the painted band without touching the data.
 * Returns the frame unchanged when q ≤ 0 or the window would be empty.
 */
export function filterFrameToRange(frame: SurfaceFrame, spot: number, q: number): SurfaceFrame {
  if (q <= 0 || !frame.price_levels.length) return frame;
  const lo = spot - q;
  const hi = spot + q;
  const keep: number[] = [];
  for (let i = 0; i < frame.price_levels.length; i++) {
    if (frame.price_levels[i] >= lo && frame.price_levels[i] <= hi) keep.push(i);
  }
  if (keep.length === 0) return frame;
  const grids: { [metric: string]: number[][] } = {};
  for (const [m, grid] of Object.entries(frame.grids)) {
    grids[m] = keep.map((i) => grid[i] ?? []);
  }
  return { ...frame, price_levels: keep.map((i) => frame.price_levels[i]), grids };
}

// ─── Session-flow rebase math (SessionFlowPane) ─────────────────────────────

export interface SessionPoint {
  t: string; // "HH:MM"
  call: number; // cumulative net call premium at t
  put: number; // cumulative net put premium at t (typically ≤ 0)
}

/**
 * Convert a cumulative series to per-minute increments (first point kept as-is).
 * The tide payload carries CUMULATIVE ncp/npp; the "per-min" toggle differences them.
 */
export function toPerMinute(series: SessionPoint[]): SessionPoint[] {
  if (series.length === 0) return [];
  const out: SessionPoint[] = [{ ...series[0] }];
  for (let i = 1; i < series.length; i++) {
    out.push({
      t: series[i].t,
      call: series[i].call - series[i - 1].call,
      put: series[i].put - series[i - 1].put,
    });
  }
  return out;
}

/**
 * Off-open rebase: subtract the 9:30 open value from every point so the series reads
 * "Δ since the open". The first point becomes 0/0 by construction. No-op on empty input.
 * (Quanted's "off open" toggle on the Net Delta / Premium Flow panes.)
 */
export function rebaseOffOpen(series: SessionPoint[]): SessionPoint[] {
  if (series.length === 0) return [];
  const base = series[0];
  return series.map((p) => ({ t: p.t, call: p.call - base.call, put: p.put - base.put }));
}

/** Absolute value of both legs (quanted's "absolute" toggle — magnitude comparison). */
export function toAbsolute(series: SessionPoint[]): SessionPoint[] {
  return series.map((p) => ({ t: p.t, call: Math.abs(p.call), put: Math.abs(p.put) }));
}

export type SessionMode = "cumulative" | "permin";
export type SessionSide = "cp" | "calls" | "puts";

// ─── Strike-ladder hover: per-expiry breakdown (from the matrix cells) ──────────

export interface MatrixCell {
  strike: number;
  expiry: string;
  gex: number;
}

export interface ExpiryShare {
  exp: string;
  gex: number;
  share: number; // 0..1 of the strike's total |gex| across expiries
}

/**
 * Top-N per-expiry GEX shares for a strike, from the matrix cells (options_structure
 * .matrix). Zero/non-finite cells are dropped; shares are |gex| / Σ|gex| over the kept
 * cells and sum to 1. Returns [] when the matrix has no (matching) cells — the caller
 * then omits the breakdown rather than fabricating it. Powers the ladder hover popover.
 */
export function topExpiriesForStrike(
  cells: MatrixCell[] | null | undefined,
  strike: number,
  n = 3,
): ExpiryShare[] {
  if (!cells || cells.length === 0) return [];
  const rows = cells.filter(
    (c) => c.strike === strike && Number.isFinite(c.gex) && c.gex !== 0,
  );
  if (rows.length === 0) return [];
  const totalAbs = rows.reduce((s, c) => s + Math.abs(c.gex), 0) || 1;
  return rows
    .map((c) => ({ exp: c.expiry, gex: c.gex, share: Math.abs(c.gex) / totalAbs }))
    .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex))
    .slice(0, n);
}

/**
 * What the drill modal may show for the per-expiry breakdown (B4 — point-in-time honesty).
 *
 * The per-expiry matrix (`matrix:{ROOT}`) is fetched ONCE per root, with no stamp in the key,
 * so it always describes the PRESENT — there is no stored per-stamp matrix to substitute.
 * Captioning those present-time shares "Expiry breakdown at NOW" while the user is scrubbed
 * back would state something false about a past moment, so:
 *
 *   "none"   — no cells for this strike: omit the section entirely (never fabricate it).
 *   "live"   — at the head of the replay: NOW really is now, show the bars as before.
 *   "stale"  — scrubbed back: withdraw the bars and say the split is live-only.
 *
 * Split out as a pure function so the rule is unit-testable and cannot silently regress into
 * "just render it anyway".
 */
export type ExpiryPanelState = "none" | "live" | "stale";

export function expiryPanelState(expiryCount: number, replayLive: boolean): ExpiryPanelState {
  if (expiryCount <= 0) return "none";
  return replayLive ? "live" : "stale";
}

// ─── OI Δ strike ranking (options_hub.oi_change/v1, nightly) ────────────────

/** Structural subset of an `oi_change:{ROOT}` row this module reads. */
export interface OiChangeCell {
  strike: number;
  d_oi: number;
}

/**
 * Parse `oi_change:{ROOT}`'s `rows` array into the minimal {strike, d_oi} shape,
 * dropping anything non-finite. Never throws on a malformed payload — an absent or
 * empty `rows` array yields [], which the caller then treats as "no OI-change coverage"
 * rather than fabricating a highlight. Mirrors the defensive parse SurfacePane already
 * does for `matrix:{ROOT}`.
 *
 * F8: `root` is optional but should always be passed by a caller that fetched a
 * root-keyed key (`oi_change:{ROOT}`) — it rejects a payload whose own top-level `root`
 * doesn't match (a stale-root race: the state still holds the previous ticker's response
 * when the fetch effect re-fires), and drops any ROW carrying a foreign `root` (the
 * cross-root board's rows do carry one; a per-root payload should not, but a badge must
 * never wear another ticker's structure — same law as optionsLevels' pickRootPayload).
 */
export function parseOiChangeRows(raw: unknown, root?: string): OiChangeCell[] {
  if (root) {
    const payloadRoot = (raw as { root?: unknown } | null)?.root;
    if (typeof payloadRoot === "string" && payloadRoot.toUpperCase() !== root.toUpperCase()) {
      return [];
    }
  }
  const rows = (raw as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) return [];
  const out: OiChangeCell[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    if (root && typeof rec.root === "string" && rec.root.toUpperCase() !== root.toUpperCase()) continue;
    const strike = Number(rec.strike);
    // d_oi must ALREADY be a number — unlike `strike`, coercing a null/missing d_oi would
    // turn "not populated" into a false literal 0 (Number(null) === 0), which would then
    // rank as a real (if uncompetitive) "no change" reading instead of being dropped.
    const dOi = rec.d_oi;
    if (Number.isFinite(strike) && typeof dOi === "number" && Number.isFinite(dOi)) {
      out.push({ strike, d_oi: dOi });
    }
  }
  return out;
}

/**
 * The top-N strikes by |ΔOI|, summed across every expiry/right at that strike PRESENT IN
 * `rows`. F11: `rows` is itself the upstream's own top contract-level movers list
 * (`options_hub.oi_change/v1`, capped/ranked upstream) — not a full per-strike OI ledger —
 * so this is each strike's footprint AMONG THE CONTRACTS THAT MADE THE UPSTREAM CUT, not
 * its true total footprint across the whole chain. Returns strike → summed |d_oi|.
 * F10: JS `Map` DOES preserve insertion order, and `top` is sorted descending before being
 * inserted below — so iterating the returned Map (`[...map.entries()]` / `map.keys()`)
 * already yields strikes in descending-|ΔOI| rank order; no re-sort is needed. The
 * strike-axis badge itself only needs membership (`map.has(strike)`). Rows with the same
 * strike across different expiries/rights are meant to combine (a strike can carry a wall
 * of ΔOI split across its option chain) — matches MSC's numDoi flattening convention for
 * the same payload family.
 */
export function topOiChangeStrikes(rows: OiChangeCell[] | null | undefined, n = 5): Map<number, number> {
  const out = new Map<number, number>();
  if (!rows || !rows.length) return out;
  const byStrike = new Map<number, number>();
  for (const r of rows) {
    if (!Number.isFinite(r.strike) || !Number.isFinite(r.d_oi)) continue;
    byStrike.set(r.strike, (byStrike.get(r.strike) ?? 0) + Math.abs(r.d_oi));
  }
  const top = [...byStrike.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.max(0, n));
  for (const [strike, mag] of top) out.set(strike, mag);
  return out;
}

// ─── Archived-session overlay policy (F1) ─────────────────────────────────────

/**
 * Which of SurfacePane's three nightly overlays (Levels / regime chip / OI Δ) may draw
 * during an archived session, and which are withdrawn outright.
 *
 * `gexstate:{ROOT}` (regime) and `oi_change:{ROOT}` (OI Δ) are CURRENT-session-only
 * stores with no dated twin — rendering them under a replayed session would silently
 * paint today's numbers over a past session's field, the exact cross-session lookahead
 * this policy exists to prevent (same law as the Exposure desk's archived pane, see
 * GexDeskView's `isArchived` branch + `archivedPaneNote`, post-#344). They are WITHDRAWN,
 * never merely "absent because no data loaded yet" — the two states must read differently.
 *
 * `gex_at:{ROOT}:{DATE}` (Levels) DOES have a dated twin (the gex_history plane), so
 * Levels stays live, sourced ONLY from that dated payload (see deriveOptLevels called
 * with a null `movesRaw` — there is no dated `moves:` twin either, so the EM band drops
 * on its own via deriveOptLevels' existing "missing moves" path).
 *
 * Deliberately takes ONLY `isArchived` (no payload) — the withdrawal is a SESSION-STATE
 * decision, not a data-presence one, so this function's shape itself proves regime/OI Δ
 * cannot flip back on just because a fetch happens to resolve with data.
 */
export interface ArchivedOverlayPolicy {
  /** Levels overlay stays live, sourced from the dated gex_at: payload only. */
  useDatedLevels: boolean;
  /** Regime chip is withdrawn (current-session-only store). */
  regimeWithdrawn: boolean;
  /** OI Δ toggle/badges are withdrawn (current-session-only store). */
  oiDeltaWithdrawn: boolean;
}

export function archivedOverlayPolicy(isArchived: boolean): ArchivedOverlayPolicy {
  return {
    useDatedLevels: isArchived,
    regimeWithdrawn: isArchived,
    oiDeltaWithdrawn: isArchived,
  };
}

// ─── Price-line host bookkeeping (N1) ─────────────────────────────────────────

/** A drawn LWC price line, tagged with the series it was actually created on. */
export interface HostedLine {
  host: unknown;
  line: unknown;
}

/**
 * N1: remove every line from the host it was ACTUALLY drawn on — never a "whichever host
 * this cleanup run currently resolves to" variable passed in separately. Lightweight-
 * Charts' `removePriceLine()` is a silent no-op for a line belonging to a DIFFERENT
 * series (no throw, no effect), so SurfacePane's Levels/OI-Δ overlay effects used to leak:
 * a host flip between the run that drew a set of lines and the run that cleans them up
 * (F4/R1 — the candle series gaining or losing its first plotted bar) orphaned the old
 * host's lines, drawn a second time on the new host, doubling every wall/flip/EM level.
 * Mirrors the pins reconciliation idiom (`pinLinesRef`'s `series` field), which already
 * stored the host per-entry and was never affected by this bug.
 */
export function removeHostedLines(records: HostedLine[]): void {
  for (const rec of records) {
    try {
      (rec.host as { removePriceLine: (line: unknown) => void }).removePriceLine(rec.line);
    } catch {
      /* host already torn down (chart remount) — nothing left to clean up */
    }
  }
}

// ─── Greek metric enablement (Wave 2E feature-detection) ─────────────────────

/**
 * The surface metric grid keys, in tab order. `netprem` is Wave-1's premium-flow field;
 * the greek grids (`gex` gamma, `vanna`, `charm`) arrive with the greeks snapshotter and
 * are enabled per-frame ONLY when the loaded snapshot actually carries the key — never
 * assumed. `gex` is the gamma grid's key in the snapshot store (matches the macro lane's
 * grids:{gex,dex,vanna,charm}); the UI labels it "Gamma".
 */
export const SURFACE_METRIC_KEYS = ["netprem", "gex", "vanna", "charm"] as const;
export type SurfaceMetricKey = (typeof SURFACE_METRIC_KEYS)[number];

/**
 * Feature-detect which metric a frame can render: a grid key is enabled only when the
 * frame's `grids` carries a non-empty 2-D array for it. A missing key, a null frame, or an
 * empty grid all read as disabled — so the greek tabs stay disabled-with-tooltip until the
 * snapshotter ships them, and light up the instant a snapshot arrives with the grid. Pure
 * (no DOM) so the tab-enablement logic is unit-testable.
 */
export function metricEnabled(frame: SurfaceFrame | null | undefined, key: string): boolean {
  const grid = frame?.grids?.[key];
  return Array.isArray(grid) && grid.length > 0 && Array.isArray(grid[0]) && grid[0].length > 0;
}

// ─── Strike Intraday-Evolution series (Wave 2E drill modal) ──────────────────

export interface StrikePoint {
  t: string; // "HH:MM" session time column
  v: number; // the metric's value for this strike at that time
}

export interface StrikeSeries {
  strike: number;
  metric: string;
  points: StrikePoint[]; // realized-so-far, truncated at the replay stamp
  nowT: string | null; // the "HH:MM" of the NOW marker (the scrubbed stamp), or null
  nowValue: number | null; // the metric value at NOW (last kept point), or null
  total: number; // count of session columns in the full day (for "N snapshots")
}

/**
 * Build a single strike's intraday evolution for the Intraday-Evolution modal.
 *
 * A surface frame's grid is `grid[levelIdx][timeIdx]` — one strike's whole-session series
 * is therefore the row `grid[strikeIdx]`, indexed by `time_steps`. The frame passed in is
 * the HEAD (full realized day); `upToTimeIdx` truncates the series to the replay-scrubbed
 * stamp (inclusive) so the modal time-travels with the scrubber (left of NOW = realized).
 * When `upToTimeIdx` is null/out-of-range the full realized series is returned.
 *
 * The NOW marker sits at the last kept column. Returns an empty series (points:[]) when the
 * grid/row is absent — the caller then shows an honest empty state, never a fabricated line.
 * Pure + DOM-free for unit tests.
 */
export function buildStrikeSeries(
  frame: SurfaceFrame | null | undefined,
  strikeIdx: number,
  metric: string,
  upToTimeIdx: number | null,
): StrikeSeries {
  const empty: StrikeSeries = { strike: NaN, metric, points: [], nowT: null, nowValue: null, total: 0 };
  if (!frame) return empty;
  const grid = frame.grids?.[metric];
  const row = grid?.[strikeIdx];
  const steps = frame.time_steps ?? [];
  const strike = frame.price_levels?.[strikeIdx] ?? NaN;
  if (!Array.isArray(row) || steps.length === 0) return { ...empty, strike };
  const total = Math.min(row.length, steps.length);
  const cut =
    upToTimeIdx == null || upToTimeIdx < 0 || upToTimeIdx >= total ? total - 1 : upToTimeIdx;
  const points: StrikePoint[] = [];
  for (let ti = 0; ti <= cut; ti++) {
    const v = row[ti];
    points.push({ t: steps[ti], v: Number.isFinite(v) ? v : 0 });
  }
  const last = points[points.length - 1] ?? null;
  return {
    strike,
    metric,
    points,
    nowT: last ? last.t : null,
    nowValue: last ? last.v : null,
    total,
  };
}

/**
 * Truncate a session series at a replay stamp — the session-flow pane's half of whole-desk
 * time travel. `stamp` is the replay's "HHMM"; points are the tide's "HH:MM" minutes.
 *
 * Cutting (rather than masking) is what makes this honest: the pane then plots exactly the
 * premium that had accrued by that minute, and its running totals are the totals as of then.
 * A null/blank/malformed stamp returns the series untouched — a stamp we can't parse must not
 * silently blank a chart. Points whose own time is unparseable are kept in place: they came
 * from the feed, and dropping feed data on a formatting quibble would understate the tide.
 */
export function truncateSessionAt(series: SessionPoint[], stamp: string | null): SessionPoint[] {
  if (!stamp || !/^\d{4}$/.test(stamp)) return series;
  const cut = Number(stamp.slice(0, 2)) * 60 + Number(stamp.slice(2));
  if (!Number.isFinite(cut)) return series;
  return series.filter((p) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(p.t);
    if (!m) return true;
    return Number(m[1]) * 60 + Number(m[2]) <= cut;
  });
}

/**
 * Compose the display series from the raw cumulative series under the pane's toggles,
 * in a fixed order: per-min differencing → off-open rebase → absolute. (Rebase-then-abs
 * matches the panes: "Δ off open", then optionally its magnitude.)
 */
export function composeSessionSeries(
  cumulative: SessionPoint[],
  opts: { mode: SessionMode; offOpen: boolean; absolute: boolean },
): SessionPoint[] {
  let s = opts.mode === "permin" ? toPerMinute(cumulative) : cumulative.map((p) => ({ ...p }));
  if (opts.offOpen) s = rebaseOffOpen(s);
  if (opts.absolute) s = toAbsolute(s);
  return s;
}
