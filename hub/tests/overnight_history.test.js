"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  OvernightHistory,
  etWallToUtcMs,
} = require("../lib/overnightHistory");

describe("OvernightHistory — ownership and clock contract", () => {
  it("refuses upstream work when Quote Hub has no Alpaca credentials", async () => {
    let calls = 0;
    const history = new OvernightHistory({
      fetchImpl: async () => { calls++; throw new Error("must not run"); },
    });
    const result = await history.getWallDate("AAPL", "1h", "2026-10-14");
    assert.equal(result.status, "not_configured");
    assert.deepEqual(result.bars, []);
    assert.equal(calls, 0);
    assert.equal(history.health().configured, false);
  });

  it("converts ET wall dates to true UTC across daylight and standard time", () => {
    assert.equal(
      new Date(etWallToUtcMs("2026-10-14", 0)).toISOString(),
      "2026-10-14T04:00:00.000Z",
      "October ET midnight is UTC-4",
    );
    assert.equal(
      new Date(etWallToUtcMs("2026-01-14", 0)).toISOString(),
      "2026-01-14T05:00:00.000Z",
      "January ET midnight is UTC-5",
    );
  });

  it("requests BOATS on split basis and emits only the requested ET wall-date overnight bars", async () => {
    let capturedUrl = "";
    let capturedHeaders = {};
    const history = new OvernightHistory({
      apiKey: "test-key",
      apiSecret: "test-secret",
      fetchImpl: async (url, opts) => {
        capturedUrl = String(url);
        capturedHeaders = opts.headers;
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              bars: {
                AAPL: [
                  // Oct 14 02:00 ET — accepted early-morning overnight.
                  { t: "2026-10-14T06:00:00Z", o: 100, h: 103, l: 99, c: 102, v: 10 },
                  // Oct 14 05:00 ET — premarket, rejected by this owner.
                  { t: "2026-10-14T09:00:00Z", o: 102, h: 104, l: 101, c: 103, v: 11 },
                  // Oct 14 20:30 ET — accepted evening overnight.
                  { t: "2026-10-15T00:30:00Z", o: 103, h: 106, l: 102, c: 105, v: 12 },
                  // Oct 15 00:30 ET — belongs to next wall date, rejected.
                  { t: "2026-10-15T04:30:00Z", o: 105, h: 107, l: 104, c: 106, v: 13 },
                ],
              },
            };
          },
        };
      },
    });

    const now = Date.UTC(2026, 9, 16, 12, 0, 0);
    const result = await history.getWallDate("AAPL", "1h", "2026-10-14", now);

    assert.equal(result.status, "available");
    assert.equal(result.source, "alpaca-boats");
    assert.deepEqual(result.bars, [
      [Date.UTC(2026, 9, 14, 2, 0) / 1000, 100, 103, 99, 102, 10],
      [Date.UTC(2026, 9, 14, 20, 30) / 1000, 103, 106, 102, 105, 12],
    ]);

    const url = new URL(capturedUrl);
    assert.equal(url.searchParams.get("symbols"), "AAPL");
    assert.equal(url.searchParams.get("timeframe"), "1Hour");
    assert.equal(url.searchParams.get("feed"), "boats");
    assert.equal(url.searchParams.get("adjustment"), "split");
    assert.equal(url.searchParams.get("sort"), "asc");
    assert.equal(url.searchParams.get("start"), "2026-10-14T04:00:00.000Z");
    assert.equal(url.searchParams.get("end"), "2026-10-15T04:00:00.000Z");
    assert.equal(capturedHeaders["APCA-API-KEY-ID"], "test-key");
    assert.equal(capturedHeaders["APCA-API-SECRET-KEY"], "test-secret");
  });

  it("caps current-date historical requests fifteen minutes behind now", async () => {
    let capturedUrl = "";
    const history = new OvernightHistory({
      apiKey: "key",
      apiSecret: "secret",
      fetchImpl: async (url) => {
        capturedUrl = String(url);
        return { ok: true, status: 200, async json() { return { bars: { AAPL: [] } }; } };
      },
    });
    // 2026-10-14 21:00 ET = 2026-10-15 01:00Z. Historical end must be 00:45Z.
    const now = Date.UTC(2026, 9, 15, 1, 0, 0);
    const result = await history.getWallDate("AAPL", "1h", "2026-10-14", now);
    assert.equal(result.status, "empty");
    assert.equal(new URL(capturedUrl).searchParams.get("end"), "2026-10-15T00:45:00.000Z");
  });

  it("caches the same wall-date request for sixty seconds", async () => {
    let calls = 0;
    const history = new OvernightHistory({
      apiKey: "key",
      apiSecret: "secret",
      fetchImpl: async () => {
        calls++;
        return { ok: true, status: 200, async json() { return { bars: { AAPL: [] } }; } };
      },
    });
    const now = Date.UTC(2026, 9, 16, 12, 0, 0);
    await history.getWallDate("AAPL", "1h", "2026-10-14", now);
    await history.getWallDate("AAPL", "1h", "2026-10-14", now + 30_000);
    assert.equal(calls, 1);
  });

  it("fails soft on upstream rejection and network failure", async () => {
    const rejected = new OvernightHistory({
      apiKey: "key",
      apiSecret: "secret",
      fetchImpl: async () => ({ ok: false, status: 403 }),
    });
    const a = await rejected.getWallDate("AAPL", "1h", "2026-10-14", Date.UTC(2026, 9, 16));
    assert.equal(a.status, "unavailable");
    assert.match(a.note, /403/);

    const broken = new OvernightHistory({
      apiKey: "key",
      apiSecret: "secret",
      fetchImpl: async () => { throw new Error("offline"); },
    });
    const b = await broken.getWallDate("AAPL", "1h", "2026-10-14", Date.UTC(2026, 9, 16));
    assert.equal(b.status, "unavailable");
    assert.match(b.note, /offline/);
  });
});
