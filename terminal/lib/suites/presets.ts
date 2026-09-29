/**
 * Progressive, module-selection-only recipes for the five premium suites.
 *
 * Important persistence contract:
 * - SuiteModuleDef.defaultOn remains the runtime fallback for legacy/sparse workspaces.
 * - A preset changes only canonical "<module>.on" keys.
 * - Calculation and presentation fields, unknown forward-compatible fields, and the caller's
 *   object are preserved verbatim.
 *
 * That separation lets an existing workspace remain "Custom" until its owner explicitly applies
 * a recipe. It also prevents a future change to a recipe from silently migrating saved charts.
 */

import type { SuiteTier } from "@/lib/indicator-canvas/types";
import { SUITE_DEFS, SUITE_ORDER } from "./registry";

export const SUITE_PRESET_IDS = ["focused", "workflow", "research"] as const;
export type SuitePresetId = (typeof SUITE_PRESET_IDS)[number];

export interface SuitePresetCopy {
  en: string;
  zh: string;
}

export interface SuitePresetDef {
  /** Stable within a suite and suitable for persistence or analytics. */
  id: SuitePresetId;
  /** Existing runtime suite key. */
  suiteKey: string;
  name: SuitePresetCopy;
  description: SuitePresetCopy;
  /** Short module keys only (never bare cross-suite ids and never `suite:<suite>/<module>` ids). */
  modules: readonly string[];
  /** Highest entitlement required by any selected module. */
  minTier: SuiteTier;
}

type SuitePresetRecipe = Omit<SuitePresetDef, "suiteKey">;

const PRESETS: Readonly<Record<string, readonly SuitePresetRecipe[]>> = {
  structure: [
    {
      id: "focused",
      name: { en: "Structure Focus", zh: "结构聚焦" },
      description: {
        en: "Market Structure only — a clean BOS and CHoCH map for learning direction.",
        zh: "仅显示市场结构——用清晰的 BOS 与 CHoCH 地图判断方向。",
      },
      modules: ["ms"],
      minTier: "essential",
    },
    {
      id: "workflow",
      name: { en: "Structure Workflow", zh: "结构工作流" },
      description: {
        en: "Direction, imbalance, and range location without the full research stack.",
        zh: "组合方向、失衡与区间位置，不加载完整研究工具栈。",
      },
      modules: ["ms", "fvg", "pd"],
      minTier: "essential",
    },
    {
      id: "research",
      name: { en: "Complete Structure Research", zh: "完整结构研究" },
      description: {
        en: "All Structure Core modules for advanced investigation and custom workflows.",
        zh: "启用全部结构核心模块，用于高级研究与自定义工作流。",
      },
      modules: ["ms", "ob", "fvg", "pd", "liq", "sfp", "sr", "mfp", "pat"],
      minTier: "pro",
    },
  ],
  trend: [
    {
      id: "focused",
      name: { en: "Candle State", zh: "蜡烛状态" },
      description: {
        en: "Mastermind Candles only — the lightest one-glance trend read.",
        zh: "仅启用蜡烛着色——最轻量的一眼趋势判断。",
      },
      modules: ["cp"],
      minTier: "free",
    },
    {
      id: "workflow",
      name: { en: "Trend Workflow", zh: "趋势工作流" },
      description: {
        en: "Trend entries, participation confirmation, and candle-state context.",
        zh: "组合趋势入场、参与度确认与蜡烛状态环境。",
      },
      modules: ["te", "fb", "cp"],
      minTier: "essential",
    },
    {
      id: "research",
      name: { en: "Complete Trend Research", zh: "完整趋势研究" },
      description: {
        en: "All Trend Waves modules, including volatility bands and the dashboard.",
        zh: "启用全部趋势波模块，包括波动带与市场仪表盘。",
      },
      modules: ["te", "fb", "vb", "cp", "dash"],
      minTier: "pro",
    },
  ],
  pulse: [
    {
      id: "focused",
      name: { en: "Pulse Focus", zh: "脉冲聚焦" },
      description: {
        en: "The core momentum wave without signal, flow, or dashboard overlays.",
        zh: "仅显示核心动量波，不叠加信号、资金流或仪表盘。",
      },
      modules: ["wave"],
      minTier: "essential",
    },
    {
      id: "workflow",
      name: { en: "Pulse Workflow", zh: "脉冲工作流" },
      description: {
        en: "The Pulse Wave with its confirmed turn and continuation signals.",
        zh: "组合脉冲波及其确认后的转折与延续信号。",
      },
      modules: ["wave", "sig"],
      minTier: "essential",
    },
    {
      id: "research",
      name: { en: "Complete Pulse Research", zh: "完整脉冲研究" },
      description: {
        en: "All Pulse modules for divergence, participation, flow, and MTF analysis.",
        zh: "启用全部脉冲模块，用于背离、参与度、资金流与多周期分析。",
      },
      modules: ["wave", "sig", "div", "vmap", "flow", "mtf"],
      minTier: "pro",
    },
  ],
  rsix: [
    {
      id: "focused",
      name: { en: "RSI Focus", zh: "RSI 聚焦" },
      description: {
        en: "The configurable RSI engine on its own for a clean momentum read.",
        zh: "仅启用可配置 RSI 引擎，保持清晰的动量判断。",
      },
      modules: ["eng"],
      minTier: "essential",
    },
    {
      id: "workflow",
      name: { en: "RSI Workflow", zh: "RSI 工作流" },
      description: {
        en: "The RSI engine with reversal and deviation follow-through signals.",
        zh: "组合 RSI 引擎、反转信号与偏离跟进信号。",
      },
      modules: ["eng", "sig"],
      minTier: "essential",
    },
    {
      id: "research",
      name: { en: "Complete RSI Research", zh: "完整 RSI 研究" },
      description: {
        en: "All RSI modules for divergences, channels, and multi-timeframe context.",
        zh: "启用全部 RSI 模块，用于背离、通道与多周期环境分析。",
      },
      modules: ["eng", "sig", "div", "chan", "mtf"],
      minTier: "pro",
    },
  ],
  macdx: [
    {
      id: "focused",
      name: { en: "MACD Focus", zh: "MACD 聚焦" },
      description: {
        en: "The normalized MACD engine alone for an uncluttered momentum read.",
        zh: "仅启用标准化 MACD 引擎，保持清晰的动量判断。",
      },
      modules: ["eng"],
      minTier: "essential",
    },
    {
      id: "workflow",
      name: { en: "MACD Workflow", zh: "MACD 工作流" },
      description: {
        en: "The engine, reversal signals, and histogram as one practical workflow.",
        zh: "组合引擎、反转信号与柱状图，形成实用工作流。",
      },
      modules: ["eng", "sig", "hist"],
      minTier: "essential",
    },
    {
      id: "research",
      name: { en: "Complete MACD Research", zh: "完整 MACD 研究" },
      description: {
        en: "All MACD modules for divergences, phases, and multi-timeframe context.",
        zh: "启用全部 MACD 模块，用于背离、阶段与多周期环境分析。",
      },
      modules: ["eng", "sig", "hist", "div", "trend", "mtf"],
      minTier: "pro",
    },
  ],
};

export const DEFAULT_SUITE_PRESET: Readonly<Record<string, SuitePresetId>> = {
  structure: "focused",
  trend: "focused",
  pulse: "focused",
  rsix: "focused",
  macdx: "focused",
};

const TIER_RANK: Record<SuiteTier, number> = { free: 0, essential: 1, pro: 2 };

function requiredTier(suiteKey: string, modules: readonly string[]): SuiteTier | null {
  const suite = SUITE_DEFS[suiteKey];
  if (!suite || modules.length === 0) return null;
  let tier: SuiteTier = "free";
  for (const moduleKey of modules) {
    const moduleDef = suite.modules.find((candidate) => candidate.key === moduleKey);
    if (!moduleDef) return null;
    if (TIER_RANK[moduleDef.tier] > TIER_RANK[tier]) tier = moduleDef.tier;
  }
  return tier;
}

/**
 * Fail-fast validation for this internal catalog. A broken recipe is a source-code error, not
 * recoverable user input: silently accepting it would let the picker promise a setup the host
 * cannot render.
 */
export function validateSuitePresets(): void {
  const canonicalSuites = new Set<string>(SUITE_ORDER);
  const recipeSuites = Object.keys(PRESETS);
  if (recipeSuites.length !== canonicalSuites.size || recipeSuites.some((key) => !canonicalSuites.has(key))) {
    throw new Error("Suite presets must cover exactly the registered suites.");
  }

  for (const suiteKey of SUITE_ORDER) {
    const suite = SUITE_DEFS[suiteKey];
    const recipes = PRESETS[suiteKey];
    if (!suite || !recipes || recipes.length !== SUITE_PRESET_IDS.length) {
      throw new Error(`Suite preset catalog is incomplete for ${suiteKey}.`);
    }
    if (!recipes.some((recipe) => recipe.id === DEFAULT_SUITE_PRESET[suiteKey])) {
      throw new Error(`Default suite preset is missing for ${suiteKey}.`);
    }

    const seenIds = new Set<SuitePresetId>();
    const seenSelections = new Set<string>();
    let previousModules = new Set<string>();
    let previousTier = -1;

    for (let index = 0; index < recipes.length; index++) {
      const recipe = recipes[index];
      if (recipe.id !== SUITE_PRESET_IDS[index] || seenIds.has(recipe.id)) {
        throw new Error(`Suite preset ids are invalid for ${suiteKey}.`);
      }
      seenIds.add(recipe.id);
      if (!recipe.name.en.trim() || !recipe.name.zh.trim() || !recipe.description.en.trim() || !recipe.description.zh.trim()) {
        throw new Error(`Suite preset copy is incomplete for ${suiteKey}/${recipe.id}.`);
      }

      const selected = new Set(recipe.modules);
      if (selected.size !== recipe.modules.length || selected.size === 0) {
        throw new Error(`Suite preset modules are invalid for ${suiteKey}/${recipe.id}.`);
      }
      for (const moduleKey of selected) {
        if (!suite.modules.some((moduleDef) => moduleDef.key === moduleKey)) {
          throw new Error(`Unknown module ${suiteKey}/${moduleKey} in preset ${recipe.id}.`);
        }
      }
      for (const previous of previousModules) {
        if (!selected.has(previous)) {
          throw new Error(`Suite presets must be progressive for ${suiteKey}/${recipe.id}.`);
        }
      }
      previousModules = selected;

      const selectionKey = [...selected].sort().join(",");
      if (seenSelections.has(selectionKey)) {
        throw new Error(`Suite preset module selections must be distinct for ${suiteKey}.`);
      }
      seenSelections.add(selectionKey);

      const actualTier = requiredTier(suiteKey, recipe.modules);
      if (actualTier !== recipe.minTier || TIER_RANK[recipe.minTier] < previousTier) {
        throw new Error(`Suite preset tier is invalid for ${suiteKey}/${recipe.id}.`);
      }
      previousTier = TIER_RANK[recipe.minTier];
    }

    const complete = new Set(recipes[recipes.length - 1].modules);
    if (complete.size !== suite.modules.length || suite.modules.some((moduleDef) => !complete.has(moduleDef.key))) {
      throw new Error(`Research preset must include every registered module for ${suiteKey}.`);
    }
  }
}

validateSuitePresets();

/** All progressive recipes for one suite, in focused → workflow → research order. */
export function suitePresetsFor(suiteKey: string): readonly SuitePresetDef[] {
  const recipes = PRESETS[suiteKey];
  if (!recipes) return [];
  return recipes.map((recipe) => ({ ...recipe, suiteKey }));
}

/** Resolve a named recipe, or the suite's default recipe when `presetId` is omitted. */
export function resolveSuitePreset(
  suiteKey: string,
  presetId: SuitePresetId | string | undefined = DEFAULT_SUITE_PRESET[suiteKey],
): SuitePresetDef | null {
  if (!presetId) return null;
  return suitePresetsFor(suiteKey).find((preset) => preset.id === presetId) ?? null;
}

/**
 * Apply one recipe to the flat suite params blob. Only canonical module master toggles change.
 * Unknown suites/presets are a no-op copy so callers never lose data on a stale persisted id.
 */
export function applySuitePresetParams(
  suiteKey: string,
  presetId: SuitePresetId | string | undefined,
  currentParams: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const next = { ...(currentParams ?? {}) };
  const suite = SUITE_DEFS[suiteKey];
  const preset = resolveSuitePreset(suiteKey, presetId);
  if (!suite || !preset) return next;

  const selected = new Set(preset.modules);
  for (const moduleDef of suite.modules) next[`${moduleDef.key}.on`] = selected.has(moduleDef.key);
  return next;
}

/** Whether the effective module selection exactly matches one named recipe. */
export function matchesSuitePreset(
  suiteKey: string,
  presetId: SuitePresetId | string,
  currentParams: Readonly<Record<string, unknown>> | undefined,
): boolean {
  const suite = SUITE_DEFS[suiteKey];
  const preset = resolveSuitePreset(suiteKey, presetId);
  if (!suite || !preset) return false;
  const selected = new Set(preset.modules);
  return suite.modules.every((moduleDef) => {
    const saved = currentParams?.[`${moduleDef.key}.on`];
    const on = saved === undefined ? moduleDef.defaultOn : !!saved;
    return on === selected.has(moduleDef.key);
  });
}

/** Resolve the exact matching recipe, or null for a custom/legacy selection. */
export function matchSuitePreset(
  suiteKey: string,
  currentParams: Readonly<Record<string, unknown>> | undefined,
): SuitePresetDef | null {
  for (const preset of suitePresetsFor(suiteKey)) {
    if (matchesSuitePreset(suiteKey, preset.id, currentParams)) return preset;
  }
  return null;
}


// Cross-suite task recipes stay in this existing presentation-preset owner. They
// are not technical species, forecasts, signal scores or an execution policy.
export interface ChartWorkflowPreset {
  id: "reversal-reclaim";
  name: SuitePresetCopy;
  minTier: SuiteTier;
  suites: Readonly<Record<string, readonly string[]>>;
  classics: readonly string[];
  display: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
export const CHART_WORKFLOW_PRESETS: readonly ChartWorkflowPreset[] = [{
  id: "reversal-reclaim", name: { en: "Reversal & Reclaim", zh: "转折与收复" }, minTier: "pro",
  suites: { structure: ["sr", "sfp", "pat"], trend: ["te", "cp"], rsix: ["eng", "sig", "div"] },
  classics: ["gaps"],
  display: {
    structure: { "sr.showLast": 4, "sr.bufferZone": true, "pat.showLast": 1, "pat.targets": false, "sfp.showLast": 2, "sfp.showInvalid": true },
    trend: { "te.autoOpt": false, "te.bands": true, "te.shadow": false, "te.bgTint": false, "te.pills": false, "te.tiers": false, "te.retests": true, "te.tpMode": "off", "te.slMode": "off", "te.showLast": 1 },
    rsix: { "sig.signals": true, "sig.deviations": false, "sig.crossDots": false, "sig.showLast": 4, "div.hidden": false, "div.showLast": 3 },
    gaps: { showGaps: true, hideFilled: true },
  },
}];
export interface ChartWorkflowState {
  active: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
  params: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>;
}
export interface ChartWorkflowApplied {
  active: Set<string>;
  hidden: Set<string>;
  params: Record<string, Record<string, unknown>>;
}
export function resolveChartWorkflowPreset(id: string): ChartWorkflowPreset | null {
  return CHART_WORKFLOW_PRESETS.find(recipe => recipe.id === id) ?? null;
}
export function applyChartWorkflowPreset(id: string, current: ChartWorkflowState, classicKeys: ReadonlySet<string>): ChartWorkflowApplied | null {
  const recipe = resolveChartWorkflowPreset(id);
  if (!recipe) return null;
  // Noncatalogue extensions (e.g. comparisons/Pine) are not ours to remove.
  const active = new Set([...current.active].filter(key => !SUITE_DEFS[key] && !classicKeys.has(key)));
  const hidden = new Set(current.hidden);
  const params: Record<string, Record<string, unknown>> = {};
  for (const [key, fields] of Object.entries(current.params)) params[key] = { ...fields };
  for (const [suiteKey, moduleKeys] of Object.entries(recipe.suites)) {
    const suite = SUITE_DEFS[suiteKey];
    if (!suite || moduleKeys.some(key => !suite.modules.some(mod => mod.key === key))) return null;
    const selected = new Set(moduleKeys);
    const fields = { ...params[suiteKey] };
    for (const mod of suite.modules) fields[`${mod.key}.on`] = selected.has(mod.key);
    params[suiteKey] = fields;
    active.add(suiteKey); hidden.delete(suiteKey);
    for (const key of selected) hidden.delete(`suite:${suiteKey}/${key}`);
  }
  for (const key of recipe.classics) {
    if (!classicKeys.has(key)) return null;
    active.add(key); hidden.delete(key);
  }
  for (const [key, fields] of Object.entries(recipe.display)) params[key] = { ...params[key], ...fields };
  return { active, hidden, params };
}
function sameSavedValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameSavedValue(value, b[i]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && sameSavedValue(left[key], right[key]));
}
/** Ephemeral one-step UI undo guard: later custom edits must not be overwritten. */
export function sameChartWorkflowState(a: ChartWorkflowState, b: ChartWorkflowState): boolean {
  const sameSet = (x: ReadonlySet<string>, y: ReadonlySet<string>) => x.size === y.size && [...x].every(key => y.has(key));
  return sameSet(a.active, b.active) && sameSet(a.hidden, b.hidden) && sameSavedValue(a.params, b.params);
}
export function matchesChartWorkflowPreset(id: string, current: ChartWorkflowState, classicKeys: ReadonlySet<string>): boolean {
  const applied = applyChartWorkflowPreset(id, current, classicKeys);
  return applied !== null && sameChartWorkflowState(current, applied);
}
