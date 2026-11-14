import type { TroughRow } from "../lib/prophetTroughRead";
/** Synthetic test-only publications. Never shipped as customer data. */
export type TroughSpecimenState = "A" | "B" | "C" | "D" | "E";
export const TROUGH_BANNED_WORDS = /\b(?:buy|sell|entry|trade|sizing|permission|risk-on|risk-off|warning|probability|score|confirmed|tailwind|support)\b/i;
export function troughSpecimen(state: TroughSpecimenState = "A") {
  const row: TroughRow = {
    as_of: "2026-11-13",
    timeframes: [
      { tf: "1D", bar_end: "2026-11-13", washed_out: true, turned_up: false, available: true },
      { tf: "3D", bar_end: "2026-11-12", washed_out: true, turned_up: true, available: true },
      { tf: "1W", bar_end: "2026-11-13", washed_out: true, turned_up: false, available: true },
      { tf: "2W", bar_end: "2026-11-06", washed_out: false, turned_up: null, available: true },
    ],
    kind: { label: "leans_cyclical", position: .7 },
    own_history: { tf: "1W", current_depth_pct: -24, past: [
      { date: "2022-06-17", depth_pct: -12 }, { date: "2023-10-27", depth_pct: -22 }, { date: "2024-08-09", depth_pct: -28 },
    ], comparison: "about_usual" },
    group: { group_id: "semiconductors", name: "Semiconductors", state: "BASING", fields: null },
    provenance: "shared_with_group",
  };
  if (state === "B") row.timeframes.forEach(f => { f.turned_up = false; });
  if (state === "C") { row.timeframes.forEach(f => { f.washed_out = false; f.turned_up = null; }); row.own_history!.current_depth_pct = null; }
  if (state === "E") row.timeframes[3] = { tf: "2W", bar_end: null, washed_out: null, turned_up: null, available: false };
  return { schema: "prophet.trough_read/v1", as_of: "2026-11-13", built_at: "2026-11-14T08:00:00Z", status: state === "D" ? "unavailable" : "ok", tickers: { ADP: row } };
}
