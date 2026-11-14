import { describe, expect, it } from "vitest";
import { fadedRotationSegments, rotationTrailArrow, type RotationTrailSample } from "../rotationTrajectoryVisual";

const p = (date: string, x: number, y: number): RotationTrailSample => ({ date, x, y });

describe("age-faded source-bound rotation trajectory geometry", () => {
  const run = [p("2026-11-09", 15, 65), p("2026-11-10", 30, 55), p("2026-11-11", 42, 50), p("2026-11-12", 60, 38)];

  it("maps every real adjacent observation into plot pixels with progressively brighter and thicker strokes", () => {
    const segments = fadedRotationSegments([run], 600, 560);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ x1: 90, y1: 364, x2: 180, y2: 308, from: "2026-11-09", to: "2026-11-10" });
    expect(segments[2].x2).toBe(360);
    expect(segments[2].y2).toBeCloseTo(212.8);
    expect(segments.map(segment => segment.opacity)).toEqual([...segments.map(segment => segment.opacity)].sort((a, b) => a - b));
    expect(segments[2].strokeWidth).toBeGreaterThan(segments[0].strokeWidth);
    expect(segments[2].newest).toBe(true);
    expect(segments[0].newest).toBe(false);
  });

  it("renders ambient cohort paths much dimmer than the selected trajectory", () => {
    const selected = fadedRotationSegments([run], 600, 560, "selected");
    const ambient = fadedRotationSegments([run], 600, 560, "ambient");
    expect(ambient).toHaveLength(selected.length);
    expect(ambient.every((segment, index) => segment.opacity < selected[index].opacity)).toBe(true);
    expect(ambient.every((segment, index) => segment.strokeWidth < selected[index].strokeWidth)).toBe(true);
  });

  it("never connects across missing-week runs or interpolates a missing coordinate", () => {
    const runs = [[run[0], run[1]], [run[2], run[3]]];
    const segments = fadedRotationSegments(runs, 600, 560);
    expect(segments.map(segment => [segment.from, segment.to])).toEqual([
      ["2026-11-09", "2026-11-10"], ["2026-11-11", "2026-11-12"],
    ]);
    const broken = fadedRotationSegments([[run[0], p("2026-11-10", Number.NaN, 45), run[2], run[3]]], 600, 560);
    expect(broken).toHaveLength(1);
    expect(broken[0].from).toBe("2026-11-11");
  });

  it("rejects out-of-domain/invalid/unordered points without substituting a zero", () => {
    const invalid = fadedRotationSegments([[
      p("2026-11-10", 110, 20), p("2026-11-11", 30, 30), p("2026-11-09", 40, 40),
      p("invalid", 50, 50), p("2026-11-12", 60, 60),
    ]], 600, 560);
    expect(invalid).toHaveLength(0);
    expect(fadedRotationSegments([run], 0, 560)).toHaveLength(0);
    expect(fadedRotationSegments([run], 600, Number.POSITIVE_INFINITY)).toHaveLength(0);
  });

  it("omits near-stationary segments and does not manufacture a movement arrow", () => {
    const flat = fadedRotationSegments([[p("2026-11-10", 40, 40), p("2026-11-11", 40, 40)]], 600, 560);
    expect(flat).toHaveLength(0);
    const small = fadedRotationSegments([[p("2026-11-10", 40, 40), p("2026-11-11", 41, 41)]], 600, 560);
    expect(small).toHaveLength(1);
    expect(rotationTrailArrow(small)).toBeNull();
    expect(rotationTrailArrow(fadedRotationSegments([run], 600, 560))).toMatch(/^[-.\d]+,[-.\d]+ [-.\d]+,[-.\d]+ [-.\d]+,[-.\d]+$/);
  });

  it("bounds the drawable segment count on unexpectedly dense collections", () => {
    const long = Array.from({ length: 900 }, (_, index) => p(
      new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10),
      10 + (index % 80), 12 + (index % 70),
    ));
    expect(fadedRotationSegments([long], 600, 560).length).toBeLessThanOrEqual(512);
  });
});
