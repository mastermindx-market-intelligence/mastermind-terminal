/**
 * flowdeskStrings.ts — complete EN/ZH string table for the Flow Desk surface.
 *
 * Pattern: each key maps to [English, 中文].
 * Getter: getFlowStr(lang, key) → string.
 *
 * HONESTY DOCTRINE (enforced here):
 *   - Direction labels always carry a "(~soft)" qualifier.
 *   - Tier names are descriptive magnitude labels — no claim of edge.
 *   - The LEAN chip tooltip explicitly disclaims tick-rule derivation.
 *   - No "validated", "predictive", or "empirically confirmed" language.
 *   - "Lean" is the approved word for direction; "buy/sell" is never asserted.
 *
 * NOTE: translated strings MUST NOT appear in HTML title= attributes (CI-guarded).
 * Use aria-label or visible text spans instead.
 */

import type { Lang } from "@/lib/i18n";

// ─── String table type ───────────────────────────────────────────────────────

type FlowDeskKey = keyof typeof FLOW_LEX;

const FLOW_LEX = {
  // ── Tab ────────────────────────────────────────────────────────────────────
  tabFlow: ["Flow Desk", "资金流"],

  // ── Filter panel labels ────────────────────────────────────────────────────
  filterType:           ["Type", "期权类型"],
  filterTypeCall:       ["Call", "认购"],
  filterTypePut:        ["Put", "认沽"],
  filterTypeAll:        ["All", "全部"],
  filterLean:           ["Lean (~soft)", "倾向（~软性）"],
  filterLeanBuy:        ["~buy", "~买入"],
  filterLeanSell:       ["~sell", "~卖出"],
  filterLeanMixed:      ["mixed", "混合"],
  filterScore:          ["Min score", "最低评分"],
  filterDte:            ["DTE bucket", "到期分组"],
  filterDteZero:        ["0DTE", "当日到期"],
  filterDte1_7:         ["1–7d", "1–7天"],
  filterDte8_30:        ["8–30d", "8–30天"],
  filterDte31_90:       ["31–90d", "31–90天"],
  filterDte90p:         [">90d", ">90天"],
  filterMoneyness:      ["Moneyness", "价值状态"],
  filterMnyItm:         ["ITM", "实值"],
  filterMnyAtm:         ["ATM", "平值"],
  filterMnyNearOtm:     ["Near OTM", "近虚值"],
  filterMnyFarOtm:      ["Far OTM", "深虚值"],
  filterMinPremium:     ["Min premium", "最低权利金"],
  filterExecType:       ["Execution", "执行方式"],
  filterFreshOnly:      ["Fresh (vol>OI)", "新仓（量超持仓）"],
  filterRepeatOnly:     ["Cluster / repeat", "重复/集群"],
  filterBadge:          ["Badge", "标记"],
  filterReset:          ["Reset", "重置"],
  filterApply:          ["Apply", "应用"],

  // ── Score tiers (descriptive magnitude — no edge claims) ──────────────────
  tierElite:  ["ELITE",  "顶级"],
  tierStrong: ["STRONG", "强势"],
  tierHigh:   ["HIGH",   "较高"],
  tierMedium: ["MEDIUM", "中等"],
  tierLow:    ["LOW",    "偏低"],

  tierEliteDesc:  ["Top-magnitude event — largest premium + structure alignment", "高权利金+结构共振的顶级事件"],
  tierStrongDesc: ["Strong premium and positioning signal", "强权利金与持仓信号"],
  tierHighDesc:   ["Above-average premium with supporting signals", "高于均值的权利金与支撑信号"],
  tierMediumDesc: ["Moderate premium; mixed or weaker structure", "中等权利金；结构信号偏弱"],
  tierLowDesc:    ["Below threshold — included for completeness", "低于阈值，仅供参考"],

  // ── Badge names ────────────────────────────────────────────────────────────
  badgeWhale:   ["WHALE",   "巨鲸"],
  badgeCluster: ["CLUSTER", "集群"],
  badgeSweep:   ["SWEEP",   "扫单"],
  badgeUnusual: ["UNUSUAL", "异常"],
  badgeBlock:   ["BLOCK",   "大宗"],

  badgeWhaleDesc:   ["Premium ≥$1M single event", "单笔权利金≥100万美元"],
  badgeClusterDesc: ["Repeat-root: multiple prints on this underlying this session (not a $-sized campaign)", "重复标的：本时段该标的多次成交（非按金额的集群）"],
  badgeSweepDesc:   ["Multi-exchange heuristic — labeled, not confirmed aggressor", "多交易所启发式扫单 — 标记，非确认主动方"],
  badgeUnusualDesc: ["Premium activity is much higher than its typical one-year level", "权利金活跃度显著高于过去一年的常态"],
  badgeBlockDesc:   ["Large single-print block; size ≥500 contracts", "单笔大宗；规模≥500张"],

  // ── Flow Gauge labels ──────────────────────────────────────────────────────
  gaugeTitle:      ["Flow Gauge", "资金流量表"],
  gaugeCallPrem:   ["Call premium", "认购权利金"],
  gaugePutPrem:    ["Put premium", "认沽权利金"],
  gaugePcRatio:    ["P/C ratio", "认沽/认购比"],
  gaugeNetSoft:    ["Net (~soft)", "净值（~软性）"],
  gaugeSessionPct: ["Session", "盘中进度"],

  // ── Smart Money Radar ──────────────────────────────────────────────────────
  radarTitle:     ["Smart Money Radar", "聪明钱雷达"],
  radarSubtitle:  ["Ranked by premium activity versus the past trading year", "按权利金活动相对过去一年排名"],
  radarPremZ:     ["Activity", "活跃度"],
  radarGrossPrem: ["Gross prem", "总权利金"],
  radarCallShare: ["Call share", "认购占比"],
  radarNEvents:   ["Events", "事件数"],
  radarBaseline:  ["baseline warming", "基线积累中"],

  // ── Watchlist rail ─────────────────────────────────────────────────────────
  watchlistTitle:     ["Watchlist", "自选期权"],
  watchlistAdd:       ["Add ticker", "添加代码"],
  watchlistEmpty:     ["No tickers — add one to track its flow", "暂无代码，添加后可跟踪其资金流"],
  watchlistBestScore: ["Best score today", "今日最高评分"],
  watchlistNoFlow:    ["No flow today", "今日无流向"],

  // ── Inspector panel ────────────────────────────────────────────────────────
  inspectorTitle:      ["Inspector", "详情"],
  inspectorContract:   ["Contract", "合约"],
  inspectorPremium:    ["Premium", "权利金"],
  inspectorSize:       ["Size", "数量"],
  inspectorAvgPx:      ["Avg price", "均价"],
  inspectorDte:        ["DTE", "到期天数"],
  inspectorVolGtOi:    ["Vol > OI", "成交量>持仓"],
  inspectorVolGtOiYes: ["Yes — fresh positioning", "是 — 新开仓"],
  inspectorVolGtOiNo:  ["No", "否"],
  inspectorRepeated:   ["Repeated", "重复"],
  inspectorNPrints:    ["Prints", "笔数"],
  inspectorScore:      ["Flow score", "资金流评分"],
  inspectorScoreNote:  ["Magnitude-based composite — see components below", "基于权利金规模的综合评分 — 详见各分项"],
  inspectorComponents: ["Score components", "评分分项"],
  inspectorLean:       ["Lean (~soft)", "倾向（~软性）"],
  inspectorLeanNote:   ["Tick-rule derived — magnitude is the reliable read", "基于tick规则推算 — 权利金规模是可靠的读数"],
  inspectorClose:      ["Close", "关闭"],
  inspectorSessionCtx: ["Session context", "当日概况"],

  // ── Card expand affordance (v7b — chevron button with its own hit slot) ───
  cardExpand:   ["Show score breakdown", "展开评分拆解"],
  cardCollapse: ["Hide score breakdown", "收起评分拆解"],
  cardPenalty:  ["penalty", "扣分"],

  // ── Chain Heat rail ────────────────────────────────────────────────────────
  chainHeatTitle:     ["Chain Heat", "链式热度"],
  chainHeatSubtitle:  ["Contract-day accumulation ≥$3M", "合约日累计权利金≥300万美元"],
  chainHeatAlertCt:   ["hits", "笔"],
  chainHeatSpan:      ["span", "时长"],
  chainHeatAskShare:  ["at ask", "按卖价成交"],
  chainHeatFirstSeen: ["first seen", "首次出现"],
  chainHeatDte:       ["DTE", "到期天数"],
  chainHeatLeanAccum: ["accumulation", "积累"],
  chainHeatLeanDist:  ["distribution", "派发"],
  chainHeatContested: ["contested", "争议"],
  chainHeatLeanNote:  ["ask-share derived — not NBBO", "基于卖价成交比 — 非NBBO"],
  chainHeatEmpty:     ["No campaigns today — accumulation threshold ≥$3M", "今日无集群 — 累计阈值≥300万美元"],
  chainHeatLoading:   ["Loading chain heat…", "加载链式热度中…"],

  // ── Soft-direction tooltip (HONESTY DOCTRINE — the key required copy) ──────
  leanTooltip: [
    "Lean is tick-rule derived — magnitude is the reliable read. Direction without NBBO is approximate (~0.41 recovery). Color and rank use premium size, not asserted side.",
    "倾向基于tick规则推算 — 权利金规模才是可靠读数。无NBBO时方向为近似值（约0.41正确率）。颜色与排名基于权利金规模，非声称的买卖方向。",
  ],

  // ── Empty / loading states ─────────────────────────────────────────────────
  loading:       ["Loading…", "加载中…"],
  loadingFeed:   ["Loading flow feed…", "加载资金流中…"],
  loadingRadar:  ["Loading radar…", "加载雷达中…"],
  emptyFeed:     ["No events match the current filters", "当前筛选无匹配事件"],
  emptyFeedHint: ["Try clearing filters or lowering the min-premium threshold", "尝试清除筛选条件或降低最低权利金阈值"],
  errFeed:       ["Could not load flow feed", "无法加载资金流"],
  errRetry:      ["Retry", "重试"],

  // ── Misc ───────────────────────────────────────────────────────────────────
  scoreLabel:       ["Score", "评分"],
  premiumLabel:     ["Prem", "权利金"],
  sideLabel:        ["Side", "方向"],
  sizeLabel:        ["Size", "数量"],
  dteLabel:         ["DTE", "到期天数"],
  strikeLabel:      ["Strike", "行权价"],
  expLabel:         ["Exp", "到期日"],
  typeCall:         ["Call", "认购"],
  typePut:          ["Put", "认沽"],
  displayOnly:      ["Display-only — not investment advice", "仅供展示 — 非投资建议"],
  spreadUnreliable: ["spread — direction unreliable", "价差 — 方向不可靠"],
  scoreHonesty:     [
    "Score reflects magnitude/activity/novelty — not a win-rate prediction. Tiers are descriptive; no historical predictive edge until a forward ledger gates authority.",
    "评分反映规模、活跃度和新鲜程度，不是胜率预测。等级只是描述；在前瞻账本完成之前，没有历史预测效力。",
  ],
  directionLean:    ["Direction lean", "方向倾向"],
  tickRuleInferred: ["tick-rule inferred, not NBBO-confirmed", "由成交价变动规则推断，未经买卖报价确认"],
  softDirection:    ["~soft direction", "~软性方向"],
  noNbbo:           ["Direction without NBBO is approximate", "无NBBO时方向为近似值"],
  baselineWarming:  ["baseline warming (<30 sessions)", "基线积累中（<30个交易日）"],
} as const;

// ─── Typed getter ─────────────────────────────────────────────────────────────

/**
 * Get a localized string from the Flow Desk string table.
 *
 * @param lang - "en" | "zh"
 * @param key  - A key from FLOW_LEX
 * @returns The localized string for the given language.
 *
 * Usage:
 *   const t = (key: FlowDeskKey) => getFlowStr(lang, key);
 *   t("leanTooltip") // returns the EN or ZH string depending on lang
 */
export function getFlowStr(lang: Lang, key: FlowDeskKey): string {
  const entry = FLOW_LEX[key];
  return lang === "zh" ? entry[1] : entry[0];
}

/**
 * Returns a bound getter for a fixed language — useful inside components.
 *
 * @param lang - "en" | "zh"
 * @returns (key: FlowDeskKey) => string
 *
 * Usage:
 *   const t = makeFlowT(lang);
 *   t("tierElite") // "ELITE" or "顶级"
 */
export function makeFlowT(lang: Lang): (key: FlowDeskKey) => string {
  return (key: FlowDeskKey) => getFlowStr(lang, key);
}

// Export the key type for consuming components
export type { FlowDeskKey };

// ─── Compat exports for pre-generated component stubs ────────────────────────
// Components under terminal/components/flowdesk/ import `FD` (an object with
// { en, zh } per key) and `strings` (imported but currently unused).
// These aliases keep those imports compiling without modifying components.

type BiStr = { en: string; zh: string };

function bi(en: string, zh: string): BiStr { return { en, zh }; }

/**
 * FD — flat object of bilingual string pairs, for components that use the
 * `FD.keyName.en` / `FD.keyName.zh` access pattern.
 */
export const FD = {
  // Used in RadarStrip
  smartMoneyRadar: bi(...FLOW_LEX.radarTitle),
  radarBaseline:   bi(...FLOW_LEX.radarBaseline),
  // Used in FlowGauge
  sessionGauge:    bi(...FLOW_LEX.gaugeTitle),
  sessionOverview: bi("Session overview", "盘中概览"),
  // Used in InspectorPane
  inspectorEmpty:  bi("Select an event to inspect", "选择事件查看详情"),
  // Used in watchlist rail
  watchlist:       bi(...FLOW_LEX.watchlistTitle),

  // ── v7 institutional pass (additive) ─────────────────────────────────────
  // Inspector: the blank-until-selection state now says what a selection buys you.
  inspectorEmptyWhy: bi(
    "Click any card in the feed to open its full breakdown — score components, contract fields, detections, and the ticker's session context.",
    "点击信息流中的任意卡片，即可展开完整拆解——评分分项、合约字段、检测信号，以及该标的当日概况。",
  ),

  // Watchlist rail column label (was an untranslated literal).
  watchlistScoreCol: bi(...FLOW_LEX.scoreLabel),

  // Radar empty state — states WHY the list is empty, never a bare "no data".
  radarEmpty:    bi("No unusual activity", "暂无异常活动"),
  radarEmptyWhy: bi(
    "Nothing on the tape is running far enough above its one-year premium norm to rank yet.",
    "目前尚无标的的权利金明显高于其一年常态水平，故暂无排名。",
  ),

  // Feed empty / loading states — each branch names the real reason.
  feedLoading:      bi(...FLOW_LEX.loadingFeed),
  feedEmptyFiltered: bi("No signals match your filters", "无符合筛选条件的信号"),
  feedEmptyFilteredWhy: bi(
    "Every event on today's tape is excluded by the active filters. Clear them, or lower the min-premium / min-score threshold.",
    "当前筛选条件排除了今日磁带上的所有事件。请清除筛选，或降低最低权利金／最低评分阈值。",
  ),
  feedEmptyQuiet: bi("No signals yet", "暂无信号"),
  feedEmptyClosedWhy: bi(
    "Market closed — showing the last session outside US options regular hours (09:30–16:00 ET). New source snapshots resume after the next open.",
    "市场休市 — 美股期权常规交易时段（美东 09:30–16:00）之外显示上一交易时段。下次开盘后恢复新的源数据快照。",
  ),
  feedEmptyOpenWhy: bi(
    "The regular-hours session is current, but nothing has cleared the desk's magnitude bar in the latest published source snapshot.",
    "当前常规交易时段仍在进行，但最新发布的源数据快照中尚无事件达到本台的规模门槛。",
  ),
  feedEmptyStaleWhy: bi(
    "The last payload is stale, so this is the previous session's tape rather than today's.",
    "最新数据已过期，此处显示的是上一交易时段的磁带，而非今日数据。",
  ),

  // Filter-panel badge tooltips — EN text unchanged; zh added so the aria-label
  // no longer leaks English into the 中文 view.
  filterTipWhale: bi(
    "Premium ≥$1M (magnitude gate — reliable)",
    "权利金≥100万美元（规模门槛——可靠）",
  ),
  filterTipCluster: bi(
    "Repeat-root: multiple prints on the same underlying this session (repeat/multi-print flag — not a $ threshold)",
    "重复标的：本时段同一标的多次成交（重复／多笔标记——非金额门槛）",
  ),
  filterTipSweep: bi(
    "Multi-print heuristic — aggressor direction is unverified (no NBBO)",
    "多笔成交启发式——主动方方向未经确认（无NBBO）",
  ),
  filterTipUnusual: bi(
    "Premium activity is much higher than its typical level over the past trading year.",
    "权利金活跃度显著高于过去一个交易年度的常态水平。",
  ),
  filterTipBlock: bi(
    "Single-print size ≥ block threshold (exchange-reported; not direction-signed)",
    "单笔成交规模≥大宗门槛（交易所报告；未标注方向）",
  ),
  detTipWhale: bi(
    "Single-event premium ≥$1M. Magnitude gate — reliable.",
    "单笔事件权利金≥100万美元。规模门槛——可靠。",
  ),
  detTipMultiLeg: bi(
    "Spread detected: 2+ strikes, same root, ≤60s. Direction is DISCOUNTED — reads as spread, not naked.",
    "识别为价差：同一标的、2个及以上行权价、间隔≤60秒。方向已降权——按价差解读，而非单腿。",
  ),
  detTipLadder: bi(
    "Same root+right, ≥3 distinct strikes, same lean within 30 min — staged accumulation.",
    "同一标的与期权类型、≥3个不同行权价、30分钟内同向——分批建仓。",
  ),
  detTipRepeat: bi(
    "Same OCC contract in ≥3 separate events this session — conviction re-load.",
    "本时段同一OCC合约出现于≥3次独立事件——反复加仓。",
  ),
  detTipSizeVsOi: bi(
    "Event size ≥ 2× prior-day OI — new positioning that can't hide in existing interest.",
    "事件规模≥前一日持仓量的2倍——新增头寸，无法藏于既有持仓中。",
  ),
  detTipFresh: bi(
    "Vol > OI: new positioning, not recycled open interest.",
    "成交量>持仓量：新建头寸，而非既有持仓的换手。",
  ),
  detTipZOutlier: bi(
    "Ticker-level premium activity is much higher than its typical level over the past trading year.",
    "该标的的权利金活跃度显著高于过去一个交易年度的常态水平。",
  ),
  leanHeuristic: bi(
    "Direction is tick-rule heuristic — not NBBO-verified",
    "方向由成交价变动规则推断，未经买卖报价确认",
  ),
  allExpirations: bi("All expirations", "全部到期"),
  sweepHeuristic: bi(
    "Sweep is heuristic — aggressor not NBBO-confirmed",
    "扫单是启发式判断，未经买卖报价确认主动方",
  ),
  detectionsCaveat: bi(
    "Detections from enrich artifact; absent/stale → v1 behavior, badges hidden.",
    "检测信号来自富集数据；文件缺失或过期时退回基础筛选，徽章会隐藏。",
  ),
  resetFilters: bi("Reset filters", "重置筛选"),
} as const;

/**
 * strings — legacy named export (imported but not yet accessed in components).
 * Forwards to the same FLOW_LEX table via the getFlowStr interface.
 */
export const strings = {
  get: getFlowStr,
  make: makeFlowT,
} as const;

// ─── Score-component labels (v7b) ─────────────────────────────────────────────
/**
 * The flow-score components arrive from the server (lib/flowScore.ts) carrying an
 * ENGLISH `label` only — there is no `label_zh` on the wire. Rendering that label
 * directly leaked English into the 中文 view on both the card detail panel and the
 * inspector. This table re-localises by the component's stable `key`; the server
 * label stays the fallback for any key added upstream before this table catches up.
 *
 * Keys mirror lib/flowScore.ts `components[].key` exactly.
 */
const FLOW_SCORE_LABELS: Record<string, readonly [string, string]> = {
  premiumMagnitude:     ["Premium magnitude",            "权利金规模"],
  unusualness:          ["Activity vs one-year norm",    "相对一年常态的活跃度"],
  dteRelevance:         ["DTE relevance",                "到期天数相关性"],
  freshPositioning:     ["Fresh positioning (vol>OI)",   "新建头寸（量>持仓）"],
  moneynessProximity:   ["Moneyness proximity",          "价值状态接近度"],
  repeatCluster:        ["Repeat / cluster",             "重复／集群"],
  directionReliability: ["Direction-reliability penalty", "方向可靠性扣分"],
};

/**
 * Localised label for one flow-score component.
 *
 * @param lang     - "en" | "zh"
 * @param key      - component key from the server payload
 * @param fallback - the server-supplied EN label (used when the key is unknown)
 */
export function scoreComponentLabel(lang: Lang, key: string, fallback?: string): string {
  const entry = FLOW_SCORE_LABELS[key];
  if (entry) return lang === "zh" ? entry[1] : entry[0];
  return fallback || key;
}
