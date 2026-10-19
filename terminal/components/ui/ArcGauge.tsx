"use client";

/**
 * ArcGauge — v6 primitive. Replaces every speedometer / rainbow / hard-edged
 * conic "retro odometer". A single open 240° SVG arc with a round terminal cap,
 * a faint track, ONE state color, a soft drop-shadow glow, and a mono numeral at
 * the center. The progress arc renders at its final reading immediately so a
 * throttled mobile animation frame can never leave the gauge visually empty.
 *
 * Law: the STATE picks the color — never a red→green gradient across the arc.
 *   bull → var(--up)   bear → var(--down)   warn → var(--signal)
 *   neutral → var(--text-2)  ("no signal" reads as grey, never red).
 * Directional states route through --up/--down so the East-Asian red-up flip
 * (html[data-updown="east"]) is honoured for free.
 *
 * Usage:
 *   <ArcGauge value={72} state="bull" label="Buy pressure" />
 *   <ArcGauge value={48} state="neutral" label="Insider" sublabel="routine only" />
 */

export type ArcState = "bull" | "bear" | "warn" | "neutral";

export interface ArcGaugeProps {
  /** 0–100 fill of the 240° sweep. */
  value: number;
  state: ArcState;
  /** Outer diameter in px (default 120). */
  size?: number;
  label?: string;
  sublabel?: string;
  /** Show the center numeral (default true). */
  showValue?: boolean;
  /** Textual state shown in the center when a numeric score is intentionally hidden. */
  centerLabel?: string;
  /** Accessible title for the gauge; defaults to state label via arcAccessibleLabel. */
  stateTitle?: string;
}

/** The visible arc spans 240° (a 120° gap at the bottom, symmetric). */
export const ARC_SWEEP_DEG = 240;

/** Map a semantic state to its single design-system color variable. */
export function arcStateColor(state: ArcState): string {
  switch (state) {
    case "bull": return "var(--up)";
    case "bear": return "var(--down)";
    case "warn": return "var(--signal)";
    case "neutral":
    default: return "var(--text-2)";
  }
}

/** Clamp an arbitrary input to a 0–100 gauge value (NaN → 0). */
export function clampArcValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/** Keep the accessible name honest when the visual deliberately withholds a score. */
export function arcAccessibleLabel(
  label: string | undefined,
  value: number,
  showValue = true,
  centerLabel?: string,
  stateTitle?: string,
): string {
  if (stateTitle) {
    const prefix = label ? `${label}: ` : "";
    return `${prefix}${stateTitle}`;
  }
  const prefix = label ? `${label}: ` : "";
  return showValue
    ? `${prefix}${Math.round(clampArcValue(value))} of 100`
    : `${prefix}${centerLabel || "No numeric score"}`;
}

/**
 * Geometry for the arc stroke. Given the SVG radius, returns the dasharray
 * (length of the full 240° track) and the dashoffset for a 0–100 value
 * (offset shrinks as value grows → the fill sweeps clockwise from the left tip).
 */
export function arcGeometry(radius: number, value: number) {
  const full = 2 * Math.PI * radius;                 // full circle circumference
  const arcLen = full * (ARC_SWEEP_DEG / 360);       // length of the visible 240° track
  const pct = clampArcValue(value) / 100;
  const offset = arcLen * (1 - pct);                 // remaining (unfilled) length
  return { full, arcLen, offset };
}

/**
 * A multi-word verdict ("Strong sell", "No signal") wraps to two lines inside
 * the arc. At the default inner width (80% of the box) the second line's
 * corners reach past the arc's inner edge and the words visually collide with
 * the stroke. `arcInnerPadPct` returns the horizontal inset (as a fraction of
 * `size`) that keeps a two-line verdict clear of the stroke: the wide default
 * for a single word, a deep inset for anything that can wrap.
 *
 * .21 is derived, not guessed: with the numeral at .26·size, a 2×10px/1.15
 * verdict beneath it and the centre stack sitting .09·size above the arc
 * centre, an inset of .21·size keeps the block's lower corners ≥6px inside the
 * arc's inner edge at every size the app uses (118 is the tightest — the
 * Technicals gauges — where it clears by ~7.5px).
 */
export function arcInnerPadPct(sublabel?: string): number {
  const s = (sublabel ?? "").trim();
  const wraps = s.length > 0 && /\s/.test(s);
  return wraps ? 0.21 : 0.1;
}

/**
 * Optical layout for the numeral + verdict stack.
 *
 * The content wrapper is intentionally shorter than the full SVG because the
 * gauge has an open bottom gap. Centering a two-line verdict in that shorter
 * wrapper pushes the larger numeral too close to the arc's inner top edge.
 * Multi-word verdicts therefore use a slightly smaller numeral and move the
 * complete stack down into the open gap. Single-line gauges retain the original
 * metrics exactly.
 */
export function arcStackMetrics(size: number, sublabel?: string) {
  const tight = arcInnerPadPct(sublabel) > 0.1;
  return {
    tight,
    valueFontSize: Math.round(size * (tight ? 0.235 : 0.26)),
    translateY: tight ? Math.max(4, Math.round(size * 0.042)) : 0,
    gap: tight ? Math.max(3, Math.round(size * 0.025)) : 2,
  };
}

export function ArcGauge({
  value,
  state,
  size = 120,
  label,
  sublabel,
  showValue = true,
  centerLabel,
  stateTitle,
}: ArcGaugeProps) {
  const v = clampArcValue(value);
  const color = arcStateColor(state);

  // Geometry. Stroke sits inside the box with padding = strokeWidth/2 + glow room.
  const stroke = Math.max(6, Math.round(size * 0.075));
  const pad = stroke / 2 + 4;
  const radius = size / 2 - pad;
  const cx = size / 2;
  const cy = size / 2;
  const { arcLen, offset } = arcGeometry(radius, v);

  // Verdict crowding: a wrapping verdict gets a deeper inner inset plus tighter
  // tracking/leading, a smaller numeral, and a downward optical shift so both
  // the score and verdict clear the arc. Single-word verdicts keep the original
  // metrics.
  const stack = arcStackMetrics(size, sublabel);
  const innerPad = Math.round(size * arcInnerPadPct(sublabel));

  // The 240° arc is centered at the bottom gap: start at 150°, sweep to 30°
  // (i.e. rotate the SVG so the gap is bottom-center). We draw a full-circle
  // <circle> and reveal 240° of it via dasharray; a -90° base rotation plus a
  // 60° start offset lands the gap symmetrically at the bottom.
  const rotation = 90 + (360 - ARC_SWEEP_DEG) / 2; // = 90 + 60 = 150°

  return (
    <span
      className="arcg"
      style={{ width: size, display: "inline-flex", flexDirection: "column", alignItems: "center", gap: label ? 6 : 0 }}
      role="img"
      aria-label={arcAccessibleLabel(label, v, showValue, centerLabel, stateTitle)}
    >
      <span style={{ position: "relative", width: size, height: size * 0.82, display: "block" }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ position: "absolute", inset: 0, overflow: "visible" }}
        >
          <g transform={`rotate(${rotation} ${cx} ${cy})`}>
            {/* track — faint, non-directional */}
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,.07)"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${arcLen} 9999`}
            />
            {/* progress — one state color, soft glow, animated sweep */}
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${arcLen} 9999`}
              strokeDashoffset={offset}
              style={{
                filter: `drop-shadow(0 0 5px color-mix(in srgb, ${color} 30%, transparent))`,
              }}
            />
          </g>
        </svg>
        {showValue && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: stack.gap,
              // inner padding — the lane the centred stack may occupy. Deeper
              // when the verdict wraps, so line 2 never touches the arc.
              padding: `0 ${innerPad}px`,
              transform: stack.translateY ? `translateY(${stack.translateY}px)` : undefined,
              pointerEvents: "none",
            }}
          >
            <span
              className="num"
              style={{
                fontFamily: "var(--font-num)",
                fontWeight: 650,
                fontSize: stack.valueFontSize,
                letterSpacing: "-.01em",
                color: "var(--text)",
                lineHeight: 1,
              }}
            >
              {Math.round(v)}
            </span>
            {sublabel && (
              <span
                style={{
                  // 10px is the bottom of the v6 ramp AND the house font floor,
                  // so the "one step down" for a wrapping verdict is spent on
                  // tracking + leading rather than on an illegible font size.
                  font: `600 var(--fs-micro)/${stack.tight ? 1.15 : 1.2} var(--font-ui)`,
                  letterSpacing: stack.tight ? ".02em" : ".06em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  maxWidth: "100%",
                  textAlign: "center",
                  overflowWrap: "break-word",
                }}
              >
                {sublabel}
              </span>
            )}
          </span>
        )}
        {!showValue && centerLabel && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: `0 ${Math.round(size * 0.19)}px`,
              color: "var(--text-2)",
              font: "650 var(--fs-micro)/1.25 var(--font-ui)",
              letterSpacing: ".04em",
              textTransform: "uppercase",
              textAlign: "center",
              overflowWrap: "break-word",
              pointerEvents: "none",
            }}
          >
            {centerLabel}
          </span>
        )}
      </span>
      {label && (
        <span
          style={{
            font: "600 var(--fs-micro)/1.2 var(--font-ui)",
            letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "var(--muted)",
            textAlign: "center",
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
