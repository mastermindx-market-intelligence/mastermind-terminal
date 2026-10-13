// Mastermind Chart Engine — typed option normalization (C02).
//
// EngineOptions is an open bag so ChartPanel can keep passing the groups it
// already sets (layout / grid / crosshair / timeScale / …). This module is the
// gate that stops native-only LWC groups (and capability-gated groups) leaking
// into a renderer that does not implement them. The last valid frame stays
// untouched: we never mutate the caller's object; a refusal returns the reason
// and the caller keeps what it had.
//
// This file must not import "lightweight-charts".

import type { EngineOptions, EngineSeriesKind } from "./api";

export type EnginePriceScaleMode = "normal" | "log" | "percent" | "indexed100";

export type EngineCapabilities = {
  seriesKinds: readonly EngineSeriesKind[];
  priceScaleModes: readonly EnginePriceScaleMode[];
  watermark: boolean;
  markers: boolean;
  primitives: boolean;
  screenshot: boolean;
  kineticScroll: boolean;
};

export type NormalizeEngineOptionsResult =
  | { ok: true; options: EngineOptions }
  | { ok: false; reason: string; unsupported: string[] };

// Top-level groups the contract actually models. Anything else is treated as a
// native-only LWC leftover (overlayPriceScales, trackingMode, watermark, …).
const ALLOWED_GROUPS = new Set<string>([
  "width",
  "height",
  "autoSize",
  "layout",
  "grid",
  "crosshair",
  "timeScale",
  "rightPriceScale",
  "leftPriceScale",
  "localization",
  "handleScroll",
  "handleScale",
  "kineticScroll",
]);

const MODE_BY_NUMBER: Record<number, EnginePriceScaleMode> = {
  0: "normal",
  1: "log",
  2: "percent",
  3: "indexed100",
};

function cloneValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return value;
}

function resolvePriceScaleMode(mode: unknown): EnginePriceScaleMode | null {
  if (typeof mode === "number" && Number.isFinite(mode) && MODE_BY_NUMBER[mode] != null) {
    return MODE_BY_NUMBER[mode];
  }
  if (mode === "normal" || mode === "Normal") return "normal";
  if (mode === "log" || mode === "percent" || mode === "indexed100") return mode;
  return null;
}

/** true / `{… any true value}` request kinetic behaviour; `{mouse:false,touch:false}` does not. */
export function kineticScrollRequested(k: unknown): boolean {
  if (k == null || k === false) return false;
  if (k === true) return true;
  if (typeof k !== "object") return false;
  return Object.values(k as Record<string, unknown>).some((v) => v === true);
}

function priceScaleModeUnsupported(
  scale: unknown,
  caps: EngineCapabilities,
): string | null {
  if (!scale || typeof scale !== "object") return null;
  const mode = (scale as { mode?: unknown }).mode;
  if (mode == null) return null;
  const resolved = resolvePriceScaleMode(mode);
  if (resolved != null && caps.priceScaleModes.includes(resolved)) return null;
  return `priceScaleMode:${String(mode)}`;
}

export function normalizeEngineOptions(
  options: EngineOptions,
  caps: EngineCapabilities,
): NormalizeEngineOptionsResult {
  const unsupported: string[] = [];
  for (const key of Object.keys(options)) {
    if (!ALLOWED_GROUPS.has(key)) {
      unsupported.push(key);
      continue;
    }
    if (key === "kineticScroll" && !caps.kineticScroll && kineticScrollRequested(options.kineticScroll)) {
      unsupported.push(key);
    }
  }
  for (const key of ["rightPriceScale", "leftPriceScale"] as const) {
    const token = priceScaleModeUnsupported(options[key], caps);
    if (token) unsupported.push(token);
  }
  if (unsupported.length > 0) {
    const groups = unsupported.join(", ");
    return {
      ok: false,
      reason: `unsupported option group${unsupported.length === 1 ? "" : "s"}: ${groups}`,
      unsupported,
    };
  }
  const next: EngineOptions = {};
  for (const key of Object.keys(options)) {
    (next as Record<string, unknown>)[key] = cloneValue((options as Record<string, unknown>)[key]);
  }
  return { ok: true, options: next };
}
