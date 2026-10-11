"use client";
import { useCallback } from "react";
import { useLang } from "./i18n";
import type { FundamentalBasis, FundamentalFieldId } from "./fundamentalScan";
import type { CoverageStatus } from "./screenerScan";

/** Feature-local EN/ZH tuples for the Screener's fundamental screen (E02). Language state stays
 * the shared LangProvider; the copy stays out of global LEX so other routes do not load it and
 * their screen evidence does not move. Every reason code the scan contract can emit has an entry
 * here (pinned by lib/__tests__/fundamentalScanLex.test.ts), so no unknown is ever unexplained.
 */
export const FUNDAMENTAL_SCAN_LEX: Record<string, [string, string]> = {
  // ── the bar ──
  fsToggle: ["Fundamentals", "基本面"],
  fsToggleTitle: ["Filter on fiscal-period fundamentals", "按财务期间的基本面筛选"],
  fsRowLabel: ["Fundamental filters", "基本面筛选"],
  fsField: ["Fundamental field", "基本面字段"],
  fsMin: ["Min", "最低"],
  fsMax: ["Max", "最高"],
  fsModeRange: ["Range", "区间"],
  fsModeUnknown: ["Only unknown", "仅未知"],
  fsMode: ["Filter mode", "筛选方式"],
  fsIncludeUnknown: ["Also include unknown", "同时包含未知"],
  fsAdd: ["Add filter", "添加筛选"],
  fsUpdate: ["Update filter", "更新筛选"],
  fsRemove: ["Remove", "移除"],
  fsClear: ["Clear fundamentals", "清除基本面筛选"],
  fsErrNumber: ["Enter a number", "请输入数字"],
  fsErrOrder: ["Min must not exceed max", "最低值不能高于最高值"],
  fsErrEmpty: ["Enter a min, a max, or choose Only unknown", "请输入最低值或最高值，或选择仅未知"],
  fsUnitPct: ["Enter percent: 15 means 15%", "以百分比输入：15 即 15%"],
  fsUnitMult: ["Enter a multiple: 15 means 15×", "以倍数输入：15 即 15×"],
  fsChipUnknown: ["unknown", "未知"],
  fsChipPlusUnknown: ["+ unknown", "+ 未知"],
  fsSourceKeys: ["Source keys", "来源字段"],
  // ── field names ──
  "fsF_fund.pe_ttm": ["P/E · TTM", "市盈率 · TTM"],
  "fsF_fund.gross_margin_fy": ["Gross margin · FY", "毛利率 · 财年"],
  "fsF_fund.net_margin_fy": ["Net margin · FY", "净利率 · 财年"],
  "fsF_fund.roe_fy": ["ROE · FY", "净资产收益率 · 财年"],
  "fsF_fund.revenue_growth_fy": ["Revenue growth · FY", "营收增长 · 财年"],
  "fsC_fund.pe_ttm": ["P/E TTM", "市盈率TTM"],
  "fsC_fund.gross_margin_fy": ["Gross mgn FY", "毛利率财年"],
  "fsC_fund.net_margin_fy": ["Net mgn FY", "净利率财年"],
  "fsC_fund.roe_fy": ["ROE FY", "ROE财年"],
  "fsC_fund.revenue_growth_fy": ["Rev growth FY", "营收增长财年"],
  // ── basis: which period a value belongs to (never mixed inside one field) ──
  fsB_ttm_snapshot: ["Trailing-twelve-month vendor multiple, captured on each company's snapshot date — not a fiscal-year value.", "供应商近十二个月倍数，按各公司快照日期采集 — 并非财年数值。"],
  fsB_fiscal_year: ["Each company's latest full fiscal year, from annual statements only — never an interim, TTM or older year.", "各公司最近一个完整财年，仅取年度报表 — 不以中期、TTM或更早年度替代。"],
  fsB_fiscal_year_vs_prior: ["Latest full fiscal year against its comparable prior fiscal year (330–400 days earlier).", "最近完整财年对比其可比上一财年（早330–400天）。"],
  fsFamIndustrial: ["Industrial statements only — banks, insurers and financial-services companies count as not supported.", "仅适用工业类报表 — 银行、保险及金融服务公司计为不支持。"],
  fsFamAny: ["All statement families.", "适用所有报表类型。"],
  // ── scan state ──
  fsLoading: ["Loading the fundamental scan…", "正在加载基本面扫描…"],
  fsAbsent: ["The fundamental scan has not been published yet, so fundamental filters cannot be applied.", "基本面扫描尚未发布，暂无法应用基本面筛选。"],
  fsUnavailable: ["The fundamental scan could not be read.", "无法读取基本面扫描。"],
  fsRetry: ["Retry", "重试"],
  fsRefreshFailed: ["Refresh failed — showing the last scan read", "刷新失败 — 显示上次读取的扫描"],
  fsGenerated: ["Scan generated {d}", "扫描生成于 {d}"],
  fsIncomplete: ["Partial scan: {n} companies not processed", "部分扫描：{n} 家公司未处理"],
  // ── result tally (AC-E02-05) ──
  fsTallyMatched: ["{n} matched", "{n} 家符合"],
  fsTallyFailed: ["{n} failed on a known value", "{n} 家已知数值不符"],
  fsTallyUnknownOut: ["{n} excluded — value unknown", "{n} 家因数值未知被排除"],
  fsTallyUnknownIn: ["{n} included as unknown", "{n} 家作为未知被包含"],
  fsTallyOf: ["of {n} after the other filters", "（其他筛选后共 {n} 家）"],
  fsCoverageFor: ["Coverage · {f}", "覆盖 · {f}"],
  fsPeriodRange: ["Fiscal years ending {a} – {b}", "财年截止于 {a} – {b}"],
  fsPeriodOne: ["Fiscal years ending {a}", "财年截止于 {a}"],
  fsSnapshotRange: ["Snapshots {a} – {b}", "快照日期 {a} – {b}"],
  fsSnapshotOne: ["Snapshot {a}", "快照日期 {a}"],
  fsNoKnown: ["No known values in this result", "当前结果中没有已知数值"],
  // ── coverage statuses ──
  fsS_evaluated: ["Known", "已知"],
  fsS_stale: ["Stale — not used by filters", "已过期 — 不参与筛选"],
  fsS_unsupported: ["Not supported", "不支持"],
  fsS_unavailable: ["Unavailable", "不可用"],
  // ── reasons: row level ──
  fsR_asset_class_not_covered: ["Not an equity — no company statements", "非股票 — 无公司报表"],
  fsR_fund_absent: ["No company fundamentals file", "无公司基本面文件"],
  fsR_fund_unreadable: ["Company fundamentals file unreadable", "公司基本面文件无法读取"],
  fsR_fund_malformed: ["Company fundamentals file malformed", "公司基本面文件格式错误"],
  fsR_not_processed: ["Not processed in this scan run", "本次扫描未处理"],
  // ── reasons: field level, unsupported ──
  fsR_pe_basis_unverified: ["P/E may be on a last-fiscal-year basis (A-shares) — withheld", "市盈率可能为上一财年口径（A股）— 不予采用"],
  fsR_currency_basis_unverified: ["Trading and reporting currencies differ — basis unproven", "交易货币与报表货币不同 — 口径未经验证"],
  fsR_equity_basis_unverified: ["Equity includes minority interests (CN/HK) — ROE withheld", "权益含少数股东权益（A股/港股）— 不计算ROE"],
  fsR_family_not_applicable: ["Bank, insurer or financial statements — industrial ratio not applicable", "银行、保险或金融类报表 — 不适用工业类比率"],
  fsR_family_ambiguous: ["Several statement formats on file — family ambiguous", "存在多种报表格式 — 报表类型不明确"],
  fsR_family_unverified: ["Statement family unverified", "报表类型未经验证"],
  fsR_family_changed: ["Statement family changed from the prior year", "报表类型较上一财年发生变化"],
  fsR_period_not_annual: ["Latest annual column is not a full fiscal year", "最新年度列并非完整财年"],
  // ── reasons: field level, unavailable ──
  fsR_not_reported: ["Not reported by the source", "来源未报告"],
  fsR_earnings_nonpositive: ["Earnings ≤ 0 — no meaningful P/E", "盈利 ≤ 0 — 市盈率无意义"],
  fsR_denominator_nonpositive: ["Revenue or equity ≤ 0 — ratio undefined", "营收或权益 ≤ 0 — 比率无定义"],
  fsR_input_missing: ["A required input is missing for the latest fiscal year", "最新财年缺少必要输入"],
  fsR_input_misaligned: ["A statement line is not aligned to its periods", "报表科目与期间未对齐"],
  fsR_no_annual_statements: ["No annual statements on file", "无年度报表"],
  fsR_period_axis_misaligned: ["Period labels are not aligned", "期间标签未对齐"],
  fsR_period_end_missing: ["Latest fiscal year has no period end", "最新财年缺少期末日期"],
  fsR_period_order_invalid: ["Latest column is not the newest period", "最新列并非最近期间"],
  fsR_no_comparable_prior: ["No comparable prior fiscal year", "无可比的上一财年"],
  // ── reasons: derived by the reader ──
  fsR_ok: ["Known", "已知"],
  fsR_generation_stale: ["Scan is more than 4 days old", "扫描已超过4天"],
  fsR_fiscal_period_aged: ["Fiscal year ended more than 18 months ago", "财年结束已超过18个月"],
  fsR_snapshot_aged: ["P/E snapshot is more than 14 days old", "市盈率快照已超过14天"],
  fsR_field_not_produced: ["Field not produced by this scan", "本次扫描未生成该字段"],
  fsR_scan_absent: ["Fundamental scan not published", "基本面扫描尚未发布"],
  fsR_scan_unavailable: ["Fundamental scan unavailable", "基本面扫描不可用"],
  fsR_not_in_scan: ["Symbol not in the scan", "该代码不在扫描中"],
  fsR_malformed_row: ["Scan row malformed", "扫描行格式错误"],
  fsR_invalid_coverage: ["Coverage could not be classified", "覆盖状态无法分类"],
  // ── statement families ──
  fsFam_industrial: ["Industrial", "工业类"],
  fsFam_bank: ["Bank", "银行"],
  fsFam_insurer: ["Insurer", "保险"],
  fsFam_financial_services: ["Financial services", "金融服务"],
  fsFam_ambiguous: ["Ambiguous", "不明确"],
  fsFam_other: ["Other", "其他"],
  // ── company evidence ──
  fsEvOpen: ["Show evidence for {s}", "查看 {s} 的证据"],
  fsEvTitle: ["Fundamental evidence", "基本面证据"],
  fsEvClose: ["Close", "关闭"],
  fsEvLoading: ["Reading the company file…", "正在读取公司文件…"],
  fsEvAbsent: ["No fundamentals file is published for this company.", "该公司没有已发布的基本面文件。"],
  fsEvUnavailable: ["The company file could not be read.", "无法读取公司文件。"],
  fsEvNotObserved: ["This company has no fundamental values in the scan.", "该公司在扫描中没有基本面数值。"],
  fsEvPeriod: ["Fiscal period and sources", "财务期间与来源"],
  fsEvFyLabel: ["Fiscal year", "财年"],
  fsEvPeriodEnd: ["Period end", "期末日期"],
  fsEvKind: ["Period type", "期间类型"],
  fsEvKindFull: ["Full fiscal year", "完整财年"],
  fsEvFamily: ["Statement family", "报表类型"],
  fsEvStmtSrc: ["Statement source", "报表来源"],
  fsEvFiled: ["Filed", "披露日期"],
  fsEvRestated: ["Restated", "重述"],
  fsEvSnapshot: ["Snapshot as of", "快照日期"],
  fsEvCcyQuote: ["Trading currency", "交易货币"],
  fsEvCcyStmt: ["Reporting currency", "报表货币"],
  fsEvPrior: ["Comparable prior year", "可比上一财年"],
  fsEvInterim: ["Latest interim period end", "最新中期期末"],
  fsEvInterimNote: ["Interim periods are shown for context and never used by fiscal-year fields.", "中期数据仅作参考，财年字段从不使用。"],
  fsEvScanGen: ["Scan generated", "扫描生成时间"],
  fsEvField: ["Field", "字段"],
  fsEvScreen: ["In screen", "筛选中"],
  fsEvFile: ["From company file", "来自公司文件"],
  fsEvInputs: ["Inputs ({c})", "输入（{c}）"],
  fsEvSame: ["Same value", "数值一致"],
  fsEvDiffers: ["Differs — the company file changed after this scan", "不一致 — 扫描后公司文件已更新"],
  fsEvOpenStatements: ["Open statements", "打开财务报表"],
  fsEvYes: ["Yes", "是"],
  fsEvNo: ["No", "否"],
  fsEvNotStated: ["Not stated", "未说明"],
  fsIn_revenue: ["Revenue", "营收"],
  fsIn_grossProfit: ["Gross profit", "毛利"],
  fsIn_netIncome: ["Net income", "净利润"],
  fsIn_equity: ["Equity at fiscal year end", "财年末股东权益"],
  fsIn_priorRevenue: ["Prior-year revenue", "上一财年营收"],
  fsIn_peTtm: ["Vendor P/E", "供应商市盈率"],
};

export type FundT = (key: string, vars?: Record<string, string | number>) => string;

/** Pure lookup (tests, non-React callers). An unknown key returns itself — never a blank. */
export function fundText(lang: string, key: string, vars?: Record<string, string | number>): string {
  const pair = FUNDAMENTAL_SCAN_LEX[key];
  let s = pair ? pair[lang === "zh" ? 1 : 0] : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function useFundT(): FundT {
  const { lang } = useLang();
  return useCallback((key: string, vars?: Record<string, string | number>) => fundText(lang, key, vars), [lang]);
}

export const fieldName = (t: FundT, f: FundamentalFieldId): string => t(`fsF_${f}`);
export const fieldColumn = (t: FundT, f: FundamentalFieldId): string => t(`fsC_${f}`);
export const basisText = (t: FundT, b: FundamentalBasis): string => t(`fsB_${b}`);
export const statusText = (t: FundT, s: CoverageStatus): string => t(`fsS_${s}`);
export const reasonText = (t: FundT, r: string): string => t(`fsR_${r}`);
export const familyText = (t: FundT, fam: string): string => (FUNDAMENTAL_SCAN_LEX[`fsFam_${fam}`] ? t(`fsFam_${fam}`) : fam);
