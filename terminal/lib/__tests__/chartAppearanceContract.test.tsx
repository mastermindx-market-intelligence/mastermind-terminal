// @vitest-environment jsdom
// Execute the exact private ChartPanel seams without exporting test-only app APIs
// or mounting unrelated chart/data/Copilot operations. AST selection is a harness;
// assertions concern real hook events/cache and actual style options, not source text.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

const text = fs.readFileSync(path.resolve("components/ChartPanel.tsx"), "utf8");
const source = ts.createSourceFile("ChartPanel.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map<string, string>();
const effects: ts.CallExpression[] = [];
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ["css", "readTokens"].includes(node.name.text)) {
    declarations.set(node.name.text, "const " + node.getText(source) + ";");
  }
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect") effects.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
const readTokens = new Function("getComputedStyle", "document", compile(declarations.get("css")! + declarations.get("readTokens")!) + ";return readTokens;")(getComputedStyle, document) as () => Record<string, string>;
const selected = effects.filter((e) => {
  const body = e.arguments[0]?.getText(source) || "";
  return body.includes("mm:updown") && (body.includes("setCsNonce") || body.includes("suiteColorsRef"));
});
const useSeams = new Function("useEffect", "window", "setCsNonce", "suiteColorsRef", compile(selected.map((e) => e.getText(source) + ";").join("\n"))) as (
  effect: typeof useEffect, win: Window, setEpoch: React.Dispatch<React.SetStateAction<number>>, cache: { current: unknown },
) => void;
const styleEffect = effects.find((e) => e.arguments[1]?.getText(source) === "[csNonce]" && e.arguments[0].getText(source).includes("chart.applyOptions"))!;
const styleCode = compile("const style = " + styleEffect.arguments[0].getText(source) + ";") + "return style();";
const cache: { current: unknown } = { current: null };
let unmount: (() => Promise<void>) | undefined;
afterEach(async () => { await unmount?.(); unmount = undefined; document.documentElement.removeAttribute("style"); });

function Harness() {
  const [epoch, setEpoch] = useState(0);
  useSeams(useEffect, window, setEpoch, cache);
  return <output>{epoch}</output>;
}
async function mount() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
  unmount = async () => { await act(async () => { root.unmount(); }); host.remove(); };
  return host;
}
function tokens(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) document.documentElement.style.setProperty(key, value);
}

describe("actual ChartPanel palette seam", () => {
  it("a real theme event advances style epoch and drops cached suite colors", async () => {
    const host = await mount(); cache.current = { up: "#old" };
    await act(async () => { window.dispatchEvent(new CustomEvent("mm:theme")); });
    expect(host.textContent).toBe("1"); expect(cache.current).toBeNull();
  });
  it("retains up/down refresh and removes both event handlers on cleanup", async () => {
    const host = await mount(); cache.current = { up: "#old" };
    await act(async () => { window.dispatchEvent(new CustomEvent("mm:updown")); });
    expect(host.textContent).toBe("1"); expect(cache.current).toBeNull();
    await unmount!(); unmount = undefined;
    cache.current = { retained: true };
    window.dispatchEvent(new CustomEvent("mm:theme"));
    window.dispatchEvent(new CustomEvent("mm:updown"));
    expect(cache.current).toEqual({ retained: true });
  });
  it("uses the readable light crosshair label backdrop and preserves dark panel fallback", () => {
    tokens({ "--panel-3": "#e3e7ee", "--chart-label-bg": "#2a2e38" });
    expect(readTokens().p3).toBe("#2a2e38");
    // LWC label text remains white; independent WCAG luminance for the mapped backdrop.
    const channels = [42, 46, 56].map((n) => n / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    const luminance = .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    expect(1.05 / (luminance + .05)).toBeGreaterThan(4.5);
    document.documentElement.style.removeProperty("--chart-label-bg");
    tokens({ "--panel-3": "#1a1d25" }); expect(readTokens().p3).toBe("#1a1d25");
  });
  it.each([["west", "#1f9a55", "#cf4040"], ["east", "#cf4040", "#1f9a55"]] as const)(
    "%s token snapshot follows actual directional values", (direction, up, down) => {
      document.documentElement.dataset.updown = direction;
      tokens({ "--up": up, "--down": down, "--buy": "#1f9a55", "--sell": "#cf4040" });
      expect(readTokens()).toMatchObject({ up, down, buy: "#1f9a55", sell: "#cf4040" });
    },
  );
  it("the incumbent style consumer preserves custom overrides and existing indicator recoloring", () => {
    tokens({ "--up": "#1f9a55", "--down": "#cf4040", "--chart-axis-text": "#4a5160", "--chart-label-bg": "#2a2e38" });
    const chartOptions: Record<string, unknown>[] = [], priceOptions: Record<string, unknown>[] = [];
    let rebuilds = 0, renders = 0;
    const bindings: Record<string, unknown> = {
      chartRef: { current: { applyOptions: (options: Record<string, unknown>) => chartOptions.push(options) } },
      priceSeriesRef: { current: { applyOptions: (options: Record<string, unknown>) => priceOptions.push(options) } },
      tokensRef: { current: null }, readTokens,
      chartSettingsRef: { current: { scaleTextColor: "#123456", candleUpColor: "#abcdef", candleDownColor: "#fedcba", paneSeparatorColor: "#445566" } },
      css: (key: string) => getComputedStyle(document.documentElement).getPropertyValue(key).trim(),
      axisLineColor: (value: string) => value, chartType: "candles", isValueChartType: () => false,
      indSeriesRef: { current: new Map() }, barsRef: { current: [{}] }, csNonce: 1,
      indicatorsRef: { current: new Set(["macd"]) }, rebuildIndicators: () => { rebuilds++; },
      renderSignalsRef: { current: () => { renders++; } }, renderRef: { current: () => { renders++; } },
    };
    new Function(...Object.keys(bindings), styleCode)(...Object.values(bindings));
    expect(chartOptions[0]).toMatchObject({ layout: { textColor: "#123456", panes: { separatorColor: "#445566" } }, crosshair: { vertLine: { labelBackgroundColor: "#2a2e38" }, horzLine: { labelBackgroundColor: "#2a2e38" } } });
    expect(priceOptions[0]).toMatchObject({ upColor: "#abcdef", downColor: "#fedcba" });
    expect(rebuilds).toBe(1); expect(renders).toBe(2);
  });
});
