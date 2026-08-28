// @vitest-environment jsdom
/**
 * dataCacheAbsenceTtl.test.ts — absence has BOUNDED validity (B5).
 *
 * The negative cache was a `Set` with a session lifetime: a URL that 404'd was never requested
 * again while the tab lived. That turned a temporary fact into a permanent one — the nightly
 * publisher would write `XYZ.intel.json`, the user would revisit XYZ in the same tab, and the
 * client would refuse to make the request. The only cure was closing the tab.
 *
 * Two properties have to hold together, and it is the pair that matters: a 404 must stay CHEAP
 * inside its window (that is why the cache exists at all), and it must EXPIRE so newly published
 * data is discoverable. A test that only proved one of them would pass for the broken version.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getJSON,
  getJSONResult,
  invalidate,
  loadCoverage,
  peek,
  _neg404Has,
  _absenceExpiry,
  _resetCoverage,
} from "../dataCache";

const ABSENCE_TTL = 10 * 60_000;
const COVERAGE_ABSENCE_TTL = 30 * 60_000;
const URL_A = "/data/XYZ.intel.json";

const okJson = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as unknown as Response;
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response;

/** Move the wall clock without touching promise scheduling. */
const START = new Date("2026-08-19T12:00:00Z").getTime();
const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

beforeEach(() => {
  invalidate();
  _resetCoverage();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(START));
});

afterEach(() => {
  vi.useRealTimers();
  invalidate();
  _resetCoverage();
  vi.restoreAllMocks();
});

describe("a runtime 404 is remembered — but only for a while", () => {
  it("suppresses repeat requests inside the window (the reason this cache exists)", async () => {
    const f = vi.fn(async () => notFound());
    vi.stubGlobal("fetch", f);

    expect(await getJSONResult(URL_A)).toMatchObject({ status: "absent" });
    for (let i = 0; i < 25; i += 1) await getJSON(URL_A);
    advance(ABSENCE_TTL - 1_000);
    await getJSON(URL_A);
    expect(f).toHaveBeenCalledTimes(1);          // 27 reads, ONE request
    expect(_neg404Has(URL_A)).toBe(true);
  });

  it("stamps an EXPIRY, not a permanent membership", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notFound()));
    expect(_absenceExpiry(URL_A)).toBeUndefined();
    await getJSON(URL_A);
    expect(_absenceExpiry(URL_A)).toBe(Date.now() + ABSENCE_TTL);
  });

  it("re-requests after the window and FINDS an artifact published in the meantime", async () => {
    let published = false;
    const f = vi.fn(async () => (published ? okJson({ symbol: "XYZ", published: true }) : notFound()));
    vi.stubGlobal("fetch", f);

    expect(await getJSON(URL_A)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);

    // the nightly writes the file; the tab is still open and never reloads
    published = true;
    await getJSON(URL_A);
    expect(f).toHaveBeenCalledTimes(1);          // still inside the window

    advance(ABSENCE_TTL + 1);
    expect(await getJSON(URL_A)).toEqual({ symbol: "XYZ", published: true });
    expect(f).toHaveBeenCalledTimes(2);
    expect(peek(URL_A)).toMatchObject({ published: true });
    expect(_neg404Has(URL_A)).toBe(false);
  });

  it("re-arms with a FRESH window when the artifact is still absent", async () => {
    const f = vi.fn(async () => notFound());
    vi.stubGlobal("fetch", f);

    await getJSON(URL_A);
    advance(ABSENCE_TTL + 1);
    await getJSON(URL_A);                        // second request, absence re-armed
    expect(f).toHaveBeenCalledTimes(2);
    advance(ABSENCE_TTL - 1_000);
    await getJSON(URL_A);
    expect(f).toHaveBeenCalledTimes(2);          // …and cheap again inside the new window
  });

  it("prefetch honours the same window, and the same expiry", async () => {
    const f = vi.fn(async () => notFound());
    vi.stubGlobal("fetch", f);
    await getJSON(URL_A);
    const { prefetch } = await import("../dataCache");
    prefetch(URL_A);
    prefetch(URL_A);
    expect(f).toHaveBeenCalledTimes(1);
    advance(ABSENCE_TTL + 1);
    prefetch(URL_A);
    await Promise.resolve();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("invalidate(url) drops the absence immediately — no waiting for the window", async () => {
    const f = vi.fn(async () => notFound());
    vi.stubGlobal("fetch", f);
    await getJSON(URL_A);
    invalidate(URL_A);
    expect(_neg404Has(URL_A)).toBe(false);
    await getJSON(URL_A);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("coverage.json pre-seeding — an index cannot outlive what it describes", () => {
  const SYMS = ["XYZ", "ABC"];
  const coverageDoc = (over: Record<string, unknown> = {}) => ({
    as_of: new Date().toISOString(),
    generation: Math.floor(Date.now() / 1000),
    intel: [], fund: [], opts: [], ohlc: SYMS,
    ...over,
  });

  it("seeds a BOUNDED absence for every uncovered symbol, not a permanent one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson(coverageDoc())));
    loadCoverage(SYMS);
    await vi.waitFor(() => expect(_neg404Has("/data/XYZ.intel.json")).toBe(true));

    // vi.waitFor nudges the faked clock while polling, so compare against a tight band rather
    // than an exact instant. The point is the WINDOW, not the millisecond.
    const expiry = _absenceExpiry("/data/XYZ.intel.json")!;
    expect(expiry).toBeLessThanOrEqual(Date.now() + COVERAGE_ABSENCE_TTL);
    expect(expiry).toBeGreaterThan(Date.now() + COVERAGE_ABSENCE_TTL - 5_000);
    expect(_neg404Has("/data/ABC.fund.json")).toBe(true);
    expect(_neg404Has("/data/ABC.opts.json")).toBe(true);
  });

  it("costs ZERO requests for an uncovered artifact inside the window", async () => {
    const f = vi.fn(async () => okJson(coverageDoc()));
    vi.stubGlobal("fetch", f);
    loadCoverage(SYMS);
    await vi.waitFor(() => expect(_neg404Has("/data/XYZ.intel.json")).toBe(true));
    f.mockClear();

    for (let i = 0; i < 10; i += 1) expect(await getJSON("/data/XYZ.intel.json")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("expires, so an artifact published after the index is generated is still found", async () => {
    const f = vi.fn(async () => okJson(coverageDoc()));
    vi.stubGlobal("fetch", f);
    loadCoverage(SYMS);
    await vi.waitFor(() => expect(_neg404Has("/data/XYZ.intel.json")).toBe(true));

    // the publisher writes the artifact the index says does not exist
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ symbol: "XYZ", published: true })));
    expect(await getJSON("/data/XYZ.intel.json")).toBeNull();      // inside the window

    advance(COVERAGE_ABSENCE_TTL + 1);
    expect(await getJSON("/data/XYZ.intel.json")).toEqual({ symbol: "XYZ", published: true });
  });

  it("refuses to pre-seed at all from an index older than the trust window", async () => {
    const stale = new Date(Date.now() - 37 * 60 * 60 * 1000).toISOString();
    vi.stubGlobal("fetch", vi.fn(async () => okJson(coverageDoc({ as_of: stale }))));
    loadCoverage(SYMS);
    await new Promise((resolve) => setTimeout(resolve, 20));   // let the fetch chain settle
    expect(_neg404Has("/data/XYZ.intel.json")).toBe(false);
  });

  it("pre-seeds from an index that is old but still inside the trust window", async () => {
    const recent = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    vi.stubGlobal("fetch", vi.fn(async () => okJson(coverageDoc({ as_of: recent }))));
    loadCoverage(SYMS);
    await vi.waitFor(() => expect(_neg404Has("/data/XYZ.intel.json")).toBe(true));
  });

  it("a covered symbol is never suppressed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson(coverageDoc({ intel: ["XYZ"] }))));
    loadCoverage(SYMS);
    await vi.waitFor(() => expect(_neg404Has("/data/ABC.intel.json")).toBe(true));
    expect(_neg404Has("/data/XYZ.intel.json")).toBe(false);
  });
});
