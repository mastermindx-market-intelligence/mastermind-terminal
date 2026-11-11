/**
 * prophetSectorStrings.ts — bilingual EN/ZH strings for the Prophet × Sector
 * Intelligence journey: the Prophet sector lane (context, picker, population,
 * setup, sources) and the sector-side member-row link.
 *
 * HONESTY DOCTRINE (DESIGN_DOCTRINE + prophetStrings law):
 *   - Descriptive only. Sector strength is context, never a trade instruction:
 *     no "buy/enter/qualified" on descriptive states.
 *   - A member's Prophet state is REPORTED, never recommended.
 *   - Nulls in plain words ("not produced"), owner reason codes translated via
 *     a closed map with a generic fallback — raw slugs never face the reader.
 *   - Numbers carry meaning (+X% vs market, pp, sessions); one as-of per block.
 *   - Translated strings never appear in HTML title= attributes (CI-guarded).
 */

import type { Lang } from "@/lib/i18n";

export const PROPHET_SECTOR_LEX = {
  // ── Lane + return ────────────────────────────────────────────────────────
  laneSector:          ["Sector context", "行业背景"],
  laneSectorCaption:   ["members · descriptive", "成分 · 仅描述"],
  returnToSector:      ["Back to Sector Intelligence", "返回行业情报"],
  returnAria:          ["Return to the exact sector view you came from", "返回你出发时的行业视图"],

  // ── Context strip (SX01) ─────────────────────────────────────────────────
  contextTitle:        ["Market vs {group}", "市场与{group}"],
  contextGroupReturn:  ["Group return", "组内收益"],
  contextMarketReturn: ["Market return", "市场收益"],
  contextRelative:     ["Relative", "相对表现"],
  contextBreadth:      ["Above trend", "趋势上方"],
  contextWindow:       ["{n} sessions", "{n} 个交易日"],
  contextNotProduced:  ["not produced", "未产出"],
  contextNotStated:    ["not stated", "未说明"],
  contextUnknown:      ["unknown", "未知"],
  contextClocks:       ["Sector reading {sector} · Prophet index {prophet}", "行业读数 {sector} · 预言台指数 {prophet}"],
  contextNoGroup:      ["Pick a group to see its market context.", "选择一个行业组，查看其市场背景。"],
  contextOwnerLabelAria: ["Owner's own state label", "数据方的状态描述"],

  // ── Compatibility verdicts (plain words when NOT compatible) ────────────
  verdictCompatible:   ["Both readings cover the same session ({session}).", "两次读数覆盖同一交易日（{session}）。"],
  verdictStaleSector:  ["The sector reading is {gap} sessions older than the Prophet index — treat group measures as dated.", "行业读数比预言台指数旧 {gap} 个交易日——请将组内指标视为滞后数据。"],
  verdictStaleProphet: ["The Prophet index is {gap} sessions older than the sector reading — member states may lag the group.", "预言台指数比行业读数旧 {gap} 个交易日——成员状态可能滞后于行业。"],
  verdictMixedBasis:   ["The readings were captured on different sessions ({sector} vs {prophet}) — comparisons span dates.", "两次读数采集于不同交易日（{sector} 与 {prophet}）——对比跨越了日期。"],
  verdictSectorDown:   ["The sector reading is unavailable — group context is not shown for this read.", "行业读数不可用——本次不显示行业背景。"],
  verdictProphetDown:  ["The Prophet index is unavailable — member states cannot be shown.", "预言台指数不可用——无法显示成员状态。"],

  // ── Group picker (SX02) ──────────────────────────────────────────────────
  pickerTitle:         ["Groups", "行业组"],
  pickerIntro:         ["Every group in the current sector read, with its Prophet coverage.", "当前行业读数中的全部行业组及其预言台覆盖。"],
  pickerCoverageHonest: ["{served} served members across {groups} groups. Prophet also covers companies outside these groups.", "{groups} 个行业组共 {served} 只成分。预言台亦覆盖这些组之外的公司。"],
  pickerMembers:       ["{n} members", "{n} 只成分"],
  pickerCoverage:      ["{open} open plans · {early} early observations · {resolved} resolved", "{open} 个进行中计划 · {early} 项早期观察 · {resolved} 个已完结"],
  pickerView:          ["View population", "查看成员"],
  pickerEmpty:         ["No groups in the current read.", "当前读数中没有行业组。"],

  // ── Member population (SX04) ─────────────────────────────────────────────
  populationTitle:     ["{group} in Prophet", "预言台中的{group}"],
  populationTitleNoGroup: ["Members", "成分"],
  populationCounts:    ["{served} served of {configured} configured · {unserved} unmeasured", "配置 {configured} 只，已服务 {served} 只 · {unserved} 只未测量"],
  searchLabel:         ["Search members", "搜索成分"],
  searchPlaceholder:   ["Symbol or name", "代码或名称"],
  searchSubmit:        ["Search", "搜索"],
  searchClear:         ["Clear", "清除"],
  filterAll:           ["All", "全部"],
  columnSymbol:        ["Symbol", "代码"],
  columnName:          ["Name", "名称"],
  columnIndustry:      ["Industry", "行业"],
  columnSince:         ["In group", "组内"],
  sinceAtLeast:        ["at least {date}", "至少 {date}"],
  columnState:         ["Prophet state", "预言台状态"],
  shownOf:             ["Showing {shown} of {total}", "显示 {shown} / {total}"],
  pagePrev:            ["Previous page", "上一页"],
  pageNext:            ["Next page", "下一页"],
  openSetup:           ["Setup", "研究起点"],
  setupAria:           ["Open {symbol} setup", "打开 {symbol} 的研究起点"],
  unservedTitle:       ["Unmeasured members ({n})", "未测量成分（{n} 只）"],
  unservedNote:        ["Group members with no measured row in this read.", "本次读取中没有测量数据的组成员。"],
  emptyFiltered:       ["No members match this filter.", "没有符合条件的成分。"],
  alsoIn:              ["also in {groups}", "同属 {groups}"],

  // ── Prophet member states (reported, never recommended) ─────────────────
  stateOpenPlan:       ["Open plan", "进行中计划"],
  stateEarly:          ["Early observation", "早期观察"],
  stateResolved:       ["Resolved plan", "已完结计划"],
  stateNone:           ["No plan", "无计划"],
  stateUnavailable:    ["Not available", "暂不可用"],

  // ── Reason translations (closed map, owner codes → plain words) ─────────
  reasonNoPlanInIndex: ["The Prophet index has no plan for this symbol.", "预言台指数中没有该代码的计划。"],
  reasonNotInUniverse: ["This symbol is outside Prophet's covered universe.", "该代码不在预言台覆盖范围内。"],
  reasonProphetDown:   ["The Prophet index is unavailable right now.", "预言台指数当前不可用。"],
  reasonSectorDown:    ["The sector reading is unavailable right now.", "行业读数当前不可用。"],
  reasonAbsentPanel:   ["No price panel for this member in the read.", "本次读取没有该成分的价格数据。"],
  reasonNotObserved:   ["Not observed at the effective date.", "生效日未观测到该成员。"],
  reasonGeneric:       ["No published plan.", "未发布计划。"],
  reasonUnservedGeneric: ["Not measured in this read.", "本次读取未测量。"],

  // ── Company Setup (SX03) ─────────────────────────────────────────────────
  setupTitle:          ["{symbol} setup", "{symbol} 研究起点"],
  setupBack:           ["Back to population", "返回成员列表"],
  setupPlanHeading:    ["Prophet plan", "预言台计划"],
  setupPlanMissing:    ["This plan is not in the current board read.", "该计划不在当前计划板读取中。"],
  setupNoPlanHeading:  ["No Prophet plan for {symbol}", "{symbol} 暂无预言台计划"],
  setupGroupDoing:     ["What {group} is doing", "{group} 近期表现"],
  setupWhyNoPlan:      ["Why no plan", "为何没有计划"],
  setupObservation:    ["Early observation · {asof}", "早期观察 · {asof}"],
  setupChartLink:      ["Open {symbol} chart", "打开 {symbol} 图表"],
  setupMemberSince:    ["In this group since at least {date}", "至少自 {date} 起在该组"],
  setupRosterSince:    ["Roster effective {date}", "名单生效 {date}"],
  setupReported:       ["Reported from the Prophet index — not a recommendation.", "来自预言台指数的记录——不构成建议。"],
  setupInGroups:       ["Member of {n} group(s)", "{n} 个组的成分"],

  // ── Sources & evidence disclosure ────────────────────────────────────────
  sourcesSummary:      ["Sources & evidence", "来源与证据"],
  sourcesSectorTitle:  ["Sector generation", "行业生成"],
  sourcesProphetTitle: ["Prophet index", "预言台指数"],
  sourcesGeneration:   ["Generation {id}", "生成 {id}"],
  sourcesSession:      ["Session {session}", "交易日 {session}"],
  sourcesPublished:    ["Published {at}", "发布于 {at}"],
  sourcesPlanCounts:   ["{total} plans · {open} open", "{total} 个计划 · {open} 个进行中"],
  sourcesContentHash:  ["Content", "内容指纹"],
  sourcesIndexHash:    ["Index bytes", "指数字节"],
  sourcesQualification:["Qualification {value}", "资质 {value}"],
  sourcesMembership:   ["Membership is the group's current roster, not a point-in-time snapshot.", "成员为该组当前名单，非时点快照。"],
  sourcesMembershipPit: ["Membership is the current roster; first-known dates are lower bounds from stored snapshots, never true first-in dates.", "成员为当前名单；首次已知日期为存量快照给出的下界，并非真实加入日期。"],
  sourcesMembershipLabel: ["Membership basis", "成员口径"],
  sourcesTaxonomy:     ["Industry labels are current-basis GICS, not point-in-time.", "行业标签为当前口径的 GICS 分类，非时点口径。"],
  sourcesTaxonomyLabel: ["Taxonomy basis", "分类口径"],
  sourcesJoin:         ["Joined by US listing ticker.", "按美国上市代码关联。"],
  sourcesJoinLabel:    ["Join key", "关联键"],
  sourcesDescriptive:  ["Descriptive only — no trade instructions.", "仅作描述——不构成交易指令。"],
  sourcesCopy:         ["Copy", "复制"],
  sourcesCopied:       ["Copied", "已复制"],

  // ── Fetch states ─────────────────────────────────────────────────────────
  loading:             ["Reading the sector population…", "正在读取行业成分…"],
  signedOut:           ["Sign in to see sector members.", "登录后查看行业成分。"],
  denied:              ["Your subscription does not include Prophet sector members.", "你的订阅不包含预言台行业成分。"],
  retry:               ["Could not read sector members.", "无法读取行业成分。"],
  retryAction:         ["Try again", "重试"],
  invalid:             ["This response is outside the expected format.", "响应格式不符合预期。"],
  notFound:            ["This group is not in the current sector read.", "该行业组不在当前行业读数中。"],
  // The upstream reading is not published for the Terminal yet (404/502/timeout
  // at the BFF). The designed degradation: say so, keep the rest of Prophet usable.
  unavailableYet:      ["Sector context is not available yet.", "行业背景暂未开放。"],
  groupUnavailableMembers: ["The group's member list is not part of this read.", "本次读数不包含该组的成员列表。"],
  unavailableNote:     ["This reading is not published for the Terminal yet — the rest of Prophet keeps working.", "该读数尚未向 Terminal 发布——预言台其余功能不受影响。"],
  backToGroups:        ["← All groups", "← 全部行业组"],

  // ── Sector-side member row (SectorPopulationMembers) ────────────────────
  rowProphetColumn:    ["Prophet", "预言台"],
  rowProphetState:     ["{symbol} in Prophet", "预言台中的 {symbol}"],
  eligibleNotPublished:["Prophet state not published yet", "预言台状态尚未发布"],
  eligiblePending:     ["Prophet state pending", "预言台状态待发布"],
} as const;

export type ProphetSectorKey = keyof typeof PROPHET_SECTOR_LEX;

export function getProphetSectorStr(lang: Lang, key: ProphetSectorKey): string {
  const entry = PROPHET_SECTOR_LEX[key];
  if (!entry) return "";
  return lang === "zh" ? entry[1] : entry[0];
}

export function makeProphetSectorT(lang: Lang): (key: ProphetSectorKey) => string {
  return (key: ProphetSectorKey) => getProphetSectorStr(lang, key);
}

/** `{placeholder}` substitution (nativeFill pattern). */
export function prophetSectorFill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}

/** Wire state → label key (reported, never recommended). */
export const PROPHET_STATE_LABEL_KEY: Record<string, ProphetSectorKey> = {
  open_plan: "stateOpenPlan",
  early_observation: "stateEarly",
  resolved_plan: "stateResolved",
  none: "stateNone",
  unavailable: "stateUnavailable",
};

/** Closed reason-code translation with a plain generic fallback. */
export function prophetReasonKey(reason: string | null | undefined): ProphetSectorKey {
  switch (reason) {
    case "no_plan_in_index": return "reasonNoPlanInIndex";
    case "not_in_prophet_universe": return "reasonNotInUniverse";
    case "prophet_unavailable": return "reasonProphetDown";
    case "sector_unavailable": return "reasonSectorDown";
    case "absent_from_price_panel": return "reasonAbsentPanel";
    case "not_observed_at_effective_as_of": return "reasonNotObserved";
    default: return "reasonGeneric";
  }
}
export function prophetUnservedReasonKey(reason: string | null | undefined): ProphetSectorKey {
  switch (reason) {
    case "absent_from_price_panel": return "reasonAbsentPanel";
    case "not_observed_at_effective_as_of": return "reasonNotObserved";
    default: return "reasonUnservedGeneric";
  }
}

/** GroupContext null-field reasons → the strip's not-stated vocabulary. */
export function contextNullKey(reason: string | undefined): ProphetSectorKey {
  return reason === "not_produced" ? "contextNotProduced" : "contextNotStated";
}
