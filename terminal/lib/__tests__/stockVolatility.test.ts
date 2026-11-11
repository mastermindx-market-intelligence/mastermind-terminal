import { describe, expect, it } from "vitest";
import { stockVolatilityRead } from "../stockVolatility";

const now = new Date("2026-11-03T01:00:00Z");
const payload = {
  schema: "options_hub.vol/v1", root: "GOOG", asof: "2026-10-30",
  term: [{ exp: "2026-11-27", dte: 28, atm_iv: 32.05 }],
  smile: [{ exp: "2026-11-06", points: [{ strike: 280, call_iv: 31, put_iv: 33 }] }],
};

describe("stock analysis volatility", () => {
  it("preserves the Hub's percent units, dates, root and cached-source status", () => {
    const value = stockVolatilityRead("GOOG", { status: "data", data: { ...payload, stale: true } }, now);
    expect(value).toMatchObject({ status: "data", asof: "2026-10-30", stale: true,
      term: [{ expiry: "2026-11-27", iv: 32.05 }],
      smile: { expiry: "2026-11-06", strikes: [280], callIv: [31] } });
  });
  it.each([
    { ...payload, root: "GOOGL" }, { ...payload, asof: "2026-11-10" },
    { ...payload, asof: "2026-02-30" }, { ...payload, term: [], smile: [] },
    { ...payload, term: [...payload.term, ...payload.term], smile: [] },
  ])("rejects mismatched, empty or conflicting observations", book => {
    expect(stockVolatilityRead("GOOG", { status: "data", data: book }, now).status).toBe("unavailable");
  });
  it("keeps missing coverage distinct from a failed read", () => {
    expect(stockVolatilityRead("GOOG", { status: "absent", httpStatus: 404 }, now).status).toBe("absent");
    expect(stockVolatilityRead("GOOG", { status: "unavailable", reason: "network" }, now).status).toBe("unavailable");
  });
});

describe("stock analysis preserves the admitted curve geometry", () => {
  const near = { exp: "2026-11-06", dte: 7, atm_iv: 31 };
  const far = { exp: "2026-11-27", dte: 28, atm_iv: 34 };
  const later = { exp: "2026-12-18", dte: 49, atm_iv: 36 };
  function read(term: unknown[], smile: unknown[] = payload.smile) {
    const value = stockVolatilityRead("GOOG", { status: "data", data: { ...payload, term, smile } }, now);
    expect(value.status).toBe("data");
    if (value.status !== "data") throw new Error("expected admitted observations");
    return value;
  }

  it("breaks across a rejected expiry at a known tenor without making up a date", () => {
    const value = read([near, { exp: "invalid", dte: 14, atm_iv: 32 }, far]);
    expect(value.term).toEqual([{ expiry: near.exp, iv: 31 }, { expiry: far.exp, iv: 34 }]);
    expect(value.termBreakBefore).toEqual([false, true]);
  });

  it("keeps a reported span continuous when a rejected identity overlaps an admitted tenor", () => {
    const value = read([near, { exp: "invalid", dte: 7, atm_iv: 32 }, far]);
    expect(value.termBreakBefore).toEqual([false, false]);
  });

  it("does not invent a break inside a span for a rejected tenor outside that span", () => {
    const value = read([near, far, { exp: "invalid", dte: 60, atm_iv: 32 }]);
    expect(value.termBreakBefore).toEqual([false, false]);
  });

  it("retains every valid point but withholds connections when a duplicated expiry has conflicting coordinates", () => {
    const value = read([near, far, later,
      { exp: "2026-11-13", dte: 14, atm_iv: 32 },
      { exp: "2026-11-13", dte: 21, atm_iv: 33 },
    ]);
    expect(value.term.map(row => row.expiry)).toEqual([near.exp, far.exp, later.exp]);
    expect(value.termBreakBefore).toEqual([false, true, true]);
  });

  it.each([null, "14", -1])("withholds all connections when a supplied tenor cannot be placed (%s)", dte => {
    const value = read([near, { exp: "2026-11-13", dte, atm_iv: 32 }, far, later]);
    expect(value.term.map(row => row.iv)).toEqual([31, 34, 36]);
    expect(value.termBreakBefore).toEqual([false, true, true]);
  });

  it("keeps a duplicated expiry with an agreed coordinate as an actual NaN gap", () => {
    const value = read([near, far,
      { exp: "2026-11-13", dte: 14, atm_iv: 32 },
      { exp: "2026-11-13", dte: 14, atm_iv: 33 },
    ]);
    expect(value.term.map(row => row.expiry)).toEqual([near.exp, "2026-11-13", far.exp]);
    expect(value.term[1].iv).toBeNaN();
    expect(value.termBreakBefore).toEqual([false, false, false]);
  });

  it("preserves the shared admission contract for reported numeric zero", () => {
    const value = read([{ ...near, atm_iv: 0 }], [{
      exp: near.exp, points: [{ strike: 280, call_iv: 0, put_iv: 0 }],
    }]);
    expect(value.term).toEqual([{ expiry: near.exp, iv: 0 }]);
    expect(value.smile?.callIv).toEqual([0]);
  });

  it("keeps an admitted smile when term coverage is absent", () => {
    const value = read([]);
    expect(value.term).toEqual([]);
    expect(value.termBreakBefore).toEqual([]);
    expect(value.smile?.callIv).toEqual([31]);
  });

  it("keeps an admitted smile when all term observations conflict", () => {
    const value = read([near, near]);
    expect(value.term[0].iv).toBeNaN();
    expect(value.smile?.callIv).toEqual([31]);
  });

  it("keeps admitted term observations when smile coverage is absent", () => {
    const value = read([near, far], []);
    expect(value.term.map(row => row.iv)).toEqual([31, 34]);
    expect(value.smile).toBeNull();
  });

  it("retains a duplicate strike at its exact coordinate as a call-IV gap", () => {
    const value = read([near], [{
      exp: near.exp, points: [
        { strike: 270, call_iv: 20, put_iv: 22 },
        { strike: 280, call_iv: 31, put_iv: 33 },
        { strike: 280, call_iv: 32, put_iv: 34 },
        { strike: 290, call_iv: 40, put_iv: 42 },
      ],
    }]);
    expect(value.smile?.strikes).toEqual([270, 280, 290]);
    expect(value.smile?.callIv[0]).toBe(20);
    expect(value.smile?.callIv[1]).toBeNaN();
    expect(value.smile?.callIv[2]).toBe(40);
  });

  it("does not choose a client-side winner for a duplicated smile expiry", () => {
    const value = read([near], [...payload.smile, ...payload.smile]);
    expect(value.smile).toBeNull();
  });
});
