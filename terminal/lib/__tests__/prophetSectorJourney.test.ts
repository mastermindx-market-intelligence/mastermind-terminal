/**
 * Lane B pure helpers — the leadership ranking (SectorGroupPicker) and the
 * compare selection (SectorMemberPopulation). These decide what renders and
 * in what order; they must be honest with the wire's nulls (a null measure
 * never sorts as zero) and closed to anything the wire would not admit
 * (invalid symbols, duplicates, over-cap entries).
 *
 * The suite lives in lib/__tests__ because vitest's include list is a closed
 * set (vitest.config.ts); the helpers themselves stay in their lane files.
 */
import { describe, expect, it } from "vitest";
import type { CoverageCounts, SectorGroupSummary } from "@/lib/prophetSectorMembers";
import type { ProphetUrlState } from "@/lib/prophetUrlState";
import { rankLeadershipGroups } from "@/components/prophet/sector/SectorGroupPicker";
import {
  PROPHET_COMPARE_CAP, readProphetSelection, toggleProphetSelection,
} from "@/components/prophet/sector/SectorMemberPopulation";

const counts: CoverageCounts = {
  configured: 10, served: 8, accountedUnserved: 2, unaccounted: 0,
  openPlan: 1, resolvedPlan: 1, earlyObservation: 1, none: 5, unavailable: 0,
};

function group(id: string, name: string, relativePp: number | null, groupReturnPct: number | null): SectorGroupSummary {
  return {
    id, kind: "sector", name, nameZh: null, benchmark: null, counts,
    context: {
      windowSessions: 20, groupReturnPct, marketReturnPct: 1.0, relativePp,
      breadth: null, stateLabel: null,
      reasons: {},
    },
  };
}

describe("rankLeadershipGroups", () => {
  it("orders by relativePp descending, nulls last", () => {
    const ranked = rankLeadershipGroups([
      group("a", "A", null, 5), group("b", "B", -1.2, -2), group("c", "C", 4.4, 7.6), group("d", "D", 0.5, 1),
    ]);
    expect(ranked.map(g => g.id)).toEqual(["c", "d", "b", "a"]);
  });

  it("breaks ties on group return, then name — never on wire order", () => {
    const ranked = rankLeadershipGroups([
      group("late", "Late", 2.0, 1.0), group("early", "Early", 2.0, 3.0), group("mid", "Mid", 2.0, 2.0),
    ]);
    expect(ranked.map(g => g.id)).toEqual(["early", "mid", "late"]);
  });

  it("sorts all-null reads by name (deterministic, no invented ranking)", () => {
    const ranked = rankLeadershipGroups([
      group("z", "Zeta", null, null), group("a", "Alpha", null, null),
    ]);
    expect(ranked.map(g => g.id)).toEqual(["a", "z"]);
  });

  it("does not mutate the wire's own order", () => {
    const input = [group("a", "A", 1, 1), group("b", "B", 9, 9)];
    rankLeadershipGroups(input);
    expect(input.map(g => g.id)).toEqual(["a", "b"]);
  });
});

describe("the compare selection", () => {
  it("caps at three and never silently replaces", () => {
    let sel: string[] = [];
    for (const symbol of ["CARR", "ADP", "ALLE", "HWM"]) sel = toggleProphetSelection(sel, symbol);
    expect(sel).toEqual(["CARR", "ADP", "ALLE"]);
    expect(PROPHET_COMPARE_CAP).toBe(3);
  });

  it("toggles off and validates symbols against the wire grammar", () => {
    let sel = toggleProphetSelection([], "CARR");
    sel = toggleProphetSelection(sel, "ADP");
    sel = toggleProphetSelection(sel, "CARR");
    expect(sel).toEqual(["ADP"]);
    expect(toggleProphetSelection(sel, "not a symbol!")).toBe(sel);
  });

  it("reads tolerantly: drops invalid, duplicate and over-cap entries", () => {
    const state = { sel: ["CARR", "adp", "CARR", "ADP", "ALLE", "HWM"] } as unknown as ProphetUrlState;
    expect(readProphetSelection(state)).toEqual(["CARR", "ADP", "ALLE"]);
    expect(readProphetSelection({} as ProphetUrlState)).toEqual([]);
  });
});
