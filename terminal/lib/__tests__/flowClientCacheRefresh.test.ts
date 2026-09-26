import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { flowGet, flowInvalidate } from "@/lib/flowClientCache";
// Proposed additive refresh contract; original JavaScript ignores the extra argument.
// The mounted tests independently reproduce the existing user-visible defect.
const read = flowGet as (key: string, options?: { refresh?: boolean }) => Promise<unknown>;

beforeEach(() => { flowInvalidate(); vi.useFakeTimers(); });
afterEach(() => { flowInvalidate(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("an explicit refresh awaits the newest response instead of returning a stale index", async () => {
  let value = 1;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ value }))));
  expect(await read("surface_idx:SPY")).toEqual({ value: 1 });
  value = 2;
  await vi.advanceTimersByTimeAsync(26_000);
  expect(await read("surface_idx:SPY", { refresh: true })).toEqual({ value: 2 });
});

it("explicit refresh deduplicates an already active request", async () => {
  let finish!: (value: Response) => void;
  const request = new Promise<Response>((resolve) => { finish = resolve; });
  const transport = vi.fn(() => request);
  vi.stubGlobal("fetch", transport);
  const first = read("surface_idx:SPY", { refresh: true });
  const second = read("surface_idx:SPY", { refresh: true });
  expect(transport).toHaveBeenCalledTimes(1);
  finish(new Response(JSON.stringify({ value: 3 })));
  expect(await first).toEqual({ value: 3 });
  expect(await second).toEqual({ value: 3 });
});

it("default reads still return a fresh cached response", async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify({ value: 1 })));
  vi.stubGlobal("fetch", transport);
  await read("gex:SPY");
  await read("gex:SPY");
  expect(transport).toHaveBeenCalledTimes(1);
});

it("an explicit failed refresh reports null, not a cached success", async () => {
  const transport = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ value: 1 })))
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  vi.stubGlobal("fetch", transport);
  await read("surface_idx:SPY");
  expect(await read("surface_idx:SPY", { refresh: true })).toBeNull();
});
