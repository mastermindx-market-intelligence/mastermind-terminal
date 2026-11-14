/**
 * prophetSectorStrings.ts — bilingual EN/ZH strings for the Prophet × Sector
 * Intelligence journey: the Prophet sector lane (context, picker, population,
 * setup, sources) and the sector-side member-row link.
 *
 * HONESTY DOCTRINE (DESIGN_DOCTRINE + prophetStrings law):
 *   - Descriptive only. Sector strength is context, never a trade instruction:
 *     no "buy/enter/qualified" on descriptive states.
 *   - A member's Prophet state is REPORTED, never recommended.
 *   - Nulls in plain words ("Not available"), owner reason codes translated via
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
  contextNotProduced:  ["Not available", "暂不可用"],
  contextNotStated:    ["not stated", "未说明"],
  contextUnknown:      ["unknown", "未知"],
  contextClocks:       ["Sector reading {sector} · Prophet index {prophet}", "行业读数 {sector} · 预言台指数 {prophet}"],
  contextNoGroup:      ["Pick a group to see its market context.", "选择一个行业组，查看其市场背景。"],
  contextOwnerLabelAria: ["Owner's own state label", "数据方的状态描述"],

  // ── Compatibility verdicts (plain words when NOT compatible) ────────────
  verdictCompatible:   ["Both readings cover the same session ({session}).", "两次读数覆盖同一交易日（{session}）。"],
  verdictStaleSector:  ["The sector reading is {gap} sessions older than the Prophet index — treat group measures as dated.", "行业读数比预言台指数旧 {gap} 个交易日——请将组内指标视为滞后数据。"],
  verdictStaleProphet: ["The Prophet index is {gap} sessions older than the sector reading — member states may lag the group.", "预言台指数比行业读数旧 {gap} 个交易日——成员状态可能滞后于行业。"],
  verdictMixedBasis:   ["The readings were captured on different sessions — comparisons span dates.", "两次读数采集于不同交易日——对比跨越了日期。"],
  verdictSectorDown:   ["The sector reading is unavailable — group context is not shown.", "行业读数不可用——不显示行业背景。"],
  verdictProphetDown:  ["The Prophet index is unavailable — member states cannot be shown.", "预言台指数不可用——无法显示成员状态。"],

  // ── Group picker (SX02) ──────────────────────────────────────────────────
  pickerTitle:         ["Groups", "行业组"],
  pickerIntro:         ["Every group in the current sector read, with its Prophet coverage.", "当前行业读数中的全部行业组及其预言台覆盖。"],
  pickerCoverageHonest: ["{companies} companies across {groups} groups. Prophet also covers companies outside these groups.", "{groups} 个行业组共 {companies} 家公司。预言台亦覆盖这些组之外的公司。"],
  pickerMembers:       ["{n} members", "{n} 只成分"],
  pickerCoverage:      ["{open} open plans · {early} early observations · {resolved} resolved", "{open} 个进行中计划 · {early} 项早期观察 · {resolved} 个已完结"],
  pickerView:          ["View population", "查看成员"],
  pickerEmpty:         ["No groups in the current read.", "当前读数中没有行业组。"],

  // ── Member population (SX04) ─────────────────────────────────────────────
  populationTitle:     ["{group} in Prophet", "预言台中的{group}"],
  populationTitleNoGroup: ["Members", "成分"],
  populationCounts:    ["{companies} companies", "共 {companies} 家公司"],
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
  cardOpen:            ["Open", "打开"],
  setupAria:           ["Open {symbol} setup", "打开 {symbol} 的研究起点"],
  unservedTitle:       ["Members without a reading ({n})", "暂无读数的成分（{n} 只）"],
  unservedNote:        ["These group members have no reading available yet.", "这些组成员暂无可用读数。"],
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
  reasonGeneric:       ["No plan available.", "暂无计划。"],
  reasonUnservedGeneric: ["No reading for this member yet.", "暂无该成分的读数。"],

  // ── Company Setup (SX03) ─────────────────────────────────────────────────
  setupTitle:          ["{symbol} setup", "{symbol} 研究起点"],
  setupMissingSymbol:  ["This address does not name a company. Choose a member in the population.", "该地址未指定公司。请在成分列表中选择。"],
  setupBack:           ["Back to population", "返回成员列表"],
  setupPlanHeading:    ["Prophet plan", "预言台计划"],
  setupPlanMissingTitle: ["This plan is not on today's board", "该计划不在今日计划板中"],
  setupPlanMissingBody: ["The member list reports {state}, opened {date}. Today's plan board does not carry it, so its entry, invalidation and targets are not shown here.", "成员名单记录为{state}，开启于 {date}。今日计划板未包含该计划，因此此处不显示其入场价、失效价与目标价。"],
  setupPlanBoard:      ["Open the plans board", "打开计划板"],
  setupNoPlanHeading:  ["No Prophet plan for {symbol}", "{symbol} 暂无预言台计划"],
  setupGroupDoing:     ["What {group} is doing", "{group} 近期表现"],
  setupWhyNoPlan:      ["Why no plan", "为何没有计划"],
  setupObservation:    ["Early observation · {asof}", "早期观察 · {asof}"],
  setupChartLink:      ["Open {symbol} chart", "打开 {symbol} 图表"],
  setupMemberSince:    ["In this group since at least {date}", "至少自 {date} 起在该组"],
  setupRosterSince:    ["Roster effective {date}", "名单生效 {date}"],
  setupReported:       ["Reported from the Prophet index — not a recommendation.", "来自预言台指数的记录——不构成建议。"],
  // Only rendered when the member belongs to more than one group, so the
  // plural is fixed here rather than carrying an "(s)" the reader must parse.
  setupInGroups:       ["Member of {n} groups", "同属 {n} 个组"],

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
  // The BFF/owner throttle answered with how long to wait — say that, not the
  // generic read failure, so an engaged reader knows a retry will work.
  retryRateLimited:    ["Too many requests — try again in {n} seconds.", "请求过于频繁——请 {n} 秒后重试。"],
  retryAction:         ["Try again", "重试"],
  invalid:             ["This response is outside the expected format.", "响应格式不符合预期。"],
  notFound:            ["This group is not in the current sector read.", "该行业组不在当前行业读数中。"],
  // The upstream reading is not published for the Terminal yet (404/502/timeout
  // at the BFF). The designed degradation: say so, keep the rest of Prophet usable.
  unavailableYet:      ["Sector context is not available yet.", "行业背景暂未开放。"],
  groupUnavailableMembers: ["The group's member list is not available.", "该组的成员列表暂不可用。"],
  unavailableNote:     ["This reading is not available yet — the rest of Prophet keeps working.", "该读数暂不可用——预言台其余功能不受影响。"],
  // The visible back controls draw their own "←" (SX02/SX04); these labels must
  // not carry a second one.
  backToGroups:        ["All groups", "全部行业组"],

  // ── Sector-side member row (SectorPopulationMembers) ────────────────────
  rowProphetColumn:    ["Prophet", "预言台"],
  rowProphetState:     ["{symbol} in Prophet", "预言台中的 {symbol}"],
  eligibleNotPublished:["Prophet state not available yet", "预言台状态暂不可用"],
  eligiblePending:     ["Prophet state pending", "预言台状态待发布"],

  // ── Leadership table (SX01 · G5) ─────────────────────────────────────────
  leadershipTitle:     ["Where leadership is moving", "行业领导力去向"],
  leadershipIntro:     ["Every group in the sector read, ranked by return versus market over the same window.", "当前行业读数中的全部行业组，按同一窗口内相对市场的收益排序。"],
  // SX01 hero summary: names the top-ranked group from the SERVED window reads.
  // Renders only when both the return and the versus-market figure are served.
  heroKicker:          ["Market & sector leadership", "市场与行业领导力"],
  heroTitle:           ["{group} leads this read", "{group} 领跑本次读数"],
  heroBody:            ["{ret} over {n} sessions · {pp} versus the market.", "{n} 个交易日 {ret} · 相对市场 {pp}。"],
  heroBodyNoWindow:    ["{ret} in this window · {pp} versus the market.", "本窗口 {ret} · 相对市场 {pp}。"],
  heroNote:            ["Descriptive context — ranked by return versus market over the same window, not a forecast.", "描述性背景——按同一窗口内相对市场的收益排序，并非预测。"],
  columnReturn:        ["Window return", "窗口收益"],
  columnVsMarket:      ["Vs market", "相对市场"],
  columnBreadth:       ["Breadth", "宽度"],
  columnDevelopment:   ["Development", "发展阶段"],
  columnOpen:          ["Open", "查看"],
  breadthNoneLine:     ["Breadth by group is not available.", "暂无按组的宽度数据。"],
  pickerResearch:      ["Research →", "研究 →"],
  siExplore:           ["Explore every sector in Sector Intelligence ↗", "在行业情报中查看全部行业 ↗"],

  // ── Sector focus (SX02 · G4) ─────────────────────────────────────────────
  focusLeadIntro:      ["The group is ahead of the market. Test how widely that strength is shared.", "该组领先市场。检验这轮强势覆盖多广。"],
  focusLagIntro:       ["The group trails the market. Check what still holds up inside it.", "该组落后于市场。看看组内还有什么站得住。"],
  focusFlatIntro:      ["See the group against its market, then test what the members show.", "先看该组与市场的对照，再检验成分股的表现。"],
  focusBenchmarkChip:  ["Benchmark {ticker}", "基准 {ticker}"],
  focusCloseChip:      ["Close {session}", "收盘 {session}"],
  focusViewMembers:    ["Research these names →", "研究这些成分 →"],
  focusOpenPopulation: ["Open the full population →", "打开全部成分 →"],
  // The fail-closed group read (group null): the numbers, count and lead line
  // are not served — say so once, in the designed not-served block, and never
  // borrow them from another read.
  focusNotServedTitle: ["Group measures not available", "组内指标暂不可用"],
  focusNotServedBody:  ["The sector reading for this group is not available in this session. No group return, market return, relative or breadth is shown.", "本次会话未提供该组的行业读数。不显示组内收益、市场收益、相对表现或宽度。"],
  focusDisclaimer:     ["Sector strength is descriptive context. It does not decide entry, size or timing for any name.", "行业强势属于描述性背景，不决定任何名称的入场、仓位或时点。"],
  backToFocus:         ["Sector focus", "行业聚焦"],
  // The panels the wire cannot fill are ONE plain line (P1-4), not four
  // refusal panels; the Sector Intelligence handoff stays a link.
  focusUnavailableLine: ["Breadth, concentration, industries and history are not available for this group yet.", "该组的宽度、集中度、行业分布与历史数据暂不可用。"],
  // SX02's breadcrumb and return contract. Until Lane A's `/prophet` Today
  // route lands with #1480, Today is the Prophet board at this address.
  focusBreadcrumbToday: ["Today", "今日"],
  focusBreadcrumbMarket: ["US market", "美国市场"],
  focusReturnToday:    ["Return to Today", "返回今日"],
  siLink:              ["Open in Sector Intelligence ↗", "打开行业情报 ↗"],
  siLinkAria:          ["Open this group's own view in Sector Intelligence", "在行业情报中打开该组自己的视图"],

  // ── Relative leader, falling price (SX09 #01 · G22) ─────────────────────
  relativeLeadTitle:   ["Ahead of the market. Still falling.", "跑赢市场，仍在下跌。"],
  relativeLeadBody:    ["Sector {sector} · market {market} · advantage {adv} pp. Relative resilience does not turn the absolute return green.", "行业 {sector} · 市场 {market} · 优势 {adv} 个百分点。相对抗跌不会让绝对收益转正。"],
  relativeLeadAction:  ["Inspect the comparison", "查看对比"],
  relativeLeadActionAria: ["Open this group's own comparison in Sector Intelligence", "在行业情报中打开该组的对比"],

  // ── Member selection + compare (SX04/T2-06, T2-07/T2-13 · G6, G7) ───────
  compareCol:          ["Compare", "对比"],
  selectAria:          ["Select {symbol} for comparison", "选择 {symbol} 加入对比"],
  removeSelectionAria: ["Remove {symbol} from the selection", "从已选中移除 {symbol}"],
  selectedCount:       ["{n} selected", "已选 {n} 只"],
  selectionNote:       ["Selections stay fixed as you change filters.", "更改筛选时选择保持不变。"],
  selectionCapNote:    ["Keep up to {n} names selected; compare three at a time.", "最多保留 {n} 只选择，每次对比三只。"],
  compareSelected:     ["Compare selected ⇅", "对比已选 ⇅"],
  compareNeedsMore:    ["Select at least two names in the population to compare them.", "请在成分列表中至少选择两只名称后再对比。"],
  // Compare is its own view address. Until the address carries the selection
  // (Lane A's `sel` key), a reload lands on compare with nothing selected — say
  // that plainly instead of showing an empty comparison.
  compareSelectionLost: ["No companies are selected in this address. Choose at least two names to compare.", "此地址没有已选公司。请至少选择两只进行对比。"],
  populationMeasuresNote: ["Return and vs-sector figures are not available for these companies yet.", "这些公司暂无收益与相对行业数据。"],
  columnReturnMember:  ["Return", "收益"],
  columnVsSector:      ["Vs sector", "相对行业"],
  populationContextVsMarket: ["{pp} vs market", "相对市场 {pp}"],
  populationContextSessions: ["{n} sessions to {session}", "{n} 个交易日，截至 {session}"],
  populationContextSessionsNoDate: ["{n} sessions", "{n} 个交易日"],
  compareTitle:        ["Compare the evidence", "对比证据"],
  compareShown: ["Comparing {shown} of {total} selected. Choose which names to show.", "正在对比已选 {total} 只中的 {shown} 只。请选择要显示的名称。"],
  compareColumn: ["Comparison {n}", "对比 {n}"],
  compareIntro:        ["Keep each research case, its clock and its next check in view.", "把每个研究案例、其时间基准与下一步核查放在同一视野。"],
  compareBack:         ["← Back to population", "← 返回成分列表"],
  compareBackScreener: ["← Choose a group", "← 选择行业组"],
  compareFooterScreener: ["Choose a group to explore more companies. Your selection stays in the address.", "选择行业组以探索更多公司。已选名称会保留在地址中。"],
  compareAddName:      ["Add a name +", "添加名称 +"],
  compareNoScore:      ["Each case keeps its own clock and basis. No combined score or ranking is assigned.", "每个案例保留各自的时间基准与口径。不给出综合评分或排名。"],
  // ONE sentence for the mixed-clock case (SX09 #08) — the banner states the
  // clock difference and the no-combined-arithmetic rule once, not twice.
  compareMixedClocks:  ["These cases use different clocks — each is compared on its own, with no combined score or ranking assigned.", "这些案例的时间基准不同——各自对照，不给出综合评分或排名。"],
  compareFooter:       ["Returning to the population preserves your selection and filters.", "返回成分列表会保留你的选择与筛选。"],
  compareChartUnavailable: ["{symbol}'s window series is not available.", "暂无 {symbol} 的窗口序列。"],
  compareEvidenceUnavailable: ["Support, challenge and next check are not available for this name yet.", "该名称的支持论点、质疑与下一步核查暂不可用。"],
  compareEntryUnavailable: ["Entry state unavailable", "入场状态不可用"],
  compareStrategy:     ["Strategy", "策略"],
  compareOpenSetup:    ["Open setup →", "打开研究起点 →"],
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

/** Prophet plan phase → the owner's plain-language label, EN/ZH.
 *
 * Mirrored from the intelligence workspace's own PHASE map
 * (`components/intelligence/IntelligenceWorkspace.tsx`), which is where Lane A's
 * Prophet work takes its phase vocabulary from. The wire enum stays the
 * producer's (`pre_trigger` …); the reader never sees the slug and never sees a
 * title-cased code either ("Pre-Trigger" is the raw-code spelling, not this
 * vocabulary). A minimal local copy until that map has a single shared owner —
 * then this const is replaced by the import, nothing else. */
export const PROPHET_PHASE_LABELS: Record<string, readonly [string, string]> = {
  pre_trigger:      ["Before trigger", "尚未触发"],
  triggered_pre_t1: ["Triggered · before target 1", "已触发 · 未达第一目标"],
  at_t1:            ["At T1", "T1位"],
  between_t1_t2:    ["T1→T2", "T1→T2"],
  at_t2:            ["At T2", "T2位"],
  overtime:         ["Window elapsed", "窗口已过"],
  invalidated:      ["Invalidated", "已失效"],
};

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
