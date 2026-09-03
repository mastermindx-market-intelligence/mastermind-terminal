"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { OKX, parseInst, parseOkxTicker, toSpotInst, toSwapInst } = require("../lib/okx");

test("OKX instrument mapping covers spot and perpetual lanes", () => {
  assert.equal(toSpotInst("BTC-USD"), "BTC-USDT");
  assert.equal(toSwapInst("BTC-USD"), "BTC-USDT-SWAP");
  assert.deepEqual(parseInst("BTC-USDT"), { sym: "BTC-USD", lane: "spot" });
  assert.deepEqual(parseInst("BTC-USDT-SWAP"), { sym: "BTC-USD", lane: "perp" });
  assert.equal(parseInst("BTC-USD"), null);
});

test("OKX spot uses UTC-0 open for the canonical day change", () => {
  const quote = parseOkxTicker({
    instId: "BTC-USDT",
    last: "77496.1",
    open24h: "76052.1",
    sodUtc0: "77742.9",
    high24h: "78100.0",
    low24h: "75200.0",
    vol24h: "123.4",
    ts: "1787600000123",
  });

  assert.equal(quote.lane, "spot");
  assert.equal(quote.sym, "BTC-USD");
  assert.equal(quote.prevClose, 77742.9);
  assert.equal(quote.open, 77742.9);
  assert.equal(quote.changeBasis, "UTC_0");
  assert.ok(Math.abs(quote.chg - ((77496.1 - 77742.9) / 77742.9) * 100) < 1e-12);
  assert.equal(quote.source, "okx-spot");
});

test("OKX swap is supplemental and preserves its own UTC-0 change", () => {
  const quote = parseOkxTicker({
    instId: "ETH-USDT-SWAP",
    last: "2456.55",
    open24h: "2388.01",
    sodUtc0: "2462.66",
    high24h: "2500.0",
    low24h: "2350.0",
    vol24h: "456.7",
    ts: "1787600000123",
  });

  assert.equal(quote.lane, "perp");
  assert.equal(quote.sym, "ETH-USD");
  assert.equal(quote.perpLast, 2456.55);
  assert.equal(quote.perpPrevClose, 2462.66);
  assert.ok(Math.abs(quote.perpChg - ((2456.55 - 2462.66) / 2462.66) * 100) < 1e-12);
  assert.equal(quote.perpChangeBasis, "UTC_0");
  assert.equal(quote.perpSource, "okx-swap");
  assert.equal(quote.last, undefined);
  assert.equal(quote.prevClose, undefined);
});

test("OKX subscribes to both lanes for every manifest crypto product", () => {
  const okx = new OKX({ manifest: { syms: new Set(["BTC-USD", "ETH-USD", "AAPL"]) } }, { cryptoPrimary: "okx" });
  assert.deepEqual(okx._instIds(), ["BTC-USDT", "BTC-USDT-SWAP", "ETH-USDT", "ETH-USDT-SWAP"]);
});
