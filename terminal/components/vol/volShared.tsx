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
import type { VolHistoryRow, VolSmileExp, VolTermRow } from "./volTypes";

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

export interface AdmittedVolTermPoint {
  dte: number;
  exp: string;
  v: number;
  /** True when the source identity was duplicated and this row exists only to preserve its known gap coordinate. */
  conflict: boolean;
}

export interface VolTermAdmission {
  rows: AdmittedVolTermPoint[];
  conflictExpiries: Set<string>;
  /** Duplicate expiry rows whose DTE coordinates disagree; no gap coordinate can be invented safely. */
  ambiguousCoordinateExpiries: Set<string>;
}

/**
 * Admit term rows once for BOTH the panel and the shared expiry context.
 * Duplicate expiry identities never pick a client-side winner. When every duplicate
 * agrees on DTE, keep one NaN placeholder so finiteSegments preserves that source
 * position as a gap. If DTE itself conflicts, report the ambiguity and omit a fake
 * coordinate; the panel then suppresses line continuity for the curve.
 */
export function admitVolTermRows(term: VolTermRow[] | undefined): VolTermAdmission {
  const valid: AdmittedVolTermPoint[] = [];
  for (const row of term ?? []) {
    const dte = reportedVolNumber(row?.dte);
    const exp = volIsoDay(row?.exp);
    if (!Number.isFinite(dte) || !exp) continue;
    valid.push({ dte, exp, v: reportedVolNumber(row?.atm_iv), conflict: false });
  }
  const groups = new Map<string, AdmittedVolTermPoint[]>();
  for (const row of valid) groups.set(row.exp, [...(groups.get(row.exp) ?? []), row]);
  const rows: AdmittedVolTermPoint[] = [];
  const conflictExpiries = new Set<string>();
  const ambiguousCoordinateExpiries = new Set<string>();
  for (const [exp, group] of groups) {
    if (group.length === 1) {
      rows.push(group[0]);
      continue;
    }
    conflictExpiries.add(exp);
    const dtes = [...new Set(group.map((row) => row.dte))];
    if (dtes.length === 1) rows.push({ dte: dtes[0], exp, v: Number.NaN, conflict: true });
    else ambiguousCoordinateExpiries.add(exp);
  }
  rows.sort((a, b) => a.dte - b.dte || a.exp.localeCompare(b.exp));
  return { rows, conflictExpiries, ambiguousCoordinateExpiries };
}

export interface AdmittedVolSmilePoint {
  strike: number;
  call_iv: number;
  put_iv: number;
  conflict: boolean;
}

export interface AdmittedVolSmileExpiry {
  exp: string;
  points: AdmittedVolSmilePoint[];
  conflictStrikes: Set<number>;
}

export interface VolSmileAdmission {
  expiries: AdmittedVolSmileExpiry[];
  conflictExpiries: Set<string>;
}

/**
 * Admit smile rows once for BOTH VolSkewPanel and VolView. A duplicated expiry is
 * rejected as a whole. Within an otherwise unique expiry, duplicate strike identity
 * becomes one NaN placeholder at that exact strike so neither line nor interpolation
 * can bridge across the conflict.
 */
export function admitVolSmileExpiries(smile: VolSmileExp[] | undefined): VolSmileAdmission {
  const valid = (smile ?? []).filter((row) => volIsoDay(row?.exp) != null && Array.isArray(row?.points));
  const expiryGroups = new Map<string, VolSmileExp[]>();
  for (const row of valid) expiryGroups.set(row.exp, [...(expiryGroups.get(row.exp) ?? []), row]);
  const expiries: AdmittedVolSmileExpiry[] = [];
  const conflictExpiries = new Set<string>();
  for (const [exp, group] of expiryGroups) {
    if (group.length !== 1) {
      conflictExpiries.add(exp);
      continue;
    }
    const pointGroups = new Map<number, AdmittedVolSmilePoint[]>();
    for (const point of group[0].points ?? []) {
      if (typeof point?.strike !== "number" || !Number.isFinite(point.strike) || point.strike <= 0) continue;
      const normalized: AdmittedVolSmilePoint = {
        strike: point.strike,
        call_iv: reportedVolNumber(point.call_iv),
        put_iv: reportedVolNumber(point.put_iv),
        conflict: false,
      };
      pointGroups.set(point.strike, [...(pointGroups.get(point.strike) ?? []), normalized]);
    }
    const points: AdmittedVolSmilePoint[] = [];
    const conflictStrikes = new Set<number>();
    for (const [strike, pointGroup] of pointGroups) {
      if (pointGroup.length === 1) points.push(pointGroup[0]);
      else {
        conflictStrikes.add(strike);
        points.push({ strike, call_iv: Number.NaN, put_iv: Number.NaN, conflict: true });
      }
    }
    points.sort((a, b) => a.strike - b.strike);
    expiries.push({ exp, points, conflictStrikes });
  }
  expiries.sort((a, b) => a.exp.localeCompare(b.exp));
  return { expiries, conflictExpiries };
}

export interface AdmittedVolHistoryPoint {
  date: string;
  e: number;
  v: number;
  conflict: boolean;
}

export interface VolHistoryAdmission {
  rows: AdmittedVolHistoryPoint[];
  conflictDates: Set<string>;
}

/** Duplicate dates keep one NaN placeholder at that date so the history line visibly breaks. */
export function admitVolHistoryRows(history: VolHistoryRow[] | undefined): VolHistoryAdmission {
  const valid: AdmittedVolHistoryPoint[] = [];
  for (const row of history ?? []) {
    const date = volIsoDay(row?.date);
    if (!date) continue;
    valid.push({ date, e: Date.parse(`${date}T00:00:00Z`), v: reportedVolNumber(row.atm_iv), conflict: false });
  }
  const groups = new Map<string, AdmittedVolHistoryPoint[]>();
  for (const row of valid) groups.set(row.date, [...(groups.get(row.date) ?? []), row]);
  const rows: AdmittedVolHistoryPoint[] = [];
  const conflictDates = new Set<string>();
  for (const [date, group] of groups) {
    if (group.length === 1) rows.push(group[0]);
    else {
      conflictDates.add(date);
      rows.push({ date, e: group[0].e, v: Number.NaN, conflict: true });
    }
  }
  rows.sort((a, b) => a.e - b.e);
  return { rows, conflictDates };
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
