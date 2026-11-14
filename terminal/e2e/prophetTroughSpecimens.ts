import type { TroughRow } from "../lib/prophetTroughRead";
/** Synthetic test-only REV 1.1 publications. Never customer data. */
export type TroughSpecimenState = "A" | "B" | "C" | "D" | "E";
export const TROUGH_BANNED_WORDS = /\b(?:buy|sell|entry|trade|sizing|permission|risk-on|risk-off|warning|probability|score|confirmed|tailwind|support)\b/i;
export function troughSpecimen(state: TroughSpecimenState = "A") {
  const components = () => ({ K_gt_D: true, K_rising: true, D_rising: false, hist_rising: true });
  const row: TroughRow = {
    as_of: "2026-11-13",
    timeframes: [
      { tf: "1D", bar_end: "2026-11-13", washed_out: true, turned_up: null, available: true, d: 18, components: components() },
      { tf: "3D", bar_end: "2026-11-12", washed_out: true, turned_up: true, available: true, d: 16, components: components() },
      { tf: "1W", bar_end: "2026-11-13", washed_out: true, turned_up: null, available: true, d: 19, components: components() },
      { tf: "2W", bar_end: "2026-11-06", washed_out: false, turned_up: null, available: true, d: 42, components: components() },
    ],
    kind: null,
    own_history: { tf: "3D", depth_atrc: 6, own_history_pct: .5, n_prior: 3, past: [
      { date: "2022-06-17", depth_atrc: 3 }, { date: "2023-10-27", depth_atrc: 5.5 }, { date: "2024-08-09", depth_atrc: 7 },
    ] },
    group: { group_id: "semiconductors", name: "Semiconductors", state: "BASING", fields: null },
    provenance: null,
  };
  if (state === "B") row.timeframes[1].turned_up = false;
  if (state === "C") { row.timeframes.forEach(f => { f.washed_out = false; f.turned_up = null; }); }
  if (state === "E") row.timeframes[3] = { tf: "2W", bar_end: null, washed_out: null, turned_up: null, available: false, d: null, components: { K_gt_D: null, K_rising: null, D_rising: null, hist_rising: null } };
  return { schema: "prophet.trough_read/v1", as_of: "2026-11-13", built_at: "2026-11-14T08:00:00Z", known_ts: "2026-11-13T21:00:00Z", engine_ref: "e999086d", status: state === "D" ? "unavailable" : "ok", tickers: { ADP: row } };
}
