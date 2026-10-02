// How ONE accepted live-bar mutation reaches every chart consumer that follows the developing bar.
//
// The chart accepts a live quote in exactly two places (ChartPanel's `applyLiveSplice` for the
// daily/resampled source and `applyIntradayLiveCandle` for the one-second aggregate). Both fold the
// quote into a new bar generation and then hand that generation to ONE derivation boundary
// (`commitLiveBarGeneration`) which projects it onto the price series, the indicator series, the
// Chart Table / visual-intelligence readout and the cross-pane sync lookup.
//
// This module holds the parts of that contract that are pure: which projection class each built-in
// study belongs to, and whether a quote is new enough to be accepted at all. Keeping them here makes
// the contract assertable without a chart — see `lib/__tests__/liveBarProjection.test.ts`.

import { IND_ORDER, type IndKey } from "./indicators";

/**
 * How a study's on-chart state is carried to the CURRENT bar generation.
 *
 * Removing and re-adding a study's series is deliberately NOT one of these: lightweight-charts
 * auto-removes an emptied pane (sliding higher panes down), so a per-tick rebuild would recreate
 * panes and reset their sizing on every quote.
 */
export type LiveBarProjection =
  /** `updateAllIndicators()` re-`setData`s the series this key already owns. */
  | "inplace-series"
  /** The key's own builder is re-run against the series it already owns (`runStudyInPlace`). */
  | "inplace-rebuild"
  /** Closed-bar evidence: rebuilt only at normal data/rebuild boundaries, never on a developing tick. */
  | "closed-bar-series"
  /** Holds no precomputed state: recomputed from `barsRef` by the overlay render pass. */
  | "render-pass"
  /** Nothing in it derives from the bars, so a bar mutation cannot change it. */
  | "not-bar-derived";

/**
 * Every built-in indicator's live-bar projection class. A study missing from here (or added to
 * `IND_ORDER` without a class) is a study nobody decided the live behaviour of — the unit test
 * fails rather than letting it silently freeze on the previous bar.
 */
export const LIVE_BAR_PROJECTION: Record<IndKey, LiveBarProjection> = {
  // ── classic in-place set (ChartPanel's updateAllIndicators) ──
  ema: "inplace-series",
  bb: "inplace-series",
  vwap: "inplace-series",
  vol: "inplace-series",
  rsi: "inplace-series",
  stochrsi: "inplace-series",
  macd: "inplace-series",
  // MTF evidence is explicitly CLOSED-bar only. A developing RTH candle may move beside it,
  // but a live mutation must never recompute or replace the last published closed state.
  mtfconfluence: "closed-bar-series",

  // ── day-trade / premium studies: their builder is the single owner of both the math and the
  //    row→point mapping, so it is re-run against the series the key already owns ──
  ichimoku: "inplace-rebuild",
  ribbon: "inplace-rebuild",
  supertrend: "inplace-rebuild",
  avwap: "inplace-rebuild",
  rvwap: "inplace-rebuild",
  wvwap: "inplace-rebuild",
  vprofile: "inplace-rebuild",
  volbox: "inplace-rebuild",
  rsistack: "inplace-rebuild",
  accum: "inplace-rebuild",
  svwap: "inplace-rebuild",
  orb: "inplace-rebuild",
  slevels: "inplace-rebuild",
  pivots: "inplace-rebuild",
  rvol: "inplace-rebuild",
  ttmsq: "inplace-rebuild",
  adx: "inplace-rebuild",
  cvd: "inplace-rebuild",

  // ── no cached derivation of their own ──
  // `gaps` re-derives from the daily source (the splice reassigns it, which evicts the gap memo)
  // and repaints in renderSignals; `_lab` is a date-keyed marker layer re-projected the same way.
  gaps: "render-pass",
  _lab: "render-pass",

  // ── data-fed, never bar-derived ──
  // Options levels come from the nightly options build keyed on the symbol; a developing bar
  // carries no information they read, so re-running the builder per quote would be pure waste.
  optlevels: "not-bar-derived",
};

/** Keys `updateAllIndicators()` re-setData's directly. Also gates Effect 2's in-place TF switch. */
export const LIVE_INPLACE_SERIES_KEYS: ReadonlySet<IndKey> = new Set(
  IND_ORDER.filter((k) => LIVE_BAR_PROJECTION[k] === "inplace-series"),
);

/** Keys whose builder must be re-run in place when the developing bar changes, in canonical order. */
export const LIVE_REBUILD_KEYS: IndKey[] = IND_ORDER.filter(
  (k) => LIVE_BAR_PROJECTION[k] === "inplace-rebuild",
);

/** Closed-bar series are never eligible for the developing-tick rebuild lane. */
export const LIVE_CLOSED_BAR_KEYS: IndKey[] = IND_ORDER.filter(
  (k) => LIVE_BAR_PROJECTION[k] === "closed-bar-series",
);

/**
 * Does this quote explicitly prove that the named regular session is finished?
 *
 * US hub quotes carry a regular-session date plus session state, so post/overnight
 * can prove completion of the just-finished bar. Tencent CN/HK ordinary quotes do
 * not carry an equivalent completion state; absence is UNKNOWN, never permission
 * to publish a provisional daily/3D value as closed evidence.
 */
export function regularSessionBarIsFinal(
  q: { marketSession?: string | null; regularSessionDate?: string | null } | null | undefined,
  market: string,
  sessionDate: string | null,
): boolean {
  if (!q || !sessionDate || market !== "us") return false;
  if (q.regularSessionDate !== sessionDate) return false;
  return q.marketSession === "post" || q.marketSession === "overnight";
}

// ── series reuse: run a builder as its own update owner ───────────────────────────────────────
// A study's builder both computes its projection and creates the series it draws into. On a live
// bar we want the first half and must NOT repeat the second: removing and re-adding a sub-pane's
// series makes lightweight-charts auto-remove the emptied pane (sliding higher panes down), which
// recreates panes and resets their sizing. So the builder runs against a chart facade that hands
// back the series the key already owns — one owner for the math, zero lifecycle churn.

const NOOP_PRICE_LINE = { applyOptions: () => {}, options: () => ({}) };

/**
 * An existing series, dressed so a re-run builder UPDATES it instead of restyling or re-decorating.
 *
 * Deliberately not a Proxy over the series: the markers plugin and the price scale must see the
 * real object, so every forwarded call runs on it directly.
 */
export function reuseSeries<S extends object>(s: S): S {
  const api = s as unknown as Record<string, (...a: never[]) => unknown>;
  return {
    setData: (d: never) => api.setData(d),
    update: (d: never) => api.update(d),
    data: () => api.data(),
    options: () => api.options(),
    priceScale: () => api.priceScale(),
    getPane: () => api.getPane(),
    // Styling belongs to the build/param path — and `keepIndicatorPaneAxisLabelsOnly` runs AFTER
    // it, so replaying the builder's option literals here would silently re-enable the native
    // last-value line it just removed. A bar mutation never restyles a series.
    applyOptions: () => {},
    // Static guides (RSI 80/20, ADX 20/25, MACD 0, Accum bands) are created once by the build pass
    // and do not derive from the bars; re-creating them per quote would stack duplicates. The
    // data-derived lines (slevels/pivots/optlevels) live on the PRICE series through
    // `pushIndPriceLine`, and their builders clear their own pool first, so they are unaffected.
    createPriceLine: () => NOOP_PRICE_LINE,
  } as unknown as S;
}

/**
 * A chart facade whose `addSeries()` returns `owned[i]` (wrapped by {@link reuseSeries}) instead of
 * creating one. Every other chart call forwards to the real chart, bound to it.
 *
 * A builder's series COUNT is a function of its params, the timeframe and the intraday branch —
 * never of the bars — so a live tick can only ever ask for exactly what the key already owns.
 *
 * If that stops holding, `addSeries` throws. The throw's job is to stop the builder BEFORE it can
 * leak an untracked series onto the chart — it is not an abort of the tick, and the caller cannot
 * make it one: the sibling studies in the same generation still have to be carried, and dropping
 * them would re-create the split this boundary exists to close. So the throw does leave that ONE
 * key holding a stale bar. `runStudyInPlace` (ChartPanel) therefore records the failing key rather
 * than swallowing it, warns once in dev, and reports it through `__mmLiveBarGeneration().studyFailures`,
 * which the burst spec asserts is empty. A non-empty map is the signal to fix the key's ownership —
 * not something the live path can paper over.
 */
export function seriesReuseChart<C extends object, S extends object>(chart: C, owned: S[], label: string): C {
  let taken = 0;
  return new Proxy(chart, {
    get(target, prop) {
      if (prop === "addSeries") {
        return () => {
          const s = owned[taken++];
          if (!s) throw new Error(`live refresh: ${label} asked for more series than it owns`);
          return reuseSeries(s);
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/**
 * How far ahead of the reader's clock a quote may claim to be and still be treated as a clock.
 *
 * Nothing on any lane is legitimately stamped hours into the future — the delayed lanes run BEHIND
 * — so this only has to clear ordinary client/hub skew. It is deliberately generous for that, and
 * still ~11 orders of magnitude short of the failure it exists to catch (see below).
 */
const STAMP_FUTURE_LIMIT_MS = 6 * 60 * 60 * 1000;

/**
 * The quote's own instant, in ms. `asOfMs` is the packet's measured time; `ts` is the coarser
 * seconds field every basis carries. Returns null when the quote declares neither.
 *
 * A stamp implausibly far in the future is reported as UNSTAMPED rather than adopted. This is not
 * defensive decoration: `acceptsLiveTick` keeps the highest stamp it has seen as the lane's floor,
 * so a single bad stamp would refuse every subsequent packet on that lane for the life of the bar
 * set — a permanently frozen chart with no self-heal and no visible cause. The realistic source is
 * a units bug upstream (a lane shipping `ts` already in ms, which the fallback below multiplies by
 * 1000 again, landing around the year 55000), and the honest reading of such a value is that the
 * packet has no usable clock. Degrading to null keeps the lane live, because an unstamped quote is
 * accepted by design.
 */
export function liveQuoteStamp(
  q: { asOfMs?: number | null; ts?: number | null } | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!q) return null;
  const plausible = (ms: number) => (ms <= now + STAMP_FUTURE_LIMIT_MS ? ms : null);
  if (typeof q.asOfMs === "number" && Number.isFinite(q.asOfMs)) return plausible(q.asOfMs);
  if (typeof q.ts === "number" && Number.isFinite(q.ts)) return plausible(q.ts * 1000);
  return null;
}

/** The last quote a pane accepted: which lane it came from, and when. */
export type AcceptedLiveTick = { basis: string; stamp: number | null };

/**
 * Is `next` allowed to repaint over the generation `prev` already painted?
 *
 * A strictly OLDER packet from the SAME lane must never land after a newer one: the daily splice
 * rewrites the final bucket in place, so an out-of-order quote would silently roll the developing
 * candle — and every consumer derived from it — backwards.
 *
 * Three deliberate acceptances:
 *  • an equal stamp — the chart lane and the header lane share a packet time, and a corrected
 *    print can arrive under the same `ts`;
 *  • an unstamped quote — rejecting it would freeze a basis that ships no clock;
 *  • ANY stamp after a lane change. Ordering is per-lane, and the lanes do not share a clock: a
 *    REALTIME → DELAYED_15M fallback moves `asOfMs` back a quarter of an hour, and comparing
 *    across that boundary would freeze the chart until the delayed clock caught up.
 */
export function acceptsLiveTick(prev: AcceptedLiveTick | null, next: AcceptedLiveTick): boolean {
  if (!prev || prev.basis !== next.basis) return true;
  if (prev.stamp == null || next.stamp == null) return true;
  return next.stamp >= prev.stamp;
}
