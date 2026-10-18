// Nine-Bar Exhaustion — METADATA ONLY (identity, settings schema, parameter defaults).
// The pure calculation lives in lib/nineBarExhaustion.ts; this module is the native Trend-suite
// adapter and does not import proprietary DeMARK code or claim full Sequential 9–13 parity.

import type { SuiteField, SuiteModuleMeta } from "@/lib/indicator-canvas/types";

const FIELDS: SuiteField[] = [
  {
    key: "displayPolicy",
    label: "Display",
    labelZh: "显示方式",
    type: "select",
    options: [
      { v: "retro6", label: "Reveal at 6 (vendor style)", labelZh: "第6根后回显（平台风格）" },
      { v: "progressive", label: "Progressive 1–9", labelZh: "逐步显示 1–9" },
      { v: "completed", label: "Completed patterns only", labelZh: "仅显示完成形态" },
    ],
    tip: "Reveal-at-6 hides an unfinished sequence until count 6, then shows 1–6 together.",
    tipZh: "第6根前隐藏未完成序列；到达6后一次显示1–6。",
  },
  {
    key: "density",
    label: "Annotation Density",
    labelZh: "标注密度",
    type: "select",
    options: [
      { v: "all", label: "All eligible counts", labelZh: "全部有效计数" },
      { v: "late", label: "Late counts 6–9", labelZh: "后段计数 6–9" },
      { v: "completion", label: "Completed 9 only", labelZh: "仅显示完成的 9" },
    ],
    tip: "Reduces chart clutter without changing the calculation or alert events.",
    tipZh: "减少图表拥挤，不改变计算或提醒事件。",
  },
  {
    key: "requireFlip",
    label: "Require Price Flip",
    labelZh: "要求价格翻转",
    type: "bool",
    tip: "Optional DeMARK-like start prerequisite: count 1 must follow the opposite four-bar relation.",
    tipZh: "可选的类 DeMARK 起点条件：计数 1 前必须出现相反的四根K线比较关系。",
  },
  {
    key: "cycleMode",
    label: "Sustained Trend",
    labelZh: "持续趋势",
    type: "select",
    options: [
      { v: "single", label: "One completion per uninterrupted run", labelZh: "每段连续走势仅一次完成" },
      { v: "repeat", label: "Repeat every 9 qualifying bars", labelZh: "每 9 根合格K线重复" },
    ],
    tip: "Repeat mode emits completions at streaks 9, 18, 27… — never on every later candle.",
    tipZh: "重复模式在连续计数 9、18、27… 时完成，不会在之后每根K线上重复触发。",
  },
  {
    key: "showMarkers",
    label: "Completion Markers",
    labelZh: "完成标记",
    type: "bool",
    tip: "Draw a diamond at each finalized 9. Forming nines never receive a confirmed marker.",
    tipZh: "在每个已完成的 9 上绘制菱形；形成中的 9 不会获得确认标记。",
  },
  {
    key: "historyBars",
    label: "Recent History",
    labelZh: "最近历史",
    type: "number",
    min: 50,
    max: 5000,
    step: 50,
    tip: "Only annotations inside this many recent chart bars are drawn; events remain deterministic.",
    tipZh: "仅绘制最近指定K线范围内的标注；事件计算保持确定性。",
  },
  {
    key: "labelSize",
    label: "Label Size",
    labelZh: "标签大小",
    type: "number",
    min: 8,
    max: 16,
    step: 1,
  },
];

const DEFAULTS: Record<string, unknown> = {
  displayPolicy: "retro6",
  density: "all",
  requireFlip: false,
  cycleMode: "single",
  showMarkers: true,
  historyBars: 500,
  labelSize: 10,
};

export const NINE_BAR_EXHAUSTION_META: SuiteModuleMeta = {
  key: "nine",
  label: "Nine-Bar Exhaustion",
  labelZh: "九转衰竭",
  tag: "9X",
  tier: "free",
  defaultOn: false,
  fields: FIELDS,
  defaults: DEFAULTS,
};
