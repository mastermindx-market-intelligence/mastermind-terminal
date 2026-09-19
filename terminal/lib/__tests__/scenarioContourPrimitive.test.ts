import { describe, expect, it } from "vitest";
import type { Time } from "lightweight-charts";
import {
  projectScenarioContourSegments,
  type ScenarioContourProjection,
} from "@/lib/scenarioContourPrimitive";
import type { ScenarioContourSegment } from "@/lib/surfaceScenarioOverlay";

const T0 = 1000 as unknown as Time;
const T1 = 2000 as unknown as Time;
const T2 = 3000 as unknown as Time;

const SEGMENTS: ScenarioContourSegment[] = [
  {
    continuity: "adjacent_horizon_only",
    from: { time: T0, price: 95, horizon_minutes: 0 },
    to: { time: T1, price: 100, horizon_minutes: 30 },
  },
  {
    continuity: "adjacent_horizon_only",
    from: { time: T1, price: 100, horizon_minutes: 30 },
    to: { time: T2, price: 105, horizon_minutes: 60 },
  },
];

const timeToX = (time: Time): number | null => {
  const value = time as unknown as number;
  return value === 1000 ? 80 : value === 2000 ? 160 : value === 3000 ? 260 : null;
};const priceToY = (price: number): number | null => 300 - price * 2;

describe("scenarioContourPrimitive projection", () => {
  it("clips every contour to NOW and the visible pane", () => {
    const projected = projectScenarioContourSegments(
      SEGMENTS,
      T0,
      timeToX,
      priceToY,
      { width: 220, height: 140 },
    );

    expect(projected).toEqual<ScenarioContourProjection[]>([
      {
        continuity: "adjacent_horizon_only",
        from: { x: 80, y: 110 },
        to: { x: 160, y: 100 },
      },
      {
        continuity: "adjacent_horizon_only",
        from: { x: 160, y: 100 },
        to: { x: 220, y: 94 },
      },
    ]);
    expect(projected.every((segment) => segment.from.x >= 80 && segment.to.x >= 80)).toBe(true);
    expect(projected.every((segment) => segment.from.x <= 220 && segment.to.x <= 220)).toBe(true);
  });

  it("clips a segment that enters the visible price range instead of dropping it", () => {
    const crossing: ScenarioContourSegment[] = [{
      continuity: "adjacent_horizon_only",
      from: { time: T0, price: 50, horizon_minutes: 0 },
      to: { time: T1, price: 100, horizon_minutes: 30 },
    }];

    const projected = projectScenarioContourSegments(
      crossing,
      T0,
      timeToX,
      priceToY,
      { width: 220, height: 140 },
    );

    expect(projected).toHaveLength(1);
    expect(projected[0].from.y).toBe(140);
    expect(projected[0].from.x).toBeGreaterThan(80);
    expect(projected[0].to).toEqual({ x: 160, y: 100 });
  });

  it("fails closed per segment when chart coordinates or horizon direction are invalid", () => {
    const invalid: ScenarioContourSegment[] = [
      SEGMENTS[0],
      {
        continuity: "adjacent_horizon_only",
        from: { time: (9999 as unknown as Time), price: 100, horizon_minutes: 30 },
        to: { time: T2, price: 101, horizon_minutes: 60 },
      },
      {
        continuity: "adjacent_horizon_only",
        from: { time: T1, price: 100, horizon_minutes: 30 },
        to: { time: T2, price: 101, horizon_minutes: 30 },
      },
    ];

    const projected = projectScenarioContourSegments(
      invalid,
      T0,
      timeToX,
      (price) => price === 101 ? null : priceToY(price),
      { width: 220, height: 140 },
    );

    expect(projected).toHaveLength(1);
    expect(projected[0]).toEqual({
      continuity: "adjacent_horizon_only",
      from: { x: 80, y: 110 },
      to: { x: 160, y: 100 },
    });
  });
});
