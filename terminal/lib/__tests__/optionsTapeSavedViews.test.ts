import { describe, expect, it } from "vitest";
import { createDefaultTapeView, decodeTapeView, encodeTapeView } from "../optionsTapeView";
import { addSavedTapeView, decodeSavedTapeViews, encodeSavedTapeViews, MAX_SAVED_TAPE_VIEWS,
  normalizeTapeViewName, removeSavedTapeView, renameSavedTapeView } from "../optionsTapeSavedViews";

const a = { ...createDefaultTapeView(), tapeTickerSearch: "NVDA", minPrem: 1_000_000, sortKey: "premium" as const, sortDir: 1 as const };
const b = { ...createDefaultTapeView(), drillTicker: "SPY", groupFilter: "Technology", tapeTickerSearch: "SP",
  dteBuckets: ["0d" as const], sideFilter: "~buy", flagFilter: "swept" };

describe("named Tape screen preferences", () => {
  it("roundtrips two distinct exact states without saving market/account data", () => {
    const views = addSavedTapeView(addSavedTapeView([], "one", "NVDA swing", a), "two", "SPY 0DTE", b);
    const wire = encodeSavedTapeViews(views);
    const result = decodeSavedTapeViews(wire);
    expect(result).toEqual({ ok: true, views });
    expect(Object.keys(JSON.parse(wire))).toEqual(["v", "views"]);
    expect(Object.keys(views[0])).toEqual(["id", "name", "state"]);
    expect(decodeTapeView(views[0].state)).toEqual(a);
    expect(decodeTapeView(views[1].state)).toEqual(b);
  });

  it("treats only absent storage as an empty library", () => {
    expect(decodeSavedTapeViews(null)).toEqual({ ok: true, views: [] });
    for (const raw of ["", "null", "{}", "[]", "{bad", "a".repeat(100_001)]) {
      expect(decodeSavedTapeViews(raw)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("rejects the whole malformed library rather than widening or dropping an entry", () => {
    const row = { id: "one", name: "Screen", state: encodeTapeView(a) };
    const invalid = [
      { v: 2, views: [row] }, { v: 1, views: [row], extra: true },
      { v: 1, views: [{ ...row, state: '{"v":99}' }] },
      { v: 1, views: [{ ...row, account: "secret" }] },
      { v: 1, views: [row, { ...row, name: "Other" }] },
      { v: 1, views: [row, { ...row, id: "two", name: "screen" }] },
      { v: 1, views: [{ ...row, id: "bad id" }] },
      { v: 1, views: [{ ...row, state: JSON.stringify({ ...a, v: 1, events: [] }) }] },
    ];
    for (const value of invalid) expect(decodeSavedTapeViews(JSON.stringify(value))).toEqual({ ok: false, reason: "invalid" });
  });

  it("normalizes multilingual names while retaining valid joiners and emoji", () => {
    for (const name of ["  期权观察  ", "فارسی‌نمایش", "👩‍💻研究"]) {
      expect(normalizeTapeViewName(name)).toBe(name.trim());
    }
    expect(normalizeTapeViewName("Cafe\u0301")).toBe("Café");
    for (const name of ["", "  ", "\u200d", "x".repeat(61), "line\nbreak", "tab\tname", "bad\u2028name", "bad\ud800name"]) {
      expect(normalizeTapeViewName(name)).toBeNull();
    }
    expect(normalizeTapeViewName("😀".repeat(60))).toBe("😀".repeat(60));
  });

  it("keeps operations immutable and rename/delete separate from active filters", () => {
    const first = addSavedTapeView([], "one", "One", a);
    const before = JSON.stringify(first);
    const two = addSavedTapeView(first, "two", "Two", b);
    const renamed = renameSavedTapeView(two, "one", "Renamed");
    expect(JSON.stringify(first)).toBe(before);
    expect(renamed[0].state).toBe(first[0].state);
    expect(two[0].name).toBe("One");
    expect(removeSavedTapeView(renamed, "one")).toEqual([two[1]]);
    expect(() => renameSavedTapeView(two, "one", "two")).toThrow("duplicate");
    expect(() => addSavedTapeView(two, "three", " one ", a)).toThrow("duplicate");
    expect(() => renameSavedTapeView(two, "missing", "X")).toThrow("missing");
    expect(() => removeSavedTapeView(two, "missing")).toThrow("missing");
    expect(() => addSavedTapeView(two, "one", "Other", a)).toThrow();
  });

  it("enforces the cap without truncating saved screens", () => {
    const full = Array.from({ length: MAX_SAVED_TAPE_VIEWS }, (_, i) => ({ id: `id-${i}`, name: `Screen ${i}`, state: encodeTapeView(a) }));
    expect(decodeSavedTapeViews(encodeSavedTapeViews(full))).toEqual({ ok: true, views: full });
    expect(() => addSavedTapeView(full, "next", "Next", b)).toThrow("full");
    expect(decodeSavedTapeViews(JSON.stringify({ v: 1, views: [...full, { ...full[0], id: "next", name: "Next" }] })).ok).toBe(false);
  });
});
