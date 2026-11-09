import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { retainedFixture, principal, secondPrincipal } from "./fixtures/retainedMatrixReadFixture";
import { prepareRetainedMatrixRequest, validateRetainedMatrixResponse, parseRetainedQuery, retainedQuery, retainedUnavailable } from "../retainedMatrixRead";
import { flowGet, flowGetResult, flowInvalidate } from "../flowClientCache";
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); flowInvalidate(); });
afterEach(() => { vi.unstubAllGlobals(); flowInvalidate(); });
it("keeps the exact wire and same captured display paired to the exact request", async () => {
  const { response, request } = retainedFixture();
  expect(await validateRetainedMatrixResponse(response, request)).toEqual(response);
  expect(response.retained.wire_utf8).toContain("9007199254740993");
});
it.each(["all", "bad-expiry", "no-primary", "no-owner", "no-identity"])("refuses %s before transport", what => {
  const { input } = retainedFixture();
  if (what === "all") input.view.expiry = "all";
  if (what === "bad-expiry") input.view.expiry = "0000-10-30";
  const candidate = { ...input, primary: what === "no-primary" ? null : input.primary, matrix: what === "no-identity" ? null : input.matrix };
  expect(prepareRetainedMatrixRequest(candidate, what === "no-owner" ? null : `account:${principal}`)).toBeNull();
});
it.each(["owner", "session", "digest", "expiry", "side", "selection", "length", "wire", "display", "extra"])("refuses substituted %s with no partial pair", async what => {
  const { response, request } = retainedFixture(); const r = response.retained;
  if (what === "owner") r.owner_id = secondPrincipal;
  if (what === "session") r.reference.session = "2026-10-20";
  if (what === "digest") r.reference.sha256 = "a".repeat(64);
  if (what === "expiry") r.selector.expiry = "2026-11-20";
  if (what === "side") r.selector.side = "put";
  if (what === "selection") r.selection_sha256 = "b".repeat(64);
  if (what === "length") r.reference.byte_length++;
  if (what === "wire") r.wire_utf8 = "{}";
  if (what === "display") response.display.coverage = "unrelated cached object";
  if (what === "extra") Object.assign(response, { token: "not permitted" });
  expect(await validateRetainedMatrixResponse(response, request)).toMatchObject({ status: "unavailable", display: null, retained: null });
});
it("accepts honest unavailable only without a partial pair", async () => {
  const { request, response } = retainedFixture();
  expect(await validateRetainedMatrixResponse(retainedUnavailable("not_bound"), request)).toEqual(retainedUnavailable("not_bound"));
  expect(await validateRetainedMatrixResponse({ ...retainedUnavailable(), display: response.display }, request)).toEqual(retainedUnavailable("invalid_response"));
});
it.each(["duplicate", "extra", "wrong-mode"])("rejects %s query", what => {
  const { request } = retainedFixture(); const query = retainedQuery(request); query.set("f", "matrix:SPY");
  expect(parseRetainedQuery(query, "SPY", request.ownerKey)).toEqual(request);
  if (what === "duplicate") query.append("side", "call");
  if (what === "extra") query.set("cutoff", "2099-01-01");
  if (what === "wrong-mode") query.set("retained", "true");
  expect(parseRetainedQuery(query, "SPY", request.ownerKey)).toBeNull();
});
const ok = (data: unknown) => ({ ok: true, json: async () => data });
it("bypasses a warm ordinary cache and never stores the private result in it", async () => {
  const { response, request } = retainedFixture(); const fetcher = vi.fn().mockResolvedValueOnce(ok({ ordinary: true })).mockResolvedValue(ok(response)); vi.stubGlobal("fetch", fetcher);
  expect(await flowGet("matrix:SPY")).toEqual({ ordinary: true });
  expect(await flowGetResult("matrix:SPY", { retained: request })).toEqual({ status: "data", data: response.display, retained: response });
  expect(await flowGet("matrix:SPY")).toEqual({ ordinary: true });
  await flowGetResult("matrix:SPY", { retained: request }); expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[1][1].headers).toEqual({ "X-Mastermind-Expected-Principal": principal });
});
it("does not join an ordinary inflight or another principal's private read", async () => {
  let finish!: (data: unknown) => void; const a = retainedFixture(), b = retainedFixture(secondPrincipal);
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(ok(a.response)).mockResolvedValueOnce(ok(b.response)); vi.stubGlobal("fetch", fetcher);
  const ordinary = flowGet("matrix:SPY");
  const [ra, rb] = await Promise.all([flowGetResult("matrix:SPY", { retained: a.request }), flowGetResult("matrix:SPY", { retained: b.request })]);
  expect(ra).toMatchObject({ retained: { retained: { owner_id: principal } } }); expect(rb).toMatchObject({ retained: { retained: { owner_id: secondPrincipal } } });
  finish(ok({ ordinary: true })); expect(await ordinary).toEqual({ ordinary: true }); expect(fetcher).toHaveBeenCalledTimes(3);
});
it("invalid request makes no read; qualified 404 does not assert source absence", async () => {
  const { request } = retainedFixture(); const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 }); vi.stubGlobal("fetch", fetcher);
  expect(await flowGetResult("matrix:SPY", { retained: { ...request, expiry: "all" } })).toMatchObject({ status: "unavailable" }); expect(fetcher).not.toHaveBeenCalled();
  expect(await flowGetResult("matrix:SPY", { retained: request })).toEqual({ status: "unavailable", reason: "server" });
});

it("binds an inflight read to a value snapshot even if its caller mutates the input object", async () => {
  const { request, response } = retainedFixture(); const mutable = { ...request };
  let finish!: (value: unknown) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
  const read = flowGetResult("matrix:SPY", { retained: mutable });
  mutable.ownerKey = `account:${secondPrincipal}`; mutable.expiry = "2026-11-20";
  finish(ok(response)); expect(await read).toEqual({ status: "data", data: response.display, retained: response });
  expect(Object.isFrozen(request)).toBe(true);
});

it("does not qualify a rounded large-decimal selector as the captured exact coordinate", async () => {
  const exact = "123456789012.12345678";
  const { request, response } = retainedFixture(principal, exact);
  expect(JSON.parse(request.selection).primary.strike).not.toBe(exact);
  expect(response.retained.wire_utf8).toContain(exact);
  expect(await validateRetainedMatrixResponse(response, request)).toMatchObject({ status: "unavailable", retained: null });
});
