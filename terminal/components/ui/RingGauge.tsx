"use client";

/**
 * RingGauge — Observatory primitive
 *
 * Conic-gradient score/confidence ring.  All colors derive from the locked
 * v5 design-system CSS tokens so the East-Asian red-up flip
 * (html[data-updown="east"]) is honoured automatically.
 *
 * Usage:
 *   <RingGauge value={91} size="md" />
 *   <RingGauge value={84} size="sm" tone="up" />
 *   <RingGauge value={37} size="lg" tone="down" label="Score" />
 *   <RingGauge value={71} size="sm" tone="auto" />   ← default
 *
 * tone="auto" maps by value:
 *   ≥70  → brand   (strong)
 *   ≥50  → up      (positive)
 *   ≥30  → muted   (neutral)
 *   <30  → down    (weak / negative)
 *
 * Sizes:
 *   sm   34px outer / 26px inner  — inline in list rows
 *   md   46px outer / 36px inner  — cards, inspector sub-stats
 *   lg   84px outer / 66px inner  — inspector hero ring
 *
 * v6: the ring is now an SVG stroke arc (rounded terminal cap + animated sweep +
 * soft tone glow) instead of the old hard-edged conic wedge that could not tween.
 * The component prop API is UNCHANGED so every Observatory call site keeps working.
 *
 * Styles live in observatory.css (.obs-ring, .obs-ring--{size}, .obs-ring--{tone}).
 */

import { useEffect, useRef, useState } from "react";

export type RingTone = "brand" | "up" | "down" | "muted" | "auto";
export type RingSize = "sm" | "md" | "lg";

// Geometry per size — outer diameter, stroke width, inner value font.
const RING_GEO: Record<RingSize, { d: number; sw: number; fs: number }> = {
  sm: { d: 34, sw: 3.5, fs: 11 },
  md: { d: 46, sw: 4.5, fs: 13 },
  lg: { d: 84, sw: 7, fs: 20 },
};

export interface RingGaugeProps {
  /** Score or confidence value — displayed as-is. null / non-finite = NO reading */
  value: number | null;
  /** Scale for the ring FILL (e.g. 92 for capped confidence). Display number is unaffected. */
  max?: number;
  /** Visual size variant */
  size?: RingSize;
  /**
   * Color tone. "auto" (default) picks brand/up/muted/down by value.
   * Directional tones (up/down) map to var(--up)/var(--down) which
   * respect the East-Asian red-up flip.
   */
  tone?: RingTone;
  /** Optional micro-label rendered above the ring when supplied */
  label?: string;
  /**
   * Accessible name for the no-reading mark shown when `value` is null or
   * non-finite. Unknown is not zero: the mark renders the same geometry with
   * the track only, a "—" inner value, tone muted and data-score-state
   * "unavailable" — never a filled 0-ring.
   */
  naLabel?: string;
}

function resolveAutoTone(value: number): Exclude<RingTone, "auto"> {
  if (value >= 70) return "brand";
  if (value >= 50) return "up";
  if (value >= 30) return "muted";
  return "down";
}

export function RingGauge({ value, max = 100, size = "sm", tone = "auto", label, naLabel }: RingGaugeProps) {
  // Unknown is not zero (UI-truth law): a null or non-finite value has NO reading.
  // It renders the same geometry with the track only, a "—" instead of a number,
  // tone forced to muted and data-score-state="unavailable" — never a filled 0-ring.
  const unavailable = value === null || !Number.isFinite(value);
  const v = unavailable ? null : value;
  // The DISPLAYED number is always the true value; `max` only scales the fill.
  // (A confidence of 68 with a 92 cap must read "68", never a normalized 74.)
  const displayValue = v === null ? 0 : Math.max(0, Math.round(v));
  const fillPct = v === null || max <= 0
    ? 0
    : Math.max(0, Math.min(100, Math.round((v / max) * 100)));
  const resolvedTone: Exclude<RingTone, "auto"> =
    unavailable ? "muted" : tone === "auto" ? resolveAutoTone(fillPct) : tone;

  const geo = RING_GEO[size];
  const r = (geo.d - geo.sw) / 2;         // stroke sits inside the box
  const c = 2 * Math.PI * r;              // full-circle circumference
  const offset = c * (1 - fillPct / 100); // remaining unfilled length
  const center = geo.d / 2;

  // Sweep-in: draw from empty → real offset on mount (prefers-reduced-motion jumps).
  const [drawn, setDrawn] = useState(false);
  const reduce = useRef(false);
  useEffect(() => {
    reduce.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce.current) { setDrawn(true); return; }
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const shownOffset = drawn || reduce.current ? offset : c;

  const ring = unavailable ? (
    <span
      className={`obs-ring obs-ring--${size} obs-ring--${resolvedTone} obs-ring--na`}
      role="img"
      aria-label={naLabel ?? "—"}
      data-score-state="unavailable"
    >
      <svg className="obs-ring-svg" width={geo.d} height={geo.d} viewBox={`0 0 ${geo.d} ${geo.d}`}>
        {/* track — faint full circle; no arc: there is no reading to fill */}
        <circle cx={center} cy={center} r={r} fill="none"
          stroke="rgba(255,255,255,.08)" strokeWidth={geo.sw} />
      </svg>
      <span className="obs-ring-inner">
        <span className="obs-ring-value num" style={{ fontSize: geo.fs }}>—</span>
      </span>
    </span>
  ) : (
    <span
      className={`obs-ring obs-ring--${size} obs-ring--${resolvedTone}`}
      aria-label={`${displayValue} out of ${max}`}
      role="img"
    >
      <svg className="obs-ring-svg" width={geo.d} height={geo.d} viewBox={`0 0 ${geo.d} ${geo.d}`}>
        {/* track — faint full circle */}
        <circle cx={center} cy={center} r={r} fill="none"
          stroke="rgba(255,255,255,.08)" strokeWidth={geo.sw} />
        {/* progress — one tone color, rounded terminal cap, animated sweep, glow */}
        <circle cx={center} cy={center} r={r} fill="none"
          className="obs-ring-arc"
          stroke="var(--obs-ring-color)" strokeWidth={geo.sw} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={shownOffset}
          transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: reduce.current ? "none" : "stroke-dashoffset .6s var(--ease-out)" }} />
      </svg>
      <span className="obs-ring-inner">
        <span className="obs-ring-value num" style={{ fontSize: geo.fs }}>{displayValue}</span>
      </span>
    </span>
  );

  if (!label) return ring;

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
      <span className="obs-lbl">{label}</span>
      {ring}
    </span>
  );
}
