/**
 * FlowGauge — session-level flow summary gauge.
 *
 * Shows: total premium, call vs put premium split bar, P/C ratio, one-word tone.
 *
 * DEAD ZONE: |call_share - 0.5| < 0.08 → tone = "MIXED" (/ "混合").
 * No bull/bear assertion styling — colors are magnitude-neutral.
 *
 * Props derived from feed events; no fetching.
 */
"use client";
import { useMemo } from "react";
import { pick } from "../../lib/finFormat";
import type { Lang } from "../../lib/i18n";
import { FD, gaugeMissingPrints } from "../../lib/flowdeskStrings";
import { feedEvents, printAttributable } from "../../lib/flowPrintInspector";

// ─── Types ────────────────────────────────────────────────────────────────

interface FlowEvent {
  right: "C" | "P";
  premium: number;
}

interface FeedPayload {
  events: FlowEvent[];
  session_pct?: number;
}

export interface FlowGaugeProps {
  feed: FeedPayload;
  lang: Lang;
  /** The feed is held from an earlier read because the latest read did not land:
   *  the totals are the last read's, and the gauge says so. */
  held?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────

/** Dead zone: call share within 8pp of 0.5 → MIXED, no directional label. */
const DEAD_ZONE = 0.08;

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtPrem(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/**
 * Categorical violet for the put side.
 *
 * `--cat-2` is the house categorical-2 token used across the options suite, but
 * it is NOT defined in globals.css (see report: repo-wide gap), so a bare
 * var(--cat-2) is invalid-at-computed-value-time and the put bar renders
 * invisible. The fallback defers to `--cat-2` the moment it is defined and
 * meanwhile resolves to the same violet the observatory already uses for the
 * ELITE tier / Prophet accent. Non-directional by design — never --up/--down.
 */
const TONE_PUT = "var(--cat-2, var(--code-fn))";

type Tone = "CALL_HEAVY" | "PUT_HEAVY" | "MIXED";

function deriveTone(callShare: number): Tone {
  if (Math.abs(callShare - 0.5) < DEAD_ZONE) return "MIXED";
  return callShare > 0.5 ? "CALL_HEAVY" : "PUT_HEAVY";
}

function toneLabel(tone: Tone, zh: boolean): string {
  if (tone === "MIXED")      return pick(zh, "MIXED",      "混合");
  if (tone === "CALL_HEAVY") return pick(zh, "CALL-HEAVY", "认购偏重");
  return pick(zh, "PUT-HEAVY", "认沽偏重");
}

/** Tone uses the brand accent (not up/down) — magnitude-only signal, no bull/bear assertion. */
function toneColor(tone: Tone): string {
  if (tone === "MIXED") return "var(--text-2)";
  // Both call-heavy and put-heavy are signaled in the same brand-accent spectrum —
  // we deliberately avoid green/red here per honesty doctrine.
  return tone === "CALL_HEAVY" ? "var(--brand-2)" : TONE_PUT;
}

// ─── Component ────────────────────────────────────────────────────────────

/**
 * Unknown is not zero. A print counts toward the gauge only when it carries a
 * finite, non-negative premium AND a call/put side. With no prints, or with any
 * print the gauge cannot attribute, the totals are not established: every
 * component is drawn as unavailable with the reason, never as $0 or 50/50.
 * Prints that are all attributable but sum to zero premium give a real $0 total,
 * but no call/put split and no tone.
 */
type GaugeState = "ok" | "no-split" | "unavailable";

// Attribution is the shared printAttributable (lib/flowPrintInspector.ts) — the same
// predicate the desk's coverage line counts `missing` with, so the two always agree.

export function FlowGauge({ feed, lang, held = false }: FlowGaugeProps) {
  const zh = lang === "zh";

  const summary = useMemo(() => {
    // The same guarded tape the desk's coverage line counts (feedEvents).
    const events: readonly unknown[] = feedEvents<unknown>(feed);
    let callPrem = 0;
    let putPrem = 0;
    let missing = 0;
    for (const ev of events) {
      if (!printAttributable(ev)) { missing += 1; continue; }
      if (ev.right === "C") callPrem += ev.premium;
      else putPrem += ev.premium;
    }
    const total = callPrem + putPrem;
    const state: GaugeState = events.length === 0 || missing > 0
      ? "unavailable"
      : total > 0 ? "ok" : "no-split";
    const callShare = state === "ok" ? callPrem / total : null;
    const pc = state === "ok" && callPrem > 0 ? putPrem / callPrem : null;
    const tone = callShare != null ? deriveTone(callShare) : null;
    return { n: events.length, missing, total, callPrem, putPrem, callShare, pc, tone, state };
  }, [feed]);

  const { state, total, callPrem, putPrem, callShare, pc, tone } = summary;
  const na = pick(zh, FD.gaugeNa.en, FD.gaugeNa.zh);
  const reason = state === "ok"
    ? null
    : state === "no-split"
      ? pick(zh, FD.gaugeNoSplit.en, FD.gaugeNoSplit.zh)
      : summary.n === 0
        ? pick(zh, FD.gaugeNoPrints.en, FD.gaugeNoPrints.zh)
        : (() => { const m = gaugeMissingPrints(summary.missing, summary.n); return pick(zh, m.en, m.zh); })();

  const callPct = callShare != null ? Math.round(callShare * 100) : null;
  const putPct = callPct != null ? 100 - callPct : null;
  const sp = feed.session_pct;
  const sessionPct = typeof sp === "number" && Number.isFinite(sp) ? Math.round(sp * 100) : null;
  const totalsKnown = state !== "unavailable";

  return (
    <div style={styles.gauge} data-tut="flow-gauge" data-gauge-state={state}>
      {/* ── Header ── */}
      <div style={styles.header}>
        <span style={styles.label}>{pick(zh, FD.sessionGauge.en, FD.sessionGauge.zh)}</span>
        {sessionPct != null && (
          <span style={styles.sessionPct}>
            {pick(zh, `Session ${sessionPct}% elapsed`, `交易日已过 ${sessionPct}%`)}
          </span>
        )}
      </div>

      {/* A held feed: the latest read did not land, so these are the last read's totals. */}
      {held && (
        <div style={styles.held} data-testid="flow-gauge-held" role="note">
          {pick(zh, FD.gaugeHeld.en, FD.gaugeHeld.zh)}
        </div>
      )}

      {/* ── Total premium (big number) ── */}
      {totalsKnown ? (
        <div className="num" style={styles.totalPrem}>{fmtPrem(total)}</div>
      ) : (
        <div style={styles.totalNa}>{pick(zh, FD.gaugeTotalsNa.en, FD.gaugeTotalsNa.zh)}</div>
      )}

      {/* ── Split bar: drawn only when the feed establishes a split ── */}
      {callPct != null && putPct != null ? (
        <div style={styles.splitRow}>
          <span className="num" style={{ ...styles.splitPct, color: "var(--brand-2)" }}>
            {callPct}% {pick(zh, "C", "认购")}
          </span>
          <div style={styles.barTrack}>
            <div data-testid="flow-gauge-call-bar" style={{ ...styles.callBar, width: `${callPct}%` }} />
            <div data-testid="flow-gauge-put-bar" style={{ ...styles.putBar, width: `${putPct}%` }} />
          </div>
          <span className="num" style={{ ...styles.splitPct, color: TONE_PUT, textAlign: "right" }}>
            {putPct}% {pick(zh, "P", "认沽")}
          </span>
        </div>
      ) : (
        <div style={styles.reason} data-testid="flow-gauge-reason" role="note">{reason}</div>
      )}

      {/* ── Stats row ── */}
      <div style={styles.statsRow}>
        <div style={styles.statCell}>
          <div style={styles.statK}>{pick(zh, "Call Prem", "认购金额")}</div>
          <div style={totalsKnown ? styles.statV : styles.statNa} data-testid="flow-gauge-stat-value">
            {totalsKnown ? fmtPrem(callPrem) : na}
          </div>
        </div>
        <div style={styles.statCell}>
          <div style={styles.statK}>{pick(zh, "Put Prem", "认沽金额")}</div>
          <div style={totalsKnown ? styles.statV : styles.statNa} data-testid="flow-gauge-stat-value">
            {totalsKnown ? fmtPrem(putPrem) : na}
          </div>
        </div>
        <div style={styles.statCell}>
          <div style={styles.statK}>{pick(zh, "P/C Ratio", "认沽认购比")}</div>
          <div style={totalsKnown ? styles.statV : styles.statNa} data-testid="flow-gauge-stat-value">
            {totalsKnown ? (pc != null ? pc.toFixed(2) : "—") : na}
          </div>
        </div>
        <div style={styles.statCell}>
          <div style={styles.statK}>{pick(zh, "Tone", "倾向")}</div>
          <div
            style={tone != null ? { ...styles.statV, color: toneColor(tone) } : (totalsKnown ? styles.statV : styles.statNa)}
            data-testid="flow-gauge-stat-value"
          >
            {tone != null ? toneLabel(tone, zh) : (totalsKnown ? "—" : na)}
          </div>
        </div>
      </div>

      {/* Dead zone caption intentionally omitted — tone word "MIXED" is self-describing */}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  gauge: {
    padding: "var(--sp-3)",
    borderBottom: "1px solid var(--line)",
    background: "var(--panel)",
    flexShrink: 0,
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "var(--sp-2)",
    marginBottom: "var(--sp-2)",
  },
  label: {
    fontSize: "var(--fs-micro)",
    fontWeight: 700,
    color: "var(--muted)",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    lineHeight: 1,
  },
  sessionPct: {
    fontSize: "var(--fs-micro)",
    color: "var(--muted)",
    fontFamily: "var(--font-num)",
    fontVariantNumeric: "tabular-nums",
  },
  // Last-read qualifier: muted copy in the gauge's own type ramp — no stripe, no fill.
  held: {
    fontSize: "var(--fs-micro)",
    color: "var(--muted)",
    lineHeight: 1.4,
    marginBottom: "var(--sp-1)",
  },
  // The desk's single largest numeral — hero step of the v6 ramp.
  totalPrem: {
    fontSize: "var(--fs-num-lg)",
    fontWeight: 700,
    color: "var(--text)",
    fontFamily: "var(--font-num)",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.02em",
    lineHeight: 1.1,
    marginBottom: "var(--sp-2)",
  },
  // Unavailable totals: same slot as the hero numeral, in muted copy (no numeral).
  totalNa: {
    fontSize: "var(--fs-ui)",
    fontWeight: 650,
    color: "var(--muted)",
    lineHeight: 1.3,
    marginBottom: "var(--sp-2)",
  },
  reason: {
    fontSize: "var(--fs-micro)",
    color: "var(--text-2)",
    lineHeight: 1.4,
    marginBottom: "var(--sp-3)",
  },
  splitRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--sp-2)",
    marginBottom: "var(--sp-3)",
  },
  splitPct: {
    fontSize: "var(--fs-micro)",
    fontFamily: "var(--font-num)",
    fontVariantNumeric: "tabular-nums",
    minWidth: 30,
  },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: "var(--r-pill)",
    overflow: "hidden",
    display: "flex",
    background: "var(--panel-3)",
  },
  // Call/put bars are NON-directional on purpose (honesty doctrine): the brand
  // accent and the categorical violet, never --up/--down.
  callBar: {
    height: "100%",
    background: "var(--brand-2)",
    transition: "width 0.4s ease",
  },
  putBar: {
    height: "100%",
    background: TONE_PUT,
    transition: "width 0.4s ease",
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "var(--sp-2)",
  },
  statCell: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--sp-1)",
  },
  statK: {
    fontSize: "var(--fs-micro)",
    color: "var(--text-2)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  statNa: {
    fontSize: "var(--fs-ui)",
    fontWeight: 650,
    color: "var(--muted)",
    whiteSpace: "nowrap",
  },
  statV: {
    fontSize: "var(--fs-ui)",
    fontWeight: 650,
    color: "var(--text)",
    fontFamily: "var(--font-num)",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
};
