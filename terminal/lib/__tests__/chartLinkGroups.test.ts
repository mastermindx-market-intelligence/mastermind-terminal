import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assignPaneGroup, chartLinkView, fitLinkState, legacyLinkState, normalizeLinkState, pickLinkPanes,
  projectLegacySync, setGroupShare, type ChartLinkState,
} from "../chartLinkGroups";
import { CHART_LINK_LEX } from "../chartLinkGroupsLex";

// The pure model behind per-pane link groups (E09). paneSync does the mirroring; this module only
// decides which panes are in which group, what each group shares, and — truthfully — why a group is
// or is not synchronising right now.

const state = (panes: ChartLinkState["panes"], share: Partial<ChartLinkState["share"]> = {}): ChartLinkState => ({
  v: 1,
  panes,
  share: { A: { crosshair: true, window: true }, B: { crosshair: true, window: true }, C: { crosshair: true, window: true }, ...share },
});

describe("legacy sync migration (AC-E09-05)", () => {
  it("sync=true is one group of every pane sharing both dimensions; sync=false is every pane independent", () => {
    expect(legacyLinkState(true, 3).panes).toEqual(["A", "A", "A"]);
    expect(legacyLinkState(false, 3).panes).toEqual([null, null, null]);
    expect(legacyLinkState(true, 4).share.A).toEqual({ crosshair: true, window: true });
  });

  it("is deterministic: the same input always maps to the same state, and round-trips through the saved boolean", () => {
    for (const n of [1, 2, 4]) {
      for (const sync of [true, false]) {
        const a = legacyLinkState(sync, n);
        expect(legacyLinkState(sync, n)).toEqual(a);
        expect(projectLegacySync(a, n)).toBe(sync);
      }
    }
  });

  it("a narrower grouping saves as sync=false rather than over-claiming a global link", () => {
    expect(projectLegacySync(state(["A", "A", null, null]), 4)).toBe(false);
    expect(projectLegacySync(state(["A", "A", "B", "B"]), 4)).toBe(false);
    expect(projectLegacySync(state(["B", "B"]), 2)).toBe(true);
    expect(projectLegacySync(state(["A", "A"], { A: { crosshair: true, window: false } }), 2)).toBe(false);
    expect(projectLegacySync(state([]), 0)).toBe(false);
  });

  it("an unrecognisable persisted record is rejected (caller falls back to `sync`), never guessed", () => {
    for (const bad of [null, undefined, 1, "A", [], {}, { v: 2, panes: ["A"] }, { v: 1 }, { v: 1, panes: "AA" }]) {
      expect(normalizeLinkState(bad, 2)).toBeNull();
    }
  });

  it("inside a valid record an unknown group is independent and a damaged share flag defaults on", () => {
    const got = normalizeLinkState({ v: 1, panes: ["A", "Z", 3, "B"], share: { A: { crosshair: false, window: "yes" }, B: null } }, 4)!;
    expect(got.panes).toEqual(["A", null, null, "B"]);
    expect(got.share.A).toEqual({ crosshair: false, window: true });
    expect(got.share.B).toEqual({ crosshair: true, window: true });
  });

  it("normalises to the CURRENT pane count", () => {
    expect(normalizeLinkState({ v: 1, panes: ["A", "A", "B", "B"] }, 2)!.panes).toEqual(["A", "A"]);
    expect(normalizeLinkState({ v: 1, panes: ["A"] }, 3)!.panes).toEqual(["A", null, null]);
  });
});

describe("pane slot changes", () => {
  it("fit: removed slots leave their group and NEW slots start independent", () => {
    const s = state(["A", "A", "B", "B"]);
    expect(fitLinkState(s, 4)).toBe(s);
    const shrunk = fitLinkState(s, 2);
    expect(shrunk.panes).toEqual(["A", "A"]);
    expect(fitLinkState(shrunk, 4).panes).toEqual(["A", "A", null, null]);   // B never comes back by accident
  });

  it("pick keeps the surviving original slots in order (restore dropped an unknown symbol)", () => {
    expect(pickLinkPanes(state(["A", "B", "A", "B"]), [0, 2, 3]).panes).toEqual(["A", "A", "B"]);
  });

  it("assign and share return the SAME object when nothing changes, so React can bail out", () => {
    const s = state(["A", null]);
    expect(assignPaneGroup(s, 0, "A")).toBe(s);
    expect(assignPaneGroup(s, 5, "B")).toBe(s);
    expect(assignPaneGroup(s, 0, "Q" as never)).toBe(s);
    expect(setGroupShare(s, "A", "window", true)).toBe(s);
    const moved = assignPaneGroup(s, 1, "A");
    expect(moved.panes).toEqual(["A", "A"]);
    expect(s.panes).toEqual(["A", null]);                   // never mutated in place
    const shared = setGroupShare(moved, "A", "crosshair", false);
    expect(shared.share.A).toEqual({ crosshair: false, window: true });
    expect(moved.share.A.crosshair).toBe(true);
  });
});

describe("chartLinkView — who synchronises, and why not", () => {
  it("only members of a live group are in the plan, with exactly their group's dimensions (AC-E09-01/02)", () => {
    const s = state(["A", "A", "B", "B", null], { B: { crosshair: true, window: false } });
    const v = chartLinkView(s, ["D", "D", "D", "D", "D"], 5);
    expect(v.plan).toEqual({
      0: { group: "A", crosshair: true, window: true },
      1: { group: "A", crosshair: true, window: true },
      2: { group: "B", crosshair: true, window: false },
      3: { group: "B", crosshair: true, window: false },
    });
    expect(v.panes.map((p) => p.status)).toEqual(["active", "active", "active", "active", "independent"]);
    expect(v.anyLinked).toBe(true);
  });

  it("a mixed-timeframe group is refused as a WHOLE and names the timeframes (AC-E09-05)", () => {
    const v = chartLinkView(state(["A", "A", "B", "B"]), ["D", "W", "D", "D"], 4);
    const a = v.groups.find((g) => g.id === "A")!;
    expect(a.status).toBe("mixed_timeframes");
    expect(a.timeframes).toEqual(["D", "W"]);
    expect(v.plan[0]).toBeUndefined();
    expect(v.plan[1]).toBeUndefined();
    expect(v.plan[2]).toEqual({ group: "B", crosshair: true, window: true });
    expect(v.panes[0].status).toBe("mixed_timeframes");
  });

  it("an unknown timeframe is refused rather than guessed", () => {
    const v = chartLinkView(state(["A", "A"]), ["D", ""], 2);
    expect(v.groups[0].status).toBe("timeframe_unknown");
    expect(v.plan).toEqual({});
    expect(v.anyLinked).toBe(false);
  });

  it("a group of one, or one sharing nothing, is not linked — and says which", () => {
    expect(chartLinkView(state(["A", null]), ["D", "D"], 2).groups[0].status).toBe("alone");
    const none = chartLinkView(state(["A", "A"], { A: { crosshair: false, window: false } }), ["D", "D"], 2);
    expect(none.groups[0].status).toBe("nothing_shared");
    expect(none.plan).toEqual({});
  });

  it("waiting: the plan is applied but a member has no chart data registered yet", () => {
    const v = chartLinkView(state(["A", "A", "A"]), ["D", "D", "D"], 3, new Set([0]));
    expect(v.groups[0].status).toBe("waiting");
    expect(Object.keys(v.plan)).toEqual(["0", "1", "2"]);      // plan does not depend on registration
    const partial = chartLinkView(state(["A", "A", "A"]), ["D", "D", "D"], 3, new Set([0, 1]));
    expect(partial.groups[0].status).toBe("active");
    expect(partial.panes[2].status).toBe("waiting");
    expect(partial.plan).toEqual(v.plan);                       // registration never changes the plan
  });

  it("ignores state slots beyond the pane count", () => {
    const v = chartLinkView(state(["A", "A", "B", "B"]), ["D", "D", "D", "D"], 2);
    expect(v.groups.map((g) => g.id)).toEqual(["A"]);
    expect(v.panes).toHaveLength(2);
  });
});

describe("ownership boundaries (AC-E09-06)", () => {
  const src = (...p: string[]) => readFileSync(join(__dirname, "..", "..", ...p), "utf8");

  it("the link model and its control own no security context, chart, registry or second bus", () => {
    for (const file of [src("lib", "chartLinkGroups.ts"), src("components", "ChartLinkControl.tsx"), src("lib", "chartLinkGroupsLex.ts")]) {
      const imports = file.split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
      expect(imports).not.toMatch(/workspaceContextSession|useChartBus|useWorkspaceContextConsumer|replayContract|lightweight-charts/);
      // Only a TYPE comes from paneSync; nothing here can register, broadcast or apply a plan.
      expect(imports).not.toMatch(/import\s+\{[^}]*\b(registerPane|broadcastRange|broadcastCrosshair|setPaneLinks|setPaneSync)\b/);
    }
  });

  it("the shell applies the plan through paneSync only — no parallel map or bus advances chart state", () => {
    const shell = src("components", "TerminalShell.tsx");
    expect(shell).toMatch(/setPaneLinks\(linkView\.plan\)/);
    expect(shell).not.toMatch(/setPaneSync\(/);
  });

  it("every copy key has an EN and a ZH string", () => {
    for (const [key, [en, zh]] of Object.entries(CHART_LINK_LEX)) {
      expect(en, key).toBeTruthy();
      expect(zh, key).toBeTruthy();
      expect(zh, key).not.toBe(en);
    }
  });
});
