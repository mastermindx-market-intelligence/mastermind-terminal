"use client";
import { useCallback } from "react";
import { useLang, useT } from "./i18n";

/** Lane-local EN/ZH copy for the retained Sector Intelligence depth surfaces
 * (calls board, Bottoming Watch, flow matrix, four-universe Entry evidence,
 * theme/compare/history controls). Language state remains the shared
 * LangProvider; this module keeps feature copy out of the global LEX and out of
 * the workspace lane's own sectorIntelligenceLex.ts (single-writer file owned by
 * the Terminal workspace lane). No mutable registration or store.
 *
 * Copy rules (Macro si_workspace composer law): plain words only — no internal
 * state names, no study names, no raw slugs in primary copy; EN and ZH authored
 * together, never machine-flipped. Every capability discloses what it is and is
 * not; a watch surface never uses a buy/enter verb.
 */
export const SECTOR_DEPTH_LEX: Record<string, [string, string]> = {
  // ── shared typed states ────────────────────────────────────────────────────
  siDepthUnavailableTitle: ["Not carried by this reading", "本读数未包含"],
  siDepthUnavailableBody: [
    "This generation does not carry “{field}”. Nothing is invented in its place — the surface turns on once the owner supplies it.",
    "此版本未携带“{field}”。在其所有者提供之前不会以虚构数据替代——数据到位后此处即会显示。",
  ],
  siDepthUnavailableOwner: ["Missing field owner: {owner}", "缺失字段的所有者：{owner}"],
  siDepthAsOf: ["as of {date}", "截至 {date}"],
  siDepthDisplayOnly: ["Display-only", "仅供展示"],
  siDepthLearnAccess: ["Learn about access →", "了解访问权限 →"],
  // Review S5: the owner name and the carried field names named in the
  // unavailable state are reader-facing copy in BOTH locales — never a raw
  // English literal or an internal wire id in the ZH surface. The wire id
  // still rides the data attributes for tests; the reader sees these words.
  siDepthOwnerMacroGen: ["Macro sector generation", "Macro 板块生成引擎"],
  siDepthFieldActionBoard: ["the action board", "行动看板"],
  siDepthFieldBottomingWatch: ["the bottoming watch", "底部观察"],
  siDepthFieldEtfFlows: ["ETF fund flows", "ETF 资金流"],
  // S5 (r2): the Themes & compare capability's rs_history series field.
  siDepthFieldRsHistory: ["relative-strength history", "相对强弱历史"],
  siDepthFieldConfluence: ["the entry-evidence universes", "入场证据样本域"],
  // R3-N1: an owner or field id with no lex entry renders this generic —
  // never the raw key, "undefined", or a prototype function's source. The
  // raw id still rides the section's data attributes for triage.
  siDepthFieldGeneric: ["this data", "此数据"],
  siDepthOwnerGeneric: ["its owner", "其所有者"],

  // ── calls board ────────────────────────────────────────────────────────────
  siCallsTitle: ["What to act on now", "当下行动指南"],
  siCallsSub: [
    "Five lanes from tonight's board. Counts are the full qualified board; rows shown are the reader you have.",
    "来自今晚看板的五个分组。计数为完整合格看板；显示行以你的阅读权限为准。",
  ],
  siCallsLaneBuyNow: ["Buy now", "立即买入"],
  siCallsLaneBuyNowSub: ["Entry confirmed today", "今日已确认入场"],
  siCallsLaneBuySoon: ["Almost ready", "接近就绪"],
  siCallsLaneBuySoonSub: ["Setting up — wait for the trigger, not a buy yet", "构筑中 — 等待触发，尚不可买"],
  siCallsLaneRun: ["In favour — don't chase", "看好 — 勿追高"],
  siCallsLaneRunSub: ["Uptrend intact but extended · wait for a pullback", "趋势完好但已延伸 · 等待回调"],
  siCallsLaneTrim: ["Take profits", "止盈"],
  siCallsLaneTrimSub: ["Late in the cycle / topping — protect gains", "周期晚期／做顶 — 保护利润"],
  siCallsLaneAside: ["Stand aside", "观望"],
  siCallsLaneAsideSub: ["Hold what you own · no new buying", "持有勿动 · 不新开仓"],
  siCallsEmptyDated: [
    "No calls in this column on {date}. The board loaded in full; this is a measured zero.",
    "{date} 此栏无建议。榜单已完整加载，这是实测的零。",
  ],
  siCallsShowMore: ["Show more ({n})", "显示更多（{n}）"],
  siCallsShowLess: ["Show less", "收起"],
  siCallsMoreWithheld: [
    "Another {n} · full access",
    "另有 {n} 个 · 完整访问可见",
  ],
  siCallsPreviewBanner: [
    "Preview: {shown} of {total} names shown. Column counts are complete; the remaining {locked} need full access.",
    "预览：{total} 条建议中显示 {shown} 个名称。各栏计数完整，其余 {locked} 个名称需完整访问权限。",
  ],
  siCallsAsOfPill: ["Board as of {date} close", "榜单截至 {date} 收盘"],
  siCallsGroupHold: ["Hold", "持有"],
  siCallsGroupAvoid: ["Avoid", "回避"],
  siCallsShowAllIn: ["Show all {n} in {group}", "显示{group}的全部 {n} 个"],
  siCallsGroupWithheld: [
    "{n} more ({h} hold · {a} avoid) · full access",
    "另有 {n} 个（持有 {h} · 回避 {a}）· 完整访问可见",
  ],
  siCallsTraceWhy: [
    "Why in this column · publish order {n} of {m}",
    "为何在此栏 · 发布顺序第 {n} / {m}",
  ],
  siCallsHowItWorks: ["How calls work →", "建议如何产生 →"],
  siCallsBoardTotal: [
    "{total} qualified rows across the six source lanes",
    "六个来源分组共 {total} 行合格行",
  ],
  siCallsLockedCount: ["{n} locked", "{n} 个已锁定"],
  siCallsThemeKind: ["Theme", "主题"],
  siCallsSectorKind: ["Sector", "板块"],
  siCallsWhy: ["Why", "理由"],
  siCallsSignalGrade: ["Signal grade", "信号等级"],
  siCallsTrace: ["Trace", "依据"],
  siCallsTraceHide: ["Hide trace", "收起依据"],
  siCalls20dVsMarket: ["20d vs market", "20日对比市场"],
  siCallsRolloverBand: ["rollover risk {band}", "滚动风险 {band}"],
  siCallsScoreLabel: ["score {score}", "评分 {score}"],
  siCallsBreadth: ["Breadth (50-day)", "广度（50 日）"],
  siCallsRsPctile: ["RS percentile", "相对强弱百分位"],
  siCallsAllocRank: ["Allocation rank", "配置排名"],
  siCallsBookWt: ["Book weight", "组合权重"],
  siCallsDurability: ["Durability", "持续性"],
  siCallsFlipDistance: ["{n} pts from a lane flip", "距分组切换 {n} 点"],
  siCallsMembers: ["members", "成分"],
  siCallsDetail: ["Open detail", "打开详情"],
  siCallsThemesBeforeSectorsNote: [
    "Themes lead each lane; sectors follow.",
    "每个分组中主题在前，板块在后。",
  ],

  // ── Bottoming Watch strip (display-only) ───────────────────────────────────
  siWatchTitle: ["Bottoming watch", "底部观察"],
  siWatchSub: [
    "What tonight's cycle read says, shown as-is. Not a lane, not a signal.",
    "今晚周期读数的原样呈现。不是分组，也不是信号。",
  ],
  siWatchDisclosure: [
    "A forming low on its own has not been shown to predict what comes next — watch, don't chase.",
    "单独的底部形成迹象尚未被证明能预测后续走势——观察，勿追。",
  ],
  siWatchCycleTurn: ["cycle turn signal — watch only", "周期转向信号——仅作观察"],
  siWatchGateConflict: [
    "cycle turned but price is below its 200-day",
    "周期已转向，但价格仍低于 200 日线",
  ],
  siWatchDualRead: ["also on the reduce lane", "同时位于减仓分组"],
  siWatchDualReadTip: [
    "This name is also on Bottoming watch.",
    "此标的同时出现在底部观察中。",
  ],
  siWatchRecovering: ["recovering from cycle low", "正从周期低位回升"],
  siWatchRecoveringTip: [
    "The longer trend still says reduce, but the cycle read has this recovering off its low — still in the bottom tenth of its cycle range. Both reads are shown so you can see the disagreement.",
    "长期趋势仍建议减仓，但周期读数显示其正自低位回升——仍处于周期区间最低的十分之一。两种判读并列显示，便于看清分歧。",
  ],
  siWatchRecoveringDisclosure: [
    "Recovering from cycle low = the cycle read has turned up off a low while the longer trend still says reduce. Shown as-is, not a call.",
    "正从周期低位回升 = 周期读数已自低位转升，而长期趋势仍建议减仓。原样呈现，并非建议。",
  ],
  siWatchPos: ["cycle position {pos}", "周期位置 {pos}"],
  siWatchAbove200: ["above 200-day", "高于 200 日线"],
  siWatchBelow200: ["below 200-day", "低于 200 日线"],
  siWatchEmpty: [
    "No group is sitting in a cycle trough right now.",
    "当前没有板块处于周期谷底。",
  ],
  siWatchShowMore: ["Show all ({n} more)", "显示全部（还有 {n} 个）"],
  siWatchShowLess: ["Show less", "收起"],

  // ── independent emergence (v1.1 R6-09, owner-carried flag only) ────────────
  // Copy law: the carried flag is a boolean plus an optional href — NO numbers
  // travel with it, so no percentage may appear in either locale. The bound
  // board's example sentence ("gained 9.00% while its sector fell 1.00%") is
  // illustrative mockup data and is deliberately not reproduced here.
  siEmergKicker: ["Independent emergence", "独立走强"],
  siEmergHeadline: ["Company strength is early", "公司强势尚早"],
  siEmergBody: [
    "Sector support is weak; original company evidence remains available. Entry qualification is separate.",
    "板块支撑较弱；公司原始证据仍然可用。入场资格另行判定。",
  ],
  siEmergEvidence: ["Open company evidence →", "查看公司证据 →"],

  // ── flow matrix ────────────────────────────────────────────────────────────
  siFlowsTitle: ["Where sector-ETF money is flowing", "板块 ETF 资金流向何处"],
  siFlowsSub: [
    "Multi-day creation/redemption flow across the 11 sector SPDRs — read the rotation, not the daily noise.",
    "覆盖 11 个板块 SPDR 的多日申购／赎回资金流 — 看轮动趋势，而非单日噪声。",
  ],
  siFlowsNetRow: ["Net · 11 sector ETFs", "净额 · 11 个板块 ETF"],
  siFlowsChart: ["Heat view", "热力视图"],
  siFlowsTable: ["Exact values", "精确数值"],
  siFlowsNote: [
    "Net creation/redemption flow (ΔShares × NAV) summed over each window, in US$ millions · positive = money in. Windows cap at the {depth} trading days collected so far, so the wider windows can coincide until more accrues. Display-only.",
    "各时间窗内份额申购／赎回净额（份额变动 × 资产净值）求和，单位为百万美元 · 正值 = 资金流入。各窗口取目前已采集的 {depth} 个交易日，故在数据充足前较宽的窗口可能重合。仅供展示。",
  ],
  siFlowsUnitsMn: ["US$ mn", "百万美元"],
  siFlowsWindowDays: ["{n} trading days", "{n} 个交易日"],
  siFlowsSourceClock: [
    "source as of {asof} · {depth} trading days of history",
    "数据截至 {asof} · 已采集 {depth} 个交易日",
  ],
  siFlowsCellMissing: ["no reading", "无读数"],
  siFlowsCellZero: ["measured 0", "实测为 0"],
  siFlowsColCoverage: ["Coverage", "覆盖"],
  siFlowsMatrixHint: [
    "Arrow keys move between cells · tint is relative within each window",
    "方向键在单元格间移动 · 色深按各时间窗内部相对计算",
  ],
  siFlowsReadout: [
    "Selected: {etf} · {window} ({days} trading days to {asof}) — {value} {dir}",
    "已选：{etf} · {window}（截至 {asof} 的 {days} 个交易日）— {value} {dir}",
  ],
  siFlowsDirIn: ["net creations", "净申购"],
  siFlowsDirOut: ["net redemptions", "净赎回"],
  siFlowsRowCoverage: [
    "{measured} of {windows} windows measured",
    "{windows} 个窗口中 {measured} 个有实测",
  ],
  siFlowsSelectedEtf: ["{ticker} · {name}", "{ticker} · {name}"],
  siFlowsParticipation: [
    "flow equals {pct}% of the complex's {window} net move",
    "资金流相当于整体 {window} 净额的 {pct}%",
  ],

  // ── four-universe Entry evidence ───────────────────────────────────────────
  siUniverseTitle: ["Entry evidence", "入场证据"],
  siUniverseSub: [
    "Four independent universes, one engine each — never merged. A timing map, not a buy list.",
    "四个独立样本域，各自独立计算——绝不合并。择时图，并非买入清单。",
  ],
  siUniverseSp500: ["S&P 500", "标普500"],
  siUniverseNasdaq: ["Nasdaq-100", "纳斯达克100"],
  siUniverseRussell: ["Russell-2000", "罗素2000"],
  siUniverseBaskets: ["Thematic Baskets", "主题篮子"],
  siUniverseSubsectors: ["subsectors", "子行业"],
  siUniverseBasketsNoun: ["baskets", "篮子"],
  siUniverseBuyableNow: ["Buyable now", "现可买"],
  siUniverseRotationRead: ["Rotation read", "轮动读数"],
  siUniverseClassEntry: ["Entry now", "现可入场"],
  siUniverseClassForming: ["Forming", "构筑中"],
  siUniverseClassTailwind: ["Tailwind", "顺风"],
  siUniverseClassNeutral: ["Neutral", "中性"],
  siUniverseClassLate: ["Late", "偏晚"],
  siUniverseClassHeadwind: ["Headwind", "逆风"],
  // R3-N4: a class word the engine added between sessions — never an
  // invented tier label and never the raw English word on the ZH page; the
  // raw value rides data-cls.
  siUniverseClassUnknown: ["unclassified", "未分类"],
  siUniverseCoverage: [
    "{gateable} of {total} {noun} have enough data to time",
    "{gateable}/{total} 个{noun}有足够数据可计时",
  ],
  // N1: an absent gateable count is stated as not stated — never rendered 0.
  siUniverseCoverageNotStated: [
    "{total} {noun} in this universe; the count with enough data to time is not stated in this payload.",
    "此样本域共 {total} 个{noun}；有足够数据可计时的数量未在本数据中载明。",
  ],
  siUniverseCoverageThin: [
    "{n} thin — counted, not timed",
    "{n} 个数据稀疏——计入统计，不计时",
  ],
  siUniverseCoverageBelowMin: [
    "{n} below the {min}-name minimum",
    "{n} 个低于 {min} 只成分的最低要求",
  ],
  siUniverseCoverageUnscored: ["{n} could not be scored", "{n} 个无法评分"],
  siUniverseReliabilityHigh: ["High confidence — deep coverage", "高置信——覆盖充分"],
  siUniverseReliabilityMed: ["Medium confidence", "中等置信"],
  siUniverseReliabilityLow: ["Thin data — read with caution", "数据稀疏——请谨慎解读"],
  siUniverseAllNoun: ["All {noun}", "全部{noun}"],
  siUniverseFilterPlaceholderSp: ["Filter subsector or sector…", "筛选子行业或板块…"],
  siUniverseFilterPlaceholderBk: ["Filter basket or category…", "筛选篮子或类别…"],
  siUniverseFilterCount: ["{shown} / {total}", "{shown} / {total}"],
  siUniverseNoMatches: [
    "No matches for “{q}”. This is a successful search with zero results — not a source failure.",
    "没有匹配“{q}”的结果。这是成功的空结果搜索——并非来源故障。",
  ],
  siUniverseClearFilter: ["Clear filter", "清除筛选"],
  siUniverseZeroGroups: [
    "This universe carries no groups tonight.",
    "今晚此样本域没有分组。",
  ],
  siUniverseBuyableEmpty: [
    "No group is in the entry tiers right now — the rotation read carries the full map.",
    "当前没有分组处于入场层级——轮动读数包含完整地图。",
  ],
  siUniverseNoAccess: [
    "This universe's source requires access your reading does not carry.",
    "此样本域的来源需要你的读数不具备的权限。",
  ],
  siUniverseColLabel: ["Subsector", "子行业"],
  siUniverseColLabelBasket: ["Basket", "篮子"],
  siUniverseColSector: ["Sector", "板块"],
  siUniverseColCategory: ["Category", "类别"],
  siUniverseColTier: ["Entry", "入场"],
  siUniverseColRegime: ["Regime", "状态"],
  siUniverseColFresh: ["Freshness", "新鲜度"],
  siUniverseColRs60: ["RS60", "RS60"],
  siUniverseColN: ["N", "数"],
  siUniverseFreshJustFired: ["just fired", "刚刚触发"],
  siUniverseFreshFiredAgo: ["fired {n} bars ago", "{n} 根K线前触发"],
  siUniverseFreshAboutTo: ["about to fire", "即将触发"],
  siUniverseFreshNone: ["—", "—"],
  siUniverseNames: ["names", "只"],
  // S5: the identity line carries the tab's LOCALIZED display name (never the
  // raw tab id), and the baskets universe names its complex through
  // siUniverseBasketBenchmark instead of a raw English literal.
  siUniverseSourceIdentity: [
    "{name} universe · benchmark {benchmark} · equal weight",
    "{name} 样本域 · 基准 {benchmark} · 等权",
  ],
  siUniverseBasketBenchmark: ["equal-weight basket complex", "等权主题篮子组合"],
  siUniverseNoDate: [
    "this run did not report a session date",
    "此版本未报告交易日",
  ],
  siUniverseMemberUnits: [
    "member weight in % · vs basket in %",
    "成分权重为 % · 相对篮子为 %",
  ],
  siUniverseNeverMixed: [
    "Rows never cross between universes.",
    "各行绝不跨样本域混用。",
  ],
  siUniverseDetail: ["Open {name}", "打开 {name}"],
  siUniverseLocalSortNote: [
    "Sorting is local to this table; the source order is unchanged.",
    "排序仅限本表；来源顺序不变。",
  ],
  siUniverseBenchmarkSp500: ["vs S&P 500 (SPY)", "对比标普500（SPY）"],
  siUniverseBenchmarkNasdaq: ["vs Nasdaq-100 (QQQ)", "对比纳斯达克100（QQQ）"],
  siUniverseBenchmarkRussell: ["vs Russell-2000 (IWM)", "对比罗素2000（IWM）"],

  // ── theme / compare / history controls ─────────────────────────────────────
  siThemeTitle: ["Themes & compare", "主题与比较"],
  siThemeSub: [
    "The theme table, the compare chart and its history windows.",
    "主题表格、对比走势图及其历史窗口。",
  ],
  siThemeTableTitle: ["Performance table", "表现一览"],
  siThemeChartTitle: ["Performance", "走势对比"],
  siThemeWindow21: ["21 sessions", "21 个交易日"],
  siThemeWindow63: ["63 sessions", "63 个交易日"],
  siThemeWindowAll: ["All history", "全部历史"],
  siThemeSeriesToggle: ["Toggle {name}", "开关 {name}"],
  siThemeRebasedNote: [
    "Lines are rebased to 0 at the start of the window; relative strength is measured against {benchmark} on a {basis} basis.",
    "曲线在窗口起点重设为 0；相对强弱以 {benchmark} 为基准、按{basis}口径计算。",
  ],
  siThemeReconstructed: [
    "Reconstructed from price history — not a live-tracked series.",
    "由价格历史重构——并非实时追踪序列。",
  ],
  siThemeNaturallyObserved: ["live-tracked series", "实时追踪序列"],
  siThemeExactValues: ["Exact values", "精确数值"],
  siThemeNoneSelected: [
    "All series are off — toggle one back on to compare.",
    "全部系列已关闭——请重新开启至少一个以进行比较。",
  ],
  siThemeDateCol: ["Date", "日期"],
  siThemeTurnMarkers: ["cycle turns", "周期拐点"],
  siThemeTurnPeak: ["peak {date}", "峰值 {date}"],
  siThemeTurnTrough: ["trough {date}", "谷值 {date}"],
  siThemeTurnProvisional: ["provisional", "暂定"],

  // ── rows increment (wire v1.1) — carried row blocks ────────────────────────
  // Honest per-block unavailable copy for the five new typed blocks. The raw
  // reason word never reaches the reader in either locale — these lines are
  // the only surface for a refused block.
  siRowsReasonEntitled: [
    "Not included in your current subscription.",
    "当前订阅不包含此读数。",
  ],
  siRowsReasonNotProduced: [
    "The owner engine did not produce this reading tonight.",
    "所有者引擎今晚未生成此读数。",
  ],
  siRowsReasonInvalidShape: [
    "This reading arrived in a form we cannot present.",
    "此读数的格式无法呈现。",
  ],
  siRowsReasonTooLarge: [
    "This reading is too large to deliver and was not carried.",
    "此读数过大，未予传输。",
  ],
  siRowsReasonUnknown: [
    "This reading is unavailable right now.",
    "此读数暂不可用。",
  ],
  // The envelope's carried date, labelled by WHICH field it came from: a
  // session `as_of`, or `generated_utc` — a build time that is explicitly not
  // a market session date (data.as_of null stays undated).
  siUniverseCarriedAsOf: ["carried as of {date}", "携带截至 {date}"],
  siUniverseBuiltAt: [
    "Built {date} · a build time, not a market session",
    "构建于 {date} · 构建时间，非交易日",
  ],
  siUniverseSectorRollup: ["Sector roll-up (sector-level rows)", "板块汇总（板块级行）"],
  siUniverseNoSubsectors: [
    "No subsector crossed the scoring gate tonight.",
    "今晚没有子板块通过评分门槛。",
  ],
  // The carried theme table (theme_rows block).
  siThemePerfAsOf: ["Performance as of {date}", "表现截至 {date}"],
  siThemePerfNotStated: ["not stated", "未载明"],
  siThemeStateUnknown: ["unclassified", "未分类"],
  siThemeColTheme: ["Theme", "主题"],
  siThemeColState: ["State", "状态"],
  siThemeColReco: ["Recommendation", "建议"],
  siThemeColScore: ["Score", "评分"],
  siThemeColRank: ["Rank", "排名"],
  siThemeColAllocRank: ["Allocation rank", "配置排名"],
  siThemeColHealth: ["Health", "健康度"],
  siThemeColVal: ["Valuation", "估值状态"],
  siThemeColBreadth: ["Breadth", "广度"],
  siThemeColR10: ["10-day RS", "10日相对强弱"],
  siThemeColDays: ["Days in state", "状态天数"],
  siThemeColDelta5d: ["5-day Δ", "5日变化"],
  siThemeWin1d: ["1D", "1日"],
  siThemeWin5d: ["5D", "5日"],
  siThemeWin10d: ["10D", "10日"],
  siThemeWin20d: ["20D", "20日"],
  siThemeWin60d: ["60D", "60日"],
  siThemeWinMtd: ["MTD", "月初至今"],
  siThemeWinYtd: ["YTD", "年初至今"],
  siThemeWinFull: ["Full", "全程"],
  // Producer state vocabularies, localized word by word (unknown words render
  // siThemeStateUnknown; the raw word never reaches the ZH reader).
  siThemeWordLabelDeteriorating: ["deteriorating", "走弱"],
  siThemeWordLabelDominant: ["dominant", "主导"],
  siThemeWordLabelEmerging: ["emerging", "萌芽"],
  siThemeWordLabelNeutral: ["neutral", "中性"],
  siThemeWordRecoAccumulate: ["accumulate", "增持"],
  siThemeWordRecoAvoid: ["avoid", "回避"],
  siThemeWordRecoEnter: ["enter", "入场"],
  siThemeWordRecoHold: ["hold", "持有"],
  siThemeWordHealthBroken: ["broken", "已破坏"],
  siThemeWordHealthConfirmed: ["confirmed", "已确认"],
  siThemeWordHealthMixed: ["mixed", "混合"],
  siThemeWordValConfirming: ["confirming", "确认中"],
  siThemeWordValDiverging: ["diverging", "背离"],
  siThemeWordValFading: ["fading", "消退"],
  siThemeWordValNoData: ["no data", "无数据"],
  siThemeWordValQuiet: ["quiet", "平静"],
};

/** Resolve a lane-local key with {placeholder} interpolation. Falls back to the
 * shared sector lexicon, then the global LEX, mirroring useSectorT. */
export function useSectorDepthT() {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const pair = SECTOR_DEPTH_LEX[key];
      let out = pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key);
      if (params) {
        for (const [name, value] of Object.entries(params)) {
          out = out.split(`{${name}}`).join(String(value));
        }
      }
      return out;
    },
    [lang, sharedT],
  );
}
