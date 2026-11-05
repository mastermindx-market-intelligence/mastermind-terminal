import { describe, expect, it } from "vitest";
import { freezeLargeTradesExportFrame, layoutLargeTradesFooter, paintLargeTradesSnapshot, sameLargeTradesFrameOwner,
  snapshotRelativeRect, snapshotScale, wrapSnapshotText, type LargeTradesExportFrame } from "../largeTrades/snapshot";

const owner = { chart: {}, series: {}, bars: [], symbol: "AAPL", timeframe: "5s", replay: "" };
const fixture = (): LargeTradesExportFrame => ({
  symbol: "AAPL", timeframe: "5s", replay: "", sourceSha256: null, capturedAtMs: 1234,
  cssWidth: 390, cssHeight: 501, plot: { x: 61, y: 100, width: 290, height: 300 },
  footer: ["Synthetic fixture — shares"],
  markers: [{ id: "a", quantity: 1301, reports: 3, side: "buy", x: 110, y: 160, width: 64, height: 64,
    fill: "rgba(0,255,0,.36)", border: "#00ff00", borderWidth: 1, opacity: 1, ringColor: "#111", ringWidth: 1,
    label: { text: "1,301", rect: { x: 93, y: 153, width: 34, height: 14 }, fill: "#111", color: "#fff",
      font: "600 10px monospace", radius: 3 } }],
});

describe("large trades frozen export ownership", () => {
  it("admits only the same chart, series, exact visible bars, symbol, timeframe and replay", () => {
    expect(sameLargeTradesFrameOwner({ ...owner }, owner)).toBe(true);
    for (const change of [{ chart: {} }, { series: {} }, { bars: [] }, { symbol: "NVDA" },
      { timeframe: "1s" }, { replay: "intraday:123" }]) {
      expect(sameLargeTradesFrameOwner(owner, { ...owner, ...change })).toBe(false);
    }
    expect(sameLargeTradesFrameOwner(null, owner)).toBe(false);
    expect(sameLargeTradesFrameOwner(owner, { ...owner, chart: null })).toBe(false);
  });
  it("copies style, label, geometry and provenance before later changes", () => {
    const input = fixture(), output = freezeLargeTradesExportFrame(input);
    input.plot.x = 0; input.markers[0].quantity = 9999; input.markers[0].label!.text = "new";
    input.markers[0].label!.rect.x = 999; (input.footer as string[])[0] = "LIVE";
    expect(output).toMatchObject({ plot: { x: 61 }, markers: [{ quantity: 1301, reports: 3,
      label: { text: "1,301", rect: { x: 93 } } }], footer: ["Synthetic fixture — shares"] });
    expect(Object.isFrozen(output.markers[0].label!.rect)).toBe(true);
    expect(Object.isFrozen(output.footer)).toBe(true);
  });
  it("never recovers labels that are disabled or centers outside the owned plot", () => {
    const frame = fixture(); frame.markers[0].label = null;
    const other = { ...frame.markers[0], id: "offscreen", x: 60 };
    frame.markers = [...frame.markers, other];
    expect(freezeLargeTradesExportFrame(frame).markers).toHaveLength(1);
    expect(freezeLargeTradesExportFrame(frame).markers[0].label).toBeNull();
  });
});

describe("CSS coordinates to captured bitmap", () => {
  it("removes viewport offset and transforms relative to the exact capture root", () => {
    expect(snapshotRelativeRect({ x: 220, y: 340, width: 128, height: 128 },
      { x: 100, y: 200, width: 780, height: 1002 }, 390, 501))
      .toEqual({ x: 60, y: 70, width: 64, height: 64 });
  });
  it("derives independent output scales, without a devicePixelRatio assumption", () => {
    expect(snapshotScale(fixture(), { x: 0, y: 104, width: 781, height: 1000 }))
      .toEqual({ x: 781 / 390, y: 1000 / 501 });
  });
  it("rejects zero or nonfinite capture bounds", () => {
    expect(snapshotRelativeRect({ x: 0, y: 0, width: 64, height: 64 },
      { x: 0, y: 0, width: 0, height: 500 }, 390, 500)).toBeNull();
    expect(snapshotScale(fixture(), { x: 0, y: NaN, width: 780, height: 1000 })).toBeNull();
  });
  it("clips all marker ink before drawing and restores the caller's transform", () => {
    const calls: unknown[][] = [];
    const context = new Proxy({}, { set(target, key, value) { calls.push(["set", key, value]); return Reflect.set(target, key, value); },
      get(_target, key) { return (...args: unknown[]) => calls.push([key, ...args]); } }) as CanvasRenderingContext2D;
    paintLargeTradesSnapshot(context, freezeLargeTradesExportFrame(fixture()), { x: 0, y: 104, width: 781, height: 1000 });
    expect(calls[0]).toEqual(["save"]);
    expect(calls[1]).toEqual(["setTransform", 781 / 390, 0, 0, 1000 / 501, 0, 104]);
    expect(calls.find((call) => call[0] === "rect")).toEqual(["rect", 61, 100, 290, 300]);
    expect(calls.findIndex((call) => call[0] === "clip")).toBeLessThan(calls.findIndex((call) => call[0] === "ellipse"));
    expect(calls.at(-1)).toEqual(["restore"]);
  });
});

describe("complete provenance outside the chart body", () => {
  const attribution = "Data provided for free by IEX. By accessing or using IEX Historical Data, you agree to the IEX Historical Data Terms of Use.";
  const terms = "https://www.iex.io/legal/hist-data-terms";
  it("retains the complete IEX notice and terms at a narrow viewport", () => {
    for (const text of [attribution, terms]) {
      const lines = wrapSnapshotText(text, 366, (value) => value.length * 7);
      expect(lines.every((line) => line.length * 7 <= 366)).toBe(true);
      expect(lines.join(" ")).toBe(text);
    }
  });
  it("wraps long URLs and Chinese by code point without data loss", () => {
    const text = "https://www.iex.io/legal/hist-data-terms";
    expect(wrapSnapshotText(text, 40, (value) => value.length * 7).join("")).toBe(text);
    const chinese = "根据事后取得的档案重建，未证实原始决策时点的数据可得性。";
    expect(wrapSnapshotText(chinese, 50, (value) => Array.from(value).length * 10).join("")).toBe(chinese);
  });
  it("allocates all footer lines separately from native chart height", () => {
    const ctx = { save() {}, restore() {}, font: "", measureText: (value: string) => ({ width: value.length * 7 }) } as CanvasRenderingContext2D;
    const footer = layoutLargeTradesFooter(ctx, ["Historical · IEX · This venue only · shares", attribution, terms], 390, "sans-serif");
    expect(footer.cssHeight).toBe(footer.padding * 2 + footer.lines.length * footer.lineHeight);
    expect(footer.lines.join(" ")).toContain(attribution);
    expect(footer.lines.join(" ")).toContain(terms);
    expect(footer.cssHeight).toBeGreaterThan(60);
  });
});
