// W1C reported-Gamma change inspector copy — descriptive only, in EN/ZH.
// The inspector says what changed between two reported sessions, never why:
// the banned-vocabulary lints below are enforced by exposureChangeInspectorCopy.test.ts.
export const COPY = {
  title: ["What changed in reported Gamma?", "报告 Gamma 有何变化？"],
  basis: ["Matched reported Gamma · same contracts on both sessions", "匹配的报告 Gamma · 两个交易日相同合约"],
  sessions: ["{previous} → {current}", "{previous} → {current}"],
  contracts: ["{n} contracts matched", "匹配 {n} 份合约"],
  matched: ["Matched", "已匹配"],
  previousOnly: ["Only in previous", "仅前一交易日"],
  currentOnly: ["Only in current", "仅当前交易日"],
  qualificationLost: ["Lost qualification", "失去资格"],
  qualificationGained: ["Gained qualification", "获得资格"],
  populationsNote: ["Counted separately; never added into the change.", "分别计数，不计入变化量。"],
  netChange: ["Net change", "净变化"],
  netMagnitude: ["Net magnitude change", "净幅度变化"],
  grossChange: ["Gross change", "总变化"],
  previousNet: ["Previous net", "前一交易日净值"],
  currentNet: ["Current net", "当前净值"],
  strike: ["Strike", "行权价"],
  moreStrikes: ["{n} more strikes", "另有 {n} 个行权价"],
  focusOutsideTop: ["Selected strike shown below the largest changes.", "所选行权价显示在最大变化之后。"],
  velocityNote: ["Two sessions only: no rate, no percent, no attribution.", "仅两个交易日：不计算速率、百分比或归因。"],
  noteDescriptive: ["Reported Gamma is a dated measurement, not observed dealer inventory.", "报告 Gamma 是按日期计量的数据，不是实际做市商库存。"],
  stateMissingBasis: ["No earlier reported session to match.", "没有可匹配的更早交易日。"],
  stateIdentity: ["The two sessions describe different instruments.", "两个交易日对应不同标的。"],
  stateScope: ["The two sessions use a different scope.", "两个交易日的范围不同。"],
  stateDefinition: ["The two sessions use a different definition.", "两个交易日的定义不同。"],
  stateTime: ["The sessions are out of order or undated.", "交易日顺序错误或缺少日期。"],
  stateMalformed: ["The source records could not be read.", "无法读取来源记录。"],
  stateEmptyIntersection: ["No contract appears on both sessions.", "没有合约同时出现在两个交易日。"],
  stateOneSession: ["Only one reported session is available; a comparison needs two.", "仅有一个交易日的数据，比较需要两个。"],
  stateInvalid: ["The comparison record could not be read.", "无法读取比较记录。"],
  selectStrike: ["Select strike {strike}", "选择行权价 {strike}"],
} as const;
export type ExposureChangeInspectorKey = keyof typeof COPY;
export const exposureChangeInspectorT = (lang: "en" | "zh") => (key: ExposureChangeInspectorKey): string => COPY[key][lang === "zh" ? 1 : 0];

export function fill(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
    template,
  );
}

/** C3 banned vocabulary: causal, predictive, flow or dealer-behaviour terms. */
export const BANNED_VOCABULARY_EN =
  /\b(because|caused?|causes|driven by|due to|dealers? (bought|sold|are|were)|positioning|hedging|flows?|predicts?|will|momentum|bullish|bearish|squeeze|pinned?)\b/i;
export const BANNED_VOCABULARY_ZH =
  /(因为|导致|由于|做市商(买入|卖出)|持仓意图|对冲|资金流|预测|将会|看涨|看跌|轧空|钉住)/;
