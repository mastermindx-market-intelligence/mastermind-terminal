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

import { fmtDate } from "@/lib/finFormat";
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
      <div className="obs-insp-section-label obs-lbl">{s.eyebrow}</div>

      {/* 1 · Identity */}
      <div className="obs-print-identity num">{identity}</div>

      {/* 2 · Clocks — the owner carries only the event time */}
      <div className="obs-print-line">
        {s.eventLabel} <span className="num">{formatEventClock(view.eventTs)}</span>
        {" · "}{s.receiptNotSupplied}
        {" · "}{s.exchCondNotSupplied}
      </div>

      {/* 3 · Premium with the multiplier shown */}
      <div className="obs-print-line obs-print-premium num">{premiumLine}</div>

      {/* 4 · Side — a named-method estimate, no direction colour */}
      <div className="obs-print-block">
        <div className="obs-print-hd obs-lbl">{s.sideHeading}</div>
        <div className="obs-print-side">{sideLabel}</div>
        <div className="obs-print-sub">{methodLine}</div>
        <div className="obs-print-sub">{s.confidenceNotSupplied}</div>
      </div>

      {/* 5 · Lineage + quote context — not supplied by this owner */}
      <div className="obs-print-block">
        <div className="obs-print-hd obs-lbl">{s.lineageHeading}</div>
        <div className="obs-print-sub">{s.lineageNotSupplied}</div>
        <div className="obs-print-sub">{s.quoteNotSupplied}</div>
      </div>

      {/* 6 · Packages — no package source is admitted */}
      <div className="obs-print-block">
        <div className="obs-print-hd obs-lbl">{s.packagesHeading}</div>
        <div className="obs-print-sub">{s.packagesNone}</div>
      </div>

      {/* 7 · Contracts-over-prior-OI — a dated comparison, never a direction */}
      <div className="obs-print-block">
        <div className="obs-print-hd obs-lbl">{s.activityHeading}</div>
        <div className="obs-print-sub num">{activityLine}</div>
      </div>
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
 */
export function FlowCoverageLine({ coverage, lang }: FlowCoverageLineProps) {
  const s = flowPrintStrings(lang);

  if (coverage.total <= 0) {
    return (
      <div className="obs-print-coverage" data-testid="flow-coverage">
        {s.coverageEmpty}
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
      <span className="obs-print-coverage-totals num">
        {`${s.coverageCalls} ${formatCoverageUsd(coverage.callPremium)} · ${s.coveragePuts} ${formatCoverageUsd(coverage.putPremium)} · ${s.coverageUnsigned}`}
      </span>
    </div>
  );
}
