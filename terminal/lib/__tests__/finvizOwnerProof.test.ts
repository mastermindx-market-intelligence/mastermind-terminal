import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { normalizeFinviz, bubblePoints, visibleGroups } from "../finvizThemes";

// Opt-in evidence replay. Actual owner bytes stay in their original store;
// synthetic unit tests are never labelled source acceptance.
const payload = process.env.FINVIZ_PROOF_PAYLOAD;
const receipt = process.env.FINVIZ_PROOF_MANIFEST;
it.skipIf(!payload || !receipt)("reconciles the retained 40/268 owner generation, never the 49-house catalogue", () => {
  const raw = JSON.parse(readFileSync(payload!, "utf8"));
  const source = JSON.parse(readFileSync(receipt!, "utf8"));
  expect(source.parser_version).toBe("finviz_tree_refresh.v1");
  expect(source.promoted).toBe(true);
  const pop = normalizeFinviz(raw, { counts: {
    themes: source.counts.themes, subthemes: source.counts.subthemes,
    appearances: source.counts.memberships, tickers: source.counts.unique_tickers,
  } });
  expect(pop.counts).toEqual({ themes: 40, subthemes: 268, appearances: 2339, tickers: 924 });
  expect(pop.manifestMatched).toBe(true);
  expect(pop.asOf).toBe("2026-10-07");
  expect(source.asof).toBe("2026-08-15"); // Membership and market clocks differ.
  const original = visibleGroups(pop, "", "");
  expect(original).toHaveLength(268);
  const before = bubblePoints(original, "1W", "1M");
  expect(before.points.length + before.unavailable).toBe(268);
  const selected = before.points[0].group;
  const roster = selected.members.map(m => m.ticker);
  selected.perf["1W"] = null;
  const after = bubblePoints(original, "1W", "1M");
  expect(after.points).toHaveLength(before.points.length - 1);
  expect(after.unavailable).toBe(before.unavailable + 1);
  expect(visibleGroups(pop, "", "")).toHaveLength(268);
  expect(selected.members.map(m => m.ticker)).toEqual(roster);
});
