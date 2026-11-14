"use client";

import { type CSSProperties } from "react";
import { fadedRotationSegments, rotationTrailArrow, type RotationTrailSample } from "@/lib/rotationTrajectoryVisual";
import styles from "./SectorRotationMap.module.css";

export type RotationTrailDisplay = "off" | "selected" | "all";
export interface RotationProjectedTrail {
  id: string;
  color: string | null;
  runs: RotationTrailSample[][];
  clipped: boolean;
}
interface Props {
  trails: readonly RotationProjectedTrail[];
  selected: string;
  hovered: string | null;
  display: RotationTrailDisplay;
  kind: "daily" | "weekly";
  width: number;
  height: number;
  selectedDate?: string | null;
}

/**
 * A single non-interactive SVG beneath the real point buttons. Faint tracks
 * contextualize the cohort; the selected/hovered track takes visual priority.
 * History belongs to its native/weekly owner, never to the dated legacy fallback.
 */
export default function SectorRotationTrails({ trails, selected, hovered, display, kind, width, height, selectedDate }: Props) {
  if (display === "off" || !trails.length) return null;
  const primary = hovered && trails.some(trail => trail.id === hovered) ? hovered : selected;
  const background = display === "all" ? trails.slice(0, 24) : [];
  const focus = trails.find(trail => trail.id === primary);
  const visible = focus && !background.some(trail => trail.id === primary) ? [...background, focus] : background;
  const drawn = display === "selected" ? (focus ? [focus] : []) : visible;
  if (!drawn.length || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  return <svg className={styles.historyTrail} data-testid={kind === "daily" ? "rotation-history-trail" : "rotation-trend-trail"}
    data-trail-mode={display} data-selected-date={selectedDate || undefined}
    data-clipped={focus?.clipped ? "true" : "false"}
    viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
    {drawn.map(trail => {
      const active = trail.id === primary;
      const color = trail.color || "var(--brand)";
      const segments = fadedRotationSegments(trail.runs, width, height, active ? "selected" : "ambient");
      const latestRun = trail.runs.at(-1);
      const latest = latestRun?.at(-1);
      const arrow = active ? rotationTrailArrow(segments) : null;
      const style = { "--rotation-trail-accent": color } as CSSProperties;
      return <g key={trail.id} data-rotation-trail={trail.id}
        data-trail-emphasis={active ? "selected" : "ambient"} style={style}>
        {segments.map((part, index) => <line key={`${part.from}-${part.to}-${index}`}
          data-trail-from={part.from} data-trail-to={part.to} data-trail-age={index + 1}
          className={active ? styles.trajectoryLineActive : styles.trajectoryLineAmbient}
          x1={part.x1} y1={part.y1} x2={part.x2} y2={part.y2}
          stroke={color} strokeOpacity={part.opacity} strokeWidth={part.strokeWidth} strokeLinecap="round" />)}
        {active && arrow && <polygon className={styles.trajectoryArrow} points={arrow} fill={color} />}
        {active && latest && <circle className={styles.historyTrailPoint}
          cx={(latest.x * width) / 100} cy={(latest.y * height) / 100} r="4"
          data-trail-end={latest.date} />}
      </g>;
    })}
  </svg>;
}
