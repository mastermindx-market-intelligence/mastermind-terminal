import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { readRetainedMatrix } from "../flowSource";
import { retainedFixture, principal } from "./fixtures/retainedMatrixReadFixture";
import { FLOW_BACKEND } from "../upstreams";
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
it("calls the registered Matrix path with exact query and same-token principal assertion", async () => {
  const { request, response } = retainedFixture(); const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => response }); vi.stubGlobal("fetch", fetcher);
  expect(await readRetainedMatrix(request, "inert-server-token")).toEqual(response);
  const [url, options] = fetcher.mock.calls[0]; const parsed = new URL(url);
  expect(url.startsWith(FLOW_BACKEND + "/api/hub/matrix/SPY?")).toBe(true);
  expect(parsed.searchParams.get("selection")).toBe(request.selection);
  expect([...parsed.searchParams.keys()].sort()).toEqual(["retained", "version_ref", "sha256", "session", "expiry", "side", "selection"].sort());
  expect(options.headers).toEqual({ Authorization: "Bearer inert-server-token", "X-Mastermind-Expected-Principal": principal }); expect(options.cache).toBe("no-store");
});
it.each(["404", "network", "malformed", "substitution"])("has zero fallback for %s", async state => {
  const { request, response } = retainedFixture(); response.retained.owner_id = "wrong";
  const fetcher = vi.fn().mockImplementation(async () => { if (state === "network") throw new Error("transport"); return { ok: state !== "404", json: async () => state === "malformed" ? {} : response }; }); vi.stubGlobal("fetch", fetcher);
  expect(await readRetainedMatrix(request, "inert")).toMatchObject({ status: "unavailable", display: null, retained: null }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not read without actual server token or exact concrete request", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); const { request } = retainedFixture();
  await readRetainedMatrix(request, ""); await readRetainedMatrix({ ...request, expiry: "all" }, "inert"); expect(fetcher).not.toHaveBeenCalled();
});
