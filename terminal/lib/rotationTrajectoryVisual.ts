/**
 * Presentation-only trajectories over already-qualified rotation observations.
 * The axis owner supplies chart percentages and ordered dates. This code never
 * invents a point, closes a missing observation, alters chart scales, or scores sectors.
 */
export interface RotationTrailSample {
  date: string;
  x: number;
  y: number;
}
export interface RotationTrailSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  from: string;
  to: string;
  opacity: number;
  strokeWidth: number;
  newest: boolean;
}
export type RotationTrailEmphasis = "selected" | "ambient";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const finitePoint = (point: RotationTrailSample, width: number, height: number) =>
  DAY.test(point.date) && Number.isFinite(point.x) && Number.isFinite(point.y)
  && point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100
  && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

/**
 * Every segment joins two adjacent, source-supplied observations inside one run.
 * A missing week splits runs upstream; a malformed point breaks both adjacent
 * edges instead of being silently bridged. Oldest = whisper; newest = strongest.
 */
export function fadedRotationSegments(
  runs: readonly (readonly RotationTrailSample[])[],
  width: number,
  height: number,
  emphasis: RotationTrailEmphasis = "selected",
): RotationTrailSegment[] {
  const pairs: Omit<RotationTrailSegment, "opacity" | "strokeWidth" | "newest">[] = [];
  for (const run of runs) {
    for (let i = 1; i < run.length && pairs.length < 512; i += 1) {
      const from = run[i - 1], to = run[i];
      if (!finitePoint(from, width, height) || !finitePoint(to, width, height) || from.date >= to.date) continue;
      const x1 = (from.x * width) / 100, y1 = (from.y * height) / 100;
      const x2 = (to.x * width) / 100, y2 = (to.y * height) / 100;
      if (Math.hypot(x2 - x1, y2 - y1) < 0.35) continue;
      pairs.push({ x1, y1, x2, y2, from: from.date, to: to.date });
    }
  }
  return pairs.map((pair, index) => {
    const recency = (index + 1) / pairs.length;
    const fade = Math.pow(recency, 1.7);
    return {
      ...pair,
      opacity: Number((emphasis === "selected" ? 0.10 + 0.78 * fade : 0.018 + 0.16 * fade).toFixed(3)),
      strokeWidth: Number((emphasis === "selected" ? 1.1 + 2.0 * fade : 0.75 + 0.85 * fade).toFixed(2)),
      newest: index === pairs.length - 1,
    };
  });
}

/** Place one small arrow before the end of a sufficiently long final movement. */
export function rotationTrailArrow(segments: readonly RotationTrailSegment[]): string | null {
  const last = segments.at(-1);
  if (!last) return null;
  const dx = last.x2 - last.x1, dy = last.y2 - last.y1;
  const length = Math.hypot(dx, dy);
  if (length < 23) return null; // a short move cannot carry a legible arrow beside its dot
  const ux = dx / length, uy = dy / length;
  const tipX = last.x2 - ux * 15, tipY = last.y2 - uy * 15;
  const baseX = tipX - ux * 8, baseY = tipY - uy * 8;
  const sideX = -uy * 3.6, sideY = ux * 3.6;
  const coord = (a: number, b: number) => `${a.toFixed(1)},${b.toFixed(1)}`;
  return [coord(tipX, tipY), coord(baseX + sideX, baseY + sideY), coord(baseX - sideX, baseY - sideY)].join(" ");
}
