/** BOATS display copy uses the shared language state and the existing feature-copy pattern. */
import type { Lang } from "@/lib/i18n";

const pick = (lang: Lang, en: string, zh: string): string =>
  lang === "zh" ? zh : en;

export function boatsLatestTradeLabel(lang: Lang): string {
  return pick(lang, "Latest qualifying BOATS trade · single venue", "BOATS 最新合格成交 · 单一场所");
}


/** Chart-only copy shares the feature module without changing unrelated settings copy. */
export function boatsChartCopy(lang: Lang) {
  return {
    label: pick(lang, "24-hour US", "美股24小时"),
    coverageShort: pick(lang, "BOATS overnight · Observed live trades only; history and volume unavailable", "BOATS夜盘 · 仅当前观察的实时成交；历史及成交量暂不可用"),
    coverage: pick(lang, "Include BOATS overnight trades and available historical bars. BOATS volume covers this venue only; live trade observations have no volume. Gaps stay empty. Available on intraday intervals up to 12 hours.", "显示BOATS夜盘成交及可用的历史K线。历史成交量仅涵盖该场所，实时观察成交无成交量数据。缺口保持空白。仅适用于不超过12小时的日内周期。"),
  };
}

export type BoatsChartHistory = {
  symbol: string;
  timeframe: string;
  bars: number;
  pending?: boolean;
  error?: boolean;
  liveHistory?: { status: "applied" | "empty" | "stale" | "missing" | "unreadable" | "malformed";
    sessionDate: string | null; observedAtUtc: string | null };
};

/** Only the current accepted response can describe this pane's overnight history. */
export function boatsChartHistoryBars(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const v = value as Record<string, unknown>;
  return v.schema === "terminal.tiingo_boats_history_evidence.v1" && v.status === "available"
    && v.source === "tiingo-boats-rest" && v.venue === "BOATS" && v.complete === false
    && v.volume_basis === "vendor_reported_shares" && Number.isInteger(v.returned_bars)
    && (v.returned_bars as number) > 0 && (v.returned_bars as number) <= 20000
    ? v.returned_bars as number : 0;
}

export function boatsChartCoverage(lang: Lang, symbol: string, timeframe: string, history: BoatsChartHistory | null): string {
  if (history?.symbol === symbol && history.timeframe === timeframe && history.bars > 0) {
    return pick(lang, "BOATS overnight · Captured history available; venue-only volume. Gaps remain.",
      "BOATS夜盘 · 已载入历史K线；成交量仅限该场所，缺口保留。");
  }
  return boatsChartCopy(lang).coverageShort;
}

/** Keep server-validated BOATS metadata separate from unqualified quote and chart data. */
export function boatsChartHistoryFromResponse(
  symbol: string, timeframe: string, value: unknown,
  state: { pending?: boolean; error?: boolean } = {},
): BoatsChartHistory {
  const result: BoatsChartHistory = { symbol, timeframe, bars: boatsChartHistoryBars(value),
    pending: state.pending === true, error: state.error === true };
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const v = value as Record<string, unknown>;
  if (v.schema !== "terminal.tiingo_boats_history_evidence.v1" || v.source !== "tiingo-boats-rest"
    || v.venue !== "BOATS" || v.complete !== false || v.volume_basis !== "vendor_reported_shares"
    || v.requested_symbol !== symbol) return result;
  const live = v.live_history;
  if (!live || typeof live !== "object" || Array.isArray(live)) return result;
  const d = live as Record<string, unknown>;
  if (typeof d.status !== "string" || !["applied","empty","stale","missing","unreadable","malformed"].includes(d.status)) return result;
  const observed = typeof d.observed_at_utc === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(d.observed_at_utc)
    && Number.isFinite(Date.parse(d.observed_at_utc)) ? d.observed_at_utc : null;
  const session = typeof d.session_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.session_date)
    && Number.isFinite(Date.parse(d.session_date + "T00:00:00Z"))
    && new Date(d.session_date + "T00:00:00Z").toISOString().slice(0,10) === d.session_date ? d.session_date : null;
  result.liveHistory = { status: d.status as NonNullable<BoatsChartHistory["liveHistory"]>["status"],
    sessionDate: session, observedAtUtc: observed };
  return result;
}

export type BoatsChartCoverageView = {
  state: "fresh" | "stale" | "loading" | "captured" | "empty" | "unavailable";
  headline: string;
  detail: string;
};

/** A publisher ACK, archived bar count, or completed HTTP request never alone means live. */
export function boatsChartCoverageView(
  lang: Lang, symbol: string, timeframe: string, history: BoatsChartHistory | null,
  nowMs = Date.now(),
): BoatsChartCoverageView {
  const detail = pick(lang, "BOATS only · Vendor bar volume · Gaps kept",
    "仅BOATS场所 · 供应商K线成交量 · 缺口保留");
  if (!history || history.symbol !== symbol || history.timeframe !== timeframe)
    return { state: "empty", headline: pick(lang, "BOATS overnight · Awaiting captured bars", "BOATS夜盘 · 等待已采集K线"), detail };
  if (history.pending)
    return { state: "loading", headline: pick(lang, "Assembling 24H chart · Awaiting complete daytime history",
      "正在组合24小时图表 · 等待完整日间历史数据"), detail };
  if (history.error)
    return { state: "unavailable", headline: pick(lang, "24H history temporarily unavailable · Existing data retained",
      "24小时历史数据暂不可用 · 已保留现有数据"), detail };
  const live = history.liveHistory;
  const stamp = live?.observedAtUtc ? Date.parse(live.observedAtUtc) : NaN;
  if (live?.sessionDate && Number.isFinite(stamp) && Number.isFinite(nowMs)
    && stamp <= nowMs + 5000 && stamp >= 0 && (live.status === "applied" || live.status === "stale")) {
    const time = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US",
      { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: lang !== "zh" }).format(new Date(stamp));
    const hour = Number(new Intl.DateTimeFormat("en-US",
      { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(new Date(nowMs)));
    if (live.status === "applied" && history.bars > 0 && nowMs - stamp <= 120000 && (hour >= 20 || hour < 4))
      return { state: "fresh", headline: pick(lang, "Current-night BOATS history · " + time + " ET",
        "当夜夜盘K线 · 美东时间" + time), detail };
    return { state: "stale", headline: pick(lang, "Captured BOATS history · Last snapshot " + time + " ET · Not live",
      "已采集BOATS历史K线 · 最近快照美东时间" + time + " · 非实时"), detail };
  }
  if (live?.status === "empty")
    return { state: "empty", headline: pick(lang, "Current-night BOATS snapshot contains no bars",
      "当夜BOATS快照暂无K线"), detail };
  if (history.bars > 0)
    return { state: "captured", headline: pick(lang, "BOATS overnight · Captured history available",
      "BOATS夜盘 · 已载入历史K线"), detail };
  if (live?.status === "unreadable" || live?.status === "malformed")
    return { state: "unavailable", headline: pick(lang, "BOATS snapshot unavailable · No verified overnight history",
      "BOATS快照不可用 · 暂无已验证夜盘历史数据"), detail };
  return { state: "empty", headline: pick(lang, "BOATS overnight · Awaiting captured bars",
    "BOATS夜盘 · 等待已采集K线"), detail };
}
