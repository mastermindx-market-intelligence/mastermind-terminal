import { describe, it, expect } from "vitest";
import type { EngineCapabilities } from "../chart-engine/options";
import { normalizeEngineOptions } from "../chart-engine/options";
import { LWC_CAPABILITIES } from "../chart-engine/lwc";

const FULL: EngineCapabilities = {
  seriesKinds: ["candles", "bars", "line", "area", "histogram", "baseline"],
  priceScaleModes: ["normal", "log", "percent", "indexed100"],
  watermark: true,
  markers: true,
  primitives: true,
  screenshot: true,
  kineticScroll: true,
};

const NO_KINETIC: EngineCapabilities = { ...FULL, kineticScroll: false };

describe("normalizeEngineOptions — accept", () => {
  it("accepts the modeled option groups and returns a new object", () => {
    const input = {
      width: 800,
      height: 600,
      autoSize: true,
      layout: { fontSize: 12, background: { color: "#000" } },
      grid: { vertLines: { color: "#111" } },
      crosshair: { mode: 1 },
      timeScale: { rightOffset: 12 },
      rightPriceScale: { visible: true },
      leftPriceScale: { visible: false },
      localization: { locale: "en-GB" },
      handleScroll: true,
      handleScale: { mouseWheel: true },
      kineticScroll: { touch: true },
    };
    const result = normalizeEngineOptions(input, FULL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options).toEqual(input);
    expect(result.options).not.toBe(input);
    expect(result.options.layout).not.toBe(input.layout);
  });

  it("accepts an empty bag", () => {
    const result = normalizeEngineOptions({}, FULL);
    expect(result).toEqual({ ok: true, options: {} });
  });
});

describe("normalizeEngineOptions — refuse native-only / unknown groups (C02-A04)", () => {
  it("refuses overlayPriceScales, trackingMode, watermark, addDefaultPane, hoveredSeriesOnTop", () => {
    const input = {
      width: 800,
      overlayPriceScales: { ticksVisible: true },
      trackingMode: { exitMode: 0 },
      watermark: { visible: true },
      addDefaultPane: false,
      hoveredSeriesOnTop: false,
    };
    const result = normalizeEngineOptions(input, FULL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unsupported.sort()).toEqual([
      "addDefaultPane",
      "hoveredSeriesOnTop",
      "overlayPriceScales",
      "trackingMode",
      "watermark",
    ].sort());
    expect(result.reason).toMatch(/unsupported option groups/);
  });

  it("refuses kineticScroll when the implementation does not advertise it", () => {
    const result = normalizeEngineOptions({ kineticScroll: { touch: true } }, NO_KINETIC);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unsupported).toEqual(["kineticScroll"]);
  });

  it("accepts kineticScroll when advertised", () => {
    const result = normalizeEngineOptions({ kineticScroll: { touch: true } }, FULL);
    expect(result.ok).toBe(true);
  });

  it("accepts kineticScroll:false and all-false objects when the cap is off", () => {
    expect(normalizeEngineOptions({ kineticScroll: { mouse: false, touch: false } }, NO_KINETIC).ok).toBe(true);
    expect(normalizeEngineOptions({ kineticScroll: false as unknown as Record<string, unknown> }, NO_KINETIC).ok).toBe(true);
  });

  it("refuses a price-scale mode the caps do not advertise (token is mode-as-given)", () => {
    const mm: EngineCapabilities = { ...FULL, priceScaleModes: ["normal"] };
    const named = normalizeEngineOptions({ rightPriceScale: { mode: "log" } }, mm);
    expect(named.ok).toBe(false);
    if (!named.ok) {
      expect(named.unsupported).toContain("priceScaleMode:log");
      expect(named.reason).toMatch(/log/);
    }
    const numeric = normalizeEngineOptions({ leftPriceScale: { mode: 1 } }, mm);
    expect(numeric.ok).toBe(false);
    if (!numeric.ok) expect(numeric.unsupported).toContain("priceScaleMode:1");
    expect(normalizeEngineOptions({ rightPriceScale: { mode: 0 } }, mm).ok).toBe(true);
    expect(normalizeEngineOptions({ rightPriceScale: { mode: "log" } }, FULL).ok).toBe(true);
  });
});

describe("normalizeEngineOptions — immutability", () => {
  it("never mutates the caller object on accept or refuse", () => {
    const accepted = { width: 1, layout: { fontSize: 11 } };
    Object.freeze(accepted);
    Object.freeze(accepted.layout);
    const ok = normalizeEngineOptions(accepted, FULL);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      (ok.options as { width: number }).width = 999;
      (ok.options.layout as { fontSize: number }).fontSize = 99;
    }
    expect(accepted.width).toBe(1);
    expect(accepted.layout.fontSize).toBe(11);

    const refused = { width: 1, watermark: { text: "x" } };
    Object.freeze(refused);
    const bad = normalizeEngineOptions(refused, FULL);
    expect(bad.ok).toBe(false);
    expect(refused.width).toBe(1);
    expect("watermark" in refused).toBe(true);
  });
});

describe("EngineCapabilities — LWC adapter", () => {
  it("LWC_CAPABILITIES covers every first-class series kind and price-scale mode", () => {
    expect(LWC_CAPABILITIES.seriesKinds).toEqual(FULL.seriesKinds);
    expect(LWC_CAPABILITIES.priceScaleModes).toEqual(FULL.priceScaleModes);
    expect(LWC_CAPABILITIES.watermark).toBe(true);
    expect(LWC_CAPABILITIES.markers).toBe(true);
    expect(LWC_CAPABILITIES.primitives).toBe(true);
    expect(LWC_CAPABILITIES.screenshot).toBe(true);
    expect(LWC_CAPABILITIES.kineticScroll).toBe(true);
  });

  it("a canvas-shaped caps object without kineticScroll refuses that group", () => {
    const mm: EngineCapabilities = {
      ...FULL,
      kineticScroll: false,
      screenshot: true,
    };
    const result = normalizeEngineOptions({ layout: { fontSize: 12 }, kineticScroll: { mouse: true } }, mm);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unsupported).toEqual(["kineticScroll"]);
  });
});
