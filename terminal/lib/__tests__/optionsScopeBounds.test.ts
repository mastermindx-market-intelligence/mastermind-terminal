import { describe, expect, it } from "vitest";
import { parseScopeBounds, type BoundsIssue, type ScopeBoundsInput } from "../optionsScopeBounds";

const session = "2026-07-10";
const strikes = Object.freeze([800, 700, 740, 750, 760]);
const expiries = Object.freeze(["2026-07-08", "2026-07-17", "2026-07-10", "2026-08-21"]);
const ctx = { session, strikes, expiries };

function parse(input: ScopeBoundsInput, next = ctx) {
  return parseScopeBounds(input, next);
}

describe("parseScopeBounds", () => {
  it("(u) an open DTE range keeps in-range strikes descending and every non-expired expiry", () => {
    const result = parse({ from: "740", to: "760", dteMin: "", dteMax: "" });
    expect(result).toEqual({
      ok: true,
      value: { from: 740, to: 760, dteMin: 0, dteMax: null },
      strikes: [760, 750, 740],
      expiries: ["2026-07-10", "2026-07-17", "2026-08-21"],
    });
  });

  it("(v) from above to is inverted", () => {
    expect(parse({ from: "760", to: "740", dteMin: "", dteMax: "" })).toEqual({ ok: false, issues: ["inverted"] });
  });

  it("(w) a missing from and a non-numeric to do not report inverted", () => {
    expect(parse({ from: "", to: "x", dteMin: "", dteMax: "" })).toEqual({
      ok: false,
      issues: ["from_missing", "to_not_number"] satisfies BoundsIssue[],
    });
    expect(parse({ from: "  ", to: "740", dteMin: "", dteMax: "" })).toEqual({ ok: false, issues: ["from_missing"] });
  });

  it("(x) exponent, sign, comma and Infinity text are rejected", () => {
    for (const from of ["1e3", "-5", "7,40", "Infinity"]) {
      expect(parse({ from, to: "760", dteMin: "", dteMax: "" })).toEqual({ ok: false, issues: ["from_not_number"] });
    }
    expect(parse({ from: "740", to: "1e3", dteMin: "", dteMax: "" })).toEqual({ ok: false, issues: ["to_not_number"] });
    expect(parse({ from: "0", to: "760", dteMin: "", dteMax: "" })).toEqual({ ok: false, issues: ["not_positive"] });
    expect(parse({ from: "0", to: "0", dteMin: "", dteMax: "" })).toEqual({ ok: false, issues: ["not_positive"] });
    expect(parse({ from: "760", to: "0", dteMin: "", dteMax: "" })).toEqual({ ok: false, issues: ["not_positive"] });
  });

  it("(y) DTE must be a non-negative whole range", () => {
    expect(parse({ from: "740", to: "760", dteMin: "2.5", dteMax: "" })).toEqual({ ok: false, issues: ["dte_not_whole"] });
    expect(parse({ from: "740", to: "760", dteMin: "-1", dteMax: "" })).toEqual({ ok: false, issues: ["dte_negative"] });
    expect(parse({ from: "740", to: "760", dteMin: "5", dteMax: "2" })).toEqual({ ok: false, issues: ["dte_inverted"] });
    expect(parse({ from: "740", to: "760", dteMin: "2.5", dteMax: "-1" })).toEqual({
      ok: false,
      issues: ["dte_not_whole", "dte_negative"],
    });
  });

  it("(z) DTE 0 to 0 is exactly the session expiry and never the nearest other expiry", () => {
    const exact = parse({ from: "740", to: "760", dteMin: "0", dteMax: "0" });
    expect(exact).toEqual({
      ok: true,
      value: { from: 740, to: 760, dteMin: 0, dteMax: 0 },
      strikes: [760, 750, 740],
      expiries: ["2026-07-10"],
    });
    const absent = parse(
      { from: "740", to: "740", dteMin: "0", dteMax: "0" },
      { session, strikes: Object.freeze([740, 760]), expiries: Object.freeze(["2026-07-08", "2026-07-17"]) },
    );
    expect(absent).toEqual({ ok: false, issues: ["no_expiries"] });
  });

  it("(aa) an expiry before the session is excluded when dteMin is empty", () => {
    const result = parse({ from: "700", to: "800", dteMin: "", dteMax: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.expiries).not.toContain("2026-07-08");
    expect(result.expiries).toEqual(["2026-07-10", "2026-07-17", "2026-08-21"]);
    expect(result.value.dteMin).toBe(0);
    expect(result.value.dteMax).toBeNull();
  });

  it("(bb) a valid range with no listed strike is no_strikes", () => {
    expect(parse(
      { from: "740", to: "760", dteMin: "", dteMax: "" },
      { session, strikes: Object.freeze([100, 200]), expiries },
    )).toEqual({ ok: false, issues: ["no_strikes"] });
    expect(parse(
      { from: "740", to: "760", dteMin: "80", dteMax: "90" },
      { session, strikes: Object.freeze([100, 200]), expiries },
    )).toEqual({ ok: false, issues: ["no_strikes", "no_expiries"] });
  });
});
