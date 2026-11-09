import { describe, expect, it } from "vitest";
import { readThesisInspection, withThesisInspection } from "../thesisInspectionHistory";

const selection = { ownerKey: "owner-a", thesisId: "thesis-a", version: 1 };
const canonical = [{ thesisId: "thesis-a", version: 2 }, { thesisId: "thesis-a", version: 1 }];
const state = withThesisInspection({ __NA: true, __mmThesisHistoryPosition: 7 }, selection);

describe("owner-bound historical thesis inspection", () => {
  it("preserves framework and navigation state without changing the original entry object", () => {
    const prior = { __NA: true, __mmThesisHistoryPosition: 7 };
    const next = withThesisInspection(prior, selection);
    expect(next).toMatchObject(prior);
    expect(prior).toEqual({ __NA: true, __mmThesisHistoryPosition: 7 });
    expect(readThesisInspection(next, "owner-a", "thesis-a", canonical)).toBe(1);
  });
  it("cannot transfer the inspection between owners or theses", () => {
    expect(readThesisInspection(state, "owner-b", "thesis-a", canonical)).toBeNull();
    expect(readThesisInspection(state, "owner-a", "thesis-b", canonical)).toBeNull();
    expect(readThesisInspection(state, "", "thesis-a", canonical)).toBeNull();
  });
  it("requires the exact version to belong to the freshly loaded thesis history", () => {
    expect(readThesisInspection(state, "owner-a", "thesis-a", [])).toBeNull();
    expect(readThesisInspection(state, "owner-a", "thesis-a", [canonical[0]])).toBeNull();
    expect(readThesisInspection(state, "owner-a", "thesis-a", [{ thesisId: "thesis-b", version: 1 }])).toBeNull();
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", true, null])("rejects malformed version %s", version => {
    const malformed = { ...state, __mmThesisInspectionV1: { ...selection, version } };
    expect(readThesisInspection(malformed, "owner-a", "thesis-a", canonical)).toBeNull();
  });
  it("explicit close/new entry clears only the inspection reference", () => {
    const closed = withThesisInspection(state, null);
    expect(closed).toEqual({ __NA: true, __mmThesisHistoryPosition: 7 });
    expect(readThesisInspection(closed, "owner-a", "thesis-a", canonical)).toBeNull();
  });
  it.each([null, undefined, [], "foreign", 3])("foreign state %s cannot restore a version", value => {
    expect(readThesisInspection(value, "owner-a", "thesis-a", canonical)).toBeNull();
  });
});
