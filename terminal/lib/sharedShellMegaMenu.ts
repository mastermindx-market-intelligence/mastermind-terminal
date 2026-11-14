import { SHARED_SHELL_LEGACY_ORIGIN } from "./sharedShellOrigins";

type MenuText = { en: string; zh: string };
export type MegaMenuItem = {
  href: string;
  title: MenuText;
  description?: MenuText;
  native: boolean;
};
export type MegaMenuGroup = { title: MenuText; items: readonly MegaMenuItem[] };
export type MegaMenuSection = {
  id: string;
  title: MenuText;
  groups: readonly MegaMenuGroup[];
  explore?: readonly MegaMenuItem[];
  moreGroups?: readonly MegaMenuGroup[];
};

function menuItem(native: boolean, href: string, en: string, zh: string, detailEn?: string, detailZh?: string): MegaMenuItem {
  return {
    native, href, title: { en, zh },
    ...(detailEn && detailZh ? { description: { en: detailEn, zh: detailZh } } : {}),
  };
}
type Copy = [en: string, zh: string, detailEn?: string, detailZh?: string];
function native(path: string, ...copy: Copy): MegaMenuItem { return menuItem(true, path, ...copy); }
function macro(path: string, ...copy: Copy): MegaMenuItem {
  return menuItem(false, SHARED_SHELL_LEGACY_ORIGIN + path, ...copy);
}
function companion(href: string, ...copy: Copy): MegaMenuItem { return menuItem(false, href, ...copy); }
function group(en: string, zh: string, items: readonly MegaMenuItem[]): MegaMenuGroup {
  return { title: { en, zh }, items };
}

// Navigation presents the existing desks. Macro's _navlinks.html.j2 and nav_market.js
// own the origin-side entry points; unported tools open their normal top-level URL.
// Regional source paths and fragment selections must survive the handoff unchanged.
export const megaMenuSections: readonly MegaMenuSection[] = [
  {
    id: "markets",
    title: { en: "Markets & macro", zh: "市场与宏观" },
    groups: [
      group("Market overview", "市场总览", [
        native("/intelligence", "Market overview", "市场总览", "Read the current market regime and its drivers", "查看当前市场环境及其驱动因素"),
        macro("/macro.html", "U.S. Macro Dashboard", "美国宏观仪表盘", "Track growth, inflation and the U.S. economy", "跟踪美国经济增长与通胀"),
      ]),
      group("Regime & liquidity", "周期与流动性", [
        native("/intelligence?macroWorkspace=liquidity_regime", "Liquidity regime", "流动性环境", "Inspect the published reading and the inputs behind it", "查看最新发布的评估及其指标依据"),
        macro("/macro_context.html", "Macro Weather", "宏观气象", "Read the current growth, inflation and liquidity picture", "查看增长、通胀与流动性概况"),
      ]),
      group("Before the open", "开盘前", [
        macro("/am_edition.html", "Morning Edition", "早间版", "Read the tape, session clock and prior-close brief", "查看盘面、交易时段与前收盘简报"),
        macro("/news.html", "News Feed", "新闻流", "Read catalysts, headlines and changes in sentiment", "阅读催化事件、头条与情绪变化"),
      ]),
    ],
    explore: [
      native("/market-reference", "Market Reference", "市场参考"),
      macro("/policy_watch.html", "Policy Watch", "政策观察"),
    ],
    moreGroups: [
      group("Economic activity", "经济活动", [
        macro("/macro_growth_real_economy.html", "Growth & the real economy", "增长与实体经济"),
        macro("/macro_inflation_system.html", "Inflation", "通胀"),
        macro("/macro_labor_markets.html", "Labor markets", "劳动力市场"),
        macro("/macro_housing_real_estate.html", "Housing & real estate", "住房与房地产"),
        macro("/macro_consumer_payments.html", "Consumer payments", "消费支付"),
        macro("/macro_business_activity.html", "Business activity", "商业活动"),
        macro("/macro_trade_flows.html", "Trade flows", "贸易流动"),
      ]),
      group("Credit, rates & policy", "信贷、利率与政策", [
        macro("/macro_financial_conditions.html", "Financial conditions", "金融条件"),
        macro("/macro_rates_curves.html", "Rates & yield curves", "利率与收益率曲线"),
        macro("/macro_monetary_policy.html", "Monetary policy", "货币政策"),
        macro("/macro_liquidity_central_banks.html", "Central bank liquidity", "央行流动性"),
        macro("/macro_national_debt_liabilities.html", "National debt & liabilities", "国家债务与负债"),
        macro("/macro_capital_structure.html", "Economy-wide capital structure", "宏观资本结构"),
        macro("/government_revenue.html", "Government Revenue", "政府收入"),
      ]),
      group("Cross-asset markets", "跨资产市场", [
        macro("/forex.html", "Foreign exchange", "外汇"),
        macro("/bonds.html", "Bonds", "债券"),
        macro("/commodities.html", "Commodity Dashboard", "商品仪表盘"),
        macro("/commodity_strategies.html", "Commodity strategies", "商品策略"),
        macro("/spr.html", "Strategic reserves", "战略储备"),
        macro("/crypto.html", "Crypto intelligence", "加密资产情报"),
        macro("/vector.html", "Bitcoin Vector", "比特币向量"),
        macro("/vector.html#strategy-track-record", "Crypto strategy history", "加密策略历史"),
      ]),
    ],
  },
  {
    id: "stocks",
    title: { en: "Stocks & sectors", zh: "股票与行业" },
    groups: [
      group("Find companies", "发现公司", [
        native("/discover?tab=screener", "Stock Screener", "股票筛选器", "Filter a stock universe and compare candidates", "筛选股票范围并比较候选标的"),
        native("/discover?tab=heatmap", "Market Heatmap", "市场热力图", "See market moves by sector and company", "按板块和公司查看市场涨跌"),
      ]),
      group("Sectors & rotation", "行业与轮动", [
        native("/sectors", "Sector Intelligence", "行业情报", "Compare sectors, themes and their constituents", "比较行业、主题及其成分股"),
        native("/sectors?sectorWorkspace=cycles", "Sector Cycles", "行业周期", "Inspect price cycles and retained sector history", "查看价格周期与行业历史"),
      ]),
      group("Signals & catalysts", "信号与催化事件", [
        macro("/us_stocks.html", "U.S. Stock Dashboard", "美国股票仪表盘", "Review the full Prophet stock board and candidate setups", "查看完整的 Prophet 股票看板及候选形态"),
        native("/discover?tab=catalysts", "Catalysts", "催化事件", "Explore events and the companies they affect", "探索催化事件及相关公司"),
      ]),
    ],
    explore: [
      native("/analysis", "Company analysis", "公司分析"),
      macro("/sector_central.html#confluence", "Subsector Confluence", "子行业汇聚"),
    ],
    moreGroups: [
      group("Leadership & relative strength", "领涨股与相对强度", [
        native("/discover?tab=leaders", "Market leaders", "市场领涨股"),
        native("/discover?tab=radar", "Flow radar", "资金流雷达"),
        native("/discover?tab=rs-pivot", "Relative strength pivots", "相对强度枢轴"),
        macro("/stage_analysis.html", "Stage Analysis", "阶段分析"),
        macro("/winner_health.html", "Winner Health", "持仓健康度"),
        macro("/leader_radar.html", "Leader Radar", "龙头雷达"),
      ]),
      group("Sector evidence", "行业证据", [
        macro("/sector_cycles.html", "U.S. sector cycle board", "美国行业周期全览"),
        macro("/sector_central.html", "Macro sector dashboard", "宏观行业仪表盘"),
        macro("/sector_heatmap.html", "Sector heatmap", "行业热力图"),
      ]),
      group("Strategies & setups", "策略与形态", [
        macro("/strategies.html", "Strategies", "策略"),
        macro("/confluence_screener.html", "Signal Board", "信号看板"),
        native("/dislocations", "Market dislocations", "市场错位"),
        native("/prophet", "Model plans & options", "模型计划与期权"),
      ]),
      group("Industry research", "行业研究", [
        macro("/biocatalyst.html", "BioCatalyst Intelligence", "生物医药催化剂情报"),
        macro("/finance_intelligence.html", "Financial sector intelligence", "金融业情报"),
        macro("/special_situations.html", "Special Situations", "特殊事件"),
      ]),
    ],
  },
  {
    id: "options",
    title: { en: "Options & flows", zh: "期权与资金流" },
    groups: [
      group("Flow & activity", "资金流与成交", [
        native("/options", "Options workspace", "期权工作台", "Open the options desk and choose a market view", "打开期权工作台并选择市场视图"),
        native("/options?tab=tape", "Options tape", "期权成交带", "Inspect reported trades and unusual activity", "查看已报告的成交及异常活动"),
      ]),
      group("Exposure & volatility", "敞口与波动率", [
        native("/options?tab=gex", "Gamma exposure", "Gamma 敞口", "Inspect the distribution of dealer exposure", "查看做市商敞口分布"),
        native("/options?tab=volatility", "Volatility", "波动率", "Compare volatility across the options market", "比较期权市场的波动率"),
      ]),
      group("Market structure", "市场结构", [
        macro("/intraday_flow.html", "Intraday Flow Tracker", "盘中资金流追踪", "Follow volume and the tape, about 15 minutes delayed", "跟踪成交量与盘面，约延迟 15 分钟"),
        macro("/darkpool.html", "Dark Pool Desk", "暗池成交", "Inspect off-exchange volume and short ratios", "查看场外成交量与卖空比率"),
      ]),
    ],
    explore: [
      native("/options/equity-replay", "Equity replay", "股票回放"),
      native("/options/futures", "Futures", "期货"),
    ],
    moreGroups: [
      group("Screen the tape", "成交筛选", [
        native("/options?tab=vol", "Options screener", "期权筛选器"),
        native("/options?tab=0dte", "Zero-day options", "零日期权"),
        native("/options?tab=tide", "Market tide", "市场资金流向"),
        native("/options?tab=largest", "Largest trades", "大额成交"),
        native("/options?tab=tickers", "Flow by ticker", "个股资金流"),
      ]),
      group("Positioning & pricing", "持仓与定价", [
        native("/options?tab=surface", "Options surface", "期权曲面"),
        native("/options?tab=positioning", "Positioning", "持仓分布"),
        native("/options?tab=levels", "Exposure levels", "敞口价位"),
        macro("/market_structure.html", "Market Structure", "市场结构"),
      ]),
      group("Macro options desk", "宏观期权台", [
        macro("/options.html", "Macro options daily brief", "宏观期权每日简报"),
      ]),
    ],
  },
  {
    id: "research",
    title: { en: "Research", zh: "研究" },
    groups: [
      group("Core research", "核心研究", [
        macro("/intelligence_hub.html", "Intelligence Hub", "情报中心", "Read today’s market intelligence across desks", "查看各研究台的当日市场情报"),
        macro("/reports.html", "Research Reports", "研究报告", "Read in-depth research and market calls", "阅读深度研究与市场判断"),
      ]),
      group("Find the edge", "发现机会", [
        macro("/state_of_themes.html", "Theme Tracker", "主题追踪", "See which themes are gaining or losing strength", "查看哪些主题走强或走弱"),
        macro("/foresight.html", "Foresight", "前瞻研究", "Explore emerging themes and their drivers", "探索新兴主题及其驱动因素"),
      ]),
      group("Capital & regimes", "资金与周期", [
        macro("/etfs.html", "Fund Flows", "基金流向", "See where institutional capital is moving", "查看机构资金的流向"),
        macro("/cycle.html", "Cycle Intelligence", "周期情报", "Track where the economy is in its cycle", "跟踪经济所处的周期阶段"),
      ]),
    ],
    explore: [
      native("/research", "Research library", "研究资料库"),
      native("/market-reference", "Market Reference", "市场参考"),
    ],
    moreGroups: [
      group("Research desk", "研究工作台", [
        macro("/research_vault.html", "Research Vault", "研报库"),
        macro("/research_screener.html", "Research screener", "研究筛选"),
        macro("/stocks/earnings/index.html", "Earnings Wire", "财报情报线"),
        macro("/fundamental_forensics.html", "Filing Forensics", "财报排雷"),
        macro("/neural_web.html", "Neural Web", "智脑"),
        macro("/market_memory.html", "Market Memory", "市场记忆"),
      ]),
      group("Themes & signals", "主题与信号", [
        macro("/theme_tree.html", "Theme Map", "主题地图"),
        macro("/gmi.html", "GMI Explorer", "GMI 主题浏览"),
        macro("/radar.html", "Divergence Radar", "背离雷达"),
        macro("/stock_seasonality.html", "Stock Seasonality", "个股季节性"),
        macro("/confluence_screener.html", "Signal Board", "信号看板"),
        macro("/expectation_surface.html", "Expectation Surface", "预期曲面"),
      ]),
      group("Capital & policy", "资金与政策", [
        macro("/smart_money.html", "Smart Money", "聪明钱"),
        macro("/macro_context.html", "Macro Weather", "宏观气象"),
        macro("/ontology.html", "WTI Live Path", "WTI 实时路径"),
        macro("/policy_watch.html", "Policy Watch", "政策观察"),
        macro("/government_revenue.html", "Government Revenue", "政府收入"),
        macro("/alt_data.html", "Alternative Data", "另类数据"),
        macro("/capital_structure.html", "Capital Structure", "资本结构"),
      ]),
      group("Specialist desks", "专题研究台", [
        macro("/special_situations.html", "Special Situations", "特殊事件"),
        macro("/biocatalyst.html", "BioCatalyst Intelligence", "生物医药催化剂情报"),
        macro("/markets.html", "Global Market Cycles", "全球市场周期"),
        macro("/country_cycles.html", "Country Cycles", "国家周期"),
        macro("/am_edition.html", "Morning Edition", "早间版"),
      ]),
    ],
  },
  {
    id: "portfolio",
    title: { en: "Portfolio & alerts", zh: "组合与提醒" },
    groups: [
      group("My investments", "我的投资", [
        native("/portfolio", "My portfolio", "我的投资组合", "Review your holdings and portfolio exposure", "查看持仓与组合敞口"),
        native("/monitor", "Watchlists", "自选列表", "Follow changes in the names you track", "查看自选标的的变化"),
      ]),
      group("Alerts & signals", "提醒与信号", [
        native("/alerts", "My alerts", "我的提醒", "Manage alerts for the instruments you follow", "管理关注标的的提醒"),
        macro("/alerts.html", "Market Alert Center", "市场警报中心", "Read ranked market-moving alerts", "阅读按重要性排列的市场异动警报"),
      ]),
      group("Portfolio research", "组合研究", [
        macro("/watchlist.html", "Portfolio signals", "组合信号", "Read the latest Macro signals for your holdings", "查看持仓的最新宏观信号"),
        companion("https://bot.mastermind-x.com", "Mastermind Bot", "Mastermind 交易机器人", "The AI’s own paper account — every trade explained", "AI 自己的模拟账户，每笔交易都附理由"),
      ]),
    ],
    explore: [
      native("/research", "Research library", "研究资料库"),
      macro("/tools/index.html", "Financial calculators", "金融计算器"),
    ],
    moreGroups: [
      group("Reference & methods", "参考与方法", [
        native("/learn", "Learning center", "学习中心"),
        native("/scripts", "Scripts", "脚本"),
        macro("/methodology.html", "Research methodology", "研究方法"),
      ]),
    ],
  },
  {
    id: "global",
    title: { en: "Global markets", zh: "全球市场" },
    groups: [
      group("World markets", "全球市场", [
        macro("/intl.html", "World Dashboard", "全球仪表盘", "Compare major markets and regional conditions", "比较主要市场与地区环境"),
        macro("/markets.html", "Global Market Cycles", "全球市场周期", "Compare national equity markets on one cycle clock", "同图比较各国股市的周期位置"),
      ]),
      group("Regional dashboards", "地区仪表盘", [
        macro("/china.html", "China", "中国", "A-share breadth, capital flows and policy", "A 股市场广度、资金流与政策"),
        macro("/hk.html", "Hong Kong", "香港", "Hang Seng conditions and southbound flows", "恒指市场环境与南向资金"),
        macro("/canada.html", "Canada", "加拿大", "TSX leadership, commodities and the Bank of Canada", "多伦多市场领涨板块、商品与加拿大央行"),
        macro("/japan.html", "Japan", "日本", "Rates, wages and the yen", "利率、工资与日元"),
      ]),
    ],
    explore: [
      macro("/country_cycles.html", "Country Cycles", "国家周期"),
      macro("/sanctions_map.html", "Sanctions Map", "制裁地图"),
    ],
    moreGroups: [
      group("China · stocks & sectors", "中国 · 股票与行业", [
        macro("/china_stocks.html", "A-share stock dashboard", "A 股仪表盘"),
        macro("/china_heatmap.html", "Market Heatmap", "市场热力图"),
        macro("/sector_central_china.html", "China Sector Intelligence", "中国行业情报"),
        macro("/sector_central_china.html#confluence", "Subsector Confluence", "子行业汇聚"),
        macro("/sector_cycles_china.html", "China Sector Cycles", "中国行业周期"),
        macro("/baskets_china_ths.html", "Tonghuashun theme baskets", "同花顺主题篮子"),
        macro("/narrative_radar.html", "Narrative Basket Radar", "主题篮子雷达"),
      ]),
      group("China · flows & research", "中国 · 资金与研究", [
        macro("/china_intel.html", "China Intelligence Hub", "中国情报中心"),
        macro("/china_policy_watch.html", "PBoC & Policy Watch", "央行与政策观察"),
        macro("/china_news.html", "China News Feed", "中国新闻"),
        macro("/flow_velocity.html", "Capital flow velocity", "资金流速"),
        macro("/china_mechanics.html", "Market Mechanics", "市场结构"),
        macro("/china_radar.html", "Divergence Radar", "背离雷达"),
        macro("/china_strategies.html", "China strategies", "中国市场策略"),
        macro("/china_altdata.html", "Alternative Data", "另类数据"),
        macro("/china_special_situations.html", "Special Situations", "特殊事件"),
      ]),
      group("Hong Kong", "香港", [
        macro("/hk_stocks.html", "Hong Kong stock dashboard", "港股仪表盘"),
        macro("/hk_heatmap.html", "Market Heatmap", "市场热力图"),
        macro("/baskets_hk.html", "Hong Kong theme baskets", "港股主题篮子"),
        macro("/allocation_hk.html", "Hong Kong narrative rotation", "港股主题轮动"),
      ]),
      group("Canada", "加拿大", [
        macro("/canada_stocks.html", "Canadian stock dashboard", "加拿大股票仪表盘"),
        macro("/canada_heatmap.html", "Market Heatmap", "市场热力图"),
        macro("/baskets_canada.html", "Canadian theme baskets", "加拿大主题篮子"),
        macro("/allocation_canada.html", "Canadian narrative rotation", "加拿大主题轮动"),
      ]),
      group("Europe & Asia", "欧洲与亚洲", [
        macro("/south_korea.html", "South Korea Macro", "韩国宏观"),
        macro("/euro_area.html", "Euro Area Macro", "欧元区宏观"),
        macro("/united_kingdom.html", "United Kingdom Macro", "英国宏观"),
        macro("/india.html", "India Macro", "印度宏观"),
      ]),
      group("Cross-market comparison", "跨市场比较", [
        macro("/intl_stocks.html", "International stock dashboard", "国际股票仪表盘"),
        macro("/baskets_intl.html", "International theme baskets", "国际主题篮子"),
      ]),
    ],
  },
];
