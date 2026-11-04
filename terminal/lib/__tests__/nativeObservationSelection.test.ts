import { describe, expect, it } from "vitest";
import { extractNativeObservationFacts, projectNativeObservationPacket } from "../nativeObservationProjection";
import type { SuiteRenderBundle } from "../indicator-canvas/types";

const bundle = (): SuiteRenderBundle => ({
  prims: [
    { kind: "poly", id: "study", pts: Array.from({ length: 10 }, (_, i) => ({ i, p: i === 4 ? null : i })) },
    { kind: "line", id: "current-fit", a: { i: 1, p: 3 }, b: { i: "right", p: 4 } },
  ], events: [
    { type: "known", dir: "bull", i: 1 },
    { type: "later-confirmed", dir: "bear", i: 2 },
  ], tables: [{ id: "current-table", columns: ["state"],
    rows: [{ label: "current regime", cells: [{ text: "rising" }] }] }],
  tooltips: new Map(), candlePaint: [],
} as unknown as SuiteRenderBundle);
const timing = [
  { event_index: 0, timing: { anchorI: 1, confirmedI: 3, anchorT: 100, confirmedT: 300 } },
  { event_index: 1, timing: { anchorI: 2, confirmedI: 8, anchorT: 200, confirmedT: 800 } },
];

describe("selected candle projection of current native calculation", () => {
  it("filters on confirmation, not historical anchor, and measures age from selection", () => {
    const facts = extractNativeObservationFacts(bundle(), { barCount: 10, eventTiming: timing, selectedIndex: 4 });
    expect(facts.groups.events.map(x => x.row.type)).toEqual(["known"]);
    expect(facts.groups.events[0].row.age_bars).toBe(1);
    expect(facts.counts.events).toMatchObject({ available: 2, eligible: 1, invalid: 0, after_selection: 1 });
  });
  it("keeps series samples through the selected index and preserves null", () => {
    const facts = extractNativeObservationFacts(bundle(), { barCount: 10, eventTiming: timing, selectedIndex: 4 });
    expect(facts.groups.series[0].row.samples).toEqual([
      { index: 4, value: null, age_bars: 0 }, { index: 3, value: 3, age_bars: 1 },
      { index: 2, value: 2, age_bars: 2 }, { index: 1, value: 1, age_bars: 3 },
      { index: 0, value: 0, age_bars: 4 },
    ]);
    expect(facts.groups.series[0].row.selected_sample).toEqual({ index: 4, value: null, age_bars: 0 });
  });
  it("withholds current geometry and analytical tables without temporal provenance", () => {
    const facts = extractNativeObservationFacts(bundle(), { barCount: 10, eventTiming: timing, selectedIndex: 4 });
    expect(facts.groups.geometry).toEqual([]);
    expect(facts.groups.tables).toEqual([]);
    expect(facts.counts.geometry).toMatchObject({ available: 1, eligible: 0, invalid: 0, unqualified_time: 1 });
    expect(facts.counts.tables).toMatchObject({ available: 1, eligible: 0, invalid: 0, unqualified_time: 1 });
  });
  it("temporal exclusions do not consume the event output budget", () => {
    const input = bundle();
    input.events = Array.from({ length: 20 }, (_, i) => ({ type: "event-" + i, dir: "bull", i: 1 })) as typeof input.events;
    const events = input.events.map((_, event_index) => ({ event_index,
      timing: { anchorI: 1, confirmedI: event_index === 19 ? 3 : 9, anchorT: 100, confirmedT: event_index === 19 ? 300 : 900 } }));
    const extraction = extractNativeObservationFacts(input, { barCount: 10, eventTiming: events, selectedIndex: 4 });
    const out = projectNativeObservationPacket({ basePacket: {}, extraction, maxBytes: 10000, limits: { events: 1 } });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect((out.packet.events as Array<{ type: string }>).map(x => x.type)).toEqual(["event-19"]);
    expect((out.packet.coverage as any).events).toMatchObject({ available: 20, eligible: 1,
      after_selection: 19, invalid: 0, returned: 1, omitted: 0 });
  });
  it("the latest view preserves current geometry, tables and normal ages", () => {
    const facts = extractNativeObservationFacts(bundle(), { barCount: 10, eventTiming: timing });
    expect(facts.groups.events.map(x => x.row.type)).toEqual(["later-confirmed", "known"]);
    expect(facts.groups.events[0].row.age_bars).toBe(1);
    expect(facts.groups.geometry).toHaveLength(1);
    expect(facts.groups.tables).toHaveLength(1);
  });
  it("does not mutate renderer bundles while filtering", () => {
    const input = bundle();
    const before = JSON.stringify(input);
    extractNativeObservationFacts(input, { barCount: 10, eventTiming: timing, selectedIndex: 4 });
    expect(JSON.stringify(input)).toBe(before);
  });
});
