import { useCallback, useMemo } from "react";
import { useLang, type Lang } from "./i18n";
/** Feature-local bilingual copy, selected by the ONE existing language provider. */
export function futuresTextFor(lang: Lang) {
  const pick = (en: string, zh: string) => lang === "zh" ? zh : en;
  return {
    partialCoverage: pick("Execution coverage is incomplete. Totals and cumulative delta describe only the captured trades, not the entire market window.", "成交覆盖不完整。总量与累积净量仅描述已捕获成交，不代表整个市场时段。"),
    navTitle: pick("Futures", "期货"),
    title: pick("Futures depth & footprint", "期货深度与足迹"),
    subtitle: pick("Displayed liquidity, executed volume and options gamma on one timeline.", "在同一时间轴查看挂单流动性、成交量与期权伽马。"),
    back: pick("Options workspace", "期权工作区"),
    chart: pick("Price chart", "价格图表"),
    instrument: pick("Instrument", "品种"),
    interval: pick("Interval", "时间周期"),
    rows: pick("Price rows", "价格分组"),
    mapping: pick("Mapping", "价格映射"),
    ratio: pick("Price ratio", "价格比率"),
    basis: pick("Price offset", "价差"),
    expiry: pick("Expiry lens", "到期筛选"),
    all: pick("All expiries", "全部到期日"),
    zero: pick("Source-session 0DTE", "来源交易日内到期"),
    later: pick("Excluding source-session 0DTE", "不含来源交易日内到期"),
    replay: pick("Published replay frames", "已发布回放帧"),
    latest: pick("Latest published frame", "最新已发布帧"),
    refresh: pick("Refresh source", "刷新来源"),
    minute: pick("minute", "分钟"),
    minutes: pick("minutes", "分钟"),
    ticks: pick("ticks", "跳动"),
    depth: pick("Depth", "深度"),
    footprint: pick("Footprint", "足迹"),
    chartView: pick("Chart view", "图表视图"),
    gamma: pick("Show options gamma", "显示期权伽马"),
    cvd: pick("Show cumulative delta", "显示累积净量"),
    zoom: pick("Price zoom", "价格缩放"),
    loading: pick("Checking the published source…", "正在检查已发布来源…"),
    volume: pick("Observed contracts", "观测合约数"),
    delta: pick("Known-side delta", "已知方向净量"),
    unknown: pick("Unknown-side contracts", "方向未知合约数"),
    realtime: pick("Real-time source", "实时来源"),
    delayed: pick("Delayed source", "延迟来源"),
    historical: pick("Historical source", "历史来源"),
    source_unavailable: pick("The futures source is not available. No sample data is being substituted.", "期货来源暂不可用，不会用样本数据代替。"),
    source_restricted: pick("The source is not cleared for subscriber display.", "该来源尚未获准向订阅者展示。"),
    source_invalid: pick("The published data did not pass its source checks. The chart is withheld.", "已发布数据未通过来源检查，图表暂不显示。"),
    stale_source: pick("The source is out of date. Refresh before treating it as current.", "来源已过期，请刷新后再作为当前行情参考。"),
    no_replay_frame: pick("No published frame covers that replay selection.", "没有已发布帧覆盖所选回放时刻。"),
    access_required: pick("Your options access could not be confirmed. Previously loaded market data has been cleared.", "无法确认您的期权访问权限，已清除先前加载的市场数据。"),
    invalid_request: pick("That futures view is not supported. Choose a listed instrument and interval.", "不支持该期货视图，请选择已列出的品种与周期。"),
    keyLevels: pick("Key levels \u00b7 all expiries", "\u5173\u952e\u4ef7\u4f4d \u00b7 \u5168\u90e8\u5230\u671f\u65e5"),
    keyLevelNotice: pick("These landmarks retain the source's all-expiry scope, even when the gamma bubbles use a narrower expiry lens. They are positioning estimates, not support or resistance guarantees.", "\u5373\u4f7f\u4f3d\u9a6c\u5706\u70b9\u4f7f\u7528\u66f4\u7a84\u7684\u5230\u671f\u7b5b\u9009\uff0c\u8fd9\u4e9b\u4ef7\u4f4d\u4ecd\u4fdd\u7559\u6765\u6e90\u7684\u5168\u90e8\u5230\u671f\u65e5\u8303\u56f4\u3002\u5b83\u4eec\u662f\u6301\u4ed3\u4f30\u7b97\uff0c\u4e0d\u662f\u652f\u6491\u6216\u963b\u529b\u4fdd\u8bc1\u3002"),
    call_wall: pick("Call wall", "\u770b\u6da8\u5899"),
    put_wall: pick("Put wall", "\u770b\u8dcc\u5899"),
    gamma_flip: pick("Gamma flip", "\u4f3d\u9a6c\u7ffb\u8f6c"),
    source: pick("Source details", "来源详情"),
    through: pick("Data through", "数据截至"),
    gammaMissing: pick("Options gamma is unavailable for this frame; observed futures activity remains visible.", "此帧的期权伽马不可用，已观测的期货活动仍可查看。"),
    cashClosed: pick("Cash index is closed. Gamma conversion is withheld rather than using an unchanged cash close as a live quote.", "现金指数已休市，不会将未变化的收盘价作为实时报价进行伽马映射。"),
    gammaHeading: pick("Options gamma ($M per 1% index move)", "期权伽马（指数变动 1% 的百万美元敞口）"),
    strike: pick("Index strike", "指数行权价"),
    level: pick("Futures level", "期货价位"),
    notice: pick("Depth covers displayed orders, not implied liquidity. Delta uses known trade sides. Options gamma is an estimate, not an executed order or a trade recommendation.", "深度仅涵盖展示的挂单，不含隐含流动性。净量使用已知成交方向。期权伽马为估算，不代表已执行订单或交易建议。"),
    expiryNotice: pick("Expiry labels follow the source session, not a guarantee of intraday tradability.", "到期标签以来源交易日为准，不保证合约在日内仍可交易。"),
    replayNotice: pick("Replay uses published snapshots; it never fills missing history with newer data.", "回放使用已发布快照，不会用更新的数据填补缺失历史。"),
    esPair: pick("ES / SPX", "ES / SPX"),
    nqPair: pick("NQ / NDX", "NQ / NDX"),
  };
}
export type FuturesCopyKey = keyof ReturnType<typeof futuresTextFor>;
export function useFuturesText() {
  const { lang } = useLang();
  const copy = useMemo(() => futuresTextFor(lang), [lang]);
  return useCallback((key: FuturesCopyKey): string => copy[key], [copy]);
}
export const publicFuturesReason = (value: unknown): FuturesCopyKey => typeof value === "string" &&
  ["source_unavailable", "source_restricted", "source_invalid", "stale_source", "no_replay_frame", "access_required", "invalid_request"].includes(value)
  ? value as FuturesCopyKey : "source_unavailable";
