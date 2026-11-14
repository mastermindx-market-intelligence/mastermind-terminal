"use client";

import { useCallback } from "react";
import { useLang } from "./i18n";

/** Discover copy uses the existing language owner, with complete EN/ZH pairs. */
export const DISCOVER_WORKSPACE_LEX = {
  "market_overview": ["Market overview", "市场概览"],
  "buy_signals_uptrend": ["Buy signals + uptrend", "买入信号与上升趋势"],
  "historical_performance": ["Historical performance", "历史表现"],
  "overnight_watch": ["Overnight watch", "夜盘观察"],
  "current_view": [
    "Current view",
    "当前视图"
  ],
  "this_view_changed_on_another_device_local": [
    "This view changed on another device · local edits not saved",
    "其他设备更改了此视图 · 本地更改尚未保存"
  ],
  "view_not_saved_reduce_saved_views_or": [
    "View not saved · reduce saved views or filters",
    "视图未保存 · 请减少视图或筛选内容"
  ],
  "account_connection_changed_edits_not_saved": [
    "Account connection changed · edits not saved",
    "账户连接已变化 · 更改未保存"
  ],
  "saved_views_use_an_unsupported_format": [
    "Saved views use an unsupported format",
    "已保存的视图格式暂不支持"
  ],
  "loading_your_views": [
    "Loading your views…",
    "正在载入视图…"
  ],
  "saved_views_unavailable_changes_not_saved": [
    "Saved views unavailable · changes not saved",
    "账户暂不可用 · 更改未保存"
  ],
  "not_synced_retrying": [
    "Not synced · retrying",
    "尚未同步 · 重试中"
  ],
  "guest_views_this_device": [
    "Guest views · this device",
    "访客视图 · 当前设备"
  ],
  "device_storage_unavailable_changes_kept_for_this": [
    "Device storage unavailable · changes kept for this visit",
    "设备存储不可用 · 更改仅在本次页面有效"
  ],
  "saving": [
    "Saving…",
    "正在保存…"
  ],
  "saved_to_your_account": [
    "Saved to your account",
    "已保存到账户"
  ],
  "changes_autosave_to_your_account": [
    "Changes autosave to your account",
    "更改将自动保存到账户"
  ],
  "overnight": [
    "Overnight",
    "夜盘价格"
  ],
  "overnight_2": [
    "Overnight %",
    "夜盘涨跌%"
  ],
  "above_low": [
    "% above low",
    "距52周低点%"
  ],
  "52w_high": [
    "52W high",
    "52周最高"
  ],
  "52w_low": [
    "52W low",
    "52周最低"
  ],
  "signal_date": [
    "Signal date",
    "信号日期"
  ],
  "hist_win_rate": [
    "Hist. win rate",
    "历史胜率"
  ],
  "hist_profit_factor": [
    "Hist. profit factor",
    "历史利润因子"
  ],
  "hist_cagr": [
    "Hist. CAGR",
    "历史年化收益"
  ],
  "en_us": [
    "en-US",
    "zh-CN"
  ],
  "date_unavailable": [
    "Date unavailable",
    "日期不可用"
  ],
  "live": [
    "Live",
    "实时"
  ],
  "regular_session_close": [
    "Regular-session close",
    "常规时段收盘"
  ],
  "15_minute_delayed": [
    "15-minute delayed",
    "延迟15分钟"
  ],
  "scan_snapshot": [
    "Scan snapshot",
    "筛选快照"
  ],
  "latest_available_quote": [
    "Latest available quote",
    "最新可用行情"
  ],
  "loading_your_discover_workspace": [
    "Loading your Discover workspace…",
    "正在载入你的视图…"
  ],
  "any_signal": [
    "Any signal",
    "所有信号"
  ],
  "buy_signals": [
    "Buy signals",
    "买入类信号"
  ],
  "sell_signals": [
    "Sell signals",
    "卖出信号"
  ],
  "signal_coverage": [
    "Signal coverage",
    "有信号覆盖"
  ],
  "any_regime": [
    "Any regime",
    "所有趋势"
  ],
  "filters": [
    "Filters",
    "筛选"
  ],
  "columns": [
    "Columns",
    "列"
  ],
  "views": [
    "Views",
    "视图"
  ],
  "sorted_by": [
    "Sorted by ",
    "排序："
  ],
  "show_column": [
    "Show column",
    "显示列"
  ],
  "retry": [
    "Retry",
    "重试"
  ],
  "discard_local_edits_use_account_version": [
    "Discard local edits & use account version",
    "放弃本地更改并载入账户版本"
  ],
  "signals_and_data_guide": [
    "Signals and data guide",
    "信号与数据说明"
  ],
  "advanced_filters": [
    "Advanced filters",
    "高级筛选"
  ],
  "refine_your_results": [
    "Refine your results",
    "精细筛选"
  ],
  "universe_sector": [
    "Universe & sector",
    "范围与行业"
  ],
  "price_liquidity": [
    "Price & liquidity",
    "价格与流动性"
  ],
  "quick_filters_device_presets": [
    "Quick filters & device presets",
    "快捷筛选与设备预设"
  ],
  "historical_backtest_exit_rules_differ_from_the": [
    "Historical backtest · exit rules differ from the current signals. These are research metrics, not expected returns.",
    "历史回测使用不同的退出规则，不能代表当前信号的胜率。"
  ],
  "read_methodology": [
    "Read methodology",
    "查看方法"
  ],
  "remove_technical_filters": [
    "Remove technical filters",
    "移除技术筛选"
  ],
  "technical_filters": [
    "Technical filters",
    "技术筛选"
  ],
  "press_space_to_move_a_column_arrow": [
    "Press Space to move a column, arrow keys to change its position, Space to drop, or Escape to cancel.",
    "空格键开始移动，方向键调整列，空格键确认，Escape取消。"
  ],
  "column_order_unchanged": [
    "Column order unchanged.",
    "列顺序未改变。"
  ],
  "move_cancelled_column_order_unchanged": [
    "Move cancelled. Column order unchanged.",
    "已取消移动，列顺序未改变。"
  ],
  "scan_snapshot_2": [
    "Scan snapshot",
    "收盘快照"
  ],
  "session_close": [
    "Session close",
    "收盘"
  ],
  "15_min_delayed": [
    "15-min delayed",
    "延迟15分钟"
  ],
  "quote": [
    "Quote",
    "行情"
  ],
  "re_buy": [
    "Re-buy",
    "快速再入"
  ],
  "re_entry": [
    "Re-entry",
    "重新入场"
  ],
  "date_unavailable_2": [
    "date unavailable",
    "日期不可用"
  ],
  "select_for_explanation": [
    "Select for explanation",
    "点击了解"
  ],
  "historical_reading": [
    "Historical reading",
    "历史记录"
  ],
  "not_covered": [
    "Not covered",
    "未覆盖"
  ],
  "no_current_qualified_overnight_trade": [
    "No current qualified overnight trade",
    "暂无合格夜盘成交"
  ],
  "overnight_trade_versus_the_regular_session_close": [
    "Overnight trade versus the regular-session close",
    "夜盘成交相对常规收盘价"
  ],
  "filters_sort_snapshot": [
    "Filters & sort snapshot",
    "筛选与排序快照"
  ],
  "regular_quote_refresh_unavailable_showing_snapshot": [
    "Regular quote refresh unavailable · showing snapshot",
    "常规行情暂不可用 · 显示快照"
  ],
  "visible_quotes_refresh_automatically_session_aware_prices": [
    "Visible quotes refresh automatically · session-aware prices",
    "可见行行情自动刷新 · 价格按交易时段显示"
  ],
  "overnight_refresh_unavailable": [
    " · Overnight refresh unavailable",
    " · 夜盘刷新暂不可用"
  ],
  "price_details": [
    "Price details",
    "价格详情"
  ],
  "regular_session": [
    "Regular session",
    "常规时段"
  ],
  "state": [
    "State",
    "状态"
  ],
  "observed_at": [
    "Observed at",
    "行情时间"
  ],
  "regular_quote_refresh_is_unavailable_the_last": [
    "Regular quote refresh is unavailable. The last available reading remains visible; its observation time determines the live state.",
    "常规行情刷新暂不可用。这里保留最后可用读数；实时状态以行情时间为准。"
  ],
  "overnight_3": [
    "Overnight",
    "夜盘"
  ],
  "trade_price": [
    "Trade price",
    "成交价"
  ],
  "versus_regular_close": [
    "Versus regular close",
    "相对常规收盘"
  ],
  "source_venue": [
    "Source & venue",
    "来源与场所"
  ],
  "trade_time": [
    "Trade time",
    "成交时间"
  ],
  "valid_until": [
    "Valid until",
    "有效截止"
  ],
  "no_current_qualified_boats_overnight_trade_is": [
    "No current qualified BOATS overnight trade is available. Uncovered, missing or expired observations display a dash; regular prices never fill this field.",
    "暂无当前有效的BOATS夜盘成交。未覆盖、无合格成交或数据过期时显示—，不会用常规价格填充。"
  ],
  "overnight_refresh_is_currently_unavailable": [
    "Overnight refresh is currently unavailable.",
    "夜盘刷新暂不可用。"
  ],
  "quotes_refresh_automatically_filtering_and_sorting_use": [
    "Quotes refresh automatically. Filtering and sorting use the universe snapshot so rows stay in place as prices update.",
    "行情自动刷新。筛选和排序继续使用全市场快照，避免行随每次行情更新移动。"
  ],
  "signals_regimes_historical_data": [
    "Signals, regimes & historical data",
    "信号、趋势与历史数据"
  ],
  "signal_details": [
    "Signal details",
    "信号说明"
  ],
  "last_recorded_event": [
    "Last recorded event",
    "最近记录"
  ],
  "regime_snapshot": [
    "Regime snapshot",
    "趋势快照"
  ],
  "find_agreement_between_signal_and_regime": [
    "Find agreement between signal and regime",
    "先看信号与趋势是否一致"
  ],
  "the_buy_signals_uptrend_view_combines_the": [
    "The Buy signals + uptrend view combines the last recorded buy-side event with a trend reading above the 200-day average and bullish weekly momentum. It sorts by traded value. This is a research filter, not a verified new entry; the event and regime can have different dates.",
    "“买入信号与上升趋势”视图同时筛选最近记录的买入类事件，以及价格在200日均线上方、周线动能看涨的趋势状态。按流动性排序。它不是新入场确认；信号日期和趋势快照可能不同。"
  ],
  "what_each_signal_means": [
    "What each signal means",
    "每个标签的含义"
  ],
  "a_confirmed_bullish_momentum_event_in_the": [
    "A confirmed bullish momentum event in the signal engine.",
    "引擎确认的看涨动能事件。"
  ],
  "a_fast_bullish_reversal_within_three_3": [
    "A fast bullish reversal within three 3-session bars of a recent exit.",
    "在近期退出后的三个3日线K线内出现快速看涨反转。"
  ],
  "trend_repair_after_an_exit_or_a": [
    "Trend repair after an exit, or a previously blocked entry whose blocker clears. The summary does not distinguish these cases. Previously labeled Take back.",
    "退出后的趋势修复，或先前阻止入场的条件消失；当前摘要不区分这两种原因。原标签为Take back。"
  ],
  "a_trailing_structure_stop_event_in_the": [
    "A trailing structure-stop event in the current signal engine.",
    "当前信号引擎的跟踪结构止损事件。"
  ],
  "not_covered_means_the_scan_has_no": [
    "Not covered means the scan has no signal reading. Recorded events are not a current entry qualification. Use the signal date and chart context when researching a name.",
    "未覆盖不是卖出信号。历史标签不保证当前可交易，也不是个人投资建议。"
  ],
  "what_the_historical_metrics_measure": [
    "What the historical metrics measure",
    "历史指标衡量什么"
  ],
  "win_rate_is_the_share_of_simulated": [
    "Win rate is the share of simulated trades with a positive net return. Profit factor divides summed positive net percentage returns by the absolute sum of nonpositive net percentage returns; no-loss samples have no finite value. CAGR annualizes the simulated compounded equity over the tested calendar period.",
    "胜率是回测中净收益为正的交易占比。利润因子是正净百分比收益总和除以负净百分比收益绝对值总和；无亏损时不显示数值。CAGR是按回测期间长度计算的模拟复合年增长率。"
  ],
  "the_historical_test_uses_3_session_bars": [
    "The historical test uses 3-session bars, next-bar close fills, 3 basis points of cost plus 1 basis point of slippage on each side, and an end-of-sample close. Its exits differ from the current structure-stop signals. These figures do not validate the current signal stream, and they are not used for default ranking.",
    "当前历史回测使用3日线、下一根收盘成交，每次买卖按3个基点成本加1个基点滑点计算，并可能在样本末尾强制平仓。回测退出条件与当前信号的结构止损不同，因此这些指标不是当前信号的验证结果，不用于默认排序。"
  ],
  "price_sessions_sector_provenance": [
    "Price sessions & sector provenance",
    "价格与行业来源"
  ],
  "last_and_chg_use_the_same_regular": [
    "Last and CHG use the same regular-session quote service as Portfolio. Overnight is a separate, qualifying BOATS trade and its change against the regular close; expired or unavailable observations show a dash. Filters and sort use the dated universe snapshot so price updates do not move rows under your pointer.",
    "Last和CHG采用与Portfolio相同的常规时段行情来源。夜盘是独立的BOATS成交价格，相对常规收盘价计算涨跌；过期或未覆盖时显示—。筛选和排序使用注明日期的全市场快照，行情更新不会突然改变行的位置。"
  ],
  "sector_labels_retain_their_native_classification_their": [
    "Sector labels retain their native classification. Their details identify the source and date, distinguishing an unavailable observation date from an aged record.",
    "行业标签保留其原始分类。悬停可查看来源与日期；日期不可用与已过期会分别说明。"
  ],
  "search_options": [
    "Search options…",
    "搜索选项…"
  ],
  "no_matching_options": [
    "No matching options",
    "没有匹配选项"
  ],
  "close": [
    "Close",
    "关闭"
  ],
  "customize_columns": [
    "Customize columns",
    "自定义列"
  ],
  "your_column_order": [
    "Your column order",
    "显示顺序"
  ],
  "drag_a_table_header_or_use_these": [
    "Drag a table header, or use these arrows to arrange.",
    "拖动表头，或使用箭头调整顺序。"
  ],
  "pinned": [
    "Pinned",
    "固定"
  ],
  "add_or_hide_columns": [
    "Add or hide columns",
    "添加或隐藏"
  ],
  "find_a_column": [
    "Find a column…",
    "搜索列…"
  ],
  "find_a_column_2": [
    "Find a column",
    "搜索列"
  ],
  "no_matching_columns": [
    "No matching columns",
    "没有匹配的列"
  ],
  "reset_column_layout": [
    "Reset column layout",
    "重置列布局"
  ],
  "done": [
    "Done",
    "完成"
  ],
  "your_views": [
    "Your views",
    "视图"
  ],
  "could_not_open_this_view_resolve_the": [
    "Could not open this view. Resolve the account sync issue first; your current edits are preserved.",
    "无法打开此视图。请先解决账户同步问题；当前更改已保留。"
  ],
  "start_with_a_view": [
    "Start with a view",
    "快速开始"
  ],
  "saved_views": [
    "Saved views",
    "已保存的视图"
  ],
  "save_your_filters_and_layout_as_your": [
    "Save your filters and layout as your first view.",
    "将当前筛选与布局保存为你的第一个视图。"
  ],
  "rename": [
    "Rename",
    "重命名"
  ],
  "delete_this_view": [
    "Delete this view?",
    "删除此视图？"
  ],
  "delete": [
    "Delete",
    "删除"
  ],
  "cancel": [
    "Cancel",
    "取消"
  ],
  "rename_view": [
    "Rename view",
    "重命名视图"
  ],
  "save_current_as_a_view": [
    "Save current as a view",
    "另存为视图"
  ],
  "e_g_technology_watch": [
    "e.g. Technology watch",
    "例如：科技股观察"
  ],
  "save_view": [
    "Save view",
    "保存"
  ],
  "cancel_rename": [
    "Cancel rename",
    "取消重命名"
  ],
  "view_not_saved_check_its_name_and": [
    "View not saved. Check its name and connection, then try again.",
    "视图未保存。请检查名称与连接后重试。"
  ],
  "classification_date_unavailable": [
    "Classification date unavailable",
    "分类日期不可用"
  ]
} as const;

export function useDiscoverT() {
  const { lang } = useLang();
  return useCallback((key: keyof typeof DISCOVER_WORKSPACE_LEX): string => DISCOVER_WORKSPACE_LEX[key][lang === "zh" ? 1 : 0], [lang]);
}
