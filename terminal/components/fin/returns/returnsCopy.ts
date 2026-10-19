export const RETURNS_COPY = {
  title: ["Returns intelligence", "回报分析"], subtitle: ["Follow direction, pace and participation.", "跟踪方向、速度与市场参与度。"],
  fixture: ["Illustrative test data", "示例测试数据"],
  characterUnavailable: ["Path character unavailable", "暂无走势特征"],
  comparisonUnavailable: ["A comparison needs matching dates and price bases.", "比较需要一致的日期与价格调整依据。"],
  benchmarkUnavailable: ["Benchmark comparison unavailable", "基准比较暂不可用"],
  currentVintage: ["The adjusted history is a vendor total-return proxy at its current vintage. Historical availability and identity generations are not attested. Options price levels retain their own quoted-price basis.", "调整后的历史为供应商当前版本的总回报代理，历史可用性与身份数据版本尚未经确认。期权价位保留其自身报价依据。"],
  chooseBenchmark: ["Choose a benchmark to compare relative performance.", "选择基准以比较相对表现。"],
  flowError: ["Flow evidence could not be loaded.", "无法读取资金流依据。"],
  flowMismatch: ["The flow snapshot does not match this symbol and session.", "资金流快照与该代码或交易日不符。"],
  extendedRange: ["Extended history", "扩展历史"],
  stock: ["Stock", "个股"], basket: ["Sector / theme basket", "板块 / 主题组合"], benchmark: ["Benchmark", "基准"], none: ["None", "无"],
  performance: ["Performance", "累计回报"], relative: ["Relative", "相对表现"], drawdown: ["Drawdown", "回撤"],
  path: ["The return path", "回报轨迹"], sessions: ["sessions", "个交易日"], return: ["Return", "回报"], reportedReturn: ["Reported-price change", "报价变动"],
  asOf: ["Through", "截至"], historical: ["Historical snapshot", "历史快照"], adjusted: ["Vendor total-return proxy", "供应商总回报代理"], reported: ["Reported prices", "已报告价格"], unverified: ["Adjustment unverified", "调整依据未核实"], refused: ["Price basis needs repair", "价格调整依据待修复"],
  loading: ["Loading return history…", "正在载入回报历史…"], noHistory: ["No history is published for this symbol.", "该代码尚未发布历史数据。"], loadError: ["History could not be loaded.", "无法读取历史数据。"], invalidHistory: ["This history does not meet the return-data contract.", "该历史数据不符合回报数据规范。"], unsupported: ["This view currently covers US equities and ETFs.", "此视图目前覆盖美国股票与 ETF。"], retry: ["Retry", "重试"],
  rising: ["Rising", "上升"], falling: ["Falling", "下降"], sideways: ["Sideways", "横盘"], mixed: ["Mixed path", "走势分化"], unqualified: ["State not qualified", "状态尚未核实"],
  rising_faster: ["Ascent speeding up", "升势加速"], rising_slower: ["Ascent slowing", "升势放缓"], falling_faster: ["Decline speeding up", "跌势加速"], falling_slower: ["Decline slowing", "跌势放缓"], turned_up: ["Pace turned upward", "速度转向上行"], turned_down: ["Pace turned downward", "速度转向下行"], steady: ["Pace broadly steady", "速度大致稳定"],
  pace: ["Fitted daily pace", "拟合日速度"], paceDelta: ["Change in daily pace", "日速度变化"], perSession: ["per session", "每交易日"], previous: ["Previous window", "上一窗口"],
  volatility: ["Realized volatility", "已实现波动率"], annualized: ["Annualized · daily closes", "年化 · 日收盘价"], maxDrawdown: ["Maximum drawdown", "最大回撤"], peakToTrough: ["Peak to trough in this window", "窗口内峰值至谷值"],
  efficiency: ["Path efficiency", "走势效率"], efficiencyDetail: ["Net move / total absolute movement", "净变动 / 绝对变动总和"], concentration: ["Largest session", "最大单日贡献"], concentrationDetail: ["Share of all absolute movement", "占绝对变动总和的比例"],
  smooth: ["Directional path", "方向性较强"], choppy: ["Choppy path", "走势震荡"], offsetting: ["Strongly offsetting moves", "涨跌相互抵消"], flat: ["No observed movement", "无已观察变动"], oneSession: ["One session dominates", "由单一交易日主导"],
  reading: ["Reading the move", "理解走势"], descriptive: ["Descriptive · not a forecast", "描述历史 · 非预测"], basisNeeded: ["Price changes are visible. A qualified state needs the published adjustment basis.", "可查看报价变动；核实走势状态需要已发布的调整依据。"],
  incomplete: ["Some sessions are missing. Path statistics are withheld.", "部分交易日缺失，暂不显示轨迹统计。"],
  calendar: ["Session calendar", "交易日历"], selectedSession: ["Selected session", "所选交易日"], previousMonth: ["Previous month", "上个月"], nextMonth: ["Next month", "下个月"],
  closeToClose: ["Close to close", "收盘至收盘"], openingGap: ["Opening gap", "开盘跳空"], openToClose: ["Open to close", "开盘至收盘"], open: ["Open", "开盘"], high: ["High", "最高"], low: ["Low", "最低"], close: ["Close", "收盘"], closed: ["Market closed", "休市"], missing: ["No observation", "无观测数据"],
  previousClose: ["Previous close", "前收盘"], sessionHelp: ["Daily bars describe the regular-session path. Separate overnight and extended-session histories belong to the session study.", "日线描述常规交易时段。隔夜与盘前盘后历史由分时研究提供。"],
  calendarHint: ["Choose a day to inspect it on the path.", "选择日期可在轨迹中查看。"], chartTable: ["View chart data", "查看图表数据"], chartKeyboard: ["Return chart. Use left and right arrows to select a session; Home and End select the first and last.", "回报图。左右方向键选择交易日，Home 与 End 选择首日和末日。"],
  basketPrompt: ["Choose a source group or build a thematic basket.", "选择来源分组，或构建主题组合。"], sourceGroup: ["Source group", "来源分组"], customBasket: ["Custom theme basket", "自定义主题组合"], chooseGroup: ["Choose a sector or subsector", "选择板块或子板块"], symbols: ["Symbols, separated by commas", "股票代码，以逗号分隔"], analyzeBasket: ["Analyze basket", "分析组合"],
  currentMembers: ["Current members · reconstructed history", "当前成员 · 重建历史"], equalWeight: ["Equal weight · rebalanced daily", "等权重 · 每日再平衡"], members: ["Members", "成员"], breadth: ["Advancing members", "上涨成员"], medianMember: ["Median member return", "成员回报中位数"], membershipDate: ["Membership date", "成员日期"], commonHistory: ["Common history", "共同历史区间"],
  groupUnavailable: ["Source groups could not be loaded. A custom basket is still available.", "无法载入来源分组，仍可使用自定义组合。"], basketInvalid: ["Enter 2–256 unique US stock or ETF symbols.", "请输入 2–256 个不重复的美国股票或 ETF 代码。"], basketIncomplete: ["A complete basket cannot be calculated for these members.", "无法为这些成员计算完整组合。"], basketAccess: ["Sign in to analyze a basket.", "登录后可分析组合。"], basketLoading: ["Checking every constituent…", "正在检查所有成员…"], vsBasket: ["vs basket", "相对组合"], pp: ["pp", "百分点"],
  options: ["Options context", "期权背景"], optionsDesk: ["Open options", "打开期权"], evidence: ["Evidence", "依据"], netGex: ["Net GEX estimate", "净 GEX 估算"], flip: ["Gamma flip", "Gamma 翻转位"], callWall: ["Call concentration", "看涨期权集中位"], putWall: ["Put concentration", "看跌期权集中位"],
  gexPositive: ["Positive estimated gamma", "估算 Gamma 为正"], gexNegative: ["Negative estimated gamma", "估算 Gamma 为负"], gexNeutral: ["Net estimate is zero", "净估算值为零"], gexNote: ["Positioning can amplify or dampen a move. It does not establish its direction.", "持仓结构可能放大或抑制波动，但不决定方向。"],
  optionsLoading: ["Loading this session's evidence…", "正在载入该交易日的依据…"], optionsAbsent: ["No positioning snapshot is published for this session.", "该交易日尚未发布持仓快照。"], optionsAccess: ["Options access is required for this evidence.", "查看此依据需要期权访问权限。"], optionsError: ["Options evidence could not be loaded.", "无法读取期权依据。"], optionsMismatch: ["The returned evidence does not match this symbol and session.", "返回依据与该代码或交易日不符。"], basketOptions: ["Inspect a constituent for its options evidence.", "选择成员可查看其期权依据。"], flow: ["Observed flow", "已观察资金流"],
  outlook: ["Forward outlook", "前瞻分析"], noForecast: ["No qualified probability yet", "暂无已核实概率"], outlookNote: ["A forward likelihood appears only after the model, data cutoff and out-of-sample calibration pass their gates.", "模型、数据截止时间与样本外校准通过检验后，才显示前瞻概率。"],
  monitor: ["What to monitor", "关注哪些变化"], monitorNote: ["Compare the 5-session pace with the 21-session path. Then check whether relative performance and group participation move with it.", "对比 5 日速度与 21 日轨迹，再观察相对表现及群体参与度是否同步变化。"],
  modelDetails: ["Model & validation", "模型与验证"], up: ["Up", "上涨"], neutral: ["Flat", "平稳"], down: ["Down", "下跌"],
  grossPremium: ["Gross option premium", "期权权利金总额"], observedPrints: ["reported events", "个已报告事件"], flowNote: ["Premium volume does not identify opening intent or a future direction.", "权利金成交量不代表开仓意图或未来方向。"], flowHistoryMissing: ["A matching historical flow snapshot is not available here.", "此处暂无对应的历史资金流快照。"], snapshotStale: ["Snapshot · refresh not confirmed", "快照 · 更新未确认"],
  forecastError: ["Forecast evidence could not be checked.", "无法核查预测依据。"], forecastLoading: ["Checking forecast qualification…", "正在核查预测资格…"], forecastAccess: ["Sign in to check forecast evidence.", "登录后可核查预测依据。"], archivedForecast: ["Archived forecast", "历史预测"], nextSessions: ["Forward sessions", "前瞻交易日"], range80: ["10th–90th percentile range", "第 10–90 百分位区间"],
  methodology: ["Method & data", "方法与数据"], methodText: ["Returns compound across actual trading sessions. Pace is a log-price trend; pace change compares equal adjacent windows. State thresholds describe past movement and do not estimate future odds. Relative performance is a wealth ratio, not percentage-point excess.", "回报按实际交易日复合计算。速度来自对数价格趋势，速度变化比较相邻等长窗口。状态阈值描述历史变动，不估算未来概率。相对表现是财富比率，并非百分点差。"],
  stateThreshold: ["Descriptive materiality band", "描述性重要变动阈值"],
} satisfies Record<string, readonly [string, string]>;
export type ReturnsKey = keyof typeof RETURNS_COPY;
export const returnsT = (zh: boolean) => (key: ReturnsKey): string => RETURNS_COPY[key][zh ? 1 : 0];
export function pct(value: number | null | undefined, signed = true, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const n = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return `${signed && n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}
export const price = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const tone = (n: number | null | undefined) => n == null || n === 0 ? "neutral" : n > 0 ? "up" : "down";
export const dateLabel = (day: string, zh: boolean, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) => new Date(day + "T12:00:00Z").toLocaleDateString(zh ? "zh-CN" : "en-US", { ...options, timeZone: "UTC" });
