import { describe, expect, it } from "vitest";
import { compareExpectedUpdatedAt, nextSavedAtIso, parseExpectedUpdatedAtMs } from "@/lib/savedScriptStamp";

describe("savedScriptStamp", () => {
  const expected = "2026-10-06T12:00:00.000Z";
  const expectedMs = Date.parse(expected);

  it("parses an exact ISO DB token", () => {
    expect(parseExpectedUpdatedAtMs(expected)).toBe(expectedMs);
  });

  it("rejects malformed expected tokens", () => {
    for (const bad of [undefined, null, "", "not-a-date", 123, {}, "2026-99-99T00:00:00Z"]) {
      expect(parseExpectedUpdatedAtMs(bad)).toBeNull();
      expect(nextSavedAtIso(bad, expectedMs)).toBeNull();
    }
  });

  it("rejects Date.parse-able strings that are not timestamptz tokens", () => {
    for (const bad of [
      "2026-10-06",
      "2026-10-06T12:00:00",
      "2026-10-06 12:00:00.000Z",
      "October 6, 2026",
      "2026-10-06T12:00:00.000",
    ]) {
      expect(Number.isFinite(Date.parse(bad))).toBe(true);
      expect(parseExpectedUpdatedAtMs(bad)).toBeNull();
      expect(nextSavedAtIso(bad, expectedMs)).toBeNull();
    }
  });

  it("accepts offset timestamptz tokens and still emits millisecond ISO", () => {
    const offset = "2026-10-06T12:00:00.000+00:00";
    expect(parseExpectedUpdatedAtMs(offset)).toBe(expectedMs);
    expect(nextSavedAtIso(offset, expectedMs)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("uses now when now is later than expected+1ms", () => {
    const nowMs = expectedMs + 5_000;
    expect(nextSavedAtIso(expected, nowMs)).toBe(new Date(nowMs).toISOString());
  });

  it("is monotonic: floor(expected)+1 when now is not later", () => {
    expect(nextSavedAtIso(expected, expectedMs)).toBe(new Date(expectedMs + 1).toISOString());
    expect(nextSavedAtIso(expected, expectedMs - 50)).toBe(new Date(expectedMs + 1).toISOString());
    expect(nextSavedAtIso(expected, expectedMs + 1)).toBe(new Date(expectedMs + 1).toISOString());
  });

  it("returns millisecond-precision ISO", () => {
    const iso = nextSavedAtIso(expected, expectedMs);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("orders same-millisecond microseconds that Date.parse truncates", () => {
    const newer = "2026-10-06T12:00:01.123789Z";
    const older = "2026-10-06T12:00:01.123456Z";
    expect(parseExpectedUpdatedAtMs(newer)).toBe(Date.parse(newer));
    expect(parseExpectedUpdatedAtMs(older)).toBe(Date.parse(older));
    expect(parseExpectedUpdatedAtMs(newer)).toBe(parseExpectedUpdatedAtMs(older));
    expect(compareExpectedUpdatedAt(older, newer)).toBe(-1);
    expect(compareExpectedUpdatedAt(newer, older)).toBe(1);
    expect(compareExpectedUpdatedAt(newer, newer)).toBe(0);
  });

  it("treats timezone offsets as the same instant, not lexicographic strings", () => {
    const z = "2026-10-06T12:00:01.123789Z";
    const plusZero = "2026-10-06T12:00:01.123789+00:00";
    const plusOne = "2026-10-06T13:00:01.123789+01:00";
    const olderPlusOne = "2026-10-06T13:00:01.123456+01:00";
    expect(compareExpectedUpdatedAt(z, plusZero)).toBe(0);
    expect(compareExpectedUpdatedAt(z, plusOne)).toBe(0);
    expect(compareExpectedUpdatedAt(olderPlusOne, z)).toBe(-1);
    expect(compareExpectedUpdatedAt("not-a-stamp", z)).toBeNull();
  });
});
