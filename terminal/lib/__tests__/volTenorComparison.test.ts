// Options R1 W3B — constant-tenor comparison over the published ATM term
// structure (freeze §W3B B1/B2 + 2026-10-21 axes amendment). Pure suite: no DOM.
import { describe, expect, it } from "vitest";
import type { VolSmileExp, VolTermRow } from "@/components/vol/volTypes";
import {
  answerLine, atmProxyStrike, constantDeltaPoint, constantTenorPoint,
  eventInWindow, expectedMoveFromIv, skewInStrikeSpace, tradingDaysBetween,
  type CurveEvent,
} from "@/lib/volTenorComparison";

// DESIGN_SPEC §4 fixture: AAPL nightly 2026-10-20, today 2026-10-21.
const term: VolTermRow[] = [
  { dte: 2, exp: "2026-10-23", atm_iv: 36.9 },
  { dte: 7, exp: "2026-10-28", atm_iv: 34.8 },
  { dte: 10, exp: "2026-10-31", atm_iv: 33.5 },
  { dte: 14, exp: "2026-11-04", atm_iv: 32.2 },
  { dte: 30, exp: "2026-11-20", atm_iv: 29.4 },
  { dte: 60, exp: "2026-12-20", atm_iv: 27.8 },
  { dte: 90, exp: "2027-01-19", atm_iv: 27.1 },
];

const smile30: VolSmileExp = {
  exp: "2026-11-20",
  points: [
    { strike: 212.5, call_iv: 38.4, put_iv: 38.2 },
    { strike: 236, call_iv: 29.5, put_iv: 29.4 },
    { strike: 255, call_iv: 27.2, put_iv: 27.6 },
  ],
};

describe("constant tenor over the supplied curve", () => {
  it("returns the supplied point when the tenor matches a supplied expiry", () => {
    const seven = constantTenorPoint(term, 7);
    expect(seven.basis).toBe("supplied");
    expect(seven.iv).toBe(34.8);
    expect(seven.reason).toBeUndefined();
    const front = constantTenorPoint(term, 2);
    expect(front.basis).toBe("supplied");
    expect(front.iv).toBe(36.9);
    const between = constantTenorPoint(term, 21);
    expect(between.between && [between.between.lo.dte, between.between.hi.dte]).toEqual([14, 30]);
  });

  it("interpolates variance-linearly in calendar days between the two nearest supplied expiries", () => {
    const p = constantTenorPoint(term, 21);
    expect(p.basis).toBe("interpolated");
    // v(21) = 32.2²·14 + (29.4²·30 − 32.2²·14)·(21−14)/(30−14) → iv = √(v/21) = 30.48…
    expect(p.iv).toBeCloseTo(30.4803, 3);
    // A plain linear-in-IV read would say 30.98 — variance-linear is the declared rule.
    expect(p.iv).not.toBeCloseTo(30.975, 1);
    // Display rounds to 0.1: the board's 30.5.
    expect(Math.round(p.iv! * 10) / 10).toBe(30.5);
    expect(p.between && [p.between.lo.dte, p.between.hi.dte]).toEqual([14, 30]);
    expect(p.between?.lo.exp).toBe("2026-11-04");
  });

  it("never extrapolates outside the supplied range", () => {
    // DESIGN_SPEC §4 fixture: 7D…90D supplied, no front expiry.
    const specTerm = term.slice(1);
    for (const tenor of [3, 120]) {
      const p = constantTenorPoint(specTerm, tenor);
      expect(p.basis).toBe("unsupported");
      expect(p.iv).toBeNull();
      expect(p.reason).toBe("outside_supplied_range");
      expect(constantTenorPoint(specTerm, tenor).between).toBeUndefined();
    }
    expect(constantTenorPoint(specTerm, 1).reason).toBe("outside_supplied_range");
    // With the front expiry supplied, 3D sits strictly INSIDE and interpolates 2D → 7D;
    // only tenors below the first or above the last supplied DTE are out of range.
    const inside = constantTenorPoint(term, 3);
    expect(inside.basis).toBe("interpolated");
    expect(inside.between && [inside.between.lo.dte, inside.between.hi.dte]).toEqual([2, 7]);
    expect(constantTenorPoint(term, 1).reason).toBe("outside_supplied_range");
  });

  it("skips null and non-finite supplied points when choosing neighbours", () => {
    const gapped: VolTermRow[] = [
      { dte: 7, exp: "2026-10-28", atm_iv: null },
      { dte: 14, exp: "2026-11-04", atm_iv: 32.2 },
      { dte: 30, exp: "2026-11-20", atm_iv: 29.4 },
    ];
    // 10D has no admitted neighbour below (7D is null): unsupported, not bridged through the null.
    const ten = constantTenorPoint(gapped, 10);
    expect(ten.basis).toBe("unsupported");
    expect(ten.reason).toBe("outside_supplied_range");
    // 21D still interpolates between the two admitted finite neighbours.
    const p = constantTenorPoint(gapped, 21);
    expect(p.basis).toBe("interpolated");
    expect(p.iv).toBeCloseTo(30.4803, 3);
    // Non-finite coordinates and invalid expiries never become neighbours either.
    const malformed: VolTermRow[] = [
      { dte: Number.NaN, exp: "2026-10-28", atm_iv: 99 },
      { dte: 12, exp: "2026-02-30", atm_iv: 99 },
      { dte: 14, exp: "2026-11-04", atm_iv: Number.NaN },
      { dte: 30, exp: "2026-11-20", atm_iv: 29.4 },
      { dte: 60, exp: "2026-12-20", atm_iv: 27.8 },
    ];
    const q = constantTenorPoint(malformed, 45);
    expect(q.basis).toBe("interpolated");
    expect(q.iv).toBeCloseTo(28.343, 3);
    expect(q.between && [q.between.lo.dte, q.between.hi.dte]).toEqual([30, 60]);
    // Nothing admitted at all: no_supplied_points; an unusable tenor ask: invalid_tenor.
    expect(constantTenorPoint([{ dte: 7, exp: "2026-10-28", atm_iv: null }], 7).reason).toBe("no_supplied_points");
    expect(constantTenorPoint(undefined, 7).reason).toBe("no_supplied_points");
    for (const bad of [0, -5, Number.NaN]) {
      expect(constantTenorPoint(term, bad).reason).toBe("invalid_tenor");
    }
  });
});

describe("constant delta", () => {
  it("reports constant-delta points as unsupported while no delta is published", () => {
    expect(constantDeltaPoint(term, 0.25)).toEqual({ basis: "unsupported", reason: "delta_not_published" });
    // Even a payload that pretends to carry deltas changes nothing until the producer ships them.
    expect(constantDeltaPoint([{ dte: 30, exp: "2026-11-20", atm_iv: 29.4, delta: 0.25 }], 0.25))
      .toEqual({ basis: "unsupported", reason: "delta_not_published" });
    expect(constantDeltaPoint(undefined, Number.NaN)).toEqual({ basis: "unsupported", reason: "delta_not_published" });
  });
});

describe("expected move (declared iv·√T)", () => {
  it("estimates the expected move in percent only when no spot is supplied", () => {
    const em = expectedMoveFromIv({ ivPct: 36.9, horizonDays: 2, ivAsOf: "2026-10-20" });
    expect(em).not.toBeNull();
    expect(em!.estimator).toBe("iv_sqrt_t");
    expect(em!.annualisation).toBe("trading_days_252");
    expect(em!.pct).toBeCloseTo(3.2871, 3);
    expect(em!.lo).toBeNull();
    expect(em!.hi).toBeNull();
    expect(em!.spot).toBeNull();
    expect(em!.spotAsOf).toBeNull();
    expect(Math.round(em!.pct * 10) / 10).toBe(3.3);
    expect(expectedMoveFromIv({ ivPct: Number.NaN, horizonDays: 2, ivAsOf: "2026-10-20" })).toBeNull();
    expect(expectedMoveFromIv({ ivPct: 36.9, horizonDays: 0, ivAsOf: "2026-10-20" })).toBeNull();
    expect(expectedMoveFromIv({ ivPct: 36.9, horizonDays: -1, ivAsOf: "2026-10-20" })).toBeNull();
  });

  it("adds a price range with both clocks when a spot is supplied", () => {
    const em = expectedMoveFromIv({
      ivPct: 36.9, horizonDays: 2, ivAsOf: "2026-10-20",
      spot: { value: 236.14, asOf: "10:40:12 ET" },
    });
    expect(em).not.toBeNull();
    expect(em!.lo).toBeCloseTo(228.37, 1);
    expect(em!.hi).toBeCloseTo(243.91, 1);
    expect(em!.spot).toBe(236.14);
    expect(em!.spotAsOf).toBe("10:40:12 ET");
    expect(em!.ivAsOf).toBe("2026-10-20");
    // An unusable spot is no spot: percent only.
    for (const bad of [0, -1, Number.NaN]) {
      const emBad = expectedMoveFromIv({
        ivPct: 36.9, horizonDays: 2, ivAsOf: "2026-10-20", spot: { value: bad, asOf: "10:40:12 ET" },
      });
      expect(emBad!.lo).toBeNull();
      expect(emBad!.spotAsOf).toBeNull();
    }
  });

  it("carries no confidence level", () => {
    for (const em of [
      expectedMoveFromIv({ ivPct: 36.9, horizonDays: 2, ivAsOf: "2026-10-20" }),
      expectedMoveFromIv({ ivPct: 36.9, horizonDays: 2, ivAsOf: "2026-10-20", spot: { value: 236.14, asOf: "10:40:12 ET" } }),
    ]) {
      const keys = Object.keys(em ?? {});
      expect(keys.sort()).toEqual([
        "annualisation", "estimator", "hi", "horizonDays", "ivAsOf", "ivPct", "lo", "pct", "spot", "spotAsOf",
      ]);
      for (const key of keys) {
        expect(/confidence|ci|prob|sigma|σ/i.test(key)).toBe(false);
      }
    }
  });
});

describe("event windows", () => {
  it("flags only the expiries whose window contains an event", () => {
    const events: CurveEvent[] = [
      { kind: "earnings", date: "2026-10-30", label: "Earnings", source: "exchange calendar" },
      { kind: "macro", date: "2026-10-15", label: "Before the read", source: "macro calendar" },
      { kind: "macro", date: "2026-11-25", label: "After the expiry", source: "macro calendar" },
      { kind: "macro", date: "2026-10-21", label: "On the read day", source: "macro calendar" },
      { kind: "earnings", date: "2026-11-04", label: "On the expiry", source: "exchange calendar" },
      { kind: "broken", date: "2026-02-30", label: "Not a day", source: "bad" },
    ];
    const inside = eventInWindow("2026-11-04", events, "2026-10-21");
    expect(inside.map((e) => e.date)).toEqual(["2026-10-30", "2026-10-21", "2026-11-04"]);
    // Inclusive bounds: an event on today or on the expiry itself is inside.
    expect(eventInWindow("2026-10-23", events, "2026-10-21").map((e) => e.date)).toEqual(["2026-10-21"]);
    expect(eventInWindow("2026-11-04", [], "2026-10-21")).toEqual([]);
    expect(eventInWindow("2026-02-30", events, "2026-10-21")).toEqual([]);
  });

  it("counts weekdays between today and the expiry without subtracting holidays", () => {
    // Wed 21 Oct → Fri 23 Oct close: 2 trading days (the board's horizon).
    expect(tradingDaysBetween("2026-10-21", "2026-10-23")).toBe(2);
    expect(tradingDaysBetween("2026-10-21", "2026-10-21")).toBeNull();
    expect(tradingDaysBetween("2026-10-23", "2026-10-21")).toBeNull();
    expect(tradingDaysBetween("2026-10-21", "2026-10-28")).toBe(5);
    expect(tradingDaysBetween("2026-10-21", "not-a-day")).toBeNull();
  });
});

describe("skew in strike space", () => {
  it("reads skew in strike space between adjacent supplied strikes and leaves an unsupported wing blank", () => {
    const rows = skewInStrikeSpace(smile30, 236, [90, 95, 100, 105, 110], "auto");
    expect(rows).toHaveLength(5);
    const [p90, p95, atm, p105, p110] = rows;
    expect(p90.basis).toBe("supplied");
    expect(p90.iv).toBe(38.2);
    expect(p90.strike).toBe(212.5);
    expect(p95.basis).toBe("interpolated");
    expect(p95.iv).toBeCloseTo(33.8187, 3);
    expect(p95.between).toEqual({ lo: 212.5, hi: 236 });
    expect(atm.basis).toBe("supplied");
    expect(atm.iv).toBe(29.4);
    expect(p105.basis).toBe("interpolated");
    expect(p105.iv).toBeCloseTo(28.0716, 3);
    expect(p105.between).toEqual({ lo: 236, hi: 255 });
    // Beyond the last supplied strike: the row stays, the value stays blank.
    expect(p110.basis).toBe("unsupported");
    expect(p110.iv).toBeNull();
    expect(p110.reason).toBe("no_strike_supplied");
    // Below the first supplied strike never extrapolates either.
    expect(skewInStrikeSpace(smile30, 236, [85], "auto")[0].reason).toBe("no_strike_supplied");
    // An explicit missing leg between the bracketing strikes is a wing gap, never bridged.
    // (222 is ~94.1% of the reference — outside the ±0.5 rounding window of the 95% row.)
    const gapped: VolSmileExp = {
      exp: "2026-11-20",
      points: [
        { strike: 212.5, call_iv: 38.4, put_iv: 38.2 },
        { strike: 222, call_iv: 30.1, put_iv: null },
        { strike: 236, call_iv: 29.5, put_iv: 29.4 },
      ],
    };
    const gap = skewInStrikeSpace(gapped, 236, [95], "auto")[0];
    expect(gap.basis).toBe("unsupported");
    expect(gap.reason).toBe("wing_gap");
    // No reference strike (no ATM proxy derivable): every row says so.
    const noRef = skewInStrikeSpace(smile30, null, [95], "auto")[0];
    expect(noRef.reason).toBe("no_reference");
    expect(noRef.iv).toBeNull();
    // Forced legs read only that leg; the proxy is the supplied strike nearest the ATM.
    expect(atmProxyStrike(smile30)).toBe(236);
    expect(skewInStrikeSpace(smile30, 236, [108], "call")[0]).toMatchObject({ basis: "supplied", iv: 27.2 });
    expect(skewInStrikeSpace(undefined, 236, [95], "auto")[0].reason).toBe("no_strike_supplied");
  });
});

describe("answer line", () => {
  it("describes the selected point against 7D and 30D in vol points and says nothing when a side is unsupported", () => {
    const sel = constantTenorPoint(term, 2);
    const ans = answerLine(sel, constantTenorPoint(term, 7), constantTenorPoint(term, 30));
    expect(ans.above7).toBeCloseTo(2.1, 6);
    expect(ans.above30).toBeCloseTo(7.5, 6);
    // On the §4 curve (no front expiry) a 3D point does not exist: that side says nothing, the other stays.
    const partial = answerLine(sel, constantTenorPoint(term.slice(1), 3), constantTenorPoint(term, 30));
    expect(partial.above7).toBeNull();
    expect(partial.above30).toBeCloseTo(7.5, 6);
    // An unsupported selected expiry compares nothing.
    const none = answerLine(constantTenorPoint(term, 120), constantTenorPoint(term, 7), constantTenorPoint(term, 30));
    expect(none.above7).toBeNull();
    expect(none.above30).toBeNull();
  });
});
