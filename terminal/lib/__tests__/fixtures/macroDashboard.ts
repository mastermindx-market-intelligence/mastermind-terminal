export const macroFixture = () => ({
  schema: "mastermind.macro_dashboard.v1", market: "US", display_only: true,
  published_at: "2026-11-13T21:30:00Z", source_as_of: "2026-11-13", publication_sha256: "a".repeat(64),
  market_state: { schema: "market_state.v1", market: "us", asof: "2026-11-13", score: 0, raw_score: 61, capped: true, score_source: "radar_ceiling", verdict: "RISK_OFF", label_en: "Risk-off", label_zh: "避险", headline_en: "Published historical stance.", headline_zh: "已发布的历史立场。", components: [{ key: "risk", label_en: "Risk appetite", label_zh: "风险偏好", score: 0, weight: .2, tone: "bad", read_en: "Source context", read_zh: "来源背景", metrics: [] }], radar: { state: "watch", top_score: 70, scares: [{ label_en: "Breadth", reading_state: "UNAVAILABLE", score: 99, display_score: null, partial_composition: true }] } },
  current_risk: null,
  history: [{ asof: "2026-11-11", score: 61 }, { asof: "2026-11-12", score: null }, { asof: "2026-11-13", score: 61 }],
  sentiment: { dial: 0, label_en: "Extreme fear", label_zh: "极度恐慌", as_of: "2026-11-13" },
  events: [{ label: "Payrolls", label_zh: "非农就业", type: "NFP", date: "2026-12-04", time_et: "08:30" }],
  alerts: [{ plain_en: "Source alert", plain_zh: "来源警报", what_en: "Inspect published evidence." }],
  market_tiles: [{ label: { en: "S&P 500", zh: "标普500" }, level: "6,000.00", chg: "0.00", pct: "0.00%" }],
  health: [{ name: "source-a", status: "ok", rows: 10, last_date: "2026-11-13" }],
  brief: { state_asof: "2026-10-01", summary: "Older source brief.", zh: { summary: "较早的来源简报。" }, tldr: ["Source evidence."] },
  news: [], news_state: {},
});

