// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { reviewFramesFromColumns } from "@/components/exposure-map/useReplayColumns";
import type { ReplayColumn, ReplayFrame } from "@/lib/exposureReplayFrames";

const frame = (over: Partial<ReplayFrame>): ReplayColumn => ({
  kind: "frame",
  frame: {
    session: "2026-10-15", kind: "observed", current: false, spot: 601.2,
    values: new Map<number, number | null>([[600, -520], [605, 300], [610, null]]),
    dominant: 600, runnerUp: 605, runnerUpRatio: 0.58, contested: false,
    coverage: { expected: 12, qualified: 12 }, clocks: null, sourceRef: "sha:a", ...over,
  },
});

describe("reviewFramesFromColumns", () => {
  it("maps stored frames to review inputs at their stored dominant level", () => {
    const frames = reviewFramesFromColumns([frame({})]);
    expect(frames).toEqual([{ session: "2026-10-15", kind: "observed", level: 600, levelNetMn: -520 }]);
  });

  it("drops gap columns instead of inventing a zero-touch row", () => {
    const columns: ReplayColumn[] = [
      frame({ session: "2026-10-14" }),
      { kind: "gap", gap: { session: "2026-10-15", reason: "unavailable" } },
      frame({ session: "2026-10-16", kind: "reconstructed" }),
    ];
    expect(reviewFramesFromColumns(columns).map((f) => f.session)).toEqual(["2026-10-14", "2026-10-16"]);
    expect(reviewFramesFromColumns(columns)[1].kind).toBe("reconstructed");
  });

  it("labels the live book as current and keeps a frame without a dominant at a null level", () => {
    const frames = reviewFramesFromColumns([
      frame({ session: "2026-10-16", current: true, dominant: 605 }),
      frame({ session: "2026-10-17", current: true, dominant: null, runnerUp: null }),
    ]);
    expect(frames[0]).toEqual({ session: "2026-10-16", kind: "current", level: 605, levelNetMn: 300 });
    expect(frames[1]).toEqual({ session: "2026-10-17", kind: "current", level: null, levelNetMn: null });
  });

  it("reports a null net when the dominant strike's value is unknown", () => {
    expect(reviewFramesFromColumns([frame({ dominant: 610 })])[0].levelNetMn).toBeNull();
    expect(reviewFramesFromColumns(null)).toEqual([]);
  });
});
