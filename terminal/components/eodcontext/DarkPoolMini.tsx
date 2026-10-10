"use client";
/**
 * Settled off-exchange observations from Macro's versioned EOD artifact.
 * Keep source session, independent nulls, and comparable-history counts visible.
 * A missing baseline or source pattern is not a quiet-market conclusion.
 * The existing layout and vocabulary remain; source-specific prose awaits its owner.
 */

import React from "react";
import { makeEodT } from "./eodStrings";
import type { EodKey } from "./eodStrings";
import { Tip } from "@/components/ui/Tip";
import type { Lang } from "@/lib/i18n";
import {
  darkPoolRead,
  type DarkPoolEodPayload,
  type DarkPoolShortKey,
  eodDate,
  fmtEodDay,
} from "@/lib/eodContext";

interface DarkPoolMiniProps {
  root: string;
  /** null → the fetch hasn't resolved or the artifact is missing (see `loading`). */
  payload: DarkPoolEodPayload | null;
  /** True while the first fetch is in flight — suppresses the "unavailable" claim. */
  loading?: boolean;
  lang: Lang;
}

const SHORT_LABEL: Record<DarkPoolShortKey, EodKey> = {
  building: "dpShortBuilding",
  fading: "dpShortFading",
  light: "dpShortLight",
  heavy: "dpShortHeavy",
  normal: "dpShortNormal",
};
/** Few matched days behind the z-scores → say so rather than quietly trusting them. */
const FEW_DAYS = 30;

export function DarkPoolMini({ root, payload, loading = false, lang }: DarkPoolMiniProps) {
  const t = makeEodT(lang);
  const read = darkPoolRead(payload, root);
  const day = fmtEodDay(eodDate(read.asof), lang);
  const sourceAttributes = {
    "data-source-schema": read.schema ?? undefined,
    "data-state": read.state,
    "data-source-pattern": read.pattern ?? undefined,
    "data-source-session": read.asof ?? undefined,
    "data-history-rebased": read.historyRebased ?? undefined,
    "data-comparable-observations": read.nDays ?? undefined,
  };


  const header = (
    <div style={HEAD}>
      <span style={HEAD_TITLE}>{t("dpTitle")}</span>
      {day && <span style={HEAD_STAMP}>{t("eodStamp").replace("{d}", day)}</span>}
    </div>
  );

  // Missing, unsupported, historical-only, or unqualified source session.
  if (read.state === "unavailable") {
    return (
      <section style={OUTER} aria-label={t("dpAria")} {...sourceAttributes}>
        {header}
        {loading ? (
          <p style={ABSENT_LEAD}>&nbsp;</p>
        ) : (
          <>
            <p style={ABSENT_LEAD}>{t("dpUnavailable")}</p>
          </>
        )}
      </section>
    );
  }

  // A qualified current cross-section exists, but has no current or historical row.
  if (read.state === "not_covered") {
    return (
      <section style={OUTER} aria-label={t("dpAria")} {...sourceAttributes}>
        {header}
        <p style={ABSENT_LEAD}>{t("dpNotCovered").replace("{root}", read.root)}</p>
      </section>
    );
  }

  const lean = read.lean;
  const leanTone = "var(--signal)";
  const shortKey = read.short?.key ?? null;
  const shortText = shortKey
    ? t(SHORT_LABEL[shortKey]).replace(
        "{n}",
        read.short?.pp != null ? read.short.pp.toFixed(0) : ""
      )
    : t("cellAbsent");

  return (
    <section style={OUTER} aria-label={t("dpAria")} {...sourceAttributes}>
      {header}

      {/* Only a source-qualified standout earns the existing direction-unknown label.
          Missing/partial context and non-standouts carry measurements, never a quiet claim. */}
      {lean && (
        <div style={LEAN_ROW}>
          <span style={{ ...LEAN_CHIP, color: leanTone, borderColor: leanTone }}>
            {t("dpLeanUnusual")}
          </span>
          <span style={STANCE}>{t("dpStanceUnusual")}</span>
        </div>
      )}

      {/* Numbers tier: share, its distance from the name's own norm, short-marking trend. */}
      <div style={METRICS}>
        <Metric
          label={t("dpOeShare")}
          value={read.oeSharePct === null ? t("cellAbsent") : `${read.oeSharePct.toFixed(0)}%`}
        />
        <Metric
          label={t("dpVsNorm")}
          value={read.oeZ === null ? t("cellAbsent") : `${read.oeZ >= 0 ? "+" : ""}${read.oeZ.toFixed(1)}σ`}
        />
        <Metric
          label={t("dpShortMark")}
          value={shortText}
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
