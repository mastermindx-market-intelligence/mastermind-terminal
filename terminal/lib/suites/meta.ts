// Premium suite METADATA registry — identity, tiers, settings schemas, defaults, pane shapes.
//
// This is the graph the boot path reads. Nothing reachable from here can compute anything: the
// module implementations live behind `lib/suites/compute.ts` and are pulled in only when a suite
// is actually active on the chart.
//
// WHY THE SPLIT (B7). `registry.ts` used to import all 31 module implementations directly and
// then expose identity AND computation through one graph. TerminalShell needs nothing but
// metadata during a normal boot — suite keys, defaults to seed indParams, labels and tiers for
// the picker — so importing the registry dragged ~562 KB of compute into /terminal before a
// single premium suite was switched on.
//
// ONE CANONICAL IDENTITY. Each module's metadata literal exists exactly once, in its
// `<module>.meta.ts`; the implementation spreads it and adds `compute`. There is no second truth
// to drift, and `lib/__tests__/suiteRegistrySplit.test.ts` asserts both halves still describe the
// same modules, in the same order, with identical fields and defaults.
//
// mm.inds carries suite keys alongside classic IndKeys (TerminalShell's Set<string> is already
// generic); per-suite params live in indParams[suiteKey] as flat "<moduleKey>.<field>" entries
// plus "<moduleKey>.on" master toggles (see indicator-canvas/host.ts).
//
// Guides: every module has bilingual docs at public/guides/<suiteKey>/<moduleKey>.<lang>.md,
// rendered by components/GuidePanel.tsx via the "?" button in the module's Settings header.

import type { SuiteMetaDef } from "@/lib/indicator-canvas/types";
import { MARKET_STRUCTURE_META } from "./structure/marketStructure.meta";
import { ORDER_BLOCKS_META } from "./structure/orderBlocks.meta";
import { FVG_META } from "./structure/fvg.meta";
import { PREMIUM_DISCOUNT_META } from "./structure/premiumDiscount.meta";
import { LIQUIDITY_META } from "./structure/liquidity.meta";
import { SFP_META } from "./structure/sfp.meta";
import { SMART_SR_META } from "./structure/smartSR.meta";
import { MONEY_FLOW_PROFILE_META } from "./structure/moneyFlowProfile.meta";
import { AUTO_PATTERNS_META } from "./structure/autoPatterns.meta";
import { TREND_ENGINE_META } from "./trend/trendEngine.meta";
import { PULSE_WAVE_META } from "./pulse/pulseWave.meta";
import { PULSE_SIGNALS_META } from "./pulse/pulseSignals.meta";
import { PULSE_DIVERGENCE_META } from "./pulse/divergences.meta";
import { VOLUME_MAPPING_META } from "./pulse/volumeMapping.meta";
import { FLOWS_META } from "./pulse/flows.meta";
import { RSI_ENGINE_META } from "./rsix/rsiEngine.meta";
import { RSI_SIGNALS_META } from "./rsix/rsiSignals.meta";
import { RSI_DIVERGENCE_META } from "./rsix/rsiDivergence.meta";
import { RSI_CHANNELS_META } from "./rsix/rsiChannels.meta";
import { MACD_ENGINE_META } from "./macdx/macdEngine.meta";
import { MACD_SIGNALS_META } from "./macdx/macdSignals.meta";
import { MACD_DIVERGENCE_META } from "./macdx/macdDivergence.meta";
import { MACD_HISTOGRAM_META } from "./macdx/macdHistogram.meta";
import { MACD_TREND_META } from "./macdx/macdTrend.meta";
import { VOLT_BANDS_META } from "./trend/voltixBands.meta";
import { MARKET_DASHBOARD_META } from "./trend/marketDashboard.meta";
import { PULSE_MTF_META } from "./pulse/mtfDash.meta";
import { RSIX_MTF_META } from "./rsix/mtfDash.meta";
import { MACDX_MTF_META } from "./macdx/mtfDash.meta";
import { CANDLE_PAINTER_META } from "./trend/candlePainter.meta";
import { FLOW_BAND_META } from "./trend/flowBand.meta";

export const STRUCTURE_SUITE_META: SuiteMetaDef = {
  key: "structure",
  label: "Structure Core",
  tag: "SC",
  tkey: "suiteStructure",
  kind: "overlay",
  modules: [
    MARKET_STRUCTURE_META,
    ORDER_BLOCKS_META,
    FVG_META,
    PREMIUM_DISCOUNT_META,
    LIQUIDITY_META,
    SFP_META,
    SMART_SR_META,
    MONEY_FLOW_PROFILE_META,
    AUTO_PATTERNS_META,
  ],
};

export const TREND_SUITE_META: SuiteMetaDef = {
  key: "trend",
  label: "Trend Waves",
  tag: "TW",
  tkey: "suiteTrend",
  kind: "overlay",
  modules: [
    TREND_ENGINE_META,
    FLOW_BAND_META,
    VOLT_BANDS_META,
    CANDLE_PAINTER_META,
    MARKET_DASHBOARD_META,
  ],
};

export const PULSE_SUITE_META: SuiteMetaDef = {
  key: "pulse",
  label: "Pulse Oscillator",
  tag: "PO",
  tkey: "suitePulse",
  kind: "pane",
  pane: { min: -110, max: 110, lines: [{ p: 0 }, { p: 60, dashed: true }, { p: -60, dashed: true }] },
  modules: [PULSE_WAVE_META, PULSE_SIGNALS_META, PULSE_DIVERGENCE_META, VOLUME_MAPPING_META, FLOWS_META, PULSE_MTF_META],
};

export const RSIX_SUITE_META: SuiteMetaDef = {
  key: "rsix",
  label: "RSI Ultimate",
  tag: "RU",
  tkey: "suiteRsix",
  kind: "pane",
  pane: { min: 0, max: 100, lines: [{ p: 30, dashed: true }, { p: 50 }, { p: 70, dashed: true }] },
  modules: [RSI_ENGINE_META, RSI_SIGNALS_META, RSI_DIVERGENCE_META, RSI_CHANNELS_META, RSIX_MTF_META],
};

export const MACDX_SUITE_META: SuiteMetaDef = {
  key: "macdx",
  label: "MACD Ultimate",
  tag: "MU",
  tkey: "suiteMacdx",
  kind: "pane",
  pane: { min: -120, max: 120, lines: [{ p: 0 }, { p: 100, dashed: true }, { p: -100, dashed: true }] },
  modules: [MACD_ENGINE_META, MACD_SIGNALS_META, MACD_HISTOGRAM_META, MACD_DIVERGENCE_META, MACD_TREND_META, MACDX_MTF_META],
};

export const SUITE_META: Record<string, SuiteMetaDef> = {
  structure: STRUCTURE_SUITE_META,
  trend: TREND_SUITE_META,
  pulse: PULSE_SUITE_META,
  rsix: RSIX_SUITE_META,
  macdx: MACDX_SUITE_META,
};

export const SUITE_ORDER = ["structure", "trend", "pulse", "rsix", "macdx"] as const;

/** Pane-suite keys in canonical order (sub-pane creation + legend follow this). */
export function paneSuiteKeys(): string[] {
  return SUITE_ORDER.filter((k) => SUITE_META[k]?.kind === "pane");
}

export function isSuiteKey(k: string): boolean {
  return Object.prototype.hasOwnProperty.call(SUITE_META, k);
}
export function getSuiteMeta(k: string): SuiteMetaDef | null {
  return SUITE_META[k] ?? null;
}

/** Flat defaults blob for a suite (module-prefixed), used to seed/backfill indParams[suiteKey]. */
export function suiteDefaults(k: string): Record<string, any> {
  const def = SUITE_META[k];
  if (!def) return {};
  const out: Record<string, any> = {};
  for (const m of def.modules) {
    out[`${m.key}.on`] = m.defaultOn;
    for (const [fk, fv] of Object.entries(m.defaults)) out[`${m.key}.${fk}`] = fv;
  }
  return out;
}
