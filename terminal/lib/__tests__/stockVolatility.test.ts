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
    { ...payload, term: [...payload.term, ...payload.term] },
  ])("rejects mismatched, empty or conflicting observations", book => {
    expect(stockVolatilityRead("GOOG", { status: "data", data: book }, now).status).toBe("unavailable");
  });
  it("keeps missing coverage distinct from a failed read", () => {
    expect(stockVolatilityRead("GOOG", { status: "absent", httpStatus: 404 }, now).status).toBe("absent");
    expect(stockVolatilityRead("GOOG", { status: "unavailable", reason: "network" }, now).status).toBe("unavailable");
  });
});
