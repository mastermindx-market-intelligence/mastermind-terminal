import type { PivotEvidence, PivotField, PivotState } from "@/lib/bottomPivotContext";

// Same [en, zh] tuple convention as the incumbent LEX. Source identifiers stay
// verbatim; display copy never leaks the other locale into the current view.
const LEX = {
  title: ["Bottom-pivot evidence", "底部转折证据"],
  scope: ["Daily · single U.S. security", "日频 · 单只美股标的"],
  open: ["Inspect early-turn evidence", "查看早期转折证据"],
  close: ["Close evidence", "收起证据"],
  intro: ["See the existing early-turn marker alongside trend repair, price distance and adverse context. A moving-average reclaim is not required by this view.", "将既有的早期转折标记与趋势修复、价格距离及不利背景并列查看。本视图不要求先收复移动平均线。"],
  loading: ["Reading qualified source evidence…", "正在读取已限定的数据源证据…"],
  refresh: ["Refresh evidence", "刷新证据"],
  signIn: ["Sign in to read this source. No paid evidence was loaded.", "请登录后读取此数据源。尚未加载付费证据。"],
  entitled: ["This account does not have access to the source. No evidence is inferred from the access refusal.", "此账户无权访问该数据源。不会根据访问拒绝推断任何证据。"],
  failed: ["The source could not be read. This is unavailable evidence, not a negative signal.", "无法读取数据源。这代表证据不可用，并非负面信号。"],
  notCovered: ["No qualified pivot record exists for this symbol in the received source.", "收到的数据源中没有此标的的合格转折记录。"],
  invalid: ["The source identity, contract or clock could not be verified. No values are displayed.", "无法验证数据源身份、契约或时间戳。不显示任何数值。"],
  unsupported: ["This source covers U.S. securities only. Other markets are not inferred from the chart.", "此数据源仅覆盖美股标的。不会从图表推断其他市场的数据。"],
  historical: ["Historical as-issued reading — not current evidence", "历史发布时读数 — 并非当前证据"],
  snapshot: ["Current-snapshot reading at inspection", "查看时的当前快照读数"],
  available: ["All allowed fields observed", "全部允许字段均有观测"],
  partial: ["Partial evidence", "部分证据可用"],
  unavailable: ["No usable observations", "没有可用观测"],
  clock: ["Producer evaluation", "数据源评估时间"],
  inspected: ["Inspected", "查看时间"],
  usable: ["Usable fields", "可用字段"],
  unmeasured: ["Market, group and intraday bottom confirmation are not established by this daily stock record.", "这份日频个股记录不能确认市场、群组或盘中底部。"],
  noProbability: ["No calibrated probability, ranking or trade instruction. Missing adverse evidence is not positive evidence.", "不提供经校准的概率、排名或交易指令。缺少不利证据并不等于存在正面证据。"],
  firstSeen: ["Some original first-seen times are unknown; this snapshot cannot establish what was knowable at an earlier decision.", "部分原始首次可知时间未知；此快照不能证明较早决策时已经可以获知的信息。"],
  details: ["All fields, clocks and source limits", "全部字段、时间戳及数据源限制"],
  source: ["Source", "数据源"],
  vintage: ["Observation date", "观测日期"],
  firstKnown: ["First available", "首次可知时间"],
  unknown: ["Unknown", "未知"],
  yes: ["Yes", "是"],
  no: ["No", "否"],
  sourceState: ["Source state", "数据源状态"],
} as const;
export type BottomPivotKey = keyof typeof LEX;
export const pivotText = (zh: boolean, key: BottomPivotKey): string => LEX[key][zh ? 1 : 0];

const FIELD_LABEL: Record<PivotField, readonly [string, string]> = {
  trigger_tier: ["Trigger tier", "触发档位"],
  trigger_age_ticks: ["Trigger age (ticks)", "触发时长（tick）"],
  coiled: ["Cohort-washout context", "群体洗盘背景"],
  star: ["Existing star flag", "既有星标"],
  coiled_fire: ["Early-turn marker", "早期转折标记"],
  above200: ["Above 200-day trend", "位于200日趋势上方"],
  hold_state: ["Source holding state", "数据源持有状态"],
  hold_days_basing: ["Basing days", "筑底天数"],
  hold_ret_since_anchor_pct: ["Return since source anchor", "自数据源锚点以来收益"],
  knife_score: ["Source knife-risk index", "数据源接飞刀风险指数"],
  dist_21d_low_pct: ["Above 21-session low", "高于21交易日低点"],
  dist_126d_high_pct: ["Below 126-session high", "低于126交易日高点"],
  sponsorship_state: ["Sector sponsorship", "板块支撑背景"],
};
const STATE_LABEL: Record<PivotState, readonly [string, string]> = {
  observed: ["Observed", "已观测"], missing: ["Missing", "缺失"],
  stale: ["Stale", "过期"], future: ["After the cutoff", "晚于截止时间"],
  conflict: ["Conflicting records", "记录冲突"], invalid: ["Invalid source", "数据源无效"],
  not_known: ["Not known as issued", "发布时不可知"],
};
const SOURCE_STATE: Record<string, readonly [string, string]> = {
  basing: ["Basing", "筑底"], launched: ["Launched", "已启动"],
  tailwind: ["Tailwind", "顺风"], headwind: ["Headwind", "逆风"],
  neutral: ["Neutral", "中性"], stale: ["Stale", "过期"],
};
export const pivotFieldLabel = (field: PivotField, zh: boolean): string => FIELD_LABEL[field][zh ? 1 : 0];
export const pivotStateLabel = (state: PivotState, zh: boolean): string => STATE_LABEL[state][zh ? 1 : 0];
export function pivotValue(row: PivotEvidence, zh: boolean): string {
  if (row.state !== "observed" || row.value === null) return pivotStateLabel(row.state, zh);
  if (typeof row.value === "boolean") return pivotText(zh, row.value ? "yes" : "no");
  if (typeof row.value === "number") {
    const value = row.value.toLocaleString(zh ? "zh-CN" : "en-US", { maximumFractionDigits: 2 });
    return row.field.endsWith("_pct") ? `${value}%` : value;
  }
  return SOURCE_STATE[row.value]?.[zh ? 1 : 0] ?? row.value;
}
