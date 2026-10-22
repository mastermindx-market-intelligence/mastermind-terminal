// Strings for the Exposure scenario panel (LEX [en, zh] tuples, exposureMapStrings pattern).
// Every visible string in ExposureScenario.tsx goes through exposureScenarioT — never a raw
// enum or refusal value rendered as copy.
const COPY = {
  localLinear: ["Local linear", "局部线性"],
  repricedHeld: ["Repriced curve · held", "全量重定价 · 暂缓"],
  repricedTitle: ["Full repricing is not admitted", "未接纳全量重定价"],
  resetToSpot: ["Reset to spot", "重置到现价"],
  spotMove: ["SPOT MOVE", "现货变动"],
  volShift: ["VOL SHIFT · absolute · all tenors", "波动率变动 · 绝对 · 全期限"],
  timeDays: ["TIME · calendar", "时间 · 日历日"],
  pt: ["pt", "点"],
  day: ["day", "天"],
  admittedSummary: ["ADMITTED SUMMARY · {session}", "已接纳汇总 · {session}"],
  vannaCharmUnavailable: ["Vanna · Charm unavailable", "Vanna · Charm 不可用"],
  unavailable: ["unavailable", "不可用"],
  localValueCaption: ["local scenario value · unrounded move fraction", "局部情景值 · 未取整的变动比例"],
  spotTerm: ["SPOT TERM", "现货项"],
  volTerm: ["VOL TERM", "波动率项"],
  timeTerm: ["TIME TERM", "时间项"],
  joint: ["JOINT", "联合"],
  jointNotAdmitted: ["not admitted · terms add linearly", "未接纳 · 各项线性相加"],
  chartEyebrow: ["LOCAL SCENARIO VALUE · $ · SPOT MOVE FROM {ref} · {days} DAY", "局部情景值 · $ · 自 {ref} 的现货变动 · {days} 天"],
  emBand: ["EXPECTED MOVE 1σ ±{pct}%", "预期波动 1σ ±{pct}%"],
  sigmaChip: ["Δσ {pts} pt", "Δσ {pts} 点"],
  sigmaZero: ["Δσ 0", "Δσ 0"],
  selected: ["selected", "已选"],
  footerFormula: ["−GEX·(ΔS/S ÷ 1%) − VEX·(Δσ ÷ 1%) − CEX·days on the admitted summary. Rounding the move to −0.04% would give 184.68M; the fraction is never rounded.", "在已接纳汇总上计算 −GEX·(ΔS/S ÷ 1%) − VEX·(Δσ ÷ 1%) − CEX·days。若将变动取整为 −0.04% 会得到 184.68M；比例从不取整。"],
  oracleTag: ["oracle 499/499", "oracle 499/499"],
  tabScenario: ["SCENARIO", "情景"],
  tabWorked: ["WORKED", "算例"],
  localValue: ["local value", "局部值"],
  fromRef: ["from {ref} · {pct}", "自 {ref} · {pct}"],
  inputsIndependent: ["Inputs independent · not joint", "各输入独立 · 非联合"],
  basis: ["BASIS", "基准"],
  admittedLine: ["admitted GEX {gex} · VEX {vex} · CEX {cex}", "已接纳 GEX {gex} · VEX {vex} · CEX {cex}"],
  caveat: ["Linear in each input around the reference spot. The value is a book sensitivity, not a forecast, and it carries no hold-rate or direction claim.", "围绕参考现货对每个输入线性化。该值是持仓敏感度，不是预测，也不构成任何守住率或方向判断。"],
  resetInputs: ["Reset inputs", "重置输入"],
  openInExposure: ["Open in Exposure ↗", "在 Exposure 中打开 ↗"],
  workedRounded: ["Rounded move would give {v}", "取整后的变动会得到 {v}"],
  selfCheckFailed: ["Self-check failed", "自检失败"],
  notAdmittedTitle: ["Scenario needs a qualified projection", "情景需要合格的投影"],
  notAdmittedBody: ["Dated and aggregate books carry no local value.", "按日期近似与聚合账本没有局部值。"],
  needVex: ["Vol shift needs an admitted VEX", "波动率变动需要已接纳的 VEX"],
  needCex: ["Time needs an admitted CEX", "时间项需要已接纳的 CEX"],
  outOfRange: ["Outside the local range (±3% · ±5 pt · ≤ 5 days)", "超出局部范围（±3% · ±5 点 · ≤ 5 天）"],
  invalid: ["Inputs are not valid", "输入无效"],
} as const;

export type ScenarioKey = keyof typeof COPY;
export const exposureScenarioT = (lang: "en" | "zh") =>
  (key: ScenarioKey, vars?: Record<string, string>): string => {
    const s = COPY[key][lang === "zh" ? 1 : 0];
    if (!vars) return s;
    return Object.entries(vars).reduce<string>((acc, [k, v]) => acc.split(`{${k}}`).join(v), s);
  };
