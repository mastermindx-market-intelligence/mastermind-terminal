"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildLiquidityTiles } = require("../lib/futuresMbo");
const base = 1791568800000000000n;
const ns = n => String(base + BigInt(n));
const identity = { contract: "ESZ6", publisherId: 1, instrumentId: 42, sessionId: "2026-10-09" };
const sample = (time, size) => ({ availableAtNs: ns(time), view: {
  status: "ok", ...identity, coverage: "full_order_book", liquidityScope: "displayed_orders_excludes_implied",
  availableAtNs: ns(time), receiveTimeNs: ns(time), bids: [{ priceTicks: 30000, size, orderCount: 1 }], asks: [],
} });
const options = duration => ({ ...identity, startNs: ns(0), endNs: ns(duration), decisionTimeNs: ns(duration),
  intervalNs: String(duration), maxAgeNs: String(duration), lowTick: 30000, highTick: 30000 });
test("review counterexample: 0xffffffff contracts for four seconds yields that exact mean", () => {
  const size = 0xffffffff, duration = 4000000000n;
  const weight = BigInt(size) * duration;
  assert.ok(weight > BigInt(Number.MAX_SAFE_INTEGER));
  const result = buildLiquidityTiles([sample(0, size)], options(duration));
  assert.equal(result.status, "ok"); assert.equal(result.columns[0].coverage, "full");
  assert.equal(result.columns[0].levels[0].bidMean, size);
  assert.equal(result.columns[0].levels[0].askMean, 0);
});
test("fractional time-weighted liquidity is not truncated with BigInt integer division", () => {
  const result = buildLiquidityTiles([sample(0, 1), sample(1000000000n, 2)], options(4000000000n));
  assert.equal(result.status, "ok"); assert.equal(result.columns[0].levels[0].bidMean, 1.75);
  assert.notEqual(result.columns[0].levels[0].bidMean, Number(7000000000n / 4000000000n));
});
test("mean has ordinary floating precision, not a large-factor error across bounded inputs", () => {
  for (const size of [1, 123, 0xffffffff, Number.MAX_SAFE_INTEGER]) {
    for (const duration of [7n, 4000000000n, 900000000000n]) {
      const result = buildLiquidityTiles([sample(0, size)], options(duration));
      assert.equal(result.status, "ok");
      const mean = result.columns[0].levels[0].bidMean;
      assert.ok(Number.isFinite(mean));
      assert.ok(Math.abs(mean - size) <= Math.max(1, size) * Number.EPSILON * 2);
    }
  }
});
