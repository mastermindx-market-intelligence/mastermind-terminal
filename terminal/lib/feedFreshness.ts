// Freshness labelling for the quote badge — pure, so the rule can be unit-tested without a DOM.
//
// THE LAW THIS FILE ENCODES: the feed is called real-time ONLY on a MEASUREMENT.
// `hub/lib/snapshot.js` measures the age of the youngest print it has seen against the wall
// clock and only then stamps `basis: "REALTIME"` plus the `lagMs` it was graded on. This module
// turns that pair into a label; it has no access to any configuration and cannot manufacture a
// real-time claim on its own. If the measurement is missing, the label degrades to the
// unmeasured wording rather than to an optimistic one.
//
// SCOPE. Real-time and second-resolution entitlement on the current Massive plan is US STOCKS
// ONLY — no index, futures, FX or crypto. `usOnly` carries that boundary into the copy so the
// badge cannot imply coverage the plan does not sell us.

export type FeedBasis = "REALTIME" | "LIVE" | "DELAYED_15M" | "EOD";

export type FreshnessInput = {
  basis?: FeedBasis | string | null;
  /** Measured age of the print at SERVE time, in ms. Present only when measured. */
  lagMs?: number | null;
  /**
   * Epoch-ms of the print itself. Preferred over `lagMs` when present: it is the state, whereas
   * `lagMs` is one stopwatch reading of it taken when the response was assembled. Deriving the
   * age from this at RENDER time is what keeps the number honest across a poll the client
   * deliberately did not re-render for (TerminalShell's `quoteEq` bail-out) — a retained quote
   * object would otherwise keep displaying the age it had when it was first received.
   */
  asOfMs?: number | null;
  /** Market of the quoted symbol; only "us" can carry a real-time claim on this plan. */
  market?: string | null;
  /** US session state from the hub. "overnight" means the tape is shut, not lagging. */
  marketSession?: "pre" | "rth" | "post" | "overnight" | string | null;
};

export type FreshnessLabel = {
  /** className for the badge element */
  cls: string;
  /** the glance-tier word — deliberately one or two words, no stats, no vendor names */
  label: string;
  /** hover detail: the wording plus the number the verdict was made on */
  tip: string;
};

/** Translator shape — matches `useT()` from lib/i18n. */
type T = (key: string) => string;

/**
 * A measured age → a short human duration ("3s", "14m", "2h").
 *
 * Returns null for a missing/negative measurement so a caller cannot print "0s" and imply a
 * freshness it never measured. A negative age means the vendor clock led ours — not evidence of
 * anything, so it is refused rather than clamped to a flattering zero.
 */
export function formatLag(ms: number | null | undefined, t: T): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}${t("unitSecShort")}`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}${t("unitMinShort")}`;
  return `${Math.round(m / 60)}${t("unitHrShort")}`;
}

/**
 * The badge's three-way verdict.
 *
 * REALTIME  → the green "Live" badge, tip carries the measured age.
 * LIVE      → the pre-existing non-US live lane (OKX/Coinbase crypto, Tencent A-share). Unchanged.
 * DELAYED   → the delayed wording; tip carries the measured age when one exists, so a user sees
 *             the actual number rather than an adjective the app chose for them.
 * EOD/other → historical. No freshness claim of any kind.
 */
export function freshnessLabel(
  q: FreshnessInput | null | undefined, t: T, nowMs: number = Date.now(),
): FreshnessLabel {
  const basis = q?.basis ?? "EOD";
  // Age at RENDER time when the print instant is known; the serve-time reading otherwise.
  const ageMs = q?.asOfMs != null ? nowMs - q.asOfMs : q?.lagMs;
  const lag = formatLag(ageMs, t);

  // ── Closed market: "delayed" is the wrong word, not a conservative one ──
  // Outside a US session there is no live tape to be behind. Carrying "15-min delayed" through a
  // weekend describes a lag that does not exist and quietly implies the number would improve if
  // you waited fifteen minutes. The honest reading is that this is the last session's print.
  // Only applies with no measurement in hand: if the feed DID measure something outside session
  // hours, the measurement wins and is shown.
  if (q?.marketSession === "overnight" && lag == null && basis !== "LIVE") {
    return { cls: "livebadge", label: t("historical"), tip: t("marketClosedFeed") };
  }

  if (basis === "REALTIME") {
    return {
      cls: "livebadge live",
      label: t("live"),
      // "Real-time US stocks — last trade measured 3s" — the claim and its evidence together.
      tip: lag ? `${t("realtimeTip")} ${lag}` : t("freshnessUnknown"),
    };
  }
  if (basis === "LIVE") {
    return { cls: "livebadge live", label: t("live"), tip: lag ? `${t("realtimeTip")} ${lag}` : t("liveTip") };
  }
  if (basis === "DELAYED_15M") {
    return {
      cls: "livebadge delayed",
      label: t("delayed15m"),
      tip: lag ? `${t("delayedTip")} ${lag}` : t("delayed15m"),
    };
  }
  return { cls: "livebadge", label: t("historical"), tip: t("marketClosedFeed") };
}
