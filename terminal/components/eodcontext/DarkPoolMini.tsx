"use client";
/**
 * DarkPoolMini — settled off-exchange positioning context for one root (OEU T-E).
 *
 * The compact Terminal counterpart of the macro darkpool desk. It answers one question:
 * how much of this name traded away from the public tape yesterday, versus how much
 * normally does — and which way the short-marking moved while that happened.
 *
 * THREE STATES, NEVER COLLAPSED INTO ONE
 *   1. tagged     — the row is a standout and carries macro's own lean label + read.
 *   2. quiet      — the row exists and is inside its normal range. A real answer, printed
 *                   as such, not as an empty panel.
 *   3. absent     — split further into "this ticker is not in the panel" (ETFs, thin names)
 *                   and "the artifact hasn't published" (a 404). Different facts get
 *                   different sentences.
 *   A read that did not land (5xx, refused fetch, unparseable body) is none of the three: it
 *   says nothing about the panel, so it gets its own load error and a Retry.
 *
 * HONESTY DOCTRINE
 *   - The lean words, stances and reads are macro's published copy, carried verbatim; the
 *     classification thresholds are macro's constants (lib/eodContext.ts). One footprint,
 *     one vocabulary, across both estates.
 *   - The disclaimer ships WITH the panel, not in a footnote: off-exchange volume hides
 *     direction, so this is positioning context and never a trade call.
 *   - Small matched-day counts are disclosed on the panel, not buried.
 *   - EOD vintage stamped on the panel — this is yesterday's settled tape.
 */

import React from "react";
import { makeEodT } from "./eodStrings";
import type { EodKey } from "./eodStrings";
import { Tip } from "@/components/ui/Tip";
import type { Lang } from "@/lib/i18n";
import {
  darkPoolRead,
  type DarkPoolEodPayload,
  type EodReadStatus,
  type DarkPoolLean,
  type DarkPoolNorm,
  type DarkPoolShortKey,
  eodDate,
  fmtEodDay,
} from "@/lib/eodContext";

interface DarkPoolMiniProps {
  root: string;
  /** null → the read hasn't landed, failed, or proved the artifact missing (see `status`). */
  payload: DarkPoolEodPayload | null;
  /** How the read stands. Only "absent" may print "hasn't published". */
  status: EodReadStatus;
  /** Re-reads the artifact after a failed read. */
  onRetry: () => void;
  lang: Lang;
}

const LEAN_LABEL: Record<DarkPoolLean, EodKey> = {
  accumulation: "dpLeanAccumulation",
  distribution: "dpLeanDistribution",
  unusual: "dpLeanUnusual",
};
const LEAN_STANCE: Record<DarkPoolLean, EodKey> = {
  accumulation: "dpStanceAccumulation",
  distribution: "dpStanceDistribution",
  unusual: "dpStanceUnusual",
};
const LEAN_READ: Record<DarkPoolLean, EodKey> = {
  accumulation: "dpReadAccumulation",
  distribution: "dpReadDistribution",
  unusual: "dpReadUnusual",
};
/** Direction tones are TOKENS, so zh 红涨绿跌 flips by theme, never by hardcoded colour. */
const LEAN_TONE: Record<DarkPoolLean, string> = {
  accumulation: "var(--up)",
  distribution: "var(--down)",
  unusual: "var(--signal)",
};
const NORM_LABEL: Record<DarkPoolNorm, EodKey> = {
  far: "dpNormFar",
  well: "dpNormWell",
  above: "dpNormAbove",
  at: "dpNormAt",
};
const SHORT_LABEL: Record<DarkPoolShortKey, EodKey> = {
  building: "dpShortBuilding",
  fading: "dpShortFading",
  light: "dpShortLight",
  heavy: "dpShortHeavy",
  normal: "dpShortNormal",
};
/**
 * Short-marking tone. Short-marked selling BUILDING is the bearish read and FADING the
 * bullish one — so the tokens are deliberately crossed relative to the raw number's sign.
 */
const SHORT_TONE: Partial<Record<DarkPoolShortKey, string>> = {
  building: "var(--down)",
  fading: "var(--up)",
};

/** Few matched days behind the z-scores → say so rather than quietly trusting them. */
const FEW_DAYS = 30;

export function DarkPoolMini({ root, payload, status, onRetry, lang }: DarkPoolMiniProps) {
  const t = makeEodT(lang);
  const read = darkPoolRead(payload, root);
  const day = fmtEodDay(eodDate(read.asof), lang);

  const header = (
    <div style={HEAD}>
      <span style={HEAD_TITLE}>{t("dpTitle")}</span>
      {day && <span style={HEAD_STAMP}>{t("eodStamp").replace("{d}", day)}</span>}
    </div>
  );

  // ── The read did not land: not a fact about the panel, so never its absent copy. ──
  if (status === "unavailable") {
    return (
      <section style={OUTER} aria-label={t("dpAria")}>
        {header}
        <div style={LOAD_ERROR} data-testid="eod-darkpool-load-error" role="alert">
          <p style={ABSENT_LEAD}>{t("dpLoadError")}</p>
          <p style={ABSENT_WHY}>{t("dpLoadErrorWhy")}</p>
          <button type="button" className="btn btn-ghost load-retry" style={RETRY_INLINE} onClick={onRetry}>
            {t("retry")}
          </button>
        </div>
      </section>
    );
  }

  // ── Absent A: the artifact itself is missing (pre-first-nightly, or a 404). ──
  if (!payload || !Array.isArray(payload.universe) || payload.universe.length === 0) {
    return (
      <section style={OUTER} aria-label={t("dpAria")}>
        {header}
        {status === "loading" ? (
          <p style={ABSENT_LEAD}>&nbsp;</p>
        ) : (
          <>
            <p style={ABSENT_LEAD}>{t("dpUnavailable")}</p>
            <p style={ABSENT_WHY}>{t("dpUnavailableWhy")}</p>
          </>
        )}
      </section>
    );
  }

  // ── Absent B: the panel published, but does not cover this ticker. ──
  if (!read.row) {
    return (
      <section style={OUTER} aria-label={t("dpAria")}>
        {header}
        <p style={ABSENT_LEAD}>{t("dpNotCovered").replace("{root}", read.root)}</p>
        <p style={ABSENT_WHY}>{t("dpNotCoveredWhy")}</p>
      </section>
    );
  }

  const lean = read.lean;
  const leanTone = lean ? LEAN_TONE[lean] : "var(--muted)";
  const shortKey = read.short?.key ?? null;
  const shortText = shortKey
    ? t(SHORT_LABEL[shortKey]).replace(
        "{n}",
        read.short?.pp != null ? read.short.pp.toFixed(0) : ""
      )
    : t("cellAbsent");

  return (
    <section style={OUTER} aria-label={t("dpAria")}>
      {header}

      {/* Glance tier: the plain-word lean (or the honest "nothing unusual"), + its stance. */}
      <div style={LEAN_ROW}>
        <span style={{ ...LEAN_CHIP, color: leanTone, borderColor: leanTone }}>
          {lean ? t(LEAN_LABEL[lean]) : t("dpQuietLabel")}
        </span>
        {lean && <span style={STANCE}>{t(LEAN_STANCE[lean])}</span>}
      </div>
      <p style={READ_LINE}>{lean ? t(LEAN_READ[lean]) : t("dpQuietRead")}</p>

      {/* Numbers tier: share, its distance from the name's own norm, short-marking trend. */}
      <div style={METRICS}>
        <Metric
          label={t("dpOeShare")}
          value={read.oeSharePct === null ? t("cellAbsent") : `${read.oeSharePct.toFixed(0)}%`}
        />
        <Metric
          label={t("dpVsNorm")}
          value={read.norm ? t(NORM_LABEL[read.norm]) : t("cellAbsent")}
          sub={read.oeZ === null ? null : `${read.oeZ >= 0 ? "+" : ""}${read.oeZ.toFixed(1)}σ`}
        />
        <Metric
          label={t("dpShortMark")}
          value={shortText}
          tone={shortKey ? SHORT_TONE[shortKey] : undefined}
        />
      </div>

      <div style={FOOT}>
        {read.nDays !== null && (
          <span style={FOOT_DAYS}>
            {t("dpDays").replace("{n}", String(read.nDays))}
            {read.nDays < FEW_DAYS && <span style={FOOT_WARN}> · {t("dpFewDays")}</span>}
          </span>
        )}
        {/* Non-negotiable: off-exchange volume hides direction. Never a trade call. */}
        <Tip label={t("dpSubtitle")} size="mini">
          <span style={DISCLAIMER} tabIndex={0}>{t("dpDisclaimer")}</span>
        </Tip>
      </div>
    </section>
  );
}

function Metric({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string | null; tone?: string }) {
  return (
    <div style={METRIC}>
      <span style={METRIC_LABEL}>{label}</span>
      <span style={{ ...METRIC_VALUE, color: tone ?? "var(--text)" }}>
        {value}
        {sub && <span style={METRIC_SUB}>{sub}</span>}
      </span>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const OUTER: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  flex: "0 1 316px",
  minWidth: 250,
  padding: "7px 14px",
  borderLeft: "1px solid var(--line-2)",
};

const HEAD: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
};

const HEAD_TITLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "var(--text-2)",
};

const HEAD_STAMP: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: "0.03em",
  color: "var(--text-dim)",
  marginLeft: "auto",
  whiteSpace: "nowrap",
};

const LEAN_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  flexWrap: "wrap",
};

const LEAN_CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.02em",
  padding: "2px 8px",
  border: "1px solid",
  borderRadius: "var(--r-pill)",
  whiteSpace: "nowrap",
};

const STANCE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "var(--text-2)",
  whiteSpace: "nowrap",
};

const READ_LINE: React.CSSProperties = {
  margin: 0,
  fontSize: 10.5,
  lineHeight: 1.5,
  color: "var(--muted)",
};

const METRICS: React.CSSProperties = {
  display: "flex",
  gap: 14,
  flexWrap: "wrap",
};

const METRIC: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const METRIC_LABEL: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--muted)",
  whiteSpace: "nowrap",
};

const METRIC_VALUE: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 4,
  fontSize: 11.5,
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const METRIC_SUB: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  color: "var(--text-dim)",
};

const FOOT: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  marginTop: "auto",
};

const FOOT_DAYS: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  color: "var(--text-dim)",
  whiteSpace: "nowrap",
};

const FOOT_WARN: React.CSSProperties = {
  color: "var(--warn)",
};

const DISCLAIMER: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  color: "var(--text-dim)",
  cursor: "help",
  outline: "none",
};

const ABSENT_LEAD: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-2)",
};

const ABSENT_WHY: React.CSSProperties = {
  margin: 0,
  fontSize: 10,
  lineHeight: 1.5,
  color: "var(--muted)",
};

const LOAD_ERROR: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 6,
};

const RETRY_INLINE: React.CSSProperties = {
  padding: "2px 10px",
  fontSize: 11,
};
