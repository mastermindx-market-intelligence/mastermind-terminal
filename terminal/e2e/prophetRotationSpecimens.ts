import type { RotationGroup, RotationRead } from "../lib/prophetRotationRead";
import { ROTATION_READ_COPY } from "../lib/prophetRotationRead";

/** Synthetic SR-05–08 specimens only; never a market-data fallback. */
function row(id: string, family: "sector" | "theme", name: string, change: number, long: number,
  direction: "improving" | "flat" | "deteriorating", asOf = "2026-11-06"): RotationGroup {
  return { group_id: id, family, name, parent: null, as_of: asOf, status: "ok", unavailable_reason: null,
    n_members: 50, n_counted: 48, pct_above_200: 60, chg_13w: change, chg_26w: long,
    direction, run_weeks: 2, rank_13w: 2, n_ranked: 10 };
}
function missing(id: string, name: string, reason: "too_few_members" | "no_history"): RotationGroup {
  return { group_id: id, family: "theme", name, parent: null, as_of: "2026-11-06", status: "unavailable",
    unavailable_reason: reason, n_members: null, n_counted: null, pct_above_200: null, chg_13w: null,
    chg_26w: null, direction: null, run_weeks: null, rank_13w: null, n_ranked: null };
}
export function rotationSpecimen(): RotationRead {
  return {
    schema: "si.rotation_read/v1", as_of: "2026-11-06", built_at: "2026-11-07T01:00:00Z",
    status: "ok", basis: "current_roster", copy: ROTATION_READ_COPY,
    groups: [
      row("semis", "sector", "Semiconductors", 8, 11, "improving"),
      row("ai", "theme", "AI compute", 5, 9, "improving"),
      row("fabs", "theme", "Foundry and fabs", -6, -3, "deteriorating", "2026-10-30"),
      row("chips", "theme", "Chip equipment", 0, 2, "flat"),
      row("software", "sector", "Software", -9, -14, "deteriorating"),
      row("cloud", "theme", "Cloud platforms", 0, 1, "flat"),
      row("saas", "theme", "Enterprise software", -7, -10, "deteriorating"),
      row("automation", "theme", "Automation", 2, 3, "improving"),
      row("digital", "theme", "Digital services", -1, -2, "deteriorating"),
      row("utilities", "sector", "Utilities", 4, 6, "improving"),
      row("biotech", "sector", "Biotechnology", 0, -2, "flat"),
      missing("gene", "Gene editing", "too_few_members"),
      missing("rare", "Rare disease", "no_history"),
    ],
    companies: {
      INTC: { sector: "semis", themes: ["ai", "fabs", "chips"] },
      CRM: { sector: "software", themes: ["cloud", "saas", "automation", "digital"] },
      DUK: { sector: "utilities", themes: [] },
      CRSP: { sector: "biotech", themes: ["gene", "rare"] },
    },
  };
}
export const ROTATION_BANNED_WORDS = /\b(?:trade|buy|sell|entry|sizing|permission|risk-on|risk-off|warning|rotating in|rotating out|probability|score)\b/i;
