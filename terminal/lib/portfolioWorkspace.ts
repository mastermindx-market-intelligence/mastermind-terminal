import type { Position } from "@/lib/portfolio";
import { finite, nativePrice, priceCurrency, type PriceObservation } from "@/lib/portfolioMoney";

export type PortfolioSection = "overview" | "holdings" | "risk" | "targets";
export type RecordFilter = "all" | "details" | "prices";
export type RecordIssue = "shares" | "entryPrice" | "entryCurrency" | "quote" | "quoteCurrency" | "currencyMismatch";
export type WorkspaceQuote = PriceObservation;
export type WorkspaceManifest = { name?: string; zh?: string; col?: string; last?: number; chg?: number; currency?: unknown };

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const nullableNumber = (v: unknown) => v === null || finite(v);
const nullableText = (v: unknown) => v === null || typeof v === "string";

/** A transport boundary, not another input normalizer. One malformed row makes the
 * read unreadable; it must never be filtered into a smaller, reassuring book. */
export function decodePositionRead(value: unknown): { positions: Position[]; bookKey: string } | null {
  if (!record(value) || !Array.isArray(value.positions) || typeof value.bookKey !== "string"
    || !/^[a-f0-9]{64}$/.test(value.bookKey)) return null;
  const ids = new Set<string>();
  for (const p of value.positions) {
    if (!record(p) || typeof p.id !== "string" || !p.id.trim() || ids.has(p.id)
      || typeof p.ticker !== "string" || !p.ticker.trim()
      || !nullableNumber(p.shares) || !nullableNumber(p.entryPrice)
      || !nullableText(p.entryDate) || !nullableText(p.notes) || !nullableText(p.createdAt)
      || (p.status !== "open" && p.status !== "closed")
      || (p.entryCurrency !== undefined && p.entryCurrency !== null && priceCurrency(p.entryCurrency) === null)) return null;
    ids.add(p.id);
  }
  return { positions: value.positions as Position[], bookKey: value.bookKey };
}

export function recordIssues(position: Position, quote: WorkspaceQuote, fallback: WorkspaceQuote): RecordIssue[] {
  const issues: RecordIssue[] = [];
  const price = nativePrice(quote, fallback);
  if (position.shares === null) issues.push("shares");
  if (position.entryPrice === null) issues.push("entryPrice");
  else if (!priceCurrency(position.entryCurrency)) issues.push("entryCurrency");
  if (!price) issues.push("quote");
  else if (!price.currency) issues.push("quoteCurrency");
  else if (priceCurrency(position.entryCurrency) && position.entryCurrency !== price.currency) issues.push("currencyMismatch");
  return issues;
}

export const needsEntryDetails = (issues: readonly RecordIssue[]) =>
  issues.some(issue => issue === "shares" || issue === "entryPrice" || issue === "entryCurrency");
export const needsPriceCoverage = (issues: readonly RecordIssue[]) =>
  issues.some(issue => issue === "quote" || issue === "quoteCurrency" || issue === "currencyMismatch");

export function selectPortfolioRecords(
  positions: readonly Position[],
  quotes: Readonly<Record<string, WorkspaceQuote>>,
  manifest: Readonly<Record<string, WorkspaceManifest>>,
  options: { status: "open" | "closed"; query: string; filter: RecordFilter },
): Position[] {
  const query = options.query.trim().toLocaleLowerCase();
  return positions.filter(position => {
    if (position.status !== options.status) return false;
    const row = manifest[position.ticker];
    if (query && ![position.ticker, row?.name, row?.zh, position.notes]
      .some(value => typeof value === "string" && value.toLocaleLowerCase().includes(query))) return false;
    const issues = recordIssues(position, quotes[position.ticker], row);
    return options.filter === "all" || (options.filter === "details" ? needsEntryDetails(issues) : needsPriceCoverage(issues));
  });
}

/** UI copy follows Terminal's EN/ZH tuple convention and existing useLang owner. */
export const PORTFOLIO_LEX = {
  aboutExposure: ["How to read this exposure", "如何理解敞口"],
  aboutTargets: ["How targets work", "目标如何计算"],
  savingTarget: ["Saving target…", "正在保存目标…"],
  weightsPending: ["Current weights are awaiting refresh.", "当前权重等待刷新。"],
  changeUnconfirmed: ["We couldn't confirm that change. Refresh holdings to check the latest saved record.", "无法确认此更改。请刷新持仓，核对最新保存的记录。"],
  saveUnconfirmed: ["We couldn't confirm this save. Your entries are still here. Try again to check the same record.", "无法确认此次保存。填写的信息仍在此处，请重试以核对同一记录。"],
  clearingTarget: ["Clearing target…", "正在清除目标…"],
  createConflict: ["This record could not be confirmed. Refresh holdings and review the existing record before starting a new entry.", "无法确认此记录。请刷新持仓并检查现有记录，再新增持仓。"],
  invalidPositionTicker: ["Enter a valid security symbol.", "请输入有效的证券代码。"],
  invalidPositionShares: ["Enter a valid share count, or leave it blank.", "请输入有效的数量，或留空。"],
  invalidPositionPrice: ["Enter a valid entry price, or leave it blank.", "请输入有效的入场价，或留空。"],
  invalidPositionCurrency: ["Use a valid entry currency code, such as USD or HKD.", "请填写有效的入场币种代码，例如 USD 或 HKD。"],
  invalidPositionDate: ["Enter a valid calendar date, or leave it blank.", "请输入有效的日期，或留空。"],
  invalidPositionNotes: ["Notes can contain up to 1,000 characters. Remove any unsupported characters.", "备注最多可填写 1,000 个字符，请移除不支持的字符。"],
  invalidPositionIntent: ["This entry needs to be reopened. Copy your details, then close it and add the position again.", "请复制填写的信息，关闭此窗口后重新添加持仓。"],
  positionNotFound: ["This position is no longer available. Close the editor and refresh holdings.", "此持仓已不可用。请关闭编辑窗口并刷新持仓。"],
  positionCurrencyUnconfirmed: ["The entry price or security changed before the currency was confirmed. Refresh holdings and review this record.", "确认币种前，入场价或证券已发生变化。请刷新持仓并检查此记录。"],
  ownerChanged: ["The account changed before this change could be saved, so it was not applied. Check the account shown above before trying again.", "保存前账户已切换，此更改未生效。请先核对当前显示的账户，再决定是否重试。"],
  overview: ["Overview", "概览"], holdings: ["Holdings", "持仓"], risk: ["Risk & exposure", "风险与敞口"], targets: ["Targets", "目标"],
  subtitle: ["A clearer view of what you own.", "清晰掌握每一笔持仓。"],
  securities: ["securities", "只证券"], records: ["records", "条记录"],
  refresh: ["Refresh holdings", "刷新持仓"], refreshing: ["Checking holdings…", "正在核对持仓…"],
  checked: ["Holdings checked", "持仓已核对"], pricedValue: ["Priced value", "已定价持仓市值"],
  dayMove: ["Day change", "当日变动"], sinceEntry: ["Since entry", "入场以来"],
  pricedRecords: ["priced records", "条记录已定价"], basedRecords: ["records with comparable entry prices", "条记录有可比入场价"],
  valueUnavailable: ["A common currency total is unavailable.", "暂无法提供统一币种汇总。"],
  valueScope: ["Current prices for sized records.", "按已填写数量的记录及当前可用价格计算。"],
  pnlScope: ["Price change on the priced, based records.", "已定价且有入场价记录的价格变动。"],
  noReturns: ["Cash flows, income and fees are not included.", "未计入资金流、收入或费用。"],
  reviewCoverage: ["Review coverage", "查看覆盖情况"], coverage: ["Coverage & calculation", "覆盖与计算方法"],
  entryDetails: ["Entry details", "入场信息"], priceCoverage: ["Price coverage", "价格覆盖"],
  reviewNext: ["Review next", "待查看事项"], reviewNextHint: ["Details that unlock a clearer picture.", "补充信息，让持仓更清晰。"],
  sharesIssue: ["Add shares to calculate value.", "填写数量以计算市值。"],
  entryPriceIssue: ["Add an entry price to see the price change.", "填写入场价以查看价格变动。"],
  entryCurrencyIssue: ["Record the entry currency to compare prices.", "记录入场币种以比较价格。"],
  quoteIssue: ["A usable price is not available.", "暂无可用价格。"],
  quoteCurrencyIssue: ["The price source has not identified its currency.", "价格来源未标明币种。"],
  currencyMismatchIssue: ["Entry and quote currencies differ.", "入场价与报价的币种不同。"],
  detailsTask: ["Complete entry details", "补充入场信息"], pricesTask: ["Review price coverage", "查看价格覆盖"],
  detailsReady: ["Your entry details are in place.", "入场信息已齐备。"],
  detailsReadyHint: ["Review a holding to see its prices, notes and research.", "查看持仓的价格、备注及研究。"],
  pricedScope: ["priced and sized", "已有价格和数量"], commonUnits: ["No currency conversion is applied.", "未进行货币换算。"],
  concentration: ["Cost concentration", "成本集中度"], concentrationHint: ["Share of the eligible cost basis.", "占符合条件的成本基础的比例。"],
  concentrationMissing: ["Comparable, positive entry costs are needed.", "需要可比且为正值的入场成本。"],
  exploreRisk: ["Explore exposure", "查看敞口"], largest: ["Largest holdings by cost", "按成本计的最大持仓"],
  yourHoldings: ["Your holdings", "你的持仓"], viewAll: ["View all holdings", "查看全部持仓"],
  desk: ["From the desk", "研究台动态"], deskHint: ["Source coverage and population are shown inside.", "展开查看来源覆盖及适用持仓范围。"],
  events: ["Events affecting your holdings", "与你的持仓相关的事件"],
  search: ["Search symbol, company or notes", "搜索代码、公司或备注"], filter: ["Filter records", "筛选记录"],
  allRecords: ["All records", "全部记录"], needsDetails: ["Needs entry details", "待补充入场信息"],
  previousPage: ["Previous page", "上一页"], nextPage: ["Next page", "下一页"],
  entryCurrencyExample: ["USD / HKD", "USD 或 HKD"],
  open: ["Open", "持有中"], closed: ["Closed", "已关闭"], showing: ["Showing", "显示"], of: ["of", "/"],
  noMatches: ["No matching records", "没有匹配的记录"], noMatchesHint: ["Try another search or clear the filters.", "尝试其他搜索词或清除筛选条件。"],
  clearFilters: ["Clear filters", "清除筛选"], record: ["Record", "记录"], inspect: ["Review record", "查看记录"],
  security: ["Security", "证券"], quantity: ["Shares", "数量"], entry: ["Entry price", "入场价"], last: ["Last price", "最新可用价格"],
  value: ["Market value", "市值"], change: ["Since entry", "入场以来"], actions: ["Actions", "操作"],
  edit: ["Edit details", "编辑信息"], closeRecord: ["Close record", "关闭记录"], reopenRecord: ["Reopen record", "重新打开记录"],
  deleteRecord: ["Delete record", "删除记录"], deleteHint: ["This removes this record and its notes. It does not place an order.", "这将删除此记录及备注，不会发送交易指令。"],
  cancel: ["Cancel", "取消"], confirmDelete: ["Delete this record?", "删除此记录？"],
  savedEntry: ["Recorded entry", "已记录的入场信息"], entryDate: ["Entry date", "入场日期"], notes: ["Your notes", "你的备注"],
  noNotes: ["No notes yet.", "暂无备注。"], sourceQuote: ["Latest available quote", "最新可用报价"], sourceFallback: ["Manifest price", "行情清单价格"],
  quoteUnavailable: ["Price unavailable", "暂无价格"], currencyUnknown: ["Currency not recorded", "未记录币种"],
  research: ["Open company research", "查看公司研究"], chart: ["Open chart", "打开图表"],
  riskIntro: ["See where your holdings overlap.", "了解持仓的集中与重叠。"],
  historyTitle: ["Historical context", "历史背景"], historyHint: ["Today's cost-weighted holdings, viewed through past prices.", "用历史价格观察今天按成本加权的持仓。"],
  historyNotPerformance: ["This is a historical model of today's holdings. It is not your account return.", "这是当前持仓的历史模型，并非账户实际回报。"],
  targetsIntro: ["Compare your holdings with the targets you set.", "将持仓与你设定的目标进行比较。"],
  targetsBasis: ["Targets use the same eligible cost basis as exposure.", "目标与敞口采用相同的符合条件的成本基础。"],
  targetsReadPending: ["Showing saved target values. Current weights await a matching read.", "正在显示已保存的目标，当前权重尚待核对。"],
  loadingAnalysis: ["Loading analysis…", "正在加载分析…"], unavailable: ["Analysis is unavailable. Your holdings remain available.", "分析暂不可用，持仓仍可查看。"],
  emptyTitle: ["Start with a holding.", "从一笔持仓开始。"], emptyHint: ["Add a security you own. You can fill in entry details whenever you're ready.", "添加你持有的证券，入场信息可稍后补充。"],
  signedInBook: ["Your private position records", "你的私人持仓记录"],
  staleTitle: ["The latest holdings check failed.", "最新持仓核对失败。"],
  staleHint: ["Showing the last successful read. Refresh to check again.", "正在显示上次成功读取的持仓，请刷新后再次核对。"],
  discardTitle: ["Discard your changes?", "放弃更改？"], discardHint: ["Your unsaved entry details will be lost.", "尚未保存的入场信息将丢失。"],
  keepEditing: ["Keep editing", "继续编辑"], discard: ["Discard changes", "放弃更改"],
  closeDialog: ["Close details", "关闭详情"], methodology: ["How this is calculated", "计算方法"],
  riskLoading: ["Reading exposure coverage…", "正在读取敞口覆盖…"],
} as const;
export type PortfolioCopyKey = keyof typeof PORTFOLIO_LEX;
export function portfolioCopy(lang: "en" | "zh") {
  return (key: PortfolioCopyKey): string => PORTFOLIO_LEX[key][lang === "zh" ? 1 : 0];
}
