/** Browser-only historical design fixture. NEVER imported by production code.
 * V3 archive SHA256 a2de290080da23a8c758012a0378d39795e2d5d4f07784d1f000e1e8cf8c5393;
 * Macro source ref 25fb8fa805d611727078f65626f2c3b0388070b3, source date 2026-09-23.
 * Retained source fields; transport envelopes are synthetic. The archive only
 * gives a top-five heatmap summary, so heatmap is UNAVAILABLE, not fabricated.
 */
import type { Route } from "@playwright/test";
const stocks: Array<[string, number, number, number, string | null, number, boolean, string]> = [
  ["MPWR", 1355.47, 3.9, -9, "T2", 1, true, "long-bias"],
  ["MCHP", 75.53, 2.8, -10.2, "T2", 1, true, "long-bias"],
  ["MU", 1071.88, 14.9, 1.9, "T1", 2, true, "long-bias"],
  ["NXPI", 235.44, 5.2, -7.7, "T1", 2, true, "long-bias"],
  ["TXN", 272.62, 4.8, -8.1, "T1", 1, true, "long-bias"],
  ["ADI", 385.23, 3.4, -9.5, "T1", 2, true, "long-bias"],
  ["ON", 74.1, 2.2, -10.7, "T1", 1, true, "long-bias"],
  ["NVDA", 225.51, 6, -7, "T3", 0, true, "long-bias"],
  ["INTC", 122.6, 40.1, 27.2, null, 4, false, "long-bias"],
  ["SWKS", 91.45, 39.2, 26.3, null, 12, false, "mixed"],
  ["AMD", 614.61, 28.3, 15.3, null, 1, false, "long-bias"],
  ["QCOM", 197.24, 23.5, 10.6, null, 5, false, "long-bias"],
  ["MRVL", 260.9, 8.5, -4.4, null, 1, false, "long-bias"],
  ["AVGO", 354.99, -.3, -13.3, null, 12, false, "mixed"],
];
export const archivedMembers = stocks.map(([ticker, price, ret_20d, vs_basket, stock_tier, stock_ticks, stock_buyable, stock_state]) => ({
  ticker, price, ret_20d, vs_basket, stock_tier, stock_ticks, stock_buyable, stock_state,
}));
const data: Record<string, unknown> = {
  sector: { as_of: "2026-09-23", sectors: [{ id: "xlk", name: "Technology", ticker: "XLK",
    momentum: { rs_21d_rank: 1, rs_rank: 3, above_200d: true, lead: "leading" },
    heat: { breadth_pct: 58, adv: 46, dec: 33, heat_1M: 7.01 },
    cycle: { phaseLabel: "Rolling over" }, conviction: { label_en: "Cautious" }, rotation: { state: "TURN SIGNALED" } }] },
  confluence: { as_of: "2026-09-23", groups: [{ key: "semiconductors", label: "Semiconductors", n_members: 14, n_priced: 14,
    entry: { tier: "T1" }, regime: { state: "EXTENDED" }, members: archivedMembers }] },
  themes: { as_of: "2026-09-23", themes: [{ theme_id: "memory_storage", name_en: "Memory, HBM & Storage", name_zh: "存储与HBM", stage: "WATCH", entry_ready: false }] },
};
const paths: Record<string, string> = { sector: "/sectordata/sector_central.json", confluence: "/marketdata/subsector_confluence.json", themes: "/neuralwebdata/theme_state.json", heatmap: "/marketdata/sp500_heatmap.json" };
export async function sectorFixture(route: Route, mode: "ready" | "access" = "ready") {
  const source = new URL(route.request().url()).searchParams.get("source") || "";
  const status = mode === "access" ? "access" : source === "heatmap" ? "unavailable" : "ready";
  const http = status === "access" ? 401 : status === "unavailable" ? 404 : 200;
  return route.fulfill({ status: http, json: { data: status === "ready" ? data[source] : null,
    receipt: { source, path: paths[source], status, asOf: status === "ready" ? "2026-09-23" : null,
      observedAt: status === "ready" ? "2026-09-26T10:00:00Z" : null, stale: false, contentHash: null } } });
}
