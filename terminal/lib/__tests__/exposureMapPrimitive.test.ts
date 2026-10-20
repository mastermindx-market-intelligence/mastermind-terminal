import { describe, it, expect, vi } from "vitest";
import { createExposureMapPrimitive } from "../exposureMapPrimitive";
import { exposureNodes } from "../marketStructure";
import type { EngineProjection } from "../chart-engine/primitive";

const project = (yOfPrice: (price: number) => number, dpr = 1): EngineProjection => ({
  generation: 1, dpr, widthPx: 500, heightPx: 400, yOfPrice, priceOfY: y => y,
  xOfLogical: i => i, logicalOfX: x => x, timeToX: () => null, xToTime: () => null,
});
const nodes = exposureNodes([{ strike: 100, netMn: 10 }, { strike: 120, netMn: -20 }, { strike: 130, netMn: null }], 110).nodes;
const draw = { nodes, selected: null, mode: "net" as const, color: "blue", selectedColor: "orange" };
function context() {
  const rects: number[][] = [];
  const ctx = { save() {}, beginPath() {}, rect() {}, clip() {}, restore() {}, fillText() {},
    fillRect: (...r: number[]) => rects.push(r) } as unknown as CanvasRenderingContext2D;
  return { ctx, rects };
}
describe("exposure primitive uses the chart host projection", () => {
  it("follows log/percent projection and clips without changing the full-scope normalization", () => {
    const p = createExposureMapPrimitive(draw); const { ctx, rects } = context();
    p.paint!(ctx, project(price => price === 100 ? 200 : -100));
    expect(rects).toEqual([[422, 197, 70, 6]]); // offscreen 20 remains normalization maximum
    rects.length = 0;
    p.paint!(ctx, project(price => 300 - Math.log(price) * 10, 2));
    expect(rects[0][1]).toBeCloseTo(300 - Math.log(100) * 10 - 3);
    expect(rects[0][2]).toBe(70); expect(rects[1][2]).toBe(140);
    expect(nodes.map(n => n.netMn)).toEqual([10, -20, null]);
  });
  it("selects valid marks and removes hit/update ownership on detach", () => {
    const p = createExposureMapPrimitive(draw), requestUpdate = vi.fn();
    p.attached({ requestUpdate, seriesId: "price", paneIndex: 0 }); p.update(project(price => price));
    expect(p.hitTest!(480, 120)?.data?.strike).toBe(120);
    expect(p.hitTest!(200, 120)).toBeNull();
    p.set({ ...draw, nodes: [] }); expect(p.hitTest!(480, 120)).toBeNull();
    p.detached(); p.set(draw);
    expect(requestUpdate).toHaveBeenCalledTimes(2); expect(p.hitTest!(480, 100)).toBeNull();
  });
});
