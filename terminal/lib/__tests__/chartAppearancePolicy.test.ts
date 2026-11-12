import { describe, expect, it } from "vitest";
import { resolveChartAppearance, chartLegendInk } from "../chartSettingsUi";
const tokens = { panel: "#ffffff", chartBackground: "#131722", axis: "#717a8e", grid: "rgba(255,255,255,.04)", line: "#e2e5eb", text: "#546174" };
describe("chart appearance is a render-only projection", () => {
  it("leaves Dark factory defaults and token colours unchanged", () => {
    const settings = Object.freeze({ backgroundTop: "", backgroundBottom: "" });
    expect(resolveChartAppearance(settings, false, tokens)).toEqual({ backgroundTop: "transparent", backgroundBottom: "transparent", frameBackground: "#131722", headerInk: undefined, axis: tokens.axis, grid: tokens.grid });
    expect(settings).toEqual({ backgroundTop: "", backgroundBottom: "" });
  });
  it("paints the default Light chart with existing material and legible axis tokens", () => {
    const settings = Object.freeze({ backgroundTop: "", backgroundBottom: "" });
    expect(resolveChartAppearance(settings, true, tokens)).toMatchObject({ backgroundTop: "transparent", backgroundBottom: "transparent", frameBackground: tokens.panel, axis: tokens.text, grid: tokens.line, headerInk: undefined });
  });
  it("retains nondefault saved background colours and chooses readable custom-frame ink", () => {
    const settings = Object.freeze({ backgroundTop: "#101521", backgroundBottom: "#222733" });
    const before = JSON.stringify(settings);
    expect(resolveChartAppearance(settings, true, tokens)).toMatchObject({ backgroundTop: settings.backgroundTop, backgroundBottom: settings.backgroundBottom, headerInk: "#fff", axis: "#fff", grid: tokens.grid });
    expect(JSON.stringify(settings)).toBe(before);
  });
  it("composes a translucent saved colour over the actual Light host material", () => {
    expect(resolveChartAppearance({ backgroundTop: "rgba(0, 0, 0, 0.5)" }, true, tokens)).toMatchObject({ backgroundTop: "rgba(0, 0, 0, 0.5)", frameBackground: "rgb(128, 128, 128)", headerInk: "#000" });
  });
  it.each([0, .378, .54])("keeps legend ink readable at existing row alpha %s over a custom dark frame", alpha => {
    expect(chartLegendInk("#101521", `rgba(6,9,14,${alpha})`)).toBe("#fff");
  });
  it("does not mistake medium frame ink for the ink needed over its darker row", () => {
    expect(resolveChartAppearance({ backgroundTop: "#777777" }, true, tokens).headerInk).toBe("#000");
    expect(chartLegendInk("#777777", "rgba(6,9,14,0.54)")).toBe("#fff");
  });
});
