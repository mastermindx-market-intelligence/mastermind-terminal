/**
 * setupStrings.ts — bilingual EN/ZH strings for the company case surface
 * (Lane C: SX03 / T2-03 / T2-05 / T2-12 Setup, T2-04 / T2-16 Evidence,
 * T2-17 Context, T2-22 developing observation, T2-20 / T2-21 states).
 *
 * HONESTY DOCTRINE (same law as prophetSectorStrings):
 *   - The case opens with the company and its published Prophet state, never
 *     with entry/stop/targets. Plan terms render only inside the read-only
 *     "Model plan" rail, labeled reported.
 *   - Fields the wire does not serve get a designed unavailable state in plain
 *     words — never a placeholder number, never an invented verdict.
 *   - Numbers carry meaning (pp, sessions, X of Y); one as-of per block.
 *   - Translated strings never appear in HTML title= attributes.
 *
 * Shared vocabulary with the sector lane (state labels, reasons, sessions,
 * membership) stays in prophetSectorStrings.ts and is imported read-only.
 */

import type { Lang } from "@/lib/i18n";

export const SETUP_LEX = {
  // ── Case header ──────────────────────────────────────────────────────────
  caseKicker:         ["Company case", "公司案例"],
  caseClocksLabel:    ["Two clocks", "两个时钟"],
  clockAssessmentLabel: ["Assessment", "评估"],
  clockAssessment:    ["Assessment {asof}", "评估 {asof}"],
  clockAssessmentNone:["Assessment not dated in this read", "本次读数未给出评估日期"],
  clockQuote:         ["Quote clock not published", "未发布行情时钟"],
  clockQuoteNote:     ["This surface does not carry a live quote feed.", "该页面不承载实时行情。"],
  verdictLabel:       ["Company verdict", "公司结论"],
  verdictUnavailable: ["Verdict not produced", "未产出结论"],
  verdictBody:        ["The Prophet index publishes plans, observations and states — not a written case verdict for each name.", "预言台指数发布计划、观察与状态——不为每只股票撰写书面结论。"],

  // ── Stance sublines (served Prophet state, reported) ────────────────────
  stanceOpenPlan:     ["An open model plan is running for this name — reported, not a recommendation.", "该股票有一个进行中的模型计划——仅为记录，不构成建议。"],
  stanceResolvedPlan: ["The model plan for this name is resolved — reported, not a recommendation.", "该股票的模型计划已完结——仅为记录，不构成建议。"],
  stanceEarly:        ["An early observation is open for this name — watch the evidence, not an entry instruction.", "该股票有一项早期观察——关注证据本身，而非入场指令。"],
  stanceNone:         ["No Prophet plan is open for this name.", "该股票暂无进行中的预言台计划。"],
  stanceUnavailable:  ["The Prophet state for this name cannot be read right now.", "当前无法读取该股票的预言台状态。"],

  // ── Tabs ──────────────────────────────────────────────────────────────────
  tabsLabel:          ["Case sections", "案例板块"],
  tabSetup:           ["Setup", "研究"],
  tabEvidence:        ["Evidence", "证据"],
  tabContext:         ["Context", "背景"],

  // ── Setup · study card (G9) ──────────────────────────────────────────────
  studyTitle:         ["Separate the common move from the name", "区分共同波动与个股表现"],
  studyIntro:         ["Market and {group} over the same {n} sessions.", "市场与{group}在同一窗口（{n} 个交易日）内的表现。"],
  studyNameLeg:       ["{symbol} own return", "{symbol} 自身收益"],
  studyNameMissing:   ["not produced in this read", "本次读数未产出"],
  studyFootnote:      ["These two legs explain the shared move. This company's own leg is not published in this read, so the decomposition stays open.", "这两条腿解释的是共同波动。该股票自身的表现在本次读数中未发布，因此拆解保持开放。"],
  studyBreadth:       ["{above} of {measured} group members above trend over this window.", "该窗口内 {measured} 只成分中 {above} 只位于趋势上方。"],
  studyIssuerNote:    ["Issuer exclusion is not stated in this read.", "本读数未说明是否剔除发行人自身。"],

  // ── Setup · supports / challenges / next check (G8) ─────────────────────
  supportsTitle:      ["Supports the case", "支持该判断"],
  challengesTitle:    ["Challenges the case", "质疑该判断"],
  scUnavailable:      ["Not produced for this symbol yet.", "尚未为该代码产出。"],
  scListNote:         ["Would list the published evidence for and against the case.", "此处应列出已发布的正反证据。"],
  nextCheckTitle:     ["Next check", "下次核验"],
  nextCheckUnavailable: ["No next check is scheduled in the index.", "指数未安排下次核验。"],

  // ── Setup · entry check + model plan rail (G8, G22 setup part) ──────────
  railTitle:          ["Before considering an entry", "考虑入场之前"],
  entryTitle:         ["Entry check", "入场核验"],
  entryUnavailable:   ["Entry assessment unavailable", "入场评估不可用"],
  entryUnavailableBody: ["The Prophet index does not publish an entry assessment for this symbol.", "预言台指数未发布该代码的入场评估。"],
  entryTermsMissing:  ["Current entry terms are missing.", "当前缺少入场条款。"],
  entryPriceNote:     ["A price refresh would not renew this assessment.", "价格刷新不会更新该评估。"],
  modelPlanTitle:     ["Model plan", "模型计划"],
  modelPlanReported:  ["Reported from the Prophet index — not a recommendation.", "来自预言台指数的记录——不构成建议。"],
  modelPlanMissing:   ["This plan is not in the current board read.", "该计划不在当前计划板读取中。"],
  modelPlanNone:      ["No model plan is open for this symbol, so no plan terms are shown.", "该代码没有进行中的模型计划，因此不显示计划条款。"],
  planNoteLabel:      ["Plan management note", "计划管理备注"],
  planIdLabel:        ["Plan ID", "计划编号"],
  planStrategyLabel:  ["Strategy", "策略"],
  planAsOfLabel:      ["Signal date", "信号日期"],
  planConvictionLabel: ["Conviction", "确信度"],
  planThesisLabel:    ["Plan thesis (reported)", "计划论点（仅记录）"],
  researchNote:       ["This is a research view. It does not create a position or allocate capital.", "这是一个研究页面。不会建立仓位，也不会配置资金。"],

  // ── Save / follow (G11) ──────────────────────────────────────────────────
  saveAction:         ["Save security", "收藏证券"],
  saveWorking:        ["Confirming…", "确认中…"],
  saveSavedTitle:     ["Saved to your list", "已收藏到列表"],
  saveSavedBody:      ["{symbol} was added to your first watchlist.", "{symbol} 已加入你的第一个关注列表。"],
  saveSavedNote:      ["Saving a security does not save a dated thesis or start alerts.", "收藏证券不会保存带日期的判断，也不会启动提醒。"],
  saveFailedTitle:    ["Couldn't save to this list", "无法收藏到该列表"],
  saveFailedBody:     ["{symbol} was not added. Your list is unchanged.", "未添加 {symbol}。你的列表保持不变。"],
  saveRetry:          ["Retry save", "重试收藏"],
  saveSignedOut:      ["Sign in to save this security.", "登录后才能收藏该证券。"],
  saveDone:           ["Done", "完成"],
  followAction:       ["Follow changes", "订阅变化"],
  followTitle:        ["Alerts aren't available here", "此处暂无提醒"],
  followBody:         ["This research does not yet provide a supported change feed.", "该研究尚未提供受支持的变化推送。"],
  followNote:         ["You can still save the security and return to its published research.", "你仍可收藏该证券，并回到其已发布的研究。"],
  followBack:         ["Back to setup", "返回研究"],

  // ── Developing observation card (T2-22) ──────────────────────────────────
  obsBadge:           ["Observation only", "仅观察"],
  obsFirstTitle:      ["What is known", "已知"],
  obsMissingTitle:    ["What is missing", "缺失"],
  obsNextTitle:       ["Next useful check", "下一步核验"],
  obsKnownIntro:      ["Triggers recorded by the early-observation source.", "早期观察数据源记录到的触发条件。"],
  obsMissingBody:     ["No entry assessment is attached to an observation.", "观察不附带入场评估。"],
  obsNextBody:        ["The source does not schedule a next check.", "数据源未安排下次核验。"],
  obsReadUnavailable: ["The early-observation source is not readable right now.", "当前无法读取早期观察数据源。"],
  obsNoneBody:        ["No early observation is published for this symbol.", "该代码未发布早期观察。"],

  // ── Evidence tab (G12, G13) ──────────────────────────────────────────────
  evidenceIntro:      ["What is published, and what this source does not carry.", "哪些已发布，哪些本数据源不包含。"],
  observationEvidence:["Early observation evidence", "早期观察证据"],
  fundamentalsTitle:  ["Quarterly fundamentals", "季度基本面"],
  fundamentalsBadge:  ["Not published", "未发布"],
  fundamentalsBody:   ["Per-quarter revenue, net income, diluted shares and EPS are not served for this symbol in the Terminal yet.", "Terminal 尚未提供该代码的季度营收、净利润、摊薄股份与每股收益。"],
  sequenceTitle:      ["Information sequence", "信息时序"],
  sequenceBody:       ["Release, call and filing times are not served in this read, so no surprise claim is made.", "本次读数不提供财报发布、电话会与备案时间，因此不作意外性判断。"],
  concludeTitle:      ["What can we conclude?", "能得出什么结论？"],
  concludeBody:       ["Not enough published evidence to conclude. The Setup tab carries what is known.", "已发布证据不足以得出结论。已知内容见“研究”页。"],

  // ── Context tab (G10, G13) ──────────────────────────────────────────────
  contextIntro:       ["Membership and relationships behind this name.", "该股票背后的成员关系。"],
  membershipTitle:    ["Group membership", "行业组归属"],
  relationshipsTitle: ["Different relationships, different evidence", "不同关系，不同证据"],
  relPeer:            ["Peer membership", "同业构成"],
  relPeerBody:        ["Served by the current sector roster (see the membership line above).", "由当前行业名单提供（见上方成员信息）。"],
  relEconomic:        ["Economic exposure", "经济敞口"],
  relEconomicBody:    ["Not served — no economic-exposure mapping is published for this name.", "未提供——未发布该股票的经济敞口映射。"],
  relTheme:           ["Theme membership", "主题归属"],
  relThemeBody:       ["Not served — no theme research is linked to this name.", "未提供——没有主题研究与该股票关联。"],


  // ── Fetch states (T2-21 #4, #7) ──────────────────────────────────────────
  caseLoading:        ["Reading the case…", "正在读取案例…"],
  stateUnknown:        ["Status unknown", "状态未知"],
  stateUnknownBody:   ["The Prophet state for this symbol cannot be determined from this source.", "无法从该数据源确定该代码的预言台状态。"],
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

/** Served Prophet state → stance subline key (reported, never a verdict). */
export function stanceKey(state: string): SetupKey {
  switch (state) {
    case "open_plan": return "stanceOpenPlan";
    case "resolved_plan": return "stanceResolvedPlan";
    case "early_observation": return "stanceEarly";
    case "none": return "stanceNone";
    default: return "stanceUnavailable";
  }
}

/** Signed percentage with one decimal — the sector lane's number grammar. */
export function fmtSignedPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
