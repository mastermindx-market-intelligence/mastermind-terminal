import { describe, expect, it } from "vitest";
import {
  cloneDrawing,
  constrainScreenAngle,
  DRAWING_HANDLE_HIT_RADIUS_CSS,
  hitTestDrawingHandles,
  translateDrawingAnchors,
} from "@/lib/drawing-engine/interaction";
import type { Drawing } from "@/lib/drawings";

const drawing: Drawing = {
  id: "source",
  kind: "trendline",
  points: [{ t: "2", p: 10 }, { t: "4", p: 12 }],
  locked: true,
  meta: { nested: { value: 1 } },
};

describe("professional drawing interactions", () => {
  it("snaps to the nearest 45 degree screen-space angle", () => {
    const horizontal = constrainScreenAngle({ x: 10, y: 10 }, { x: 48, y: 15 });
    expect(horizontal.y).toBeCloseTo(10, 8);
    const diagonal = constrainScreenAngle({ x: 0, y: 0 }, { x: 19, y: 23 });
    expect(diagonal.x).toBeCloseTo(diagonal.y, 8);
  });

  it("moves all anchors rigidly and clamps one shared bar delta", () => {
    const right = translateDrawingAnchors(drawing, ["1", "2", "3", "4", "5"], 20, 1.234, 2);
    expect(right).toEqual([{ t: "3", p: 11.23 }, { t: "5", p: 13.23 }]);
    const left = translateDrawingAnchors(drawing, ["1", "2", "3", "4", "5"], -20, 0, 2);
    expect(left.map((point) => point.t)).toEqual(["1", "3"]);
  });

  it("hit-tests drawing handles in CSS pixels", () => {
    const handles = [{ drawingId: "a", handleIndex: 0, cx: 50, cy: 60 }];
    expect(hitTestDrawingHandles(58, 60, handles, DRAWING_HANDLE_HIT_RADIUS_CSS, 2)?.drawingId).toBe("a");
    expect(hitTestDrawingHandles(80, 60, handles, DRAWING_HANDLE_HIT_RADIUS_CSS, 2)).toBeNull();
  });

  it("clones nested state and always unlocks the copy", () => {
    const copy = cloneDrawing(drawing, "copy");
    expect(copy).toMatchObject({ id: "copy", locked: false });
    expect(copy.points).not.toBe(drawing.points);
    expect(copy.meta).not.toBe(drawing.meta);
  });
});
