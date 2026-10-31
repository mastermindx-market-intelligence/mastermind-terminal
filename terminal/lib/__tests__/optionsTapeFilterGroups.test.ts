import { describe, expect, it } from "vitest";
import { createDefaultTapeView, decodeTapeView, encodeTapeView, type TapeViewState } from "../optionsTapeView";
import { decodeTapeFilterGroups, encodeTapeFilterGroups, decodeTapeScreen, encodeTapeScreen, filterTapeEvents, type TapeFilterEvent } from "../optionsTapeFilterGroups";

const view = (patch: Partial<TapeViewState> = {}) => ({ ...createDefaultTapeView(), ...patch });
const event = (id: string, patch: Partial<TapeFilterEvent> = {}) => ({ id, premium: 250_000,
  root: "SPY", dte_bucket: "0d", mny_bucket: "atm", group: "Index", right: "C", side: "~buy",
  repeated: false, swept: false, ts: "2026-10-30T14:00:00Z", ...patch });
const ids = (rows: ReturnType<typeof event>[]) => rows.map((row) => row.id);

describe("Tape filter group contract", () => {
  const groups = [view({ tapeTickerSearch: "SPY" }), view({ minPrem: 1_000_000 })];
  it("preserves v1 links and makes older clients withhold composed links", () => {
    expect(encodeTapeScreen(view())).toBe(encodeTapeView(view()));
    expect(decodeTapeScreen(encodeTapeView(view()))).toEqual({ view: view() });
    const compound = encodeTapeScreen(view({ sideFilter: "~buy" }), groups);
    expect(decodeTapeView(compound)).toBeNull();
    expect(decodeTapeScreen(compound)).toEqual({ view: view({ sideFilter: "~buy" }), groups });
  });
  it("requires every composed-link constraint and rejects unknown fields and versions", () => {
    const valid = JSON.parse(encodeTapeScreen(view(), groups));
    for (const bad of [{ ...valid, groups: "bad" }, { ...valid, view: "bad" }, { ...valid, v: 3 },
      { ...valid, extra: true }, { v: 2, view: valid.view }, { v: 2, groups: valid.groups }, null]) {
      expect(decodeTapeScreen(JSON.stringify(bad))).toBeNull();
    }
    expect(decodeTapeScreen("x".repeat(14_001))).toBeNull();
  });
  it("round trips existing screens without modifying their v1 wire format", () => {
    const encoded = encodeTapeFilterGroups(groups);
    expect(JSON.parse(encoded).groups).toEqual(groups.map(encodeTapeView));
    expect(decodeTapeFilterGroups(encoded)).toEqual(groups);
    expect(encodeTapeFilterGroups(decodeTapeFilterGroups(encoded)!)).toBe(encoded);
  });
  it.each([null, "", "null", "[]", "{}", "{", "x".repeat(10_001),
    JSON.stringify({ v: 2, groups: groups.map(encodeTapeView) }),
    JSON.stringify({ v: 1, groups: groups.map(encodeTapeView), extra: 1 }),
    ...[[], [groups[0]], [...groups, ...groups, groups[0]]].map((items) => JSON.stringify({ v: 1, groups: items.map(encodeTapeView) })),
    JSON.stringify({ v: 1, groups: [encodeTapeView(groups[0]), "bad"] }),
    JSON.stringify({ v: 1, groups: [encodeTapeView(groups[0]), null] }),
    JSON.stringify({ v: 1, groups: [groups[0], groups[1]] }),
  ])("withholds malformed group input (%s)", (raw) => expect(decodeTapeFilterGroups(raw)).toBeNull());
  it("rejects malformed members and sparse arrays at the encoding boundary", () => {
    expect(() => encodeTapeFilterGroups([groups[0], { ...groups[1], minPrem: 7 }])).toThrow();
    expect(() => encodeTapeFilterGroups(new Array(2))).toThrow();
  });
  it("ORs complete screens, applies current refinement, and includes a new matching feed row", () => {
    const rows = [event("small-spy"), event("big-qqq", { root: "QQQ", premium: 2_000_000 }),
      event("small-qqq", { root: "QQQ" }), event("big-spy", { premium: 3_000_000 })];
    expect(ids(filterTapeEvents(rows, view({ sortKey: "premium", sortDir: 1 }), groups))).toEqual(["small-spy", "big-qqq", "big-spy"]);
    expect(ids(filterTapeEvents(rows, view({ minPrem: 1_000_000 }), groups))).toEqual(["big-qqq", "big-spy"]);
    expect(ids(filterTapeEvents([...rows, event("new-spy")], view(), groups))).toContain("new-spy");
  });
  it("does not duplicate overlaps, deduplicate distinct source rows, mutate input or inherit group sorts", () => {
    const rows = [event("a"), event("b"), event("c", { premium: 1_000_000 })];
    const original = structuredClone(rows);
    const overlapping = [view({ sortKey: "premium", sortDir: -1 }), view({ tapeTickerSearch: "SPY" })];
    expect(ids(filterTapeEvents(rows, view(), overlapping))).toEqual(["a", "b", "c"]);
    expect(rows).toEqual(original);
  });
  it("never treats invalid groups as no filter", () => {
    const rows = [event("a")];
    expect(filterTapeEvents(rows, view(), [])).toEqual([]);
    expect(filterTapeEvents(rows, view(), [view(), { ...view(), sideFilter: "BUY" }])).toEqual([]);
    expect(filterTapeEvents(rows, { ...view(), minPrem: NaN })).toEqual([]);
  });
  it("keeps single-screen AND semantics and drill group bypass without bypassing search", () => {
    const rows = [event("a"), event("b", { root: "QQQ" }), event("c", { dte_bucket: "8_30d" })];
    expect(ids(filterTapeEvents(rows, view({ groupFilter: "Other" })))).toEqual([]);
    expect(ids(filterTapeEvents(rows, view({ groupFilter: "Other", drillTicker: "SPY", dteBuckets: ["0d"] })))).toEqual(["a"]);
    expect(ids(filterTapeEvents(rows, view({ drillTicker: "SPY", tapeTickerSearch: "qqq" })))).toEqual([]);
    expect(ids(filterTapeEvents(rows, view({ tapeTickerSearch: " spy ", mnyBuckets: ["itm"] })))).toEqual([]);
    expect(ids(filterTapeEvents(rows, view({ dteBuckets: ["0d", "8_30d"], mnyBuckets: ["atm"] })))).toEqual(["a", "b", "c"]);
  });
  it("preserves approximate side and each activity predicate", () => {
    const rows = [event("ordinary"), event("repeat", { repeated: true }), event("sweep", { swept: true }),
      event("put-buy", { right: "P" }), event("put-sell", { right: "P", side: "~sell" })];
    expect(ids(filterTapeEvents(rows, view({ flagFilter: "put_buy" })))).toEqual(["put-buy"]);
    expect(ids(filterTapeEvents(rows, view({ flagFilter: "swept" })))).toEqual(["sweep"]);
    expect(ids(filterTapeEvents(rows, view({ flagFilter: "repeated" })))).toEqual(["repeat"]);
    expect(ids(filterTapeEvents(rows, view({ sideFilter: "~sell" })))).toEqual(["put-sell"]);
  });
});
