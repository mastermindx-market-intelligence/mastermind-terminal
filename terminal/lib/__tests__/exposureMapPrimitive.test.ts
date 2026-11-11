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
type RecordedText = { text: string; x: number; y: number; font: string; alpha: number };
function context() {
  const rects: number[][] = [];
  const texts: RecordedText[] = [];
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const fonts: string[] = [];
  const alphas: number[] = [];
  const dashes: number[][] = [];
  let from: [number, number] | null = null;
  const ctx = { save() {}, beginPath() {}, rect() {}, clip() {}, restore() {}, strokeRect() {},
    setLineDash: (dash: number[]) => dashes.push(dash),
    fillRect: (...r: number[]) => rects.push(r),
    moveTo(x: number, y: number) { from = [x, y]; },
    lineTo(x: number, y: number) { if (from) lines.push({ x1: from[0], y1: from[1], x2: x, y2: y }); },
    stroke() { from = null; },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, font: fonts[fonts.length - 1] ?? "", alpha: alphas[alphas.length - 1] ?? 1 });
    } } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(ctx, "font", { get: () => fonts[fonts.length - 1] ?? "", set: (value: string) => fonts.push(value) });
  Object.defineProperty(ctx, "globalAlpha", { get: () => alphas[alphas.length - 1] ?? 1, set: (value: number) => alphas.push(value) });
  return { ctx, rects, texts, lines, dashes };
}
describe("exposure primitive uses the chart host projection", () => {
  it("follows log/percent projection and clips without changing the full-scope normalization", () => {
    const p = createExposureMapPrimitive(draw); const { ctx, rects } = context();
    p.paint!(ctx, project(price => price === 100 ? 200 : -100));
    expect(rects[0][2]).toBe(80); // offscreen 20 remains normalization maximum
    rects.length = 0;
    p.paint!(ctx, project(price => 300 - Math.log(price) * 10, 2));
    expect(rects[0][1]).toBeCloseTo(300 - Math.log(120) * 10 - 4);
    expect(rects[0][2]).toBe(160); expect(rects[2][2]).toBe(80);
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

const clustered = [
  { label: "SMA·5D 100.3", price: 100.3 },
  { label: "EMA·21D 100.36", price: 100.36 },
  { label: "SMA·55D 100.18", price: 100.18 },
  { label: "SMA·34·5m 99.68", price: 99.68 },
];
// Average names are painted in the left lane at x=8; strike labels keep their right-side lane.
const leftLane = (texts: RecordedText[]) => texts.filter((item) => item.x === 8);

describe("current-snapshot average labels stay readable when true prices cluster", () => {
  it("keeps every clustered guide at its true price while packing legible non-overlapping name rows", () => {
    const averages = clustered.map((average) => ({ ...average }));
    const p = createExposureMapPrimitive({ ...draw, averages });
    const { ctx, texts, lines, dashes } = context();
    p.paint!(ctx, project(() => 200));
    // The incumbent strike labels survive unchanged (equal projections collapse them into one row).
    expect(texts.filter((item) => item.x !== 8).map((item) => item.text)).toEqual(["120  -20.0M"]);
    const lane = leftLane(texts);
    expect(lane.map((item) => item.text)).toEqual(clustered.map((average) => average.label));
    const rows = lane.map((item) => ({ top: item.y - 8.5, bottom: item.y + 8.5 })).sort((a, b) => a.top - b.top);
    for (const row of rows) {
      expect(row.top).toBeGreaterThanOrEqual(44); // current-bar readout clearance
      expect(row.bottom).toBeLessThanOrEqual(400); // measured pane bounds
    }
    for (let index = 1; index < rows.length; index++) expect(rows[index].top).toBeGreaterThanOrEqual(rows[index - 1].bottom);
    for (const item of lane) {
      expect(item.font).toBe("11px system-ui"); // legible at full size...
      expect(item.alpha).toBe(1); // ...and full ink opacity
    }
    const guides = lines.filter((line) => line.x1 === 0);
    expect(guides.map((line) => line.y1)).toEqual([200, 200, 200, 200]); // unchanged true y
    expect(guides.every((line) => line.y1 === line.y2)).toBe(true);
    expect(dashes).toContainEqual([2, 5]); // the original dotted guide style
    expect(averages).toEqual(clustered); // painter must not reorder or rewrite its input
  });

  it("draws a small leader back to the true price only for names the layout had to move", () => {
    const p = createExposureMapPrimitive({ ...draw, averages: clustered });
    const { ctx, texts, lines } = context();
    p.paint!(ctx, project(() => 200));
    const lane = leftLane(texts);
    expect(lane).toHaveLength(4);
    expect(lane.filter((item) => Math.abs(item.y - 200) <= 1)).toHaveLength(1); // one row stays centred
    const leaders = lines.filter((line) => line.x1 === 6 && line.x2 === 6);
    expect(leaders).toHaveLength(3);
    for (const leader of leaders) expect(leader.y2).toBe(200); // each leader ends at its true price
  });

  it("keeps near-edge names inside the pane and stays honest about unavailable prices", () => {
    const averages = [
      { label: "near top", price: 46 },
      { label: "near bottom", price: 389 },
      { label: "offscreen", price: 395 },
      { label: "broken", price: Number.NaN },
    ];
    const p = createExposureMapPrimitive({ ...draw, averages });
    const { ctx, texts, lines } = context();
    p.paint!(ctx, project((price) => price));
    const lane = leftLane(texts);
    expect(lane.map((item) => item.text)).toEqual(["near top", "near bottom"]);
    expect(lane[0].y - 8.5).toBeGreaterThanOrEqual(44); // docked below the readout band, not on it
    expect(lane[1].y + 8.5).toBeLessThanOrEqual(400); // clamped inside the pane
    expect(lines.filter((line) => line.x1 === 0).map((line) => line.y1).sort((a, b) => a - b)).toEqual([46, 389]);
    const leaders = lines.filter((line) => line.x1 === 6 && line.x2 === 6);
    expect(leaders).toHaveLength(1); // the bottom name stays centred, only the docked one leads
    expect(leaders[0].y2).toBe(46);
    expect(averages.map((average) => average.label)).toEqual(["near top", "near bottom", "offscreen", "broken"]);
  });

  it("centres a solitary name on its true price without a leader", () => {
    const p = createExposureMapPrimitive({ ...draw, averages: [{ label: "SMA·5D 100.3", price: 100.3 }] });
    const { ctx, texts, lines } = context();
    p.paint!(ctx, project((price) => 500 - price * 3)); // 100.3 -> 199.1
    const lane = leftLane(texts);
    expect(lane).toHaveLength(1);
    expect(Math.abs(lane[0].y - 199.1)).toBeLessThanOrEqual(1);
    expect(lines.filter((line) => line.x1 === 6 && line.x2 === 6)).toHaveLength(0);
    expect(lines.filter((line) => line.x1 === 0)).toHaveLength(1);
  });

  it("leaves gamma strike hits unchanged while average names are present", () => {
    const p = createExposureMapPrimitive({ ...draw, averages: clustered });
    p.attached({ requestUpdate: vi.fn(), seriesId: "price", paneIndex: 0 });
    p.update(project((price) => price));
    expect(p.hitTest!(480, 120)?.data?.strike).toBe(120);
    expect(p.hitTest!(200, 120)).toBeNull();
  });
});
