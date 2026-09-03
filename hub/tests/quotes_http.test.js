"use strict";
// Endpoint-level coverage for GET /quotes?view=… (Reactive Projection R1A-T, spec §5.5).
//
// MANDATORY, not optional: `handleQuotesRequest` in lib/quotes.js is the exact function
// hub.js's real handleQuotes(res, url) calls — it is not a parallel test-only
// reimplementation. hub.js itself can never be `require()`d by a test (it boots an HTTP
// server and every feed timer at require time — see the header comment in lib/quotes.js
// and hub.js), so this file drives the same wiring hub.js runs through the one seam that
// makes it possible to unit-test: `handleQuotesRequest(searchParams, nowMs, deps, maxSyms)`.
//
// This is what catches a mutation to the DISPATCH layer that a pure parseQuoteView /
// applyDemand / buildQuotesResponse unit test cannot — e.g. "unknown view silently
// defaults to full" or "default view becomes regular" are bugs in how handleQuotesRequest
// wires those three functions together, not in the functions themselves.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { handleQuotesRequest } = require("../lib/quotes");
const { Store } = require("../lib/store");

const NOW = Date.UTC(2026, 6, 27, 14, 0, 0);
const TS = Math.floor(NOW / 1000);

function url(qs) {
  return new URL(`http://127.0.0.1:3100/quotes${qs}`).searchParams;
}

function extDemandSpyDeps() {
  const store = new Store("/dev/null/manifest.json");
  store.quotes.set("AAPL", {
    sym: "AAPL", last: 200, chg: 1.0101, prevClose: 198,
    ts: TS, live: true, source: "polygon-live", market: "us", basis: "LIVE",
  });
  store.quotes.set("NVDA", {
    sym: "NVDA", last: 900, chg: 2.0, prevClose: 882.35,
    ts: TS, live: true, source: "polygon-live", market: "us", basis: "LIVE",
  });
  const extDemandCalls = [];
  return {
    extDemandCalls,
    deps: {
      store,
      snapshotFeed: { demand: () => {}, get: () => null, getCompleted: () => null },
      polygon: { isHealthy: () => true, ensureSubscribed: () => {} },
      anchorCache: { resolve: async () => {} },
      extFeed: {
        demand: (s) => extDemandCalls.push(s),
        getExt: () => null,
      },
    },
  };
}

describe("handleQuotesRequest — endpoint-level view=full|regular dispatch", () => {
  it("?view=regular produces zero extFeed.demand calls", () => {
    const { extDemandCalls, deps } = extDemandSpyDeps();
    const { status, body } = handleQuotesRequest(url("?syms=AAPL,NVDA&view=regular"), NOW, deps);
    assert.equal(status, 200);
    assert.deepEqual(extDemandCalls, []);
    assert.deepEqual(Object.keys(body).sort(), ["AAPL", "NVDA"]);
    for (const sym of Object.keys(body)) {
      assert.equal(
        Object.keys(body[sym]).some((k) => k.startsWith("ext")),
        false,
        `${sym} must carry no ext* field under view=regular`
      );
    }
  });

  it("?view=full produces extFeed.demand calls", () => {
    const { extDemandCalls, deps } = extDemandSpyDeps();
    const { status } = handleQuotesRequest(url("?syms=AAPL,NVDA&view=full"), NOW, deps);
    assert.equal(status, 200);
    assert.deepEqual(extDemandCalls, ["AAPL", "NVDA"]);
  });

  it("a missing view still produces extFeed.demand calls (missing view is exactly full)", () => {
    const { extDemandCalls, deps } = extDemandSpyDeps();
    const { status } = handleQuotesRequest(url("?syms=AAPL,NVDA"), NOW, deps);
    assert.equal(status, 200);
    assert.deepEqual(extDemandCalls, ["AAPL", "NVDA"]);
  });

  it("an unknown view returns 400 and demands nothing", () => {
    const { extDemandCalls, deps } = extDemandSpyDeps();
    const { status, body } = handleQuotesRequest(url("?syms=AAPL,NVDA&view=all"), NOW, deps);
    assert.equal(status, 400);
    assert.equal(typeof body.error, "string");
    assert.deepEqual(extDemandCalls, [], "an invalid view must reach no feed at all");
  });

  it("?syms=&view=bogus is 400, not an empty 200 — view is validated before the empty-syms return", () => {
    const { deps } = extDemandSpyDeps();
    const { status, body } = handleQuotesRequest(url("?syms=&view=bogus"), NOW, deps);
    assert.equal(status, 400);
    assert.notDeepEqual(body, {}, "must be the 400 error body, not an empty 200 body");
  });

  it("repeated/conflicting view values are 400", () => {
    const { deps } = extDemandSpyDeps();
    for (const qs of ["?syms=AAPL&view=full&view=regular", "?syms=AAPL&view=regular&view=regular"]) {
      const { status } = handleQuotesRequest(url(qs), NOW, deps);
      assert.equal(status, 400, qs);
    }
  });

  it("an empty syms list with a valid view is an empty 200", () => {
    const { deps } = extDemandSpyDeps();
    const { status, body } = handleQuotesRequest(url("?syms=&view=regular"), NOW, deps);
    assert.equal(status, 200);
    assert.deepEqual(body, {});
  });

  it("truncates to maxSyms, matching hub.js's MAX_SYMS_PER_REQUEST behavior", () => {
    const { deps } = extDemandSpyDeps();
    const { status, body } = handleQuotesRequest(url("?syms=AAPL,NVDA&view=regular"), NOW, deps, 1);
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body), ["AAPL"]);
  });
});
