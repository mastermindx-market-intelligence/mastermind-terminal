import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeFakeIndexedDB } from "./helpers/fakeIndexedDB";

const url = "/data/manifest.json";
const old = { as_of: "2026-10-12", symbols: { IWCACHE: { last: 111 } } };
const fresh = { as_of: "2026-10-14", symbols: { IWFRESH: { last: 222 } } };
const invalid = [[], { symbols: [] }, {}, { symbols: null }, { symbols: "bad" }];
let fetcher: ReturnType<typeof vi.fn>;
async function modules() {
  vi.resetModules();
  return { dc: await import("../dataCache"), idb: await import("../idbJsonStore") };
}
beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("indexedDB", makeFakeIndexedDB());
  fetcher = vi.fn(async () => new Response(JSON.stringify(fresh), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(invalid.map(body => [body]))("rejects an unusable manifest before cold memory or disk commit: %j", async body => {
  const { dc, idb } = await modules();
  fetcher.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  expect(await dc.getJSONResult(url)).toMatchObject({ status: "unavailable", reason: "malformed" });
  expect(dc.peek(url)).toBeUndefined();
  expect(await idb.idbGet(url)).toBeNull();
});

it.each(invalid.map(body => [body]))("retains exact old data and timestamp after an unusable refresh: %j", async body => {
  const { dc, idb } = await modules();
  const ts = Date.now() - 3600000;
  await idb.idbPut(url, old, ts);
  fetcher.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  const callback = vi.fn();
  const first = await dc.getJSONResult(url, { onRevalidate: callback });
  if (first.status !== "data") throw new Error("expected cached data");
  expect(first.data).toEqual(old);
  await expect(first.stale?.revalidation).resolves.toBe("failed");
  expect(callback).not.toHaveBeenCalled();
  expect(dc.peek(url)).toBeUndefined();
  expect(await idb.idbGet(url)).toMatchObject({ data: old, ts });
  const reopened = await modules();
  fetcher.mockResolvedValue(new Response("{}", { status: 503 }));
  const second = await reopened.dc.getJSONResult(url);
  expect(second).toMatchObject({ status: "data", data: old, stale: { source: "disk" } });
  if (second.status === "data") await expect(second.stale?.revalidation).resolves.toBe("failed");
});

it("accepts an empty symbol map and thin rows without imposing a new schema", async () => {
  const { dc, idb } = await modules();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ symbols: {} })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ symbols: { AAPL: {} } })));
  expect(await dc.getJSONResult(url)).toEqual({ status: "data", data: { symbols: {} } });
  await vi.waitFor(async () => expect((await idb.idbGet(url))?.data).toEqual({ symbols: {} }));
  dc.invalidate(url);
  expect(await dc.getJSONResult(url)).toEqual({ status: "data", data: { symbols: { AAPL: {} } } });
});

it("does not impose the scan manifest contract on another endpoint", async () => {
  const { dc, idb } = await modules();
  const other = "/data/intel/manifest.json";
  fetcher.mockResolvedValue(new Response(JSON.stringify({ symbols: [] })));
  expect(await dc.getJSONResult(other)).toEqual({ status: "data", data: { symbols: [] } });
  await vi.waitFor(async () => expect((await idb.idbGet(other))?.data).toEqual({ symbols: [] }));
});

it.each([0, 3600000])("does not serve an already invalid persisted record aged %i", async age => {
  const { dc, idb } = await modules();
  await idb.idbPut(url, { symbols: [] }, Date.now() - age);
  expect(await dc.getJSONResult(url)).toEqual({ status: "data", data: fresh });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.waitFor(async () => expect((await idb.idbGet(url))?.data).toEqual(fresh));
});

it("an already invalid disk record plus transport failure stays unavailable", async () => {
  const { dc, idb } = await modules();
  await idb.idbPut(url, { symbols: [] }, Date.now());
  fetcher.mockResolvedValue(new Response("{}", { status: 503 }));
  expect(await dc.getJSONResult(url)).toMatchObject({ status: "unavailable", reason: "server" });
  expect(dc.peek(url)).toBeUndefined();
});

it("prefetch cannot seed an invalid disk record or commit an invalid network answer", async () => {
  const { dc, idb } = await modules();
  await idb.idbPut(url, { symbols: [] }, Date.now());
  fetcher.mockResolvedValue(new Response(JSON.stringify({ symbols: [] })));
  dc.prefetch(url);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(dc.peek(url)).toBeUndefined());
  fetcher.mockResolvedValue(new Response(JSON.stringify(fresh)));
  expect(await dc.getJSONResult(url)).toEqual({ status: "data", data: fresh });
});

it("a prefetch that owns the shared request cannot bypass validation for a joining reader", async () => {
  const { dc, idb } = await modules();
  let release!: (response: Response) => void;
  fetcher.mockReturnValue(new Promise<Response>(resolve => { release = resolve; }));
  dc.prefetch(url);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const joined = dc.getJSONResult(url);
  release(new Response(JSON.stringify({ symbols: [] })));
  await expect(joined).resolves.toMatchObject({ status: "unavailable", reason: "malformed" });
  expect(dc.peek(url)).toBeUndefined();
  expect(await idb.idbGet(url)).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("a reader joining an invalid refresh receives the same retained stale scan", async () => {
  const { dc, idb } = await modules();
  const ts = Date.now() - 3600000;
  await idb.idbPut(url, old, ts);
  let release!: (response: Response) => void;
  fetcher.mockReturnValue(new Promise<Response>(resolve => { release = resolve; }));
  const owner = await dc.getJSONResult(url);
  const joined = dc.getJSONResult(url);
  release(new Response(JSON.stringify({ symbols: [] })));
  expect(owner).toMatchObject({ status: "data", data: old });
  await expect(joined).resolves.toMatchObject({ status: "data", data: old, stale: { source: "disk" } });
  expect(await idb.idbGet(url)).toMatchObject({ data: old, ts });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
