/**
 * dataCacheAvailability.test.ts — the DISCRIMINATING availability contract (B1).
 *
 * These tests inject the REAL failure mechanism (a stubbed `fetch` that throws, 500s, 404s, or
 * returns an unparseable body) and assert what `getJSONResult` reports back. They are the fence
 * around the bug that shipped: `dataCache` never rejects and answers `null` for every failure,
 * so a consumer's `.then(d => { if (d) render(d) })` silently did nothing on an outage and its
 * `.catch` was unreachable — the Screener's skeleton spun forever with no reachable Retry.
 *
 * `getJSON` must keep its data-or-null shape; every existing consumer depends on it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getJSON, getJSONResult, invalidate, _neg404Has, peek } from "../dataCache";

const URL_A = "/data/manifest.json";

/** Response stand-ins — only what dataCache touches (ok/status/json). */
const okJson = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as unknown as Response;
const httpErr = (status: number) =>
  ({ ok: false, status, json: async () => ({}) }) as unknown as Response;
const okUnparseable = () =>
  ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token < in JSON"); } }) as unknown as Response;

beforeEach(() => {
  invalidate();               // clears the memory store AND the in-session 404 cache
  vi.restoreAllMocks();
});

afterEach(() => {
  invalidate();
  vi.restoreAllMocks();
});

describe("getJSONResult — a failure is a fact, not a silent null", () => {
  it("reports `unavailable/network` when the transport throws (offline, DNS, aborted)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const res = await getJSONResult(URL_A);
    expect(res).toEqual({ status: "unavailable", reason: "network" });
    // A transport failure says NOTHING about existence — it must never be remembered as absence.
    expect(_neg404Has(URL_A)).toBe(false);
  });

  it("reports `unavailable/server` with the code on a 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => httpErr(500)));
    expect(await getJSONResult(URL_A)).toEqual({ status: "unavailable", reason: "server", httpStatus: 500 });
    expect(_neg404Has(URL_A)).toBe(false);
  });

  it("reports `unavailable/server` on 429 and 403 — neither proves the artifact is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => httpErr(429)));
    expect(await getJSONResult(URL_A)).toMatchObject({ status: "unavailable", reason: "server", httpStatus: 429 });
    invalidate();
    vi.stubGlobal("fetch", vi.fn(async () => httpErr(403)));
    expect(await getJSONResult(URL_A)).toMatchObject({ status: "unavailable", reason: "server", httpStatus: 403 });
  });

  it("reports `unavailable/malformed` when a 200 body will not parse as JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okUnparseable()));
    expect(await getJSONResult(URL_A)).toEqual({ status: "unavailable", reason: "malformed", httpStatus: 200 });
    expect(_neg404Has(URL_A)).toBe(false);
  });

  it("reports `unavailable/malformed` for a literal `null` body (parseable, but not data)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson(null)));
    expect(await getJSONResult(URL_A)).toMatchObject({ status: "unavailable", reason: "malformed" });
  });

  it("reports `absent` — and only `absent` — for 404 and 410", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => httpErr(404)));
    expect(await getJSONResult(URL_A)).toEqual({ status: "absent", httpStatus: 404 });
    expect(_neg404Has(URL_A)).toBe(true);

    invalidate();
    vi.stubGlobal("fetch", vi.fn(async () => httpErr(410)));
    expect(await getJSONResult(URL_A)).toEqual({ status: "absent", httpStatus: 410 });
  });

  it("serves the remembered 404 as `absent` without a second request", async () => {
    const f = vi.fn(async () => httpErr(404));
    vi.stubGlobal("fetch", f);
    await getJSONResult(URL_A);
    expect(await getJSONResult(URL_A)).toEqual({ status: "absent" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("reports `data` on success and caches it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ as_of: "2026-08-19", symbols: { NVDA: {} } })));
    const res = await getJSONResult(URL_A);
    expect(res.status).toBe("data");
    expect(res.status === "data" && res.data.as_of).toBe("2026-08-19");
    expect(peek(URL_A)).toMatchObject({ as_of: "2026-08-19" });
  });
});

describe("recovery — a failed read must be retryable", () => {
  it("re-requests after a network failure and succeeds on the retry (nothing is pinned)", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError("Failed to fetch");
      return okJson({ symbols: { AAPL: {} } });
    }));

    expect(await getJSONResult(URL_A)).toMatchObject({ status: "unavailable" });
    // No invalidate() needed: a transient failure evicts the key, so the next call goes out.
    expect(await getJSONResult(URL_A)).toMatchObject({ status: "data" });
    expect(attempt).toBe(2);
  });

  it("re-requests after a 500 and succeeds on the retry", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++attempt === 1 ? httpErr(500) : okJson({ symbols: {} }))));
    expect(await getJSONResult(URL_A)).toMatchObject({ status: "unavailable", httpStatus: 500 });
    expect(await getJSONResult(URL_A)).toMatchObject({ status: "data" });
  });

  it("a 404 needs an explicit invalidate() — which is exactly what the Retry button calls", async () => {
    let attempt = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++attempt === 1 ? httpErr(404) : okJson({ symbols: {} }))));
    expect(await getJSONResult(URL_A)).toMatchObject({ status: "absent" });
    expect(await getJSONResult(URL_A)).toMatchObject({ status: "absent" });
    expect(attempt).toBe(1);                       // remembered, not re-requested

    invalidate(URL_A);                             // Retry clears the negative cache
    expect(await getJSONResult(URL_A)).toMatchObject({ status: "data" });
    expect(attempt).toBe(2);
  });
});

describe("getJSON — unchanged data-or-null shape for every existing consumer", () => {
  it("answers null for network failure, 5xx, malformed and 404 alike", async () => {
    for (const stub of [
      async () => { throw new TypeError("Failed to fetch"); },
      async () => httpErr(500),
      async () => okUnparseable(),
      async () => httpErr(404),
    ]) {
      invalidate();
      vi.stubGlobal("fetch", vi.fn(stub));
      expect(await getJSON(URL_A)).toBeNull();
    }
  });

  it("answers the payload on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ symbols: { MSFT: {} } })));
    expect(await getJSON(URL_A)).toEqual({ symbols: { MSFT: {} } });
  });

  it("never rejects — the reason a consumer's .catch() can never be the error path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(getJSON(URL_A)).resolves.toBeNull();
    invalidate();
    await expect(getJSONResult(URL_A)).resolves.toMatchObject({ status: "unavailable" });
  });
});

describe("stale-while-revalidate keeps the last good answer", () => {
  it("serves cached data as `data`, and a FAILED background revalidation does not erase it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ symbols: { NVDA: {} }, v: 1 })));
    expect(await getJSONResult(URL_A, { ttl: 0 })).toMatchObject({ status: "data" });

    // Expire it (ttl 0 → every subsequent read is a stale serve + background revalidate).
    const onRevalidate = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => httpErr(503)));
    const staleServe = await getJSONResult(URL_A, { ttl: 0, onRevalidate });
    expect(staleServe).toMatchObject({ status: "data" });

    await new Promise((r) => setTimeout(r, 0));    // let the background fetch settle
    expect(onRevalidate).not.toHaveBeenCalled();   // it only ever fires with real data
  });

  it("hands the corrected payload to onRevalidate when the revalidation succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ symbols: {}, v: 1 })));
    await getJSONResult(URL_A, { ttl: 0 });

    const onRevalidate = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ symbols: {}, v: 2 })));
    expect(await getJSONResult(URL_A, { ttl: 0, onRevalidate })).toMatchObject({ status: "data", data: { symbols: {}, v: 1 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(onRevalidate).toHaveBeenCalledWith({ symbols: {}, v: 2 });
  });
});
