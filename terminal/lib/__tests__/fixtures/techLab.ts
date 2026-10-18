/** Synthetic Lab inputs for ranking/interaction tests; never served in production. */
export function techLabFixture(ticker = "EL") {
  const state = (dir: number, kind: string, active: number | null, fires: string[] = ["2026-10-14"]) => ({ dir, kind, state: active, fires });
  const profile = (display_en: string, display_zh: string, direction: number, wr: number | null, base: number | null, n: number, kind = "state") => ({
    display_en, display_zh, direction, kind, family: "trend_regime",
    wr_21d: wr, base_wr: base, edge_wr: wr !== null && base !== null ? Number((wr - base).toFixed(6)) : null,
    n_fires: n, n_months: 24, mfe_mae_med: 1.25, wr_pre2010: null, wr_post2010: wr,
  });
  return { tech: {
    asof: "2026-10-16T18:42:15Z",
    events: { ticker, generated_utc: "2026-10-16T18:42:15Z", window_start: "2023-10-16", signals: {
      weak: state(1, "state", 1, ["2026-10-09"]),
      strongest: state(-1, "state", 1, ["2026-09-21", "2026-10-12"]),
      tied: state(1, "event", 1, ["2026-10-15"]),
      insufficient: state(1, "event", 1),
      inactive: state(1, "event", 0),
      valuation_pctile: state(1, "state", 1, []),
      insider_power_state: state(0, "state", 1, []),
      neutral_range: state(0, "state", 1),
      unknown: state(1, "event", null),
    } },
    profiles: {
      weak: profile("Higher win rate, weaker than baseline", "胜率较高但低于基准", 1, 0.68, 0.72, 60000),
      strongest: profile("Volume trend pointing down", "成交量趋势向下", -1, 0.48, 0.38, 180),
      tied: profile("Momentum turning up", "动量转升", 1, 0.75, 0.65, 120, "event"),
      insufficient: profile("New condition without history", "暂无历史的新条件", 1, null, null, 0, "event"),
      inactive: profile("Inactive strong historical profile", "历史表现较强但未触发", 1, 0.91, 0.6, 800, "event"),
      valuation_pctile: profile("Valuation percentile", "估值百分位", 1, null, null, 0),
      insider_power_state: profile("Insider activity", "内部人活动", 0, null, null, 0),
      neutral_range: profile("Range context", "区间背景", 0, 0.55, 0.6, 220),
      unknown: profile("Unreported current state", "当前状态未提供", 1, 0.6, 0.5, 300, "event"),
    },
  } };
}
