/**
 * setupStrings.ts — bilingual EN/ZH strings for the company case surface
 * (Lane C: T2-C5 case-unpublished Setup, T2-03 / SX03 plan row, T2-04
 * Evidence, T2-17 Context, T2-16 sources, T2-20 save/follow states).
 *
 * HONESTY DOCTRINE (same law as prophetSectorStrings):
 *   - The case opens with the company, its served Prophet state and the plain
 *     fact that the written case is not published yet (T2-C5). No entry, stop,
 *     target or sizing copy ever leads — trade geometry lives in Plans.
 *   - What is missing is said ONCE, in one card, in reader words. No developer
 *     placeholders, no "not served" / "in this read" / "board read" / raw ids.
 *   - Numbers carry meaning (pp, sessions, X of Y); one date per row, labeled
 *     by what it actually dates.
 *   - Translated strings never appear in HTML title= attributes.
 *
 * Shared vocabulary with the sector lane (state labels, reasons, sessions,
 * membership, retry) stays in prophetSectorStrings.ts and is imported
 * read-only.
 */

import type { Lang } from "@/lib/i18n";

export type TroughHeadlineVariant = "count" | "named";
/** Held copy choice: this constant is the sole switch for headline/method/record. */
export const TROUGH_HEADLINE_VARIANT: TroughHeadlineVariant = "named";
/** CEO-ruled record copy is enabled independently of the rollout flag. */
export const TROUGH_RECORD_ENABLED = true;
export const TROUGH_STRINGS = {
  en: {
    title: "Trough read", unavailable: "Not available", unavailableBody: "This read is not available for this stock yet.",
    variants: {
      count: { headline: "Washed out on {n} of 4 timeframes · {suffix}", record: "Measured on about 22,000 past turns in large and mid-size US stocks, 2013–2019. On average they did no better than the market.", method: "Which timeframe matters for which kind of stock is still being measured; this headline only counts.", disclosureNote: "Which timeframe matters for which kind of stock is still being measured; this headline only counts." },
      named: { headline: "Washed out on {list}{notPart} · {suffix}", record: "Measured on about 22,000 past turns in large and mid-size US stocks, 2013–2019. On average they did no better than the market.", method: "More timeframes washed out means a deeper decline. It has not been shown to make the low more likely to hold.", disclosureNote: "Which timeframe matters for which kind of stock is still being measured; this headline only lists them." },
    },
    namedNone: "Not washed out on any timeframe", notPart: "; not on {rest}", notYet: "Not yet available", kindPending: "Kind: not yet available",
    notWashed: "not washed out", turning: "turning up", notTurned: "not yet turned", none: "none",
    frames: { "1D": "Daily", "3D": "3‑day", "1W": "Weekly", "2W": "2‑week" },
    kinds: { steady: "steady compounder", leans_steady: "leans steady compounder", middle: "between steady and cyclical", leans_cyclical: "leans cyclical, high-beta", cyclical: "cyclical, high-beta" },
    states: { FALLING: "Falling", WASHED_OUT: "Washed out", BASING: "Basing", TURNING: "Turning", NOT_WASHED_OUT: "Not washed out" },
    kind: "Kind: {kind}", group: "Group ({name}): {state}", open: "How this read works ▸", how: "How this read works", hide: "Hide ▴",
    washed: "● Washed out", notWashedRow: "○ Not washed out", turned: "↗ Turned up", falling: "↘ Still falling",
    turnedCount: "Turned up on {k} of {n} washed-out timeframes",
    definitions: ["Washed out means momentum is unusually low for that timeframe. A mark appears only after its timeframe's bar has closed. Only completed bars count.", "Turned up is read on 3‑day bars only: momentum crossed back up after sitting in its low zone, and a faster momentum gauge was rising too. Only completed bars count.", "Kind and own history describe the stock. They are not a judgement of it.", "Nothing here predicts a turn."],
    history: "AGAINST ITS OWN HISTORY", comparisons: { about_usual: "This washout is about as deep as its usual ones.", shallower: "This washout is shallower than its usual ones.", deeper: "This washout is deeper than its usual ones." },
    noDecline: "No decline right now, so there is nothing to compare with its group.", shallower: "← Shallower", thisOne: "◯ This one", deeper: "Deeper →",
    historyLegend: "Ring: this washout · grey dots: past ones", noHistoryLegend: "Grey dots: past washouts · none now", date: "Date", depth: "Depth (ATRc)",
    kindTitle: "WHAT KIND OF STOCK", steady: "Steady compounder", cyclical: "Cyclical, high-beta", kindBody: "A washout reads differently for a steady compounder than for a cyclical, high-beta stock.",
    groupTitle: "ITS GROUP · {name}", source: "From Sector Intelligence", groupFields: "Group figures: not yet available",
    provenance: { shared_with_group: "Most of this decline was shared with its group", own: "Most of this decline was its own" },
    groupStates: "GROUP STATES", stateList: "Falling · Washed out · Basing · Turning · Not washed out", groupMeaning: "Turning describes the group's momentum, not this stock's momentum.",
    boxed: "Group figures describe the group; they do not change how this stock's read should be taken.",
  },
  zh: {
    title: "低谷解读", unavailable: "暂不可用", unavailableBody: "该股票暂未提供此项解读。",
    variants: {
      count: { headline: "4个周期中有{n}个处于低位 · {suffix}", record: "基于2013–2019年美国大中型股约22,000次历史转折测算。平均而言，其表现并未优于大盘。", method: "哪种股票应着重看哪个周期仍在研究中；此标题只作计数。", disclosureNote: "哪种股票应着重看哪个周期仍在研究中；此标题只作计数。" },
      named: { headline: "处于低位：{list}{notPart} · {suffix}", record: "基于2013–2019年美国大中型股约22,000次历史转折测算。平均而言，其表现并未优于大盘。", method: "更多周期处于低位意味着跌幅更深。尚无证据表明这会使低点更可能守住。", disclosureNote: "哪种股票应着重看哪个周期仍在研究中；此标题只列出这些周期。" },
    },
    namedNone: "所有周期均未处于低位", notPart: "；{rest}未处于低位", notYet: "尚未提供", kindPending: "类型：尚未提供",
    notWashed: "未处于低位", turning: "正在回升", notTurned: "尚未回升", none: "无",
    frames: { "1D": "日线", "3D": "3日线", "1W": "周线", "2W": "2周线" },
    kinds: { steady: "稳健复利型", leans_steady: "偏稳健复利型", middle: "介于稳健与周期型之间", leans_cyclical: "偏周期型、高贝塔", cyclical: "周期型、高贝塔" },
    states: { FALLING: "下行", WASHED_OUT: "低位", BASING: "筑底", TURNING: "回升", NOT_WASHED_OUT: "未处于低位" },
    kind: "类型：{kind}", group: "所属组（{name}）：{state}", open: "解读方法 ▸", how: "解读方法", hide: "收起 ▴",
    washed: "● 低位", notWashedRow: "○ 未处于低位", turned: "↗ 已回升", falling: "↘ 仍下行", turnedCount: "{n}个低位周期中有{k}个已回升",
    definitions: ["低位指该周期的动量异常低。标记仅在该周期柱结束后出现。只计算已完成的周期柱。", "回升只在3日K线上判断：动能在低位区停留后重新上穿，且一个更快的动能指标也在上升。只计算已完成的K线。", "类型和自身历史描述股票本身，并非对其作出评价。", "这里的内容不预测转折。"],
    history: "与自身历史相比", comparisons: { about_usual: "此次低位深度与以往通常情况相近。", shallower: "此次低位比以往通常情况更浅。", deeper: "此次低位比以往通常情况更深。" },
    noDecline: "目前没有下跌，因此没有可与所属组比较的跌幅。", shallower: "← 更浅", thisOne: "◯ 本次", deeper: "更深 →", historyLegend: "圆环：本次低位 · 灰点：历史低位", noHistoryLegend: "灰点：历史低位 · 目前无低位", date: "日期", depth: "深度（ATRc）",
    kindTitle: "股票类型", steady: "稳健复利型", cyclical: "周期型、高贝塔", kindBody: "稳健复利型股票与周期型、高贝塔股票的低位含义不同。",
    groupTitle: "所属组 · {name}", source: "来自行业情报", groupFields: "组内数据：尚未提供", provenance: { shared_with_group: "此次跌幅大部分与所属组共同发生", own: "此次跌幅大部分来自个股自身" },
    groupStates: "组内状态", stateList: "下行 · 低位 · 筑底 · 回升 · 未处于低位", groupMeaning: "回升描述所属组的动量，而非这只股票的动量。", boxed: "组内数据描述所属组，不改变对该股票解读的理解方式。",
  },
} as const;

export const SETUP_LEX = {
  // ── Arrival / return (P1-7) ──────────────────────────────────────────────
  crumbsMembers:      ["members", "成分"],
  crumbsSelected:     ["selected", "已选中"],
  crumbsShort:        ["Sector members", "行业成员"],
  backToMembers:      ["Back to sector members", "返回行业成员"],

  // ── Case header (T2-C5: the honest case state IS the headline) ───────────
  caseUnpublished:    ["Case not published yet", "案例尚未发布"],

  // ── Tabs ──────────────────────────────────────────────────────────────────
  tabsLabel:          ["Case sections", "案例板块"],
  tabSetup:           ["Setup", "研究"],
  tabEvidence:        ["Evidence", "证据"],
  tabContext:         ["Context", "背景"],

  // ── SI breadth read (SR-05–08; description, independent of Prophet) ─────
  rotationTitle:       ["Sector and theme rotation", "行业与主题轮动"],
  rotationCopy:        ["Breadth change inside the group on today's roster. Description only; not a forecast.", "基于当前成员名单的组内广度变化。仅描述现状，不作预测。"],
  rotationSource:      ["From Sector Intelligence", "来自行业情报"],
  rotationWeek:        ["Week ending {date}", "截至 {date} 的一周"],
  rotationAsOf:        ["As of {date}", "截至 {date}"],
  rotationSector:      ["SECTOR", "行业"],
  rotationTheme:       ["THEME", "主题"],
  rotationImproving:   ["Improving", "改善"],
  rotationFlat:        ["Flat", "持平"],
  rotationDeteriorating: ["Deteriorating", "走弱"],
  rotationFew:         ["Too few members to read", "成员过少，无法解读"],
  rotationChange:      ["Share of members above their 200-day average: {value} over 13 weeks", "高于200日均线的成员占比：13周变化 {value}"],
  rotationLongChange:  ["26 weeks: {value}", "26周变化：{value}"],
  rotationPoints:      ["{value} pts", "{value} 个百分点"],
  rotationMoreOne:     ["+1 more theme", "+1 个主题"],
  rotationMore:        ["+{n} more themes", "+{n} 个主题"],

  // ── Setup · the one unavailable card (T2-C5) ─────────────────────────────
  caseUnavailable:    ["Research case unavailable", "研究案例不可用"],
  caseUnavailableBody: ["The source has not published a case for {symbol}. We show what is missing rather than fill it in.", "数据源尚未为 {symbol} 发布研究案例。我们如实说明缺失内容，而不是自行填补。"],
  rowVerdict:         ["Verdict headline", "结论标题"],
  rowFamily:          ["Research family", "研究族系"],
  rowSupports:        ["Supports and challenges", "支持与质疑"],
  rowNext:            ["Next check", "下次核验"],
  rowEntry:           ["Entry assessment", "入场评估"],
  valueNotAvailable:  ["Not available", "暂不可用"],
  valueUnavailable:   ["Unavailable", "不可用"],
  cardObserved:       ["Latest observation {date}", "最新观察 {date}"],

  // ── Setup · "You can still study" (T2-C5) ────────────────────────────────
  studyLinksTitle:    ["You can still study", "你仍然可以研究"],
  linkEvidence:       ["Company evidence", "公司证据"],
  linkContext:        ["Context and peers", "背景与同业"],

  // ── Setup · study card (G9) ──────────────────────────────────────────────
  studyTitle:         ["Separate the common move from the name", "区分共同波动与个股表现"],
  studyIntro:         ["Market and {group} over the same {n} sessions.", "市场与{group}在同一窗口（{n} 个交易日）内的表现。"],
  studyNameLeg:       ["{symbol} own return", "{symbol} 自身收益"],
  studyFootnote:      ["These two legs explain the shared move. This company's own return is not published yet, so the decomposition stays open.", "这两条腿解释的是共同波动。该股票自身的表现尚未发布，因此拆解保持开放。"],
  studyBreadth:       ["{above} of {measured} group members above trend over this window.", "该窗口内 {measured} 只成分中 {above} 只位于趋势上方。"],
  studyIssuerNote:    ["Issuer exclusion is not stated.", "未说明是否剔除发行人自身。"],

  // ── Setup / rail · the original model plan row (T2-C5, T2-03) ───────────
  planRowTitle:       ["Original model plan", "原始模型计划"],
  planRowOpened:      ["Opened {date}.", "建立于 {date}。"],
  planRowLine:        ["Entry, stop and targets are in Plans. A model plan records the model's decision; it is not a research case and not permission to trade.", "入场、止损与目标价见“计划”。模型计划记录模型的决策，它不是研究案例，也不构成交易许可。"],
  planRowBrowse:      ["Browse model plans", "查看模型计划"],
  planRowNone:        ["No model plan is open for this name.", "该股票没有进行中的模型计划。"],
  planUnavailable:    ["Plan terms unavailable", "计划条款不可用"],
  planUnavailableBody: ["We could not load the plan just now. This is a loading failure, not a missing plan.", "目前无法加载该计划。这是加载失败，并不代表计划缺失。"],

  // ── Save / follow (G11, T2-20) ───────────────────────────────────────────
  saveAction:         ["Save security", "收藏证券"],
  saveWorking:        ["Confirming…", "确认中…"],
  saveSavedButton:    ["Saved ✓", "已收藏 ✓"],
  saveSavedTitle:     ["Saved to your list", "已收藏到列表"],
  saveSavedBody:      ["{symbol} was added to your first watchlist.", "{symbol} 已加入你的第一个关注列表。"],
  saveSavedNote:      ["Saving a security does not save a dated thesis or start alerts.", "收藏证券不会保存带日期的判断，也不会启动提醒。"],
  saveFailedTitle:    ["Couldn't save to this list", "无法收藏到该列表"],
  saveFailedBody:     ["{symbol} was not added. Your list is unchanged.", "未添加 {symbol}。你的列表保持不变。"],
  saveRetry:          ["Retry save", "重试收藏"],
  saveChooseList:     ["Choose another list", "选择其他列表"],
  saveViewList:       ["View saved list", "查看已保存列表"],
  saveSignedOut:      ["Sign in to save this security.", "登录后才能收藏该证券。"],
  saveDone:           ["Done", "完成"],
  followAction:       ["Follow changes", "订阅变化"],
  followTitle:        ["Alerts aren't available here", "此处暂无提醒"],
  followBody:         ["This research does not yet provide a supported change feed.", "该研究尚未提供受支持的变化推送。"],
  followNote:         ["You can still save the security and return to its published research.", "你仍可收藏该证券，并回到其已发布的研究。"],
  followBack:         ["Back to setup", "返回研究"],

  // ── Evidence tab (T2-04): served observation + one plain line ───────────
  observationEvidence: ["Early observation evidence", "早期观察证据"],
  evidenceUnavailable: ["Evidence for this company is not available yet.", "该公司的证据尚未提供。"],

  // ── Context tab (T2-17): membership + one plain line ────────────────────
  membershipTitle:    ["Group membership", "行业组归属"],
  contextUnavailable: ["Company context is not available yet.", "公司背景尚未提供。"],

  // ── Sources sheet (T2-16; opened from the study list) ───────────────────
  sourcesTitle:       ["Sources & method", "来源与方法"],
  sourcesIntro:       ["Each source keeps its own clock. None of them is a live quote feed.", "每个数据源有各自的时钟；它们都不是实时行情。"],
  srcRoster:          ["Sector roster", "行业名单"],
  srcPlans:           ["Prophet plans", "预言台计划"],
  srcPlansClock:      ["Signal date {date}", "信号日期 {date}"],
  srcObs:             ["Early-observation source", "早期观察数据源"],
  srcObsClock:        ["Observed {date}", "观察于 {date}"],
  srcQuotes:          ["Market quotes", "行情报价"],
  srcFundamentals:    ["Quarterly fundamentals", "季度基本面"],
  srcPeers:           ["Dated peer comparison", "带日期的同业对比"],
  srcNotReadable:     ["Not readable right now", "当前无法读取"],

  // ── Fetch states (T2-21 #4, #7) ──────────────────────────────────────────
  caseLoading:        ["Reading the case…", "正在读取案例…"],
  stateUnknown:       ["Status unknown", "状态未知"],
  stateUnknownBody:   ["We cannot tell the Prophet status for this name right now.", "目前无法确定该股票的预言台状态。"],
} as const;

export type SetupKey = keyof typeof SETUP_LEX;

export function getSetupStr(lang: Lang, key: SetupKey): string {
  const entry = SETUP_LEX[key];
  if (!entry) return "";
  return lang === "zh" ? entry[1] : entry[0];
}

export function makeSetupT(lang: Lang): (key: SetupKey) => string {
  return (key: SetupKey) => getSetupStr(lang, key);
}

/** `{placeholder}` substitution (prophetSectorFill pattern). */
export function setupFill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

/** Signed percentage with one decimal — the sector lane's number grammar. */
export function fmtSignedPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
