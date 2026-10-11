"use client";
import { useCallback } from "react";
import { useLang } from "./i18n";

/**
 * Feature-local EN/ZH copy for the Financials · Compare workbench. Language state stays the
 * shared LangProvider; the copy stays out of the global LEX so it is loaded only with this
 * page. `{name}` placeholders are filled by `fcText` — the same names in both languages.
 */
export const FIN_COMPARE_LEX = {
  fcEyebrow: ["FINANCIALS", "财务数据"],
  fcTitle: ["Compare metrics", "指标对比"],
  fcIntro: [
    "Pin up to four statement metrics across {anchor} and up to five peers. A number is shown only when its statement format, currency, period kind and flow basis match the frame; every other cell says why it is left out.",
    "在 {anchor} 与最多五家同业之间固定最多四项报表指标。仅当报表格式、货币、期间类型与流量口径均与基准一致时才显示数值；其余单元格会说明原因。",
  ],
  fcFrame: ["Frame set by {anchor}: {kind} · {currency} · {family}", "基准取自 {anchor}：{kind} · {currency} · {family}"],
  fcKindYear: ["fiscal years", "财年"],
  fcKindHalf: ["half-years", "半年期"],
  fcKindQuarter: ["quarters", "季度"],
  fcFamIndustrial: ["industrial statements", "一般企业报表"],
  fcFamBank: ["bank statements", "银行报表"],
  fcFamInsurer: ["insurer statements", "保险报表"],
  fcFamFinancialServices: ["financial-services statements", "金融服务报表"],
  fcFamAmbiguous: ["statement format unresolved", "报表格式无法确定"],
  fcCurrencyUnknown: ["currency unavailable", "货币不可用"],

  fcBasisLabel: ["Period basis", "期间口径"],
  fcAnnual: ["Annual", "年度"],
  fcAlignLabel: ["Alignment", "对齐方式"],
  fcAlignFiscal: ["Fiscal-relative", "财期相对"],
  fcAlignCalendar: ["Calendar-aligned", "自然日历对齐"],
  fcAlignFiscalNote: [
    "Fiscal-relative: each column is each company's own latest period and the ones before it, counted by period end date. Fiscal calendars differ, so every cell names its own period and end date.",
    "财期相对：每列为各公司自身最新一期及之前各期，按期末日期计数。各公司财年不同，因此每个单元格均标明其自身期间与期末日期。",
  ],
  fcAlignCalendarNote: [
    "Calendar-aligned: a period is placed in the calendar {unit} that holds most of its days. A period split almost evenly across two is left out rather than guessed. Where a filing gives no start date, the start is estimated from the period length.",
    "自然日历对齐：每一期归入其多数天数所在的自然{unit}。几乎平分于两个自然期间的报告期不作归入，而非猜测。若备案未给出起始日期，则按期间长度估算起始日。",
  ],
  fcUnitYear: ["year", "年"],
  fcUnitHalf: ["half-year", "半年"],
  fcUnitQuarter: ["quarter", "季度"],

  fcPeersLabel: ["Companies", "公司"],
  fcAnchorBadge: ["frame", "基准"],
  fcAddPeerLabel: ["Peer ticker", "同业代码"],
  fcAddPeerPlaceholder: ["Add a peer, e.g. AMD", "添加同业，如 AMD"],
  fcAddPeer: ["Add", "添加"],
  fcRemovePeer: ["Remove {sym}", "移除 {sym}"],
  fcPeerInvalid: ["Enter a ticker such as AMD, 0700.HK or BRK.B.", "请输入代码，例如 AMD、0700.HK 或 BRK.B。"],
  fcPeerAnchor: ["{sym} already sets the frame.", "{sym} 已是对比基准。"],
  fcPeerDuplicate: ["{sym} is already pinned.", "{sym} 已在列表中。"],
  fcPeerLimit: ["Up to {n} peers. Remove one to add another.", "最多 {n} 家同业，请先移除一家。"],
  fcNoPeers: ["Add a peer to compare with {anchor}.", "添加同业以与 {anchor} 对比。"],

  fcMetricsLabel: ["Metrics", "指标"],
  fcMetricLimit: ["Up to {n} metrics at once.", "最多同时选择 {n} 项指标。"],
  fcM_gross_profit: ["Gross profit", "毛利"],
  fcM_op_income: ["Operating income", "营业利润"],
  fcM_net_income: ["Net income", "净利润"],
  fcM_eps_diluted: ["Diluted EPS", "稀释每股收益"],
  fcM_net_margin: ["Net margin", "净利率"],
  fcM_assets: ["Total assets", "总资产"],
  fcM_equity: ["Total equity", "股东权益"],
  fcM_cfo: ["Operating cash flow", "经营活动现金流"],
  fcM_fcf: ["Free cash flow", "自由现金流"],
  fcMetaFlow: ["flow over the period", "期间流量"],
  fcMetaStock: ["period-end balance", "期末余额"],
  fcMetaPerShare: ["per share", "每股"],
  fcMetaRatio: ["net income ÷ {topLine}, same period", "净利润 ÷ {topLine}，同一期间"],
  fcMetaUnitPercent: ["percent", "百分比"],
  fcMetaUnitPerShare: ["{currency} per share", "{currency} 每股"],
  fcRuleAny: ["comparable across statement formats", "可跨报表格式比较"],
  fcRuleSame: ["same statement format only", "仅限相同报表格式"],
  fcRuleIndustrial: ["industrial statements only", "仅限一般企业报表"],
  fcIndustrialOnlyTable: [
    "{metric} is an industrial-statement line. {anchor} reports {family}, so there is no comparable figure for this frame.",
    "{metric} 是一般企业报表科目。{anchor} 采用{family}，因此该基准下没有可比数值。",
  ],
  fcAmbiguousTable: [
    "{anchor}'s statement format could not be resolved, so {metric} — whose composition depends on the format — is not compared.",
    "{anchor} 的报表格式无法确定，因此其构成取决于格式的 {metric} 不作比较。",
  ],

  fcCompanyCol: ["Company", "公司"],
  fcColLatest: ["Latest {kind}", "最新{kind}"],
  fcColBack: ["{kind} −{n}", "前{n}{kind}"],
  fcColKindYear: ["FY", "财年"],
  fcColKindHalf: ["half", "半年"],
  fcColKindQuarter: ["quarter", "季度"],
  fcColCalYear: ["CY {year}", "{year} 自然年"],
  fcColCalHalf: ["CH{part} {year}", "{year} 自然H{part}"],
  fcColCalQuarter: ["CQ{part} {year}", "{year} 自然Q{part}"],
  fcCellEnded: ["ended {date}", "截至 {date}"],
  fcRank: ["#{rank} of {of}", "第{rank}/{of}"],
  fcRestated: ["Restated", "已重述"],
  fcRestatedTitle: [
    "More than one filing reported this period. The latest filing's figure is shown ({filed}); earlier figures are not retained by the source.",
    "该期间有多份备案。显示最新备案的数值（{filed}）；来源未保留较早的数值。",
  ],
  fcFiledUnknown: ["filing date not recorded", "未记录备案日期"],
  fcFiledOn: ["filed {date}", "备案于 {date}"],
  fcDifferenced: ["From YTD", "由累计差分"],
  fcDifferencedTitle: [
    "This interim figure is the year-to-date total minus the prior year-to-date total — the same normalization the Statements tab shows.",
    "该中期数值为本期累计数减去上期累计数——与财务报表页显示的标准化口径相同。",
  ],
  fcStaleRevalidating: ["Refreshing", "正在刷新"],
  fcStaleRevalidatingTitle: ["Showing a saved copy while a newer read is fetched.", "正在获取最新数据，暂显示已保存副本。"],
  fcStaleFailed: ["Last saved copy", "上次保存的副本"],
  fcStaleFailedTitle: ["The refresh failed; these figures are from the last successful read.", "刷新失败；这些数值来自上次成功读取。"],

  fcLoading: ["Loading statements…", "正在加载报表…"],
  fcAbsent: ["Statements for {sym} are not published.", "{sym} 的财务报表未发布。"],
  fcUnavailable: ["Statements for {sym} could not be read ({reason}).", "无法读取 {sym} 的财务报表（{reason}）。"],
  fcReasonNetwork: ["network error", "网络错误"],
  fcReasonServer: ["server error", "服务器错误"],
  fcReasonMalformed: ["unreadable file", "文件无法解析"],
  fcRetry: ["Retry", "重试"],
  fcBasisAbsent: ["{sym} publishes no {basis} statements.", "{sym} 未发布{basis}报表。"],
  fcKindMismatch: ["{sym} reports {kinds}, not {kind} — not comparable in this frame.", "{sym} 披露的是{kinds}而非{kind}，在该基准下不可比。"],
  fcKindUnknown: ["{sym}'s period kinds are not stated, so its periods are not compared.", "{sym} 未说明期间类型，因此不参与比较。"],
  fcGenerationGap: [
    "{sym}'s latest period ends {latest}, a full period away from the frame's {frame}. Its columns would not be the same generation — switch to Calendar-aligned to place it by date.",
    "{sym} 最新一期截至 {latest}，与基准的 {frame} 相差整整一期，各列不属于同一代——可切换到自然日历对齐按日期归入。",
  ],
  fcPkFullYear: ["fiscal years", "财年"],
  fcPkHalfYear: ["half-years", "半年期"],
  fcPkQuarter: ["quarters", "季度"],
  fcPkYtd: ["year-to-date totals", "年初至今累计"],
  fcBasisAnnualWord: ["annual", "年度"],
  fcBasisInterimWord: ["interim", "中期"],

  fcStatusNoncomparable: ["Not comparable", "不可比"],
  fcStatusUnavailable: ["Unavailable", "不可用"],
  fcR_no_period: ["No period", "无该期"],
  fcRT_no_period: ["This company has no {kind} period in this column.", "该公司在此列没有对应的{kind}期间。"],
  fcR_no_value: ["Not reported", "未披露"],
  fcRT_no_value: ["The filing for this period does not report this line.", "该期备案未披露此科目。"],
  fcR_family_mismatch: ["Other format", "格式不同"],
  fcRT_family_mismatch: [
    "This company reports {family}; the frame is {frameFamily}. The line has the same name but not the same composition.",
    "该公司采用{family}；基准为{frameFamily}。科目名称相同，但构成不同。",
  ],
  fcR_family_ambiguous: ["Format unresolved", "格式无法确定"],
  fcRT_family_ambiguous: ["The statement format for this period could not be resolved.", "该期报表格式无法确定。"],
  fcR_currency_mismatch: ["{currency}", "{currency}"],
  fcRT_currency_mismatch: [
    "Reported in {currency}; the frame reports in {frameCurrency}. Amounts in different currencies are not compared or converted.",
    "以 {currency} 列报；基准以 {frameCurrency} 列报。不同货币的金额不作比较或换算。",
  ],
  fcR_currency_unknown: ["Currency unknown", "货币未知"],
  fcRT_currency_unknown: ["The statement currency is not recorded, so this amount is not compared.", "未记录报表货币，因此该金额不作比较。"],
  fcR_cumulative_flow: ["Year-to-date", "年初累计"],
  fcRT_cumulative_flow: ["This interim figure is cumulative from the start of the fiscal year, not a single period.", "该中期数值为财年初至今的累计值，而非单一期间。"],
  fcR_missing_base: ["No base period", "缺少基期"],
  fcRT_missing_base: ["The prior year-to-date filing needed to isolate this period is missing.", "缺少分离该期间所需的上期累计备案。"],
  fcR_flow_basis_unknown: ["Basis unknown", "口径未知"],
  fcRT_flow_basis_unknown: ["The filing does not say whether this figure covers one period or the year to date.", "备案未说明该数值为单一期间还是年初累计。"],
  fcR_margin_undefined: ["Undefined", "无法计算"],
  fcRT_margin_undefined: ["Net margin needs a positive top line for the same period.", "净利率需要同期为正的营业收入。"],
  fcR_calendar_collision: ["Two periods", "两期重叠"],
  fcRT_calendar_collision: ["Two of this company's periods fall mostly in this calendar period; neither is chosen.", "该公司有两期主要落在此自然期间，均不选用。"],
  fcR_calendar_straddle: ["Split period", "跨期"],
  fcRT_calendar_straddle: ["This company's period splits almost evenly across two calendar periods, so it is not placed.", "该公司的报告期几乎平分于两个自然期间，因此不作归入。"],

  fcAnchorLoading: ["Loading {sym} statements…", "正在加载 {sym} 报表…"],
  fcAnchorAbsentTitle: ["No statements to compare", "暂无可比较的报表"],
  fcAnchorAbsent: [
    "Financial statements for {sym} are not available, so there is no frame to compare peers against.",
    "{sym} 的财务报表不可用，因此没有可供同业比较的基准。",
  ],
  fcAnchorBasisAbsent: ["{sym} publishes no {basis} statements. Choose the other basis.", "{sym} 未发布{basis}报表，请选择另一种口径。"],
  fcAnchorKindUnknown: [
    "{sym}'s {basis} periods do not state a period kind the comparison can align.",
    "{sym} 的{basis}期间未说明可用于对齐的期间类型。",
  ],
  fcCalendarEmpty: [
    "No calendar period holds most of any company's {kind} — nothing can be placed by date.",
    "没有任何公司的{kind}主要落在某个自然期间内——无法按日期归入。",
  ],

  fcSourceTitle: ["Source", "来源"],
  fcSourceFor: ["{sym} · {metric} · {label} · ended {date}", "{sym} · {metric} · {label} · 截至 {date}"],
  fcSourceBasis: ["{basis} {statement} · {currency} · {family}", "{basis}{statement} · {currency} · {family}"],
  fcSourceHint: [
    "The {sym} Statements view, opened on this exact period. The highlighted cell is the figure the comparison used.",
    "{sym} 财务报表视图，已定位到该期间。高亮单元格即为对比所用数值。",
  ],
  fcSourceMarginHint: [
    "Net margin is computed from the highlighted net income and the {topLine} in the same column.",
    "净利率由高亮的净利润与同列的{topLine}计算得出。",
  ],
  fcSourceStartEstimated: ["Period start not filed; estimated from the period length.", "备案未给出期间起始日；按期间长度估算。"],
  fcSourceMissing: [
    "That period is no longer published for {sym}. The comparison will refresh with the current file.",
    "{sym} 已不再发布该期间。对比将按当前文件刷新。",
  ],
  fcCloseSource: ["Close source", "关闭来源"],
  fcOpenSource: ["Open source: {sym} {metric}, {label}, ended {date}", "打开来源：{sym} {metric}，{label}，截至 {date}"],
  fcStmtIncome: ["income statement", "利润表"],
  fcStmtBalance: ["balance sheet", "资产负债表"],
  fcStmtCashflow: ["cash flow statement", "现金流量表"],
} as const satisfies Record<string, readonly [string, string]>;

export type FinCompareKey = keyof typeof FIN_COMPARE_LEX;
export type FinCompareVars = Record<string, string | number>;

/** One string in one language, with `{name}` placeholders filled; an unknown name is left as is. */
export function fcText(zh: boolean, key: FinCompareKey, vars?: FinCompareVars): string {
  const text: string = FIN_COMPARE_LEX[key][zh ? 1 : 0];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export function useFinCompareT() {
  const { lang } = useLang();
  const zh = lang === "zh";
  return useCallback((key: FinCompareKey, vars?: FinCompareVars) => fcText(zh, key, vars), [zh]);
}
