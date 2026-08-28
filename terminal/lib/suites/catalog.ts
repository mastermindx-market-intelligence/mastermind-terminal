/**
 * Module-first catalog for the Indicator Library.
 *
 * The five suite keys remain the runtime/persistence keys in mm.inds and indParams. This catalog
 * gives every nested module a collision-safe public identity without splitting shared suite
 * computation or panes. In particular, common short keys such as `sig`, `div`, `eng`, and `mtf`
 * must never be persisted or looked up without their suite namespace.
 */

import type { SuiteDef, SuiteModuleMeta, SuiteTier } from "@/lib/indicator-canvas/types";
import { SUITE_DEFS, SUITE_ORDER, suiteDefaults } from "./registry";

export type SuiteModuleId = `suite:${string}/${string}`;
export type SuiteModuleSurface = "overlay" | "pane" | "dashboard" | "candles";

export interface SuiteModuleCategory {
  /** Stable picker category id. Equal to the existing runtime suite key. */
  id: string;
  key: string;
  suiteKey: string;
  label: string;
  tag: string;
  tkey?: string;
  kind: SuiteDef["kind"];
  description: string;
  descriptionZh: string;
}

export interface SuiteModuleCatalogEntry {
  /** Collision-safe picker id, e.g. `suite:structure/ms`. */
  id: SuiteModuleId;
  suiteKey: string;
  moduleKey: string;
  label: string;
  tag: string;
  tier: SuiteTier;
  kind: SuiteDef["kind"];
  surface: SuiteModuleSurface;
  /** Picker category id; currently the owning suite key. */
  category: string;
  description: string;
  descriptionZh: string;
  aliases: readonly string[];
  aliasesZh: readonly string[];
  defaultOn: boolean;
  suiteLabel: string;
  suiteTag: string;
  suiteTkey?: string;
  /**
   * Primary calculation-settings source for a satellite module. This is explanatory metadata, not
   * an enablement dependency: satellites can still compute while the source's drawing is off.
   */
  source?: SuiteModuleId;
  /** The canonical module METADATA. Consumers must not mutate it, and must not expect
   *  `compute` here — computation is loaded separately (lib/suites/compute.ts). */
  module: SuiteModuleMeta;
  /** Pre-normalized English search corpus for simple picker filtering. */
  searchText: string;
  /** Pre-normalized Chinese search corpus for simple picker filtering. */
  searchTextZh: string;
}

export interface ParsedSuiteModuleId {
  id: SuiteModuleId;
  suiteKey: string;
  moduleKey: string;
}

export type SuiteParams = Record<string, unknown>;
export type SuiteParamsByKey = Readonly<Record<string, Readonly<SuiteParams> | undefined>>;

interface PickerMetadata {
  description: string;
  descriptionZh: string;
  aliases: readonly string[];
  aliasesZh?: readonly string[];
  surface?: SuiteModuleSurface;
}

const CATEGORY_METADATA: Record<string, Pick<SuiteModuleCategory, "description" | "descriptionZh">> = {
  structure: {
    description: "Market structure, institutional zones, liquidity, and price-action maps.",
    descriptionZh: "市场结构、机构区域、流动性与价格行为地图。",
  },
  trend: {
    description: "Trend direction, volatility bands, entries, targets, and market state.",
    descriptionZh: "趋势方向、波动带、进出场目标与市场状态。",
  },
  pulse: {
    description: "Early momentum turns, divergences, volume pressure, and multi-timeframe state.",
    descriptionZh: "早期动量转折、背离、成交量压力与多周期状态。",
  },
  rsix: {
    description: "Configurable RSI analysis, signals, divergences, channels, and MTF context.",
    descriptionZh: "可配置 RSI 分析、信号、背离、通道与多周期环境。",
  },
  macdx: {
    description: "Normalized MACD momentum, signals, phases, divergences, and MTF context.",
    descriptionZh: "标准化 MACD 动量、信号、阶段、背离与多周期环境。",
  },
};

const META: Record<SuiteModuleId, PickerMetadata> = {
  "suite:structure/ms": {
    description: "BOS, CHoCH, CISD, swing labels, and projected structure levels.",
    descriptionZh: "显示 BOS、CHoCH、CISD、摆动标签与结构投影位。",
    aliases: ["BOS", "CHoCH", "CISD", "swings", "break of structure"],
    aliasesZh: ["市场结构", "突破结构", "摆动高低点"],
  },
  "suite:structure/ob": {
    description: "Institutional order-block zones with volume grading, breakers, and macro detection.",
    descriptionZh: "带成交量评级、破坏块与宏观检测的机构订单块区域。",
    aliases: ["OB", "orderblock", "supply demand", "breaker blocks", "institutional zones"],
    aliasesZh: ["订单块", "供需区", "破坏块"],
  },
  "suite:structure/fvg": {
    description: "Fair-value gaps, retests, fill state, and inversion FVG tracking.",
    descriptionZh: "公平价值缺口、回测、填补状态与反转缺口追踪。",
    aliases: ["FVG", "iFVG", "imbalance", "fair value gap", "inversion gap"],
    aliasesZh: ["公平价值缺口", "失衡", "反转缺口"],
  },
  "suite:structure/pd": {
    description: "Premium, discount, equilibrium, Fibonacci levels, and the golden pocket.",
    descriptionZh: "溢价、折价、均衡、斐波那契水平与黄金口袋。",
    aliases: ["premium discount", "equilibrium", "golden pocket", "fib", "fibonacci"],
    aliasesZh: ["溢价折价", "均衡", "黄金口袋", "斐波那契"],
  },
  "suite:structure/liq": {
    description: "Equal-high and equal-low liquidity pools with grabs, sweeps, and volume bubbles.",
    descriptionZh: "等高等低流动性池，以及抓取、扫单与成交量气泡。",
    aliases: ["liquidity sweep", "liquidity grab", "EQH", "EQL", "stops"],
    aliasesZh: ["流动性", "扫流动性", "止损池", "等高", "等低"],
  },
  "suite:structure/sfp": {
    description: "Swing-failure reversals with volume strength, deviation zones, and invalidation.",
    descriptionZh: "带成交量强度、偏离区与失效追踪的摆动失败反转。",
    aliases: ["SFP", "swing failure pattern", "false breakout", "failed auction"],
    aliasesZh: ["摆动失败", "假突破", "失败拍卖"],
  },
  "suite:structure/sr": {
    description: "Automatically ranked support and resistance levels with holds and breaks.",
    descriptionZh: "自动评级的支撑阻力位，并追踪守住与突破。",
    aliases: ["S/R", "support resistance", "levels", "smart levels"],
    aliasesZh: ["支撑阻力", "水平位"],
  },
  "suite:structure/mfp": {
    description: "Money-flow profile with point of control, value area, and ranked price levels.",
    descriptionZh: "带控制点、价值区域与价格等级的资金流分布。",
    aliases: ["volume profile", "money flow profile", "POC", "value area", "VPVR"],
    aliasesZh: ["成交量分布", "资金流分布", "控制点", "价值区"],
  },
  "suite:structure/pat": {
    description: "Automatic trendlines and parallel channels with break confirmation and measured targets.",
    descriptionZh: "自动绘制趋势线与平行通道，并提供突破确认与测量目标。",
    aliases: ["patterns", "trendlines", "parallel channels", "measured move"],
    aliasesZh: ["自动形态", "趋势线", "平行通道", "测量目标"],
  },

  "suite:trend/te": {
    description: "Adaptive trend bands with BUY/SELL flips, retests, TP ladders, and stops.",
    descriptionZh: "自适应趋势带，包含买卖翻转、回测、止盈阶梯与止损。",
    aliases: ["trend signals", "buy sell", "TP1", "take profit", "stop loss", "ATR trend"],
    aliasesZh: ["趋势信号", "买卖", "止盈", "止损"],
  },
  "suite:trend/fb": {
    description: "Trend-and-volume flow band with cloud turns, retests, and quality scores.",
    descriptionZh: "结合趋势与成交量的流向带，包含云带转折、回测与质量评分。",
    aliases: ["flow trend", "trend cloud", "flow band", "quality retest"],
    aliasesZh: ["流向趋势", "趋势云", "流向带"],
  },
  "suite:trend/vb": {
    description: "Volatility envelope with overextension glow and reversal confirmations.",
    descriptionZh: "带过度延伸提示与反转确认的波动率包络带。",
    aliases: ["volatility bands", "voltix", "overextension", "reversal bands"],
    aliasesZh: ["波动带", "过度延伸", "反转带"],
  },
  "suite:trend/cp": {
    description: "Paints candles by trend, momentum, volume, or combined market state.",
    descriptionZh: "按趋势、动量、成交量或综合市场状态为蜡烛着色。",
    aliases: ["bar color", "candle colors", "paint bars", "trend candles"],
    aliasesZh: ["蜡烛着色", "K线颜色", "趋势蜡烛"],
    surface: "candles",
  },
  "suite:trend/dash": {
    description: "Compact dashboard for volatility, compression, trend, pressure, rating, and Chart/2×/4× resampled state.",
    descriptionZh: "汇总波动、压缩、趋势、压力、评级与图表／2×／4× 重采样状态的紧凑仪表盘。",
    aliases: ["market dashboard", "trend dashboard", "market state", "rating table"],
    aliasesZh: ["市场仪表盘", "趋势仪表盘", "市场状态"],
    surface: "dashboard",
  },

  "suite:pulse/wave": {
    description: "Normalized momentum wave tuned for early turns, extremes, and zero-line shifts.",
    descriptionZh: "用于捕捉早期转折、极值与零轴变化的标准化动量波。",
    aliases: ["pulse oscillator", "momentum wave", "early entry", "zero cross"],
    aliasesZh: ["脉冲振荡器", "动量波", "早期入场", "零轴交叉"],
  },
  "suite:pulse/sig": {
    description: "Pulse BUY/SELL turns, dip diamonds, peak dots, and gapped crosses.",
    descriptionZh: "脉冲买卖转折、回踩菱形、峰值圆点与间隔交叉。",
    aliases: ["pulse signals", "buy sell", "dip diamonds", "peak dots", "gapped cross"],
    aliasesZh: ["脉冲信号", "买卖", "回踩菱形", "峰值"],
  },
  "suite:pulse/div": {
    description: "Regular, hidden, and stacked divergences between price and the Pulse Wave.",
    descriptionZh: "价格与脉冲波之间的常规、隐藏与叠加背离。",
    aliases: ["pulse divergence", "bullish divergence", "bearish divergence", "hidden divergence"],
    aliasesZh: ["脉冲背离", "看涨背离", "看跌背离", "隐藏背离"],
  },
  "suite:pulse/vmap": {
    description: "Maps relative volume participation directly into the Pulse oscillator pane.",
    descriptionZh: "将相对成交量参与度直接映射到脉冲振荡器窗格。",
    aliases: ["volume mapping", "relative volume", "volume oscillator", "participation"],
    aliasesZh: ["成交量映射", "相对成交量", "参与度"],
  },
  "suite:pulse/flow": {
    description: "MFI and estimated cumulative-volume-delta pressure lines beside the Pulse Wave.",
    descriptionZh: "在脉冲波旁显示 MFI 与估算累计成交量差压力线。",
    aliases: ["money flow", "MFI", "CVD", "volume flow", "buying pressure"],
    aliasesZh: ["资金流", "成交量差", "买卖压力"],
  },
  "suite:pulse/mtf": {
    description: "Pulse state, signals, and divergences across Chart/2×/4× resampled blocks.",
    descriptionZh: "比较图表／2×／4× 重采样区块的脉冲状态、信号与背离。",
    aliases: ["pulse MTF", "multi timeframe", "timeframe dashboard", "MTF table"],
    aliasesZh: ["脉冲多周期", "多时间框架", "多周期仪表盘"],
    surface: "dashboard",
  },

  "suite:rsix/eng": {
    description: "Configurable RSI core with source, smoothing, thresholds, and state coloring.",
    descriptionZh: "可配置数据源、平滑、阈值与状态着色的 RSI 核心。",
    aliases: ["RSI", "relative strength index", "smoothed RSI", "RSI oscillator"],
    aliasesZh: ["相对强弱指数", "平滑 RSI"],
  },
  "suite:rsix/sig": {
    description: "RSI reversal signals, deviation follow-throughs, and crossover dots.",
    descriptionZh: "RSI 反转信号、偏离跟进与交叉圆点。",
    aliases: ["RSI signals", "RSI reversal", "deviation", "RSI cross"],
    aliasesZh: ["RSI 信号", "RSI 反转", "偏离", "交叉"],
  },
  "suite:rsix/div": {
    description: "Regular and hidden bullish or bearish divergences against the RSI engine.",
    descriptionZh: "相对于 RSI 引擎的常规与隐藏看涨或看跌背离。",
    aliases: ["RSI divergence", "bullish divergence", "bearish divergence", "hidden divergence"],
    aliasesZh: ["RSI 背离", "看涨背离", "看跌背离", "隐藏背离"],
  },
  "suite:rsix/chan": {
    description: "Bollinger, Keltner, or Donchian channels around the RSI engine.",
    descriptionZh: "围绕 RSI 引擎的布林、肯特纳或唐奇安通道。",
    aliases: ["RSI channels", "Bollinger RSI", "Keltner RSI", "Donchian RSI"],
    aliasesZh: ["RSI 通道", "布林通道", "肯特纳通道", "唐奇安通道"],
  },
  "suite:rsix/mtf": {
    description: "RSI values, signals, and divergences across Chart/2×/4× resampled blocks.",
    descriptionZh: "比较图表／2×／4× 重采样区块的 RSI 数值、信号与背离。",
    aliases: ["RSI MTF", "multi timeframe RSI", "timeframe dashboard", "MTF table"],
    aliasesZh: ["RSI 多周期", "多时间框架 RSI", "多周期仪表盘"],
    surface: "dashboard",
  },

  "suite:macdx/eng": {
    description: "Normalized ±100 MACD core with configurable averages and state coloring.",
    descriptionZh: "可配置均线与状态着色的 ±100 标准化 MACD 核心。",
    aliases: ["MACD", "normalized MACD", "moving average convergence divergence", "MACD oscillator"],
    aliasesZh: ["标准化 MACD", "指数平滑异同移动平均线"],
  },
  "suite:macdx/sig": {
    description: "MACD reversal markers at configurable momentum extremes.",
    descriptionZh: "在可配置动量极值处显示 MACD 反转标记。",
    aliases: ["MACD signals", "MACD reversal", "extreme zone", "buy sell"],
    aliasesZh: ["MACD 信号", "MACD 反转", "极值区", "买卖"],
  },
  "suite:macdx/hist": {
    description: "State-colored MACD histogram with rising, falling, and flip markers.",
    descriptionZh: "按上升、下降与翻转状态着色的 MACD 柱状图。",
    aliases: ["MACD histogram", "histogram", "momentum bars", "MACD flips"],
    aliasesZh: ["MACD 柱状图", "动量柱", "翻转"],
  },
  "suite:macdx/div": {
    description: "Regular and hidden bullish or bearish divergences against normalized MACD.",
    descriptionZh: "相对于标准化 MACD 的常规与隐藏看涨或看跌背离。",
    aliases: ["MACD divergence", "bullish divergence", "bearish divergence", "hidden divergence"],
    aliasesZh: ["MACD 背离", "看涨背离", "看跌背离", "隐藏背离"],
  },
  "suite:macdx/trend": {
    description: "Classifies MACD accumulation, expansion, distribution, and contraction phases.",
    descriptionZh: "识别 MACD 的吸筹、扩张、派发与收缩阶段。",
    aliases: ["MACD trend", "phase trend", "market phase", "accumulation", "distribution"],
    aliasesZh: ["MACD 趋势", "阶段趋势", "吸筹", "派发"],
  },
  "suite:macdx/mtf": {
    description: "MACD values, signals, and phases across Chart/2×/4× resampled blocks.",
    descriptionZh: "比较图表／2×／4× 重采样区块的 MACD 数值、信号与阶段。",
    aliases: ["MACD MTF", "multi timeframe MACD", "timeframe dashboard", "MTF table"],
    aliasesZh: ["MACD 多周期", "多时间框架 MACD", "多周期仪表盘"],
    surface: "dashboard",
  },
};

const SOURCE_BY_ID: Partial<Record<SuiteModuleId, SuiteModuleId>> = {
  "suite:trend/dash": "suite:trend/te",
  "suite:pulse/sig": "suite:pulse/wave",
  "suite:pulse/div": "suite:pulse/wave",
  "suite:pulse/mtf": "suite:pulse/wave",
  "suite:rsix/sig": "suite:rsix/eng",
  "suite:rsix/div": "suite:rsix/eng",
  "suite:rsix/chan": "suite:rsix/eng",
  "suite:rsix/mtf": "suite:rsix/eng",
  "suite:macdx/sig": "suite:macdx/eng",
  "suite:macdx/hist": "suite:macdx/eng",
  "suite:macdx/div": "suite:macdx/eng",
  "suite:macdx/trend": "suite:macdx/eng",
  "suite:macdx/mtf": "suite:macdx/eng",
};

/** Create a collision-safe module id. The caller may still use parse/get to validate existence. */
export function suiteModuleId(suiteKey: string, moduleKey: string): SuiteModuleId {
  return `suite:${suiteKey}/${moduleKey}`;
}

export const MODULE_CATEGORIES: readonly SuiteModuleCategory[] = Object.freeze(
  SUITE_ORDER.map((suiteKey) => {
    const suite = SUITE_DEFS[suiteKey];
    const meta = CATEGORY_METADATA[suiteKey];
    return Object.freeze({
      id: suiteKey,
      key: suiteKey,
      suiteKey,
      label: suite.label,
      tag: suite.tag,
      tkey: suite.tkey,
      kind: suite.kind,
      description: meta?.description ?? suite.label,
      descriptionZh: meta?.descriptionZh ?? suite.label,
    });
  }),
);

export const MODULE_CATALOG: readonly SuiteModuleCatalogEntry[] = Object.freeze(
  SUITE_ORDER.flatMap((suiteKey) => {
    const suite = SUITE_DEFS[suiteKey];
    return suite.modules.map((moduleDef) => {
      const id = suiteModuleId(suiteKey, moduleDef.key);
      const meta = META[id];
      const description = meta?.description ?? moduleDef.label;
      const descriptionZh = meta?.descriptionZh ?? description;
      const aliases = Object.freeze([...(meta?.aliases ?? [])]);
      const aliasesZh = Object.freeze([...(meta?.aliasesZh ?? [])]);
      const surface = meta?.surface ?? (suite.kind === "pane" ? "pane" : "overlay");
      return Object.freeze({
        id,
        suiteKey,
        moduleKey: moduleDef.key,
        label: moduleDef.label,
        tag: moduleDef.tag,
        tier: moduleDef.tier,
        kind: suite.kind,
        surface,
        category: suiteKey,
        description,
        descriptionZh,
        aliases,
        aliasesZh,
        defaultOn: moduleDef.defaultOn,
        suiteLabel: suite.label,
        suiteTag: suite.tag,
        suiteTkey: suite.tkey,
        source: SOURCE_BY_ID[id],
        module: moduleDef,
        searchText: [moduleDef.label, moduleDef.tag, suite.label, description, ...aliases].join(" ").toLocaleLowerCase("en"),
        searchTextZh: [moduleDef.label, moduleDef.tag, suite.label, descriptionZh, ...aliasesZh].join(" ").toLocaleLowerCase("zh"),
      });
    });
  }),
);

const MODULE_BY_ID = new Map<SuiteModuleId, SuiteModuleCatalogEntry>(
  MODULE_CATALOG.map((entry) => [entry.id, entry]),
);

const MODULES_BY_SUITE = new Map<string, readonly SuiteModuleCatalogEntry[]>(
  SUITE_ORDER.map((suiteKey) => [
    suiteKey,
    Object.freeze(MODULE_CATALOG.filter((entry) => entry.suiteKey === suiteKey)),
  ]),
);

/**
 * Parse and validate a qualified module id. Unknown suites/modules and unqualified short keys are
 * rejected so a shared key such as `div` cannot accidentally resolve to the wrong suite.
 */
export function parseSuiteModuleId(value: string): ParsedSuiteModuleId | null {
  if (typeof value !== "string") return null;
  const match = /^suite:([a-z0-9_-]+)\/([a-z0-9_-]+)$/.exec(value);
  if (!match) return null;
  const id = value as SuiteModuleId;
  if (!MODULE_BY_ID.has(id)) return null;
  return { id, suiteKey: match[1], moduleKey: match[2] };
}

export function isSuiteModuleId(value: string): value is SuiteModuleId {
  return parseSuiteModuleId(value) !== null;
}

/**
 * Resolve either a qualified id or an explicit `(suiteKey, moduleKey)` pair. A bare module key is
 * intentionally unsupported because several suites own `sig`, `div`, `eng`, and `mtf`.
 */
export function getSuiteModuleCatalogEntry(id: string, moduleKey?: string): SuiteModuleCatalogEntry | null {
  const qualified = moduleKey === undefined ? id : suiteModuleId(id, moduleKey);
  return MODULE_BY_ID.get(qualified as SuiteModuleId) ?? null;
}

/** Naming alias used by settings/picker consumers. */
export const resolveModuleCatalogEntry = getSuiteModuleCatalogEntry;

export function suiteModuleCatalogFor(suiteKey: string): readonly SuiteModuleCatalogEntry[] {
  return MODULES_BY_SUITE.get(suiteKey) ?? [];
}

function activeHas(activeSuiteKeys: Iterable<string>, suiteKey: string): boolean {
  if (activeSuiteKeys instanceof Set) return activeSuiteKeys.has(suiteKey);
  for (const key of activeSuiteKeys) if (key === suiteKey) return true;
  return false;
}

function moduleOn(entry: SuiteModuleCatalogEntry, indParams: SuiteParamsByKey): boolean {
  const saved = indParams[entry.suiteKey]?.[`${entry.moduleKey}.on`];
  return saved === undefined ? entry.defaultOn : !!saved;
}

/** A module renders only when its suite runtime is active and its own toggle is effectively on. */
export function isSuiteModuleEnabled(
  id: string | SuiteModuleCatalogEntry,
  activeSuiteKeys: Iterable<string>,
  indParams: SuiteParamsByKey,
): boolean {
  const entry = typeof id === "string" ? getSuiteModuleCatalogEntry(id) : id;
  return !!entry && activeHas(activeSuiteKeys, entry.suiteKey) && moduleOn(entry, indParams);
}

/** Enabled modules in canonical suite/module order, optionally restricted to one suite. */
export function enabledSuiteModules(
  activeSuiteKeys: Iterable<string>,
  indParams: SuiteParamsByKey,
  suiteKey?: string,
): SuiteModuleCatalogEntry[] {
  const candidates = suiteKey === undefined ? MODULE_CATALOG : suiteModuleCatalogFor(suiteKey);
  return candidates.filter((entry) => isSuiteModuleEnabled(entry, activeSuiteKeys, indParams));
}

/** Convenience name for consumers already scoped to one suite. */
export function enabledModulesForSuite(
  suiteKey: string,
  activeSuiteKeys: Iterable<string>,
  indParams: SuiteParamsByKey,
): SuiteModuleCatalogEntry[] {
  return enabledSuiteModules(activeSuiteKeys, indParams, suiteKey);
}

export function hasEnabledSuiteModules(
  activeSuiteKeys: Iterable<string>,
  indParams: SuiteParamsByKey,
  suiteKey?: string,
): boolean {
  const candidates = suiteKey === undefined ? MODULE_CATALOG : suiteModuleCatalogFor(suiteKey);
  return candidates.some((entry) => isSuiteModuleEnabled(entry, activeSuiteKeys, indParams));
}

/**
 * Produce a suite's next flat params blob for a module add/remove action.
 *
 * When adding a module to an inactive parent, every module toggle is first disabled and only the
 * selected module is enabled. Existing field values and unknown forward-compatible fields survive.
 * When the suite is already active, sibling toggles are left untouched.
 */
export function setSuiteModuleEnabledParams(
  id: string,
  currentParams: Readonly<SuiteParams> | undefined,
  enabled: boolean,
  parentActive: boolean,
): SuiteParams {
  const entry = getSuiteModuleCatalogEntry(id);
  if (!entry) return { ...(currentParams ?? {}) };

  const next: SuiteParams = { ...suiteDefaults(entry.suiteKey), ...(currentParams ?? {}) };
  if (enabled && !parentActive) {
    for (const sibling of suiteModuleCatalogFor(entry.suiteKey)) {
      next[`${sibling.moduleKey}.on`] = false;
    }
  }
  next[`${entry.moduleKey}.on`] = enabled;
  return next;
}

/** Enable or disable every module on one render surface while preserving sibling surfaces. */
export function setSuiteSurfaceEnabledParams(
  suiteKey: string,
  surface: SuiteModuleSurface,
  currentParams: Readonly<SuiteParams> | undefined,
  enabled: boolean,
): SuiteParams {
  if (!SUITE_DEFS[suiteKey]) return { ...(currentParams ?? {}) };
  const next: SuiteParams = { ...suiteDefaults(suiteKey), ...(currentParams ?? {}) };
  for (const entry of suiteModuleCatalogFor(suiteKey)) {
    if (entry.surface === surface) next[`${entry.moduleKey}.on`] = enabled;
  }
  return next;
}

/**
 * Reapply the suite preset's default module selection while preserving all customized field values.
 * This keeps the original five suite presets useful alongside module-first discovery.
 */
export function suitePresetParams(
  suiteKey: string,
  currentParams: Readonly<SuiteParams> | undefined,
): SuiteParams {
  const suite = SUITE_DEFS[suiteKey];
  if (!suite) return { ...(currentParams ?? {}) };
  const next: SuiteParams = { ...suiteDefaults(suiteKey), ...(currentParams ?? {}) };
  for (const moduleDef of suite.modules) next[`${moduleDef.key}.on`] = moduleDef.defaultOn;
  return next;
}
