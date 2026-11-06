"use client";
/**
 * PrintInspector — W3A per-print inspector (Options R1 packet 3, U05 board).
 *
 * Mounted inside InspectorPane between the hero and the field breakdown, plus the
 * desk-level coverage line rendered by FeedPane above the tape. Honesty contract
 * (docs freeze § W3A A1 + 2026-10-21 field-policy amendment):
 *   - side is a named-method ESTIMATE — never a fact, never coloured;
 *   - every clock/field the flow owner does not carry (receipt clock, exchange and
 *     conditions, lineage, quote context, confidence) renders "not supplied by the
 *     flow owner", never derived from the event time;
 *   - premium shows the owner's figure with the multiplier arithmetic beside it;
 *   - the contracts-over-prior-OI ratio is a dated comparison — the words opening,
 *     closing, bullish and bearish never appear on it;
 *   - packages: no package source is admitted; similar timestamps alone never group.
 * All copy lives in flowdeskStrings.ts (FD); all math lives in flowPrintInspector.ts.
 */

import styles from "./EvidenceDisclosure.module.css";
import { fmtDate, pick } from "@/lib/finFormat";
import { gaugeMissingPrints } from "@/lib/flowdeskStrings";
import type { Lang } from "@/lib/i18n";
import {
  flowPrintStrings,
  formatCoverageUsd,
  formatEventClock,
  formatOiDate,
  formatPrintPrice,
  formatPrintSize,
  formatPrintUsd,
  formatRatio,
  projectFlowPrint,
  type FlowCoverage,
  type FlowPrintInput,
} from "@/lib/flowPrintInspector";

// ─── Print inspector ──────────────────────────────────────────────────────────

export interface PrintInspectorProps {
  /** Any flow event row — the projector validates every field before use. */
  event: FlowPrintInput;
  lang: Lang;
  /** Publication date of the prior-open-interest figure, when the desk has one. */
  oiAsOf?: string | null;
}

export function PrintInspector({ event, lang, oiAsOf = null }: PrintInspectorProps) {
  const view = projectFlowPrint(event, { oiAsOf });
  // A row the projector rejects renders nothing — never a partial print view.
  if (!view) return null;

  const s = flowPrintStrings(lang);

  const identity = `${view.contract.root} ${String(view.contract.strike)} ${view.contract.right} · ${fmtDate(view.contract.exp)}`;
  const hasArith = Number.isFinite(view.size) && Number.isFinite(view.avgPrice);
  const arith = hasArith
    ? `${formatPrintSize(view.size)} × ${formatPrintPrice(view.avgPrice)} × 100`
    : null;
  const premiumLine = view.arithmeticReproduces
    ? `${formatPrintUsd(view.premium)} = ${arith}`
    : `${formatPrintUsd(view.premium)} · ${s.ownerFigure} · ${arith ? `${s.notReproducibleFrom} ${arith}` : s.arithNotSupplied}`;

  const sideLabel =
    view.side.estimate === "bought" ? s.sideBought
      : view.side.estimate === "sold" ? s.sideSold
        : view.side.estimate === "mixed" ? s.sideMixed
          : s.sideUnknown;
  const methodLine =
    view.side.method === "tape" ? `${s.methodPrefix} ${s.methodTape}`
      : view.side.method === "floor" ? `${s.methodPrefix} ${s.methodFloor}`
        : s.methodNotSupplied;

  const activityLine = view.ratio === null
    ? s.ratioNotSupplied
    : view.ratio.oiAsOf
      ? `${formatRatio(view.ratio.value)}× ${s.ratioUnit} · ${s.oiAsOfPrefix} ${formatOiDate(view.ratio.oiAsOf, lang)}`
      : `${formatRatio(view.ratio.value)}× ${s.ratioUnit} · ${s.oiDateNotSupplied}`;

  return (
    <div className="obs-insp-section obs-print" data-testid="flow-print-inspector">
      <div className={styles.printSummary}>
        <div><strong>{sideLabel}</strong><span>{methodLine}</span></div>
        <div><strong className="num">{Number.isFinite(view.avgPrice) ? formatPrintPrice(view.avgPrice) : "—"}</strong><span>{pick(lang === "zh", "Average price", "平均成交价")}</span></div>
      </div>
      {!view.arithmeticReproduces && <div className={styles.warning} role="note">{premiumLine}</div>}
      {view.ratio && <div className={styles.activity}>{activityLine}</div>}

      <details key={view.id} className={styles.disclosure}>
        <summary>{pick(lang === "zh", "Print evidence", "成交依据")}</summary>
        <div className={styles.evidence}>
          <div className="obs-print-hd obs-lbl">{s.eyebrow}</div>
          <div className="obs-print-identity num">{identity}</div>
          <div>{s.eventLabel} <span className="num">{formatEventClock(view.eventTs)}</span></div>
          {view.arithmeticReproduces && <div className="obs-print-premium num">{premiumLine}</div>}
          <div>{s.receiptNotSupplied} · {s.exchCondNotSupplied}</div>
          <div className="obs-print-hd obs-lbl">{s.sideHeading}</div>
          <div>{s.confidenceNotSupplied}</div>
          <div className="obs-print-hd obs-lbl">{s.lineageHeading}</div>
          <div>{s.lineageNotSupplied} · {s.quoteNotSupplied}</div>
          <div className="obs-print-hd obs-lbl">{s.packagesHeading}</div>
          <div>{s.packagesNone}</div>
          {!view.ratio && <div>{activityLine}</div>}
        </div>
      </details>
    </div>
  );
}

// ─── Coverage line (desk-level, rendered by FeedPane above the tape) ─────────

export interface FlowCoverageLineProps {
  coverage: FlowCoverage;
  lang: Lang;
}

/**
 * "88 % of eligible premium classified · 12 % unknown" + unsigned call/put totals.
 * Computed over every loaded event BEFORE the user's filters — unknown premium
 * stays in every denominator, and the C/P totals are unsigned (not a direction).
 * When any loaded print carries no premium or no call/put side, the totals are
 * replaced by the session gauge's own "n of m prints…" disclosure. A tape with no
 * eligible premium says "no eligible premium" only when every loaded print is
 * attributable (in practice: an empty tape); otherwise it carries the disclosure
 * alone — no split, because the shares are null — so unattributable prints never
 * read as an empty or waiting tape.
 */
export function FlowCoverageLine({ coverage, lang }: FlowCoverageLineProps) {
  const s = flowPrintStrings(lang);
  // A loaded print with no premium or no call/put side would silently drop out of the
  // C/P totals — the session gauge calls those totals incomplete, so the line says the
  // same (in the gauge's own words) instead of publishing them.
  const missing = coverage.missing > 0 ? gaugeMissingPrints(coverage.missing, coverage.rows) : null;

  if (coverage.total <= 0) {
    return (
      <div className="obs-print-coverage" data-testid="flow-coverage">
        {missing ? (
          <span className="obs-print-coverage-totals">{pick(lang === "zh", missing.en, missing.zh)}</span>
        ) : (
          s.coverageEmpty
        )}
      </div>
    );
  }

  // Whole-number percentages; they sum to 100 only because unknown is in the
  // denominator — it is never dropped.
  const classifiedPct = Math.round((coverage.classifiedShare ?? 0) * 100);
  const unknownPct = Math.round((coverage.unknownShare ?? 0) * 100);

  return (
    <div className="obs-print-coverage" data-testid="flow-coverage">
      <span className="obs-print-coverage-split">
        {`${classifiedPct} % ${s.coverageClassifiedPart} · ${unknownPct} % ${s.coverageUnknownPart}`}
      </span>
      {missing ? (
        <span className="obs-print-coverage-totals">{pick(lang === "zh", missing.en, missing.zh)}</span>
      ) : (
        <span className="obs-print-coverage-totals num">
          {`${s.coverageCalls} ${formatCoverageUsd(coverage.callPremium)} · ${s.coveragePuts} ${formatCoverageUsd(coverage.putPremium)} · ${s.coverageUnsigned}`}
        </span>
      )}
    </div>
  );
}
