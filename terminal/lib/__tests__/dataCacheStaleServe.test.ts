/**
 * dataCacheStaleServe.test.ts — a stale serve SAYS it is stale, and says how its refresh ended.
 *
 * `getJSONResult` answers a stale-while-revalidate read with the copy it already holds and
 * refreshes it in the background. On a full memory miss that copy is the IndexedDB record of an
 * earlier session, so on a fresh page EVERY manifest read is such a serve. When the refresh fails
 * the cache evicts memory but keeps the disk record, and the next read is answered with the same
 * old copy again — so a consumer that only sees `{status:"data"}` can never tell the user the
 * numbers are a previous session's (HeatmapView's "Could not refresh — showing the last read.").
 *
 * The contract pinned here: a stale serve carries `stale: { ageMs, source, revalidation }`, where
 * `revalidation` settles "ok" | "failed" | "superseded" once the background read does, and a
 * fresh serve stays exactly `{status:"data", data}`. Runs the REAL dataCache + idbJsonStore over
 * an in-memory IndexedDB (./helpers/fakeIndexedDB) and a stubbed fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeIndexedDB } from "./helpers/fakeIndexedDB";

async function freshModules() {
  vi.resetModules();
  const idb = await import("../idbJsonStore");
  const dc = await import("../dataCache");
  return { idb, dc };
}

const URL_ = "/data/manifest.json";
const OLD = { as_of: "2026-10-07", symbols: { AAPL: { last: 229.1 } } };
const NEW = { as_of: "2026-10-08", symbols: { AAPL: { last: 231.4 } } };
const SIX_HOURS = 6 * 60 * 60_000;

type Reply = { status: number; body: string } | "reject" | "pending";
const json = (status: number, body: unknown): Reply => ({ status, body: JSON.stringify(body) });
let reply: Reply;
let releasePending: (() => void) | null;
const fetchMock = vi.fn(async (): Promise<Response> => {
  if (reply === "reject") throw new TypeError("Failed to fetch");
  if (reply === "pending") {
    // Held until the test releases it, then answers 503.
    await new Promise<void>((resolve) => { releasePending = resolve; });
    return new Response("{}", { status: 503 });
  }
  return new Response(reply.body, { status: reply.status });
});

beforeEach(() => {
  vi.stubGlobal("indexedDB", makeFakeIndexedDB());
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  releasePending = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const REFRESH_FAILURES: [string, Reply][] = [
  ["a 5xx", json(503, { error: "unavailable" })],
  ["a rejected fetch", "reject"],
  ["an unparseable 200", { status: 200, body: "<html>edge error</html>" }],
  ["a 404", json(404, { error: "gone" })],
];

describe("getJSONResult — a stale serve from the persisted copy", () => {
  it.each(REFRESH_FAILURES)("reports a refresh that ends in %s as failed, without dropping the disk record", async (_label, failure) => {
    const { idb, dc } = await freshModules();
    const persistedAt = Date.now() - SIX_HOURS;
    await idb.idbPut(URL_, OLD, persistedAt);
    reply = failure;

    const out = await dc.getJSONResult(URL_);
    expect(out.status).toBe("data");
    if (out.status !== "data") return;
    expect(out.data).toEqual(OLD);
    expect(out.stale).toBeDefined();
    expect(out.stale!.source).toBe("disk");
    expect(out.stale!.ageMs).toBeGreaterThanOrEqual(SIX_HOURS);
    expect(out.stale!.ageMs).toBeLessThan(SIX_HOURS + 60_000);
    await expect(out.stale!.revalidation).resolves.toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Memory was released; the disk record was not — the next read meets the same copy.
    expect(dc.peek(URL_)).toBeUndefined();
    expect((await idb.idbGet(URL_))?.data).toEqual(OLD);
  });

  it("says so again on the next read, which the same disk copy answers", async () => {
    const { idb, dc } = await freshModules();
    await idb.idbPut(URL_, OLD, Date.now() - SIX_HOURS);
    reply = json(503, {});
    const first = await dc.getJSONResult(URL_);
    if (first.status !== "data") throw new Error("expected data");
    await expect(first.stale!.revalidation).resolves.toBe("failed");

    const second = await dc.getJSONResult(URL_);
    if (second.status !== "data") throw new Error("expected data");
    expect(second.data).toEqual(OLD);
    expect(second.stale?.source).toBe("disk");
    await expect(second.stale!.revalidation).resolves.toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a refresh that answers data as ok, and still hands it to onRevalidate", async () => {
    const { idb, dc } = await freshModules();
    await idb.idbPut(URL_, OLD, Date.now() - SIX_HOURS);
    reply = json(200, NEW);
    const onRevalidate = vi.fn();
    const out = await dc.getJSONResult(URL_, { onRevalidate });
    if (out.status !== "data") throw new Error("expected data");
    expect(out.data).toEqual(OLD);
    await expect(out.stale!.revalidation).resolves.toBe("ok");
    expect(onRevalidate).toHaveBeenCalledTimes(1);
    expect(onRevalidate).toHaveBeenCalledWith(NEW);
    expect(dc.peek(URL_)).toEqual(NEW);
  });

  it("reports a refresh discarded by an invalidation as superseded, not failed", async () => {
    const { idb, dc } = await freshModules();
    await idb.idbPut(URL_, OLD, Date.now() - SIX_HOURS);
    reply = "pending";
    const onRevalidate = vi.fn();
    const out = await dc.getJSONResult(URL_, { onRevalidate });
    if (out.status !== "data") throw new Error("expected data");
    await vi.waitFor(() => expect(releasePending).not.toBeNull());
    dc.invalidate(URL_);
    releasePending!();
    await expect(out.stale!.revalidation).resolves.toBe("superseded");
    expect(onRevalidate).not.toHaveBeenCalled();
  });

  it("is a plain data outcome when the disk copy is still fresh (no refresh, no stale field)", async () => {
    const { idb, dc } = await freshModules();
    await idb.idbPut(URL_, OLD, Date.now() - 5_000);
    reply = json(503, {});
    const out = await dc.getJSONResult(URL_);
    expect(out).toStrictEqual({ status: "data", data: OLD });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getJSONResult — a read that joins the background refresh of a stale copy", () => {
  // Two readers of one key on a fresh page (two mounted surfaces, or React's development double
  // mount): the first is served the disk copy and starts the refresh, the second meets that
  // refresh in flight. When the refresh fails, the second must not be told the artifact is
  // unreachable while the first is painting the same last read.
  it.each([
    ["a 5xx", json(503, {})],
    ["a rejected fetch", "reject" as Reply],
  ])("is answered with the copy being refreshed, labelled failed, when the refresh fails with %s", async (_label, failure) => {
    const { idb, dc } = await freshModules();
    await idb.idbPut(URL_, OLD, Date.now() - SIX_HOURS);
    reply = failure;
    const [first, second] = await Promise.all([dc.getJSONResult(URL_), dc.getJSONResult(URL_)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (first.status !== "data" || second.status !== "data") throw new Error(`expected data, got ${second.status}`);
    expect(first.stale?.source).toBe("disk");
    expect(second.data).toEqual(OLD);
    expect(second.stale).toBeDefined();
    expect(second.stale!.ageMs).toBeGreaterThanOrEqual(SIX_HOURS);
    await expect(first.stale!.revalidation).resolves.toBe("failed");
    await expect(second.stale!.revalidation).resolves.toBe("failed");
  });

  it("joins a stale MEMORY copy's refresh the same way", async () => {
    const { dc } = await freshModules();
    reply = json(200, OLD);
    await dc.getJSONResult(URL_);
    reply = "reject";
    const first = await dc.getJSONResult(URL_, { ttl: 0 });
    const second = await dc.getJSONResult(URL_, { ttl: 0 });
    if (first.status !== "data" || second.status !== "data") throw new Error("expected data");
    expect(second.data).toEqual(OLD);
    await expect(second.stale!.revalidation).resolves.toBe("failed");
  });

  it("still receives the refreshed data when the refresh succeeds", async () => {
    const { idb, dc } = await freshModules();
    await idb.idbPut(URL_, OLD, Date.now() - SIX_HOURS);
    reply = json(200, NEW);
    const [first, second] = await Promise.all([dc.getJSONResult(URL_), dc.getJSONResult(URL_)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ status: "data", data: OLD });
    expect(second).toStrictEqual({ status: "data", data: NEW });
  });

  it("still receives the proven absence when the refresh answers 404", async () => {
    const { idb, dc } = await freshModules();
    await idb.idbPut(URL_, OLD, Date.now() - SIX_HOURS);
    reply = json(404, {});
    const [, second] = await Promise.all([dc.getJSONResult(URL_), dc.getJSONResult(URL_)]);
    expect(second).toEqual({ status: "absent", httpStatus: 404 });
  });

  it("is not handed an invalidated copy: a refresh discarded by invalidate() passes its outcome through", async () => {
    const { idb, dc } = await freshModules();
    await idb.idbPut(URL_, OLD, Date.now() - SIX_HOURS);
    reply = "pending";
    const first = await dc.getJSONResult(URL_);
    const joined = dc.getJSONResult(URL_);
    await vi.waitFor(() => expect(releasePending).not.toBeNull());
    dc.invalidate(URL_);
    releasePending!();
    if (first.status !== "data") throw new Error("expected data");
    await expect(first.stale!.revalidation).resolves.toBe("superseded");
    expect(await joined).toEqual({ status: "unavailable", reason: "server", httpStatus: 503 });
  });

  it("does not hand a stale copy to a caller that opted out of stale serves (swr: false)", async () => {
    const { idb, dc } = await freshModules();
    await idb.idbPut(URL_, OLD, Date.now() - SIX_HOURS);
    reply = json(503, {});
    const [, strict] = await Promise.all([dc.getJSONResult(URL_), dc.getJSONResult(URL_, { swr: false })]);
    expect(strict).toEqual({ status: "unavailable", reason: "server", httpStatus: 503 });
  });

  it("a read joining a first (blocking) fetch is unchanged: no copy exists to fall back to", async () => {
    const { dc } = await freshModules();
    reply = json(503, {});
    const [a, b] = await Promise.all([dc.getJSONResult(URL_), dc.getJSONResult(URL_)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ status: "unavailable", reason: "server", httpStatus: 503 });
    expect(b).toEqual(a);
  });
});

describe("getJSONResult — a stale serve from memory", () => {
  it("carries source 'memory' and reports a failed refresh", async () => {
    const { dc } = await freshModules();
    reply = json(200, OLD);
    const first = await dc.getJSONResult(URL_);
    // The live read the caller awaited is current by definition.
    expect(first).toStrictEqual({ status: "data", data: OLD });

    reply = json(503, {});
    const out = await dc.getJSONResult(URL_, { ttl: 0 });
    if (out.status !== "data") throw new Error("expected data");
    expect(out.data).toEqual(OLD);
    expect(out.stale?.source).toBe("memory");
    expect(out.stale!.ageMs).toBeGreaterThanOrEqual(0);
    await expect(out.stale!.revalidation).resolves.toBe("failed");
  });

  it("a fresh memory hit stays exactly {status, data}", async () => {
    const { dc } = await freshModules();
    reply = json(200, NEW);
    await dc.getJSONResult(URL_);
    expect(await dc.getJSONResult(URL_)).toStrictEqual({ status: "data", data: NEW });
  });

  it("getJSON is unchanged: a stale serve is still just the data", async () => {
    const { idb, dc } = await freshModules();
    await idb.idbPut(URL_, OLD, Date.now() - SIX_HOURS);
    reply = json(503, {});
    expect(await dc.getJSON(URL_)).toEqual(OLD);
  });
});
