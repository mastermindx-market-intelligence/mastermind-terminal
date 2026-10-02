"use client";
/**
 * volShared — small helpers shared by the Volatility tab's panels.
 *
 * Chart panels build strictly on components/charts/svgChart.ts (hygiene rules
 * R1–R9 live there); this module only carries the vol-local conventions:
 * finite-run segmentation (R7 — break at gaps, never plot them), the per-panel
 * provenance footer, and the shared axis/chip styles.
 */

import React from "react";
import type { Lang } from "@/lib/i18n";
import { getVolStr } from "./volStrings";

/** Preserve typed, finite source numbers without coercing null/strings/booleans to observations. */
export function reportedVolNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : Number.NaN;
}

/** ISO date admission, not a trading calendar or expiry-time/settlement model. */
export function volIsoDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const epoch = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === value ? value : null;
}

/** Fail closed on duplicate source identities; never pick a winning revision client-side. */
export function retainUniqueBy<T>(rows: T[], keyOf: (row: T) => string | number): T[] {
  const counts = new Map<string | number, number>();
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return rows.filter((row) => counts.get(keyOf(row)) === 1);
}

/** Consecutive runs of rows whose mapped value is finite (R7: break, don't bridge). */
export function finiteSegments<T>(rows: T[], valueOf: (r: T) => number): T[][] {
  const segs: T[][] = [];
  let cur: T[] = [];
  for (const r of rows) {
    if (Number.isFinite(valueOf(r))) {
      cur.push(r);
    } else if (cur.length) {
      segs.push(cur);
      cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  return segs;
}

/** Percent-number formatting (payload IVs are percent numbers: 58.2 == 58.2%). */
export function fmtPct(v: number | null | undefined, digits = 1): string {
  return v != null && Number.isFinite(v) ? `${v.toFixed(digits)}%` : "—";
}

/** Rank formatting (0–100 percentile — a number, not a percent of anything). */
export function fmtRank(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? v.toFixed(1) : "—";
}

/** Nightly-EOD provenance footer, one per panel. */
export function ProvenanceLine({ lang }: { lang: Lang }) {
  return <div style={PROV_LINE}>{getVolStr(lang, "provenance")}</div>;
}

const PROV_LINE: React.CSSProperties = {
  marginTop: 10,
  paddingTop: 6,
  borderTop: "1px solid var(--line-2)",
  fontSize: 10,
  color: "var(--text-dim)",
  letterSpacing: "0.03em",
};

/** Shared plot paddings + text styles for the three SVG panels. */
export const PLOT_PAD = { l: 44, r: 14, t: 12, b: 24 } as const;

export const AXIS_TXT: React.CSSProperties = {
  fontSize: 10,
  fill: "var(--muted)",
  fontVariantNumeric: "tabular-nums",
};

export const REF_TXT: React.CSSProperties = {
  fontSize: 9,
  fill: "var(--muted)",
  fontVariantNumeric: "tabular-nums",
};

/** Neutral structure/disclosure chip (vol is non-directional — never --up/--down). */
export const NEUTRAL_CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 20,
  padding: "0 8px",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.05em",
  color: "var(--text-2)",
  background: "var(--panel-2)",
  border: "1px solid var(--line-3)",
  borderRadius: "var(--r-pill)",
  whiteSpace: "nowrap",
};

/** Two-line honest empty body used inside every panel (title + why). */
export function PanelEmpty({ title, why, minHeight }: { title: string; why: string; minHeight: number }) {
  return (
    <div className="fin-empty" style={{ minHeight, flexDirection: "column", gap: 6 }}>
      <div className="fin-empty-title">{title}</div>
      <div className="fin-empty-why">{why}</div>
    </div>
  );
}
