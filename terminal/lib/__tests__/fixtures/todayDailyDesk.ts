/** Original synthetic contracts for the Today composition journey. These are not
 * market observations, account holdings, captured reports or production proof. */
const pair = (en: string, zh: string) => ({ en, zh });
const chip = (id: string, en: string, zh: string, value: string, valueZh: string, note: string | null = null) => ({
  id, section: id, label: pair(en, zh), tone: "neutral", null: false, value: pair(value, valueZh), cause: null,
  note: note ? pair(note, "此来源的限定说明仍可查看。") : null, meaning: null,
  as_of: "2026-10-16", as_of_display: pair("16 October 2026", "2026年10月16日"),
});

export function todayMarketFixture() {
  return {
    schema: "mastermind.macro_command_read.v1", state: "partial",
    source: { served_root_qualified: true, manifest_generated_at: "2026-10-20T10:00:00Z", manifest_sha256: "d".repeat(64), composed_at: "2026-10-21T12:00:00Z" },
    read: { as_of: "2026-10-16", as_of_display: pair("16 October 2026", "2026年10月16日"),
      as_of_meaning: pair("Oldest dated reading", "最早读数"), omitted: true,
      clauses: [
        { topic: pair("Liquidity", "流动性"), predicate: pair("is mixed", "不均衡"), punct: pair(".", "。"), section: "money" },
        { topic: pair("Growth", "增长"), predicate: pair("is picking up", "正在回升"), punct: pair(".", "。"), section: "growth" },
      ],
    },
    strip: [chip("money", "Money", "货币", "Tight and thin", "偏紧且稀薄", "Source qualification stays accessible"),
      chip("growth", "Growth", "增长", "Picking up", "正在回升"), chip("credit", "Borrowing", "借贷", "Tight and tightening", "偏紧且持续收紧"),
      chip("inflation", "Inflation", "通胀", "Rising, but narrow", "上升但范围有限")],
    coverage: { available: 3, total: 4 },
    sections: ["money", "growth", "credit", "inflation"].map(id => ({ id, label: pair(id, id), href: `/macro_monetary.html#${id}` })),
    workspaces: [],
  };
}

export function todayDigestFixture() {
  return { schema: "portfolio_state_digest.v1", asof: "2026-10-30",
    names: { DEMOA: { stage: 2, earnings: "2026-11-05", sector: "Technology" } },
    sectors: { Technology: { class: "mixed", conviction_en: "medium", conviction_zh: "中" } },
    regime_en: "Mixed", regime_zh: "分化" };
}

export function todayPersonalBriefFixture() {
  return {
    schema: "portfolio_brief.v2", asof: "2026-10-30", generated_at: "2026-10-30T22:00:00Z", stale: true,
    weighting: { mode: "equal", label_en: "Equal weight", label_zh: "等权" },
    book: { n: 1, covered: 1, uncovered: [] }, headline: pair("A synthetic personal reading.", "示例个人读数。"),
    population: { mode: "positions", label_en: "Your portfolio positions", label_zh: "你的持仓", n: 1,
      disclosure_en: "This read describes the 1 name you hold.", disclosure_zh: "此判读描述你持有的1只个股。" },
    sections: [{ key: "regime", title_en: "Risk context", title_zh: "风险背景",
      lines: [pair("The desk's daily read: Mixed.", "工作台的每日判读：分化。"), pair("An independent personal source reading.", "独立的个人来源读数。")] }],
    data: { events: { earnings_10d: [{ ticker: "DEMOA", date: "2026-11-05", days_to: 6 }] } },
    state_digest: todayDigestFixture(),
  };
}

export function todayChangesFixture() {
  return { schema: "portfolio_changes.v1", asof: "2026-10-30", population: "positions", first_visit: true,
    changes: [], state_digest: todayDigestFixture(),
    cursor: { scope: "device", note_en: "This browser keeps its own saved reading.", note_zh: "此浏览器保留自己的已保存读数。" } };
}

export const TODAY_SAVED_SELECTION = { docId: "demo-memory-report", sourcePdfSha256: "a".repeat(64),
  extractedTextSha256: "b".repeat(64), extractorVersion: "research_vault.ingest.extract_pdf_text.v1", segmenterVersion: "page-byte-v1" };

export function todayCatalogFixture() {
  return { items: [{ id: TODAY_SAVED_SELECTION.docId, title: "Memory & storage: what still needs proof", institution: "Synthetic research desk",
    published_at: "2026-10-29", summary_points: ["An original synthetic report summary for the browser journey."] }],
    preview: false, stale: false, generated_at: "2026-10-30T20:00:00Z" };
}

export function todayWatchlistFixture() {
  return { lists: [{ id: "demo-owned-list", name: "Research list", position: 0,
    symbols: [{ symbol: "DEMOA", section: "", position: 0 }] }], sharedWithMe: [] };
}
