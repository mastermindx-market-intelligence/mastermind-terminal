import { expect, test, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import { createServer, type Server, type ServerResponse } from "node:http";
import path from "node:path";

// Native-IndexedDB witness for the dataCache invalidation fence.
//
// The real lib/dataCache.ts + lib/idbJsonStore.ts run in the browser against the browser's own
// IndexedDB and fetch. A readwrite "blocker" transaction holds the store for ~80ms (well inside the
// 250ms read timeout), so the cache's read-back is genuinely DELAYED: it is queued behind the
// blocker, and the `invalidate()` delete is queued behind the read. IndexedDB then serves the read
// the record the delete is about to remove — the browser's own ordering, not a mock. Every case
// asserts `_isIdbDead() === false` so a timed-out read (which would also skip the disk) cannot pass
// for the fence.
const bundle = buildSync({
  stdin: {
    contents: `export { getJSONResult, prefetch, invalidate, peek } from "./lib/dataCache";
      export { idbPut, _isIdbDead } from "./lib/idbJsonStore";`,
    resolveDir: process.cwd(), sourcefile: "cache-epoch-harness.ts", loader: "ts",
  },
  bundle: true, write: false, format: "iife", globalName: "DC", platform: "browser",
  tsconfig: path.resolve(process.cwd(), "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"' },
}).outputFiles[0].text;

// Raw IndexedDB helpers over the same database the cache uses.
const helpers = `window.H = {
  open() { return new Promise((res, rej) => { const r = indexedDB.open("mm-data-cache");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  block(db, ms) { const tx = db.transaction("json", "readwrite"); const s = tx.objectStore("json");
    const end = performance.now() + ms; const spin = () => { if (performance.now() < end) s.get("__hold__").onsuccess = spin; };
    spin(); return new Promise((res) => { tx.oncomplete = res; }); },
  read(db, url) { return new Promise((res) => { const r = db.transaction("json", "readonly").objectStore("json").get(url);
    r.onsuccess = () => res(r.result ? r.result.data : null); r.onerror = () => res("error"); }); },
  async settle(db) { await this.read(db, "__probe__"); await new Promise((r) => setTimeout(r, 30)); },
};`;

type Outcome = { status: string; data?: unknown; httpStatus?: number; reason?: string };
interface Harness {
  DC: {
    getJSONResult(url: string): Promise<Outcome>; prefetch(url: string): void; invalidate(url?: string): void;
    peek(url: string): unknown; idbPut(url: string, data: unknown, ts: number): Promise<void>; _isIdbDead(): boolean;
  };
  H: {
    open(): Promise<IDBDatabase>; block(db: IDBDatabase, ms: number): Promise<void>;
    read(db: IDBDatabase, url: string): Promise<unknown>; settle(db: IDBDatabase): Promise<void>;
  };
  outdated?: Promise<Outcome>;
}

type Plan = { status?: number; hold?: boolean };
let server: Server;
let origin = "";
const hits = new Map<string, number>();
const plans = new Map<string, Plan>();
const held: Array<{ path: string; response: ServerResponse }> = [];

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = (request.url ?? "/").split("?")[0];
    if (url.startsWith("/data/")) {
      hits.set(url, (hits.get(url) ?? 0) + 1);
      const plan = plans.get(url) ?? {};
      if (plan.hold) { plans.set(url, {}); held.push({ path: url, response }); return; }
      const status = plan.status ?? 200;
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(status === 200 ? JSON.stringify({ v: `NEW:${url}` }) : "{}");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<!doctype html><meta name="viewport" content="width=device-width"><title>cache</title>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(() => { hits.clear(); plans.clear(); held.length = 0; });

async function boot(page: Page): Promise<void> {
  await page.goto(origin, { timeout: 20_000 });
  await page.addScriptTag({ content: bundle });
  await page.addScriptTag({ content: helpers });
}
const NEW = (url: string) => ({ v: `NEW:${url}` });
const OLD = { v: "OLD" };

test("a delayed read-back across invalidate(url) answers and stores the new network value", async ({ page }) => {
  await boot(page);
  const U = "/data/PERKEY.json";
  const out = await page.evaluate(async ({ U, OLD }) => {
    const { DC, H } = window as unknown as Harness;
    await DC.idbPut(U, OLD, Date.now());                      // fresh on disk: would skip the network
    const db = await H.open();
    const blocked = H.block(db, 80);
    const pending = DC.getJSONResult(U);                     // read queued behind the blocker
    DC.invalidate(U);                                        // delete queued behind the read
    const result = await pending;
    await blocked; await H.settle(db);
    return { result, peek: DC.peek(U), dead: DC._isIdbDead(), disk: await H.read(db, U) };
  }, { U, OLD });
  expect(out.dead).toBe(false);
  expect(out.result).toEqual({ status: "data", data: NEW(U) });
  expect(out.peek).toEqual(NEW(U));
  expect(out.disk).toEqual(NEW(U));
  expect(hits.get(U)).toBe(1);
});

test("a delayed prefetch read-back across invalidate(url) does not repopulate memory", async ({ page }) => {
  await boot(page);
  const U = "/data/PREFETCH.json";
  const out = await page.evaluate(async ({ U, OLD }) => {
    const { DC, H } = window as unknown as Harness;
    await DC.idbPut(U, OLD, Date.now());
    const db = await H.open();
    const blocked = H.block(db, 80);
    DC.prefetch(U);
    DC.invalidate(U);
    await blocked; await H.settle(db);
    const peekAfterPrefetch = DC.peek(U) ?? null;
    const next = await DC.getJSONResult(U);
    return { peekAfterPrefetch, next, dead: DC._isIdbDead() };
  }, { U, OLD });
  expect(out.dead).toBe(false);
  expect(out.peekAfterPrefetch).toBeNull();
  expect(out.next).toEqual({ status: "data", data: NEW(U) });
  expect(hits.get(U)).toBe(1);
});

test("a whole-cache clear fences several delayed reads and prefetches", async ({ page }) => {
  await boot(page);
  const [A, B, C, D] = ["/data/GA.json", "/data/GB.json", "/data/GC.json", "/data/GD.json"];
  const out = await page.evaluate(async ({ urls, OLD }) => {
    const { DC, H } = window as unknown as Harness;
    const [A, B, C, D] = urls;
    for (const url of urls) await DC.idbPut(url, OLD, Date.now());
    const db = await H.open();
    const blocked = H.block(db, 80);
    const reads = [DC.getJSONResult(A), DC.getJSONResult(B)];
    DC.prefetch(C); DC.prefetch(D);
    DC.invalidate();
    const results = await Promise.all(reads);
    await blocked; await H.settle(db);
    return {
      results, dead: DC._isIdbDead(),
      peekC: DC.peek(C) ?? null, peekD: DC.peek(D) ?? null,
      diskC: await H.read(db, C), diskD: await H.read(db, D),
    };
  }, { urls: [A, B, C, D], OLD });
  expect(out.dead).toBe(false);
  expect(out.results).toEqual([{ status: "data", data: NEW(A) }, { status: "data", data: NEW(B) }]);
  expect(out.peekC).toBeNull();
  expect(out.peekD).toBeNull();
  expect(out.diskC).toBeNull();
  expect(out.diskD).toBeNull();
  expect([hits.get(A), hits.get(B), hits.get(C) ?? 0, hits.get(D) ?? 0]).toEqual([1, 1, 0, 0]);
});

test("an outdated network success resolving after the post-invalidation read stays out of memory and disk", async ({ page }) => {
  await boot(page);
  const U = "/data/LATE.json";
  plans.set(U, { hold: true });
  await page.evaluate((U) => { (window as unknown as Harness).outdated = (window as unknown as Harness).DC.getJSONResult(U); }, U);
  await expect.poll(() => held.length, { timeout: 20_000 }).toBe(1);
  const fresh = await page.evaluate(async (U) => {
    const { DC } = window as unknown as Harness;
    DC.invalidate(U);
    return DC.getJSONResult(U);
  }, U);
  expect(fresh).toEqual({ status: "data", data: NEW(U) });
  const late = held[0].response;
  late.writeHead(200, { "Content-Type": "application/json" });
  late.end(JSON.stringify(OLD));
  const out = await page.evaluate(async (U) => {
    const { DC, H } = window as unknown as Harness;
    const outdated = await (window as unknown as Harness).outdated;
    const db = await H.open(); await H.settle(db);
    return { outdated, peek: DC.peek(U), disk: await H.read(db, U) };
  }, U);
  expect(out.outdated).toEqual({ status: "data", data: OLD });   // its own request's answer
  expect(out.peek).toEqual(NEW(U));
  expect(out.disk).toEqual(NEW(U));
  expect(hits.get(U)).toBe(2);
});

test("after invalidation a 404 stays absent and a 503 stays unavailable, never the old disk copy", async ({ page }) => {
  await boot(page);
  const [GONE, DOWN] = ["/data/GONE.json", "/data/DOWN.json"];
  plans.set(GONE, { status: 404 });
  plans.set(DOWN, { status: 503 });
  const out = await page.evaluate(async ({ GONE, DOWN, OLD }) => {
    const { DC, H } = window as unknown as Harness;
    await DC.idbPut(GONE, OLD, Date.now());
    await DC.idbPut(DOWN, OLD, Date.now());
    const db = await H.open();
    const blocked = H.block(db, 80);
    const gone = DC.getJSONResult(GONE);
    const down = DC.getJSONResult(DOWN);
    DC.invalidate(GONE); DC.invalidate(DOWN);
    const results = [await gone, await down];
    await blocked; await H.settle(db);
    const goneAgain = await DC.getJSONResult(GONE);
    return { results, goneAgain, peekDown: DC.peek(DOWN) ?? null, dead: DC._isIdbDead() };
  }, { GONE, DOWN, OLD });
  expect(out.dead).toBe(false);
  expect(out.results).toEqual([
    { status: "absent", httpStatus: 404 },
    { status: "unavailable", reason: "server", httpStatus: 503 },
  ]);
  expect(out.goneAgain).toEqual({ status: "absent" });            // remembered: no second request
  expect(out.peekDown).toBeNull();
  expect(hits.get(GONE)).toBe(1);
  expect(hits.get(DOWN)).toBe(1);
});

test("repeated navigation and a same-symbol correction converge on one request", async ({ page }) => {
  await boot(page);
  const U = "/data/FANOUT.json";
  const out = await page.evaluate(async ({ U, OLD }) => {
    const { DC, H } = window as unknown as Harness;
    await DC.idbPut(U, OLD, Date.now());
    const db = await H.open();
    const blocked = H.block(db, 80);
    const readers = [DC.getJSONResult(U), DC.getJSONResult(U), DC.getJSONResult(U)];
    DC.prefetch(U); DC.prefetch(U);
    DC.invalidate(U);
    DC.invalidate(U);
    const results = await Promise.all(readers);
    await blocked; await H.settle(db);
    return { results, peek: DC.peek(U), again: await DC.getJSONResult(U), dead: DC._isIdbDead() };
  }, { U, OLD });
  expect(out.dead).toBe(false);
  expect(out.results).toEqual(Array(3).fill({ status: "data", data: NEW(U) }));
  expect(out.peek).toEqual(NEW(U));
  expect(out.again).toEqual({ status: "data", data: NEW(U) });
  expect(hits.get(U)).toBe(1);
});

test("a read-back that outlives the timeout still latches the store off and costs one request", async ({ page }) => {
  await boot(page);
  const U = "/data/LATCH.json";
  const out = await page.evaluate(async ({ U, OLD }) => {
    const { DC, H } = window as unknown as Harness;
    await DC.idbPut(U, OLD, Date.now());
    const db = await H.open();
    const blocked = H.block(db, 400);                        // past the 250ms read budget
    const pending = DC.getJSONResult(U);
    DC.invalidate(U);
    const result = await pending;
    await blocked;
    return { result, dead: DC._isIdbDead() };
  }, { U, OLD });
  expect(out.dead).toBe(true);
  expect(out.result).toEqual({ status: "data", data: NEW(U) });
  expect(hits.get(U)).toBe(1);
});
